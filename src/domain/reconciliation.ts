import { equityCollections, reconcileEquitySources } from './ownerEquitySources';
import { periodCollections, validatePeriods } from './periodContracts';
import { reconcileAuditArchives } from './auditArchives';
import BigNumber from 'bignumber.js';
import type { MerchantSettings, Invoice } from '../types';
import type { Document } from './store';
import { validateCostState } from './inventoryCost';
import { classifyAccount } from './accountClassification';
import { generateExpenseJournalEntry } from '../services/accountingService';
import { buildSalesReturnBases } from './returnSources';
import { invoiceFinancials } from './financial';
import { cashReconciliationCollections, reconcileCashSessions } from './cashReconciliation';
import { cashCollections, reconcileCashManagement } from './cashManagement';
import { purchaseCorrectionCollections, reconcilePurchaseCorrections } from './purchaseCorrections';
import { payableCollections, reconcilePayables } from './payables';
import { salesCorrectionCollections, reconcileSalesCorrections, invoiceSignedBalance } from './salesCorrections';
import { dateOnly, identifier, money, validateJournal } from './validation';
import { verifyOpeningSources } from './openingSources';
import { openingCollections } from './openingCollections';
import { hasOpeningSources, openingOrganization } from './openingIntegration';

export const financialCollections = [...equityCollections, ...periodCollections, ...openingCollections, 'audit_archives', 'customers', 'products', 'invoices', 'payments', 'expenses', 'inventory_movements', 'accounts', 'journal_entries', ...payableCollections, ...cashCollections, ...cashReconciliationCollections, ...salesCorrectionCollections, ...purchaseCorrectionCollections] as const;
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
export function reconcileFinancialData(data: FinancialData, settings: MerchantSettings, options: { requireCosting?: boolean } = {}): Finding[] {
  const findings: Finding[] = [];
  const add = (code: string, collection: string, id: string, extra: Partial<Finding> = {}) => findings.push({ code, collection, id, ...extra });
  const compare = (collection: string, id: string, field: string, expected: number, actual: number) => {
    if (!new BigNumber(expected).eq(actual)) add('balance_difference', collection, id, { field, expected, actual });
  };
  const inspect = (collection: string, id: string, work: () => void) => {
    try { work(); } catch (error) { add('invalid_record', collection, id, { message: error instanceof Error ? error.message : 'بيانات غير صالحة.' }); }
  };
  inspect('accounting_periods','periods',()=>validatePeriods(data.accounting_periods||[]));
  const indexes = Object.fromEntries(financialCollections.map(name => [name, new Map<string, Document>()])) as Record<FinancialCollection, Map<string, Document>>;
  for (const name of financialCollections) for (const row of data[name] || []) {
    const id = name === 'accounts' ? row.code : row.id;
    inspect(name, String(id), () => { identifier(id); });
    if (indexes[name].has(id)) add('duplicate_id', name, String(id));
    indexes[name].set(id, row);
  }
  for (const account of data.accounts) inspect('accounts', account.code, () => { classifyAccount(account as any); });
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
  const openingCustomerTotals = new Map<string,{sdg:BigNumber;usd:BigNumber}>();
  const invoiceNumbers = new Set<string>();
  let remainingSdg = new BigNumber(0), remainingUsd = new BigNumber(0);
  if(hasOpeningSources(data))inspect('opening_batches','sources',()=>{
    const verified=verifyOpeningSources(data,openingOrganization(data));
    for(const lot of verified.lots.filter(row=>row.kind==='receivable')) {
      const state=verified.states.get(lot.id)!,total=openingCustomerTotals.get(lot.party_id)||{sdg:new BigNumber(0),usd:new BigNumber(0)};
      openingCustomerTotals.set(lot.party_id,{sdg:total.sdg.plus(state.sdg),usd:total.usd.plus(state.usd)});
      remainingSdg=remainingSdg.plus(state.sdg);remainingUsd=remainingUsd.plus(state.usd);
    }
    for(const [id,total] of openingCustomerTotals)customerTotals.set(id,total);
  });
  for (const invoice of data.invoices) {
    if (!indexes.customers.has(invoice.customer_id)) add('missing_customer', 'invoices', invoice.id);
    if (invoiceNumbers.has(invoice.invoice_number)) add('duplicate_invoice_number', 'invoices', invoice.id);
    invoiceNumbers.add(invoice.invoice_number);
    inspect('invoices', invoice.id, () => {
      dateOnly(invoice.issue_date);
      const hasCorrections = (data.credit_notes || []).some(row => row.invoice_id === invoice.id);
      const originalRule = hasCorrections ? buildSalesReturnBases(invoice as Invoice, sourceEntries('invoice', invoice.id) as any, invoice.org_id).rounding_rule : settings.rounding_rule;
      const calculated = invoiceFinancials(invoice as Invoice, { ...settings, rounding_rule: originalRule });
      for (const field of ['subtotal_sdg', 'subtotal_usd', 'discount_total_sdg', 'discount_total_usd', 'tax_total_sdg', 'tax_total_usd', 'grand_total_sdg', 'grand_total_usd'] as const) compare('invoices', invoice.id, field, calculated[field], invoice[field]);
      money(invoice.remaining_sdg, 0); money(invoice.remaining_usd, 2); money(invoice.paid_amount_sdg, 0); money(invoice.paid_amount_usd, 2);
      for (const item of invoice.items) if (item.product_id && !indexes.products.has(item.product_id)) add('missing_product', 'invoices', invoice.id, { message: item.product_id });
      if (invoice.status === 'draft') return;
      const originals = sourceEntries('invoice', invoice.id);
      if (originals.length !== 1) add('missing_or_duplicate_journal', 'invoices', invoice.id);
      const corrected = (data.credit_notes || []).filter(note => note.invoice_id === invoice.id), refunds = (data.customer_refunds || []).filter(refund => refund.invoice_id === invoice.id);
      const related = [...corrected.flatMap(note => sourceEntries('credit_note', note.id)), ...refunds.flatMap(refund => sourceEntries('customer_refund', refund.id)), ...originals, ...sourceEntries('void', invoice.id), ...(paymentsByInvoice.get(invoice.id) || []).flatMap(p => sourceEntries('payment', p.id))];
      for (const currency of ['sdg', 'usd'] as const) {
        const ledger = related.flatMap(e => e.lines || []).filter(l => l.account_code === '1200').reduce((n, l) => n.plus(l[`debit_${currency}`] || 0).minus(l[`credit_${currency}`] || 0), new BigNumber(0));
        compare('invoices', invoice.id, `remaining_${currency}`, ledger.toNumber(), invoiceSignedBalance(invoice)[currency]);
        if (!corrected.length && !refunds.length && !['void', 'cancelled'].includes(invoice.status)) compare('invoices', invoice.id, `paid_plus_remaining_${currency}`, invoice[`grand_total_${currency}`], new BigNumber(invoice[`paid_amount_${currency}`]).plus(invoice[`remaining_${currency}`]).toNumber());
      }
      remainingSdg = remainingSdg.plus(invoiceSignedBalance(invoice).sdg); remainingUsd = remainingUsd.plus(invoiceSignedBalance(invoice).usd);
      const total = customerTotals.get(invoice.customer_id) || { sdg: new BigNumber(0), usd: new BigNumber(0) };
      customerTotals.set(invoice.customer_id, { sdg: total.sdg.plus(invoiceSignedBalance(invoice).sdg), usd: total.usd.plus(invoiceSignedBalance(invoice).usd) });
    });
  }
  for (const customer of data.customers) {
    const total = customerTotals.get(customer.id);
    compare('customers', customer.id, 'balance_sdg', total?.sdg.toNumber() || 0, customer.balance_sdg);
    compare('customers', customer.id, 'balance_usd', total?.usd.toNumber() || 0, customer.balance_usd);
    for (const book of ['sdg','usd'] as const) for (const prefix of ['receivable_due','credit_balance']) if (customer[`${prefix}_${book}`] !== undefined) compare('customers', customer.id, `${prefix}_${book}`, data.invoices.filter(invoice => invoice.customer_id === customer.id && !['void','cancelled','draft'].includes(invoice.status)).reduce((n, invoice) => n.plus(invoice[`${prefix === 'receivable_due' ? 'remaining' : prefix}_${book}`] || 0), prefix==='receivable_due'?openingCustomerTotals.get(customer.id)?.[book]||new BigNumber(0):new BigNumber(0)).toNumber(), customer[`${prefix}_${book}`]);
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
    inspect('expenses', expense.id, () => {
      const expected = generateExpenseJournalEntry(expense as any, expense.org_id || '', expense.created_by);
      const actual = sourceEntries('expense', expense.id).flatMap(e => e.lines || []);
      for (const line of expected.lines) for (const field of ['debit_sdg', 'credit_sdg', 'debit_usd', 'credit_usd'] as const) {
        compare('expenses', expense.id, `${line.account_code}:${field}`, line[field], actual.filter(l => l.account_code === line.account_code).reduce((total, l) => total.plus(l[field] || 0), new BigNumber(0)).toNumber());
      }
    });
    if (expense.voided_at && sourceEntries('void', expense.id).length !== 1) add('missing_reversal', 'expenses', expense.id);
  }
  // Legacy unknown cost is preserved; strict current-inventory readiness is requested for V2 activation/restore.
  const valued = data.products.filter(product => product.track_inventory && product.cost_status === 'valued');
  if (valued.length || options.requireCosting) {
    const totals = { sdg: new BigNumber(0), usd: new BigNumber(0) }, movementValues = new Map<string, { sdg: BigNumber; usd: BigNumber }>(), journalValues = new Map<string, { sdg: BigNumber; usd: BigNumber }>();
    for (const movement of data.inventory_movements) if (movement.costing_version === 2) {
      inspect('inventory_movements', movement.id, () => {
        for (const currency of ['sdg', 'usd'] as const) money(Math.abs(movement[`value_delta_${currency}`]), currency === 'sdg' ? 0 : 2);
        const values = movementValues.get(movement.product_id) || { sdg: new BigNumber(0), usd: new BigNumber(0) };
        values.sdg = values.sdg.plus(movement.value_delta_sdg); values.usd = values.usd.plus(movement.value_delta_usd); movementValues.set(movement.product_id, values);
        if (movement.value_delta_sdg || movement.value_delta_usd) {
          if (!movement.journal_id || !indexes.journal_entries.has(movement.journal_id)) add('missing_cost_journal', 'inventory_movements', movement.id);
          const ledger = journalValues.get(movement.journal_id) || { sdg: new BigNumber(0), usd: new BigNumber(0) };
          ledger.sdg = ledger.sdg.plus(movement.value_delta_sdg); ledger.usd = ledger.usd.plus(movement.value_delta_usd); journalValues.set(movement.journal_id, ledger);
        }
      });
    }
    for (const product of data.products) if (product.track_inventory) {
      if (product.cost_status !== 'valued') { if (options.requireCosting) add('unknown_inventory_cost', 'products', product.id); continue; }
      inspect('products', product.id, () => {
        const state = validateCostState(product as any), movement = movementValues.get(product.id);
        for (const currency of ['sdg', 'usd'] as const) { totals[currency] = totals[currency].plus(state[`inventory_value_${currency}`]); compare('products', product.id, `inventory_value_${currency}`, movement?.[currency].toNumber() || 0, state[`inventory_value_${currency}`]); }
      });
    }
    const inventoryCodes = new Set(['1300', ...data.accounts.filter(a => { try { return classifyAccount(a as any).reporting_group === 'inventory'; } catch { return false; } }).map(a => a.code)]);
    for (const currency of ['sdg', 'usd'] as const) {
      const balance = data.journal_entries.flatMap(e => e.lines || []).filter(l => inventoryCodes.has(l.account_code)).reduce((sum, l) => sum.plus(l[`debit_${currency}`] || 0).minus(l[`credit_${currency}`] || 0), new BigNumber(0));
      compare('journal_entries', 'Inventory-control', `valuation_${currency}`, totals[currency].toNumber(), balance.toNumber());
    }
    for (const [id, values] of journalValues) {
      const entry = indexes.journal_entries.get(id);
      for (const currency of ['sdg', 'usd'] as const) compare('journal_entries', id, `inventory_movement_${currency}`, values[currency].toNumber(), (entry?.lines || []).filter((l: Document) => l.account_code === '1300').reduce((sum: BigNumber, l: Document) => sum.plus(l[`debit_${currency}`]).minus(l[`credit_${currency}`]), new BigNumber(0)).toNumber());
    }
  }
  for (const invoice of data.invoices) if (invoice.costing_version === 2) inspect('invoices', invoice.id, () => {
    for (const item of invoice.items) if (item.cost_status === 'valued') {
      money(item.unit_cost_sdg, 12); money(item.unit_cost_usd, 12); money(item.total_cost_sdg, 0); money(item.total_cost_usd, 2); dateOnly(item.cost_recorded_at);
    }
    for (const currency of ['sdg', 'usd'] as const) {
      const snapshot = invoice.items.filter((item: Document) => item.cost_status === 'valued').reduce((sum: BigNumber, item: Document) => sum.plus(item[`total_cost_${currency}`]), new BigNumber(0));
      compare('invoices', invoice.id, `cogs_${currency}`, snapshot.toNumber(), invoice[`cogs_${currency}`]);
      compare('invoices', invoice.id, `posted_cogs_${currency}`, snapshot.toNumber(), sourceEntries('invoice', invoice.id).flatMap(e => e.lines || []).filter(l => l.account_code === '5100').reduce((sum, l) => sum.plus(l[`debit_${currency}`]).minus(l[`credit_${currency}`]), new BigNumber(0)).toNumber());
    }
  });
  findings.push(...reconcileEquitySources(data), ...reconcileAuditArchives(data.audit_archives || []), ...reconcilePurchaseCorrections(data), ...reconcileSalesCorrections(data), ...reconcilePayables(data), ...reconcileCashManagement(data), ...reconcileCashSessions(data));
  return findings;
}

