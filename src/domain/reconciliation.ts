import BigNumber from 'bignumber.js';
import type { MerchantSettings, Invoice } from '../types';
import type { Document } from './store';
import { invoiceFinancials } from './financial';
import { dateOnly, identifier, money, validateJournal } from './validation';

export const financialCollections = ['customers', 'products', 'invoices', 'payments', 'expenses', 'inventory_movements', 'accounts', 'journal_entries'] as const;
export type FinancialCollection = typeof financialCollections[number];
export type FinancialData = Record<FinancialCollection, Document[]>;
export interface Finding {
  code: string;
  collection: string;
  id: string;
  field?: string;
  expected?: number;
  actual?: number;
  message?: string;
}

/** Read-only consistency checks. A finding requires review, never an automatic historical rewrite. */
export function reconcileFinancialData(data: FinancialData, settings: MerchantSettings): Finding[] {
  const findings: Finding[] = [];
  const add = (code: string, collection: string, id: string, extra: Partial<Finding> = {}) => findings.push({ code, collection, id, ...extra });
  const compare = (collection: string, id: string, field: string, expected: number, actual: number) => {
    if (!new BigNumber(expected).eq(actual)) add('balance_difference', collection, id, { field, expected, actual });
  };
  const inspect = (collection: string, id: string, work: () => void) => {
    try { work(); } catch (error) { add('invalid_record', collection, id, { message: error instanceof Error ? error.message : 'بيانات غير صالحة.' }); }
  };
  const indexes = Object.fromEntries(financialCollections.map(name => [name, new Map<string, Document>()])) as Record<FinancialCollection, Map<string, Document>>;
  for (const name of financialCollections) for (const row of data[name]) {
    const id = name === 'accounts' ? row.code : row.id;
    inspect(name, String(id), () => { identifier(id); });
    if (indexes[name].has(id)) add('duplicate_id', name, String(id));
    indexes[name].set(id, row);
  }
  const entriesByReference = new Map<string, Document[]>();
  let arSdg = new BigNumber(0), arUsd = new BigNumber(0);
  for (const entry of data.journal_entries) {
    inspect('journal_entries', entry.id, () => {
      dateOnly(entry.date); validateJournal(entry.lines);
      for (const line of entry.lines) {
        if (!indexes.accounts.has(line.account_code)) add('missing_account', 'journal_entries', entry.id, { message: line.account_code });
        if (line.account_code === '1200') { arSdg = arSdg.plus(line.debit_sdg).minus(line.credit_sdg); arUsd = arUsd.plus(line.debit_usd).minus(line.credit_usd); }
      }
    });
    const key = `${entry.reference_type}:${entry.reference_id}`;
    entriesByReference.set(key, [...entriesByReference.get(key) || [], entry]);
  }
  const sourceEntries = (type: string, id: string) => entriesByReference.get(`${type}:${id}`) || [];
  const paymentsByInvoice = new Map<string, Document[]>();
  for (const payment of data.payments) {
    const invoice = indexes.invoices.get(payment.invoice_id);
    if (!invoice || invoice.customer_id !== payment.customer_id) add('missing_invoice_or_customer', 'payments', payment.id);
    const entries = sourceEntries('payment', payment.id);
    if (entries.length !== 1) add('missing_or_duplicate_journal', 'payments', payment.id);
    inspect('payments', payment.id, () => { dateOnly(payment.payment_date); money(payment.amount, payment.currency === 'USD' ? 2 : 0, true); });
    paymentsByInvoice.set(payment.invoice_id, [...paymentsByInvoice.get(payment.invoice_id) || [], payment]);
    for (const [field, code, side] of [['settled_amount_sdg', '1200', 'credit_sdg'], ['settled_amount_usd', '1200', 'credit_usd'], ['cash_amount_sdg', '11', 'debit_sdg'], ['cash_amount_usd', '11', 'debit_usd']] as const) {
      if (payment[field] !== undefined) compare('payments', payment.id, field, entries.flatMap(e => e.lines || []).filter(l => code === '11' ? l.account_code?.startsWith(code) : l.account_code === code).reduce((n, l) => n.plus(l[side] || 0), new BigNumber(0)).toNumber(), payment[field]);
    }
  }
  const customerTotals = new Map<string, { sdg: BigNumber; usd: BigNumber }>();
  const invoiceNumbers = new Set<string>();
  let remainingSdg = new BigNumber(0), remainingUsd = new BigNumber(0);
  for (const invoice of data.invoices) {
    if (!indexes.customers.has(invoice.customer_id)) add('missing_customer', 'invoices', invoice.id);
    if (invoiceNumbers.has(invoice.invoice_number)) add('duplicate_invoice_number', 'invoices', invoice.id);
    invoiceNumbers.add(invoice.invoice_number);
    inspect('invoices', invoice.id, () => {
      dateOnly(invoice.issue_date);
      const calculated = invoiceFinancials(invoice as Invoice, settings);
      for (const field of ['subtotal_sdg', 'subtotal_usd', 'discount_total_sdg', 'discount_total_usd', 'tax_total_sdg', 'tax_total_usd', 'grand_total_sdg', 'grand_total_usd'] as const) compare('invoices', invoice.id, field, calculated[field], invoice[field]);
      money(invoice.remaining_sdg, 0); money(invoice.remaining_usd, 2); money(invoice.paid_amount_sdg, 0); money(invoice.paid_amount_usd, 2);
      for (const item of invoice.items) if (item.product_id && !indexes.products.has(item.product_id)) add('missing_product', 'invoices', invoice.id, { message: item.product_id });
      if (invoice.status === 'draft') return;
      const originals = sourceEntries('invoice', invoice.id);
      if (originals.length !== 1) add('missing_or_duplicate_journal', 'invoices', invoice.id);
      const related = [...originals, ...sourceEntries('void', invoice.id), ...(paymentsByInvoice.get(invoice.id) || []).flatMap(p => sourceEntries('payment', p.id))];
      for (const currency of ['sdg', 'usd'] as const) {
        const ledger = related.flatMap(e => e.lines || []).filter(l => l.account_code === '1200').reduce((n, l) => n.plus(l[`debit_${currency}`] || 0).minus(l[`credit_${currency}`] || 0), new BigNumber(0));
        compare('invoices', invoice.id, `remaining_${currency}`, ledger.toNumber(), invoice[`remaining_${currency}`]);
        if (!['void', 'cancelled'].includes(invoice.status)) compare('invoices', invoice.id, `paid_plus_remaining_${currency}`, invoice[`grand_total_${currency}`], new BigNumber(invoice[`paid_amount_${currency}`]).plus(invoice[`remaining_${currency}`]).toNumber());
      }
      remainingSdg = remainingSdg.plus(invoice.remaining_sdg); remainingUsd = remainingUsd.plus(invoice.remaining_usd);
      const total = customerTotals.get(invoice.customer_id) || { sdg: new BigNumber(0), usd: new BigNumber(0) };
      customerTotals.set(invoice.customer_id, { sdg: total.sdg.plus(invoice.remaining_sdg), usd: total.usd.plus(invoice.remaining_usd) });
    });
  }
  for (const customer of data.customers) {
    const total = customerTotals.get(customer.id);
    compare('customers', customer.id, 'balance_sdg', total?.sdg.toNumber() || 0, customer.balance_sdg);
    compare('customers', customer.id, 'balance_usd', total?.usd.toNumber() || 0, customer.balance_usd);
  }
  compare('journal_entries', 'AR-control', 'outstanding_sdg', remainingSdg.toNumber(), arSdg.toNumber());
  compare('journal_entries', 'AR-control', 'outstanding_usd', remainingUsd.toNumber(), arUsd.toNumber());
  const movementTotals = new Map<string, BigNumber>();
  for (const movement of data.inventory_movements) {
    if (!indexes.products.has(movement.product_id)) add('missing_product', 'inventory_movements', movement.id);
    inspect('inventory_movements', movement.id, () => { money(movement.previous_stock, 6); money(movement.resulting_stock, 6); money(Math.abs(movement.quantity), 6); });
    compare('inventory_movements', movement.id, 'resulting_stock', new BigNumber(movement.previous_stock).plus(movement.quantity).toNumber(), movement.resulting_stock);
    movementTotals.set(movement.product_id, (movementTotals.get(movement.product_id) || new BigNumber(0)).plus(movement.quantity));
  }
  for (const product of data.products) if (product.track_inventory) {
    compare('products', product.id, 'stock_quantity', movementTotals.get(product.id)?.toNumber() || 0, product.stock_quantity || 0);
  }
  for (const expense of data.expenses) {
    if (sourceEntries('expense', expense.id).length !== 1) add('missing_or_duplicate_journal', 'expenses', expense.id);
    if (expense.voided_at && sourceEntries('void', expense.id).length !== 1) add('missing_reversal', 'expenses', expense.id);
  }
  return findings;
}
