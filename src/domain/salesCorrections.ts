import BigNumber from 'bignumber.js';
import { openingBalancesForParty, readOpeningData } from './openingIntegration';
import type { Account, Invoice, JournalEntry, JournalEntryLine, Product } from '../types';
import type { Document, Transaction } from './store';
import type { PayableContext } from './payables';
import { assertOpenPeriod, dateOnly, ensure, identifier, money, text, validateJournal } from './validation';
import { journal, paymentQuote, receiptJournal, receivableCurrency } from './financial';
import { buildSalesReturnBases, returnSourceId } from './returnSources';
import { quoteSalesLineCorrection, type SalesCorrectionEvent } from './salesCorrectionState';
import { creditRefundLines, quoteCreditRefund, salesCreditLines, type BookAmount } from './returnQuotes';
import { receiveCost, validateCostState } from './inventoryCost';
import { validateFinancialAccount } from './cashManagement';
import { classifyAccount, type ReportingGroup } from './accountClassification';
import { getDefaultChartOfAccounts } from '../services/accountingService';
import { accountLedger } from './operationalReports';
import { validateTaxConfigurationVersions } from './taxConfigurationTransactions';

export const salesCorrectionCollections = ['credit_notes', 'customer_refunds'] as const;
const books = ['sdg', 'usd'] as const;
const zero = (): BookAmount => ({ sdg: 0, usd: 0 });
const add = (a: BookAmount, b: BookAmount): BookAmount => ({ sdg: new BigNumber(a.sdg).plus(b.sdg).toNumber(), usd: new BigNumber(a.usd).plus(b.usd).toNumber() });
const negate = (a: BookAmount): BookAmount => ({ sdg: -a.sdg, usd: -a.usd });
const same = (a: BookAmount, b: BookAmount) => books.every(book => new BigNumber(a[book]).eq(b[book]));
const value = (row: Document, prefix: string): BookAmount => ({ sdg: row[`${prefix}_sdg`] ?? 0, usd: row[`${prefix}_usd`] ?? 0 });
export const invoiceSignedBalance = (invoice: Document): BookAmount => add(value(invoice, 'remaining'), negate(value(invoice, 'credit_balance')));
const movementFields = (lines: JournalEntryLine[]) => lines.map(line => [line.account_code, line.debit_sdg, line.credit_sdg, line.debit_usd, line.credit_usd]);

const controlGroups: Record<string, ReportingGroup> = { '1200': 'receivables', '4100': 'sales', '2130': 'tax_payable', '1300': 'inventory', '5100': 'cogs', '5500': 'fx_loss', '4200': 'fx_gain' };
function validatePostingAccounts(lines: JournalEntryLine[], accounts: Document[], active: boolean, extraGroups: Record<string, ReportingGroup> = {}) {
  for (const line of lines) {
    const account = accounts.find(account => account.code === line.account_code);
    ensure(account && (!active || account.is_active) && classifyAccount(account as Account).reporting_group === (extraGroups[line.account_code] || controlGroups[line.account_code] || 'cash_bank'), 'تصنيف أو تفعيل حساب التصحيح/الرد غير صالح.', 409);
  }
}

/** A bounded transaction history, independently replayed for posting, reconciliation and restore. */
export function verifySalesSource(invoice: Invoice, entries: JournalEntry[], payments: Document[], notes: Document[], refunds: Document[], financial: Document[], accounts: Document[], checkCaches = true, movements?: Document[]) {
  const orgId = identifier(invoice.org_id);
  const taxAccountCode = invoice.tax_evidence ? identifier(invoice.tax_evidence.tax_account_code) : '2130', taxGroups: Record<string, ReportingGroup> = { [taxAccountCode]: 'tax_payable' };
  const original = entries.filter(entry => entry.reference_type === 'invoice' && entry.reference_id === invoice.id);
  validatePostingAccounts(original.flatMap(entry => entry.lines), accounts, false, taxGroups);
  const source = buildSalesReturnBases(invoice, original, orgId), native = receivableCurrency({ currency_mode: invoice.currency_mode, items: invoice.items });
  ensure(['dual','single_sdg','single_usd'].includes(invoice.currency_mode) && (!invoice.receivable_currency || invoice.receivable_currency === native), 'عملة الذمم الأصلية لا تطابق مصدر الفاتورة.', 409);
  if (movements) {
    const quantities = new Map<string, { quantity: BigNumber; sdg: BigNumber; usd: BigNumber }>();
    for (const item of invoice.items.filter(item => item.cost_status === 'valued')) {
      const productId = identifier(item.product_id), old = quantities.get(productId) || { quantity: new BigNumber(0), sdg: new BigNumber(0), usd: new BigNumber(0) };
      quantities.set(productId, { quantity: old.quantity.plus(item.quantity), sdg: old.sdg.plus(item.total_cost_sdg!), usd: old.usd.plus(item.total_cost_usd!) });
    }
    const sales = movements.filter(row => row.reference_type === 'invoice' && row.reference_id === invoice.id && row.type === 'SALE' && row.costing_version === 2);
    ensure(sales.length === quantities.size, 'حركات تكلفة البيع الأصلية ناقصة أو مكررة.', 409);
    const used = new Set<string>();
    for (const movement of sales) {
      const amount = quantities.get(movement.product_id); ensure(amount && !used.has(movement.product_id), 'صنف حركة البيع الأصلية لا يطابق المصدر.', 409); used.add(movement.product_id);
      ensure(movement.org_id === orgId && movement.journal_id === source.journal_id && amount.quantity.negated().eq(movement.quantity) && amount.sdg.negated().eq(movement.value_delta_sdg) && amount.usd.negated().eq(movement.value_delta_usd), 'كمية/تكلفة حركة البيع الأصلية لا تطابق لقطات البنود.', 409);
    }
  }
  ensure(payments.length + notes.length + refunds.length <= 200, 'سجل الفاتورة تجاوز حد المعاملة؛ يلزم إجراء ترحيل خادمي.', 409);
  const legacy = payments.filter(row => row.source_sequence === undefined).sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.id.localeCompare(b.id));
  const timeline = [...legacy.map((row, i) => ({ row, type: 'payment' as const, sequence: i + 1 })),
    ...payments.filter(row => row.source_sequence !== undefined).map(row => ({ row, type: 'payment' as const, sequence: row.source_sequence })),
    ...notes.map(row => ({ row, type: 'credit_note' as const, sequence: row.source_sequence })),
    ...refunds.map(row => ({ row, type: 'customer_refund' as const, sequence: row.source_sequence }))].sort((a, b) => a.sequence - b.sequence);
  let balance = value(invoice, 'grand_total'), paid = zero(), credited = zero(), refunded = zero(), lastDate = dateOnly(invoice.issue_date), correctionCount = 0;
  const histories = new Map<string, SalesCorrectionEvent[]>(), ids = new Set<string>();
  const checkPosting = (row: Document, type: JournalEntry['reference_type'], date: string, lines: JournalEntryLine[], rate: number) => {
    const found = entries.filter(entry => entry.reference_type === type && entry.reference_id === row.id);
    if (!lines.length) { ensure(!row.journal_id && found.length === 0, 'حركة بقيمة صفرية لا تجيز قيداً مختلقاً.', 409); return; }
    ensure(found.length === 1, 'قيد المصدر ناقص أو مكرر.', 409);
    validatePostingAccounts(lines, accounts, false, taxGroups);
    const entry = found[0], totals = validateJournal(entry.lines);
    ensure(entry.org_id === invoice.org_id && dateOnly(entry.date) === date && entry.exchange_rate_used === rate && entry.is_balanced &&
      (type === 'payment' && !row.journal_id || row.journal_id === entry.id) && JSON.stringify(movementFields(entry.lines)) === JSON.stringify(movementFields(lines)) &&
      Object.entries(totals).every(([key, amount]) => entry[key as keyof JournalEntry] === amount), 'قيد المصدر لا يطابق قيمته وتاريخه الأصليين.', 409);
  };
  for (const [index, event] of timeline.entries()) {
    const { row, type } = event, date = dateOnly(type === 'payment' ? row.payment_date : row.date);
    identifier(row.id); ensure(!ids.has(row.id), 'معرّف حركة مصدر مكرر.', 409); ids.add(row.id);
    ensure(event.sequence === index + 1 && row.org_id === invoice.org_id && row.invoice_id === invoice.id && row.customer_id === invoice.customer_id && date >= lastDate, 'تسلسل أو مؤسسة أو تاريخ حركة المصدر غير صالح.', 409);
    lastDate = date;
    if (type === 'payment') {
      ensure(['SDG', 'USD'].includes(row.currency), 'عملة السند غير صالحة.');
      // Pre-B3 receipts have no source sequence. Their immutable settlement/journal is retained,
      // including legitimate rounding when several receipts share a timestamp.
      const isLegacy = row.source_sequence === undefined;
      for (const book of books) { money(row[`settled_amount_${book}`], book === 'sdg' ? 0 : 2); ensure(row[`settled_amount_${book}`] <= balance[book], 'التحصيل التاريخي يتجاوز قيمة المصدر.', 409); }
      const basis = { ...invoice, remaining_sdg: isLegacy ? row.settled_amount_sdg : balance.sdg, remaining_usd: isLegacy ? row.settled_amount_usd : balance.usd };
      ensure(balance.sdg >= 0 && balance.usd >= 0, 'التحصيل لا يستهلك رصيد العميل الدائن.', 409);
      const quote = paymentQuote(basis, row.amount, row.currency, row.exchange_rate_used);
      for (const [field, amount] of Object.entries({ settled_amount_sdg: quote.settledSdg, settled_amount_usd: quote.settledUsd, cash_amount_sdg: quote.cashSdg, cash_amount_usd: quote.cashUsd })) ensure(new BigNumber(row[field]).eq(amount), 'سند التحصيل لا يطابق القيمة الدفترية.', 409);
      const posting = receiptJournal(row as any, basis, orgId, row.created_by);
      checkPosting(row, type, date, posting.lines, row.exchange_rate_used);
      const settled = { sdg: quote.settledSdg, usd: quote.settledUsd }; paid = add(paid, settled); balance = add(balance, negate(settled));
    } else if (type === 'credit_note') {
      ensure(['price_credit', 'sales_return'].includes(row.kind) && row.native_currency === native, 'نوع الإشعار أو عملته غير صالح.');
      text(row.reason, 500, true); ensure(Array.isArray(row.lines) && row.lines.length > 0 && row.lines.length <= 100, 'بنود الإشعار غير صالحة.');
      const selected = new Set<string>(), totals = { revenue: zero(), tax: zero(), cost: zero() };
      for (const line of row.lines) {
        ensure(line && Object.keys(line).every(key => ['line_id', 'sequence', 'allocated', row.kind === 'sales_return' ? 'quantity' : 'amount'].includes(key)), 'حقول بند الإشعار غير صالحة.');
        const basis = source.bases.find(basis => basis.source_id === returnSourceId(invoice.id, identifier(line.line_id)));
        ensure(basis && !selected.has(line.line_id), 'بند مصدر مفقود أو مكرر.'); selected.add(line.line_id);
        const history = histories.get(basis.source_id) || [];
        const input = { kind: row.kind, date, ...(row.kind === 'sales_return' ? { quantity: line.quantity } : { amount: line.amount }) };
        const quote = quoteSalesLineCorrection(basis, history, input, native, invoice.issue_date);
        ensure(line.sequence === quote.sequence && JSON.stringify(Object.keys(line.allocated || {}).sort()) === JSON.stringify(Object.keys(quote.allocated).sort()) &&
          Object.keys(quote.allocated).every(key => same(line.allocated[key], quote.allocated[key])), 'توزيع الإشعار لا يطابق المصدر والسجل الثابت.', 409);
        const saved = { ...input, id: returnSourceId(row.id, line.line_id), sequence: quote.sequence, source_id: basis.source_id, native_currency: native, allocated: quote.allocated } as SalesCorrectionEvent;
        histories.set(basis.source_id, [...history, saved]);
        for (const component of ['revenue', 'tax', 'cost'] as const) totals[component] = add(totals[component], quote.allocated[component] || zero());
      }
      for (const book of books) { money(row[`credit_${book}`], book === 'sdg' ? 0 : 2); money(row[`restored_cost_${book}`], book === 'sdg' ? 0 : 2); }
      const credit = add(totals.revenue, totals.tax);
      ensure(same(credit, value(row, 'credit')) && same(totals.cost, value(row, 'restored_cost')), 'إجمالي الإشعار لا يطابق بنوده.', 409);
      const lines = credit.sdg || credit.usd || totals.cost.sdg || totals.cost.usd ? salesCreditLines(totals.revenue, totals.tax, totals.cost, taxAccountCode) : [];
      checkPosting(row, type, date, lines, invoice.exchange_rate_used); credited = add(credited, credit); balance = add(balance, negate(credit)); correctionCount++;
    } else {
      text(row.reason, 500, true); ensure(row.native_currency === native && balance.sdg <= 0 && balance.usd <= 0, 'الرد النقدي يتطلب رصيد مصدر دائن فعلي في الدفترين.', 409);
      const account = financial.find(account => account.id === row.financial_account_id);
      ensure(account && account.currency === row.currency && account.account_code === row.payment_account_code, 'ربط حساب الرد غير صالح.'); validateFinancialAccount(account, accounts);
      for (const book of books) for (const prefix of ['settled_amount', 'cash_amount', 'available_credit']) money(row[`${prefix}_${book}`], book === 'sdg' ? 0 : 2);
      const quote = quoteCreditRefund(negate(balance), native, row.amount, row.currency, row.exchange_rate_used);
      ensure(same(quote.settled, value(row, 'settled_amount')) && same(quote.cash, value(row, 'cash_amount')) && same(negate(balance), value(row, 'available_credit')), 'الرد لا يطابق رصيد المصدر الدائن.', 409);
      checkPosting(row, type, date, creditRefundLines(quote, account.account_code), row.exchange_rate_used);
      refunded = add(refunded, quote.settled); balance = add(balance, quote.settled);
    }
  }
  if (checkCaches) {
    ensure(same(balance, invoiceSignedBalance(invoice)) && same(paid, value(invoice, 'paid_amount')) && same(credited, value(invoice, 'credited_amount')) && same(refunded, value(invoice, 'refunded_amount')), 'رصيد الفاتورة لا يطابق مصادر الذمم الثابتة.', 409);
    for (const book of books) { for (const prefix of ['paid_amount', 'credited_amount', 'refunded_amount']) money(invoice[`${prefix}_${book}` as keyof Invoice] ?? 0, book === 'sdg' ? 0 : 2); money(invoice[`remaining_${book}`], book === 'sdg' ? 0 : 2); money(invoice[`credit_balance_${book}`] ?? 0, book === 'sdg' ? 0 : 2); ensure(!invoice[`remaining_${book}`] || !invoice[`credit_balance_${book}`], 'رصيد مدين ودائن للبند نفسه.'); }
    if (notes.length || refunds.length || payments.some(row => row.source_sequence !== undefined)) ensure(invoice.source_event_sequence === timeline.length && (invoice.correction_count || 0) === correctionCount, 'عداد مصادر الفاتورة لا يطابق السجل.', 409);
  }
  return { source, native, balance, paid, credited, refunded, lastDate, sequence: timeline.length, correctionCount, histories };
}

export async function loadSalesSource(tx: Transaction, root: string, invoice: Invoice) {
  ensure(invoice.org_id === root.split('/')[1], 'مصدر الفاتورة يتبع مؤسسة أخرى.', 403);
  const [entries, payments, notes, refunds, financial, accounts, movements] = await Promise.all([
    tx.list(`${root}/journal_entries`), tx.find(`${root}/payments`, 'invoice_id', invoice.id), tx.find(`${root}/credit_notes`, 'invoice_id', invoice.id),
    tx.find(`${root}/customer_refunds`, 'invoice_id', invoice.id), tx.list(`${root}/financial_accounts`), tx.list(`${root}/accounts`), tx.find(`${root}/inventory_movements`, 'reference_id', invoice.id),
  ]);
  return { ...verifySalesSource(invoice, entries as JournalEntry[], payments, notes, refunds, financial, accounts, true, movements), entries: entries as JournalEntry[], accounts: accounts as Account[] };
}

export function salesInvoiceCaches(invoice: Invoice, state: { balance: BookAmount; paid: BookAmount; credited: BookAmount; refunded: BookAmount; sequence: number; correctionCount: number }, iso: string) {
  const native = receivableCurrency(invoice) === 'SDG' ? 'sdg' : 'usd';
  return { ...invoice, remaining_sdg: Math.max(0, state.balance.sdg), remaining_usd: Math.max(0, state.balance.usd), credit_balance_sdg: Math.max(0, -state.balance.sdg), credit_balance_usd: Math.max(0, -state.balance.usd),
    paid_amount_sdg: state.paid.sdg, paid_amount_usd: state.paid.usd, credited_amount_sdg: state.credited.sdg, credited_amount_usd: state.credited.usd, refunded_amount_sdg: state.refunded.sdg, refunded_amount_usd: state.refunded.usd,
    source_event_sequence: state.sequence, correction_count: state.correctionCount, status: state.balance[native] <= 0 ? 'paid' : state.paid[native] > 0 ? 'partially_paid' : 'sent', updated_at: iso } as Invoice;
}
/** Customer balance stays signed; due and credit pools remain separately visible. */
export async function saveSalesCustomer(c: PayableContext, customer: Document, updated: Invoice) {
  const existing = (await c.tx.list(`${c.root}/invoices`)).filter(row => row.customer_id === customer.id && !['void', 'cancelled', 'draft'].includes(row.status));
  const opening=openingBalancesForParty(await readOpeningData(c.tx,c.root),'receivable',customer.id);
  const previous = existing.reduce<BookAmount>((total, row) => add(total, invoiceSignedBalance(row)), opening);
  ensure(same(previous, value(customer, 'balance')), 'رصيد العميل لا يطابق مصادره؛ راجع المطابقة.', 409);
  for (const book of books) for (const prefix of ['receivable_due', 'credit_balance']) if (customer[`${prefix}_${book}`] !== undefined) ensure(existing.reduce((n, invoice) => n.plus(invoice[`${prefix === 'receivable_due' ? 'remaining' : prefix}_${book}`] ?? 0), new BigNumber(prefix==='receivable_due'?opening[book]:0)).eq(customer[`${prefix}_${book}`]), 'رصيد العميل المفصل لا يطابق مصادره.', 409);
  const invoices = [...existing.filter(row => row.id !== updated.id), ...(!['void', 'cancelled', 'draft'].includes(updated.status) ? [updated] : [])];
  const balance = invoices.reduce<BookAmount>((total, row) => add(total, invoiceSignedBalance(row)), opening);
  const due = invoices.reduce<BookAmount>((total, row) => add(total, value(row, 'remaining')), opening), credit = invoices.reduce<BookAmount>((total, row) => add(total, value(row, 'credit_balance')), zero());
  c.set(`${c.root}/customers/${customer.id}`, { ...customer, balance_sdg: balance.sdg, balance_usd: balance.usd, receivable_due_sdg: due.sdg, receivable_due_usd: due.usd, credit_balance_sdg: credit.sdg, credit_balance_usd: credit.usd, updated_at: c.iso });
}

export async function salesCorrectionCommand(action: string, data: Document, c: PayableContext) {
  const invoice = await c.required('invoices', data.invoice_id) as Invoice;
  const taxAccountCode = invoice.tax_evidence ? identifier(invoice.tax_evidence.tax_account_code) : '2130';
  if (invoice.tax_evidence) {
    const current = await c.required('tax_configurations', invoice.tax_evidence.configuration_id);
    await validateTaxConfigurationVersions(c.tx, c.root, c.orgId, current);
    const version = await c.required('tax_configuration_versions', `${invoice.tax_evidence.configuration_id}-r${invoice.tax_evidence.configuration_revision}`);
    ensure(version.version_hash === invoice.tax_evidence.configuration_version_hash && version.tax_account_code === taxAccountCode && version.direction === 'sales', 'إصدار سياسة ضريبة الفاتورة لا يطابق دليلها المجمد.', 409);
  }
  const state = await loadSalesSource(c.tx, c.root, invoice);
  const date = dateOnly(data.date); assertOpenPeriod(date, c.settings); ensure(date >= state.lastDate, 'تاريخ التصحيح قبل آخر حركة للمصدر.', 409);
  ensure(state.sequence < 200, 'سجل الفاتورة تجاوز حد المعاملة؛ يلزم إجراء ترحيل خادمي.', 409);
  const reason = text(data.reason, 500, true), customer = await c.required('customers', invoice.customer_id);
  const stamp = { org_id: c.orgId, invoice_id: invoice.id, invoice_number: invoice.invoice_number, customer_id: invoice.customer_id, created_by: c.actor, created_at: c.iso, operation_id: c.operationId, schema_version: 3, source_sequence: state.sequence + 1, native_currency: state.native, date, reason };
  let result: Document;
  if (action === 'creditNote.create') {
    ensure(Object.keys(data).every(key => ['invoice_id', 'date', 'reason', 'kind', 'lines'].includes(key)), 'قيم المصدر والتوزيع يحسبها الخادم فقط.');
    ensure(['price_credit', 'sales_return'].includes(data.kind) && Array.isArray(data.lines) && data.lines.length > 0 && data.lines.length <= 100, 'نوع الإشعار أو بنوده غير صالح.');
    const id = `cn-${c.operationId}`; ensure(!await c.tx.get(`${c.root}/credit_notes/${id}`), 'معرّف الإشعار موجود؛ لا يجوز استبدال مستند مالي.', 409);
    const selected = new Set<string>(), totals = { revenue: zero(), tax: zero(), cost: zero() }, stock = new Map<string, { quantity: number; cost: BookAmount }>();
    const lines = data.lines.map((line: Document) => {
      ensure(line && Object.keys(line).every(key => ['line_id', data.kind === 'sales_return' ? 'quantity' : 'amount'].includes(key)), 'أرسل كمية المردود أو مبلغ التصحيح فقط.');
      const lineId = identifier(line.line_id), basis = state.source.bases.find(basis => basis.source_id === returnSourceId(invoice.id, lineId));
      ensure(basis && !selected.has(lineId), 'بند مصدر مفقود أو مكرر.'); selected.add(lineId);
      const input = { kind: data.kind, date, ...(data.kind === 'sales_return' ? { quantity: line.quantity } : { amount: line.amount }) };
      const quote = quoteSalesLineCorrection(basis, state.histories.get(basis.source_id) || [], input, state.native, invoice.issue_date);
      for (const component of ['revenue', 'tax', 'cost'] as const) totals[component] = add(totals[component], quote.allocated[component] || zero());
      if (data.kind === 'sales_return') {
        const item = invoice.items.find(item => item.id === lineId)!; ensure(item.product_id, 'المردود الفعلي يتطلب صنف مخزون موثق.');
        const previous = stock.get(item.product_id) || { quantity: 0, cost: zero() };
        stock.set(item.product_id, { quantity: new BigNumber(previous.quantity).plus(line.quantity).toNumber(), cost: add(previous.cost, quote.allocated.cost) });
      }
      return { line_id: lineId, ...('quantity' in input ? { quantity: input.quantity } : { amount: input.amount }), sequence: quote.sequence, allocated: quote.allocated };
    });
    const credit = add(totals.revenue, totals.tax), posting = credit.sdg || credit.usd || totals.cost.sdg || totals.cost.usd ? salesCreditLines(totals.revenue, totals.tax, totals.cost, taxAccountCode) : [];
    ensure(data.kind === 'sales_return' || credit.sdg > 0 || credit.usd > 0, 'الإشعار النقدي يجب أن يخفض قيمة فعلية.');
    const journalId = posting.length ? `jv-credit-${c.operationId}` : undefined;
    validatePostingAccounts(posting, [...getDefaultChartOfAccounts(c.orgId).filter(account => !state.accounts.some(saved => saved.code === account.code)), ...state.accounts], true, { [taxAccountCode]: 'tax_payable' });
    if (journalId) await c.post(journal(journalId, c.orgId, c.actor, date, 'credit_note', id, `إشعار دائن ${invoice.invoice_number}: ${reason}`, posting, invoice.exchange_rate_used));
    let movementIndex = 0;
    for (const [productId, returned] of stock) {
      const product = await c.required('products', productId) as Product; ensure(product.track_inventory, 'صنف المردود غير متتبع.');
      const before = validateCostState(product), after = receiveCost(product, returned.quantity, returned.cost, date), movementId = `mov-return-${c.operationId}-${++movementIndex}`;
      c.set(`${c.root}/products/${productId}`, { ...product, ...after });
      c.set(`${c.root}/inventory_movements/${movementId}`, { ...stamp, id: movementId, product_id: productId, product_name: product.name, type: 'SALES_RETURN', quantity: returned.quantity, previous_stock: before.stock_quantity, resulting_stock: after.stock_quantity, reference_type: 'credit_note', reference_id: id, value_delta_sdg: returned.cost.sdg, value_delta_usd: returned.cost.usd, costing_version: 2, journal_id: journalId }); c.counterAdd('inventory_movement_count', 1);
    }
    result = { ...stamp, id, kind: data.kind, lines, credit_sdg: credit.sdg, credit_usd: credit.usd, restored_cost_sdg: totals.cost.sdg, restored_cost_usd: totals.cost.usd, ...(journalId ? { journal_id: journalId } : {}) };
    state.balance = add(state.balance, negate(credit)); state.credited = add(state.credited, credit); state.correctionCount++;
    c.set(`${c.root}/credit_notes/${id}`, result); c.counterAdd('credit_note_count', 1);
  } else {
    ensure(action === 'customerRefund.create' && Object.keys(data).every(key => ['invoice_id', 'date', 'reason', 'financial_account_id', 'amount', 'exchange_rate_used'].includes(key)), 'طلب الرد النقدي غير صالح.');
    ensure(state.balance.sdg <= 0 && state.balance.usd <= 0, 'لا يوجد رصيد مصدر دائن قابل للرد في الدفترين.', 409);
    const account = await c.required('financial_accounts', data.financial_account_id); validateFinancialAccount(account, state.accounts);
    ensure(account.status === 'active' && state.accounts.find(row => row.code === account.account_code)?.is_active, 'حساب الرد غير نشط.');
    ensure((await c.tx.get(`${c.root}/financial_account_mappings/${account.account_code}`))?.id === account.id, 'ربط حساب الرد يحتاج مراجعة.', 409);
    const available = negate(state.balance), quote = quoteCreditRefund(available, state.native, data.amount, account.currency, data.exchange_rate_used ?? invoice.exchange_rate_used);
    const ledger = accountLedger(state.accounts, state.entries, { accountCode: account.account_code, end: date }, date);
    ensure((ledger.closing[account.currency] || 0) >= data.amount, 'رصيد النقد/البنك غير كاف للرد.', 409);
    const future = accountLedger(state.accounts, state.entries, { accountCode: account.account_code }, '9999-12-31'), daily = new Map<string, Document>();
    for (const row of future.rows) if (row.date > date) daily.set(row.date, row);
    for (const row of daily.values()) ensure(row.balance[account.currency] >= data.amount, 'الرد بتاريخ قديم يسبب عجزاً في يوم لاحق.', 409);
    const id = `refund-${c.operationId}`, journalId = `jv-refund-${c.operationId}`, rate = data.exchange_rate_used ?? invoice.exchange_rate_used;
    ensure(!await c.tx.get(`${c.root}/customer_refunds/${id}`), 'معرّف الرد موجود؛ لا يجوز استبدال مستند مالي.', 409);
    validatePostingAccounts(creditRefundLines(quote, account.account_code), state.accounts, true);
    await c.post(journal(journalId, c.orgId, c.actor, date, 'customer_refund', id, `رد نقدي ${invoice.invoice_number}: ${reason}`, creditRefundLines(quote, account.account_code), rate));
    result = { ...stamp, id, financial_account_id: account.id, payment_account_code: account.account_code, currency: account.currency, amount: data.amount, exchange_rate_used: rate, available_credit_sdg: available.sdg, available_credit_usd: available.usd, settled_amount_sdg: quote.settled.sdg, settled_amount_usd: quote.settled.usd, cash_amount_sdg: quote.cash.sdg, cash_amount_usd: quote.cash.usd, journal_id: journalId };
    state.balance = add(state.balance, quote.settled); state.refunded = add(state.refunded, quote.settled);
    c.set(`${c.root}/customer_refunds/${id}`, result); c.counterAdd('customer_refund_count', 1);
    c.set(`${c.root}/financial_accounts/${account.id}`, { ...account, revision: (account.revision || 0) + 1, last_refund_id: id, updated_at: c.iso });
  }
  state.sequence++;
  const updated = salesInvoiceCaches(invoice, state, c.iso); await saveSalesCustomer(c, customer, updated); c.set(`${c.root}/invoices/${invoice.id}`, updated);
  return result;
}

export function reconcileSalesCorrections(data: Record<string, Document[]>) {
  const findings: { code: string; collection: string; id: string; message: string }[] = [];
  const notes = data.credit_notes || [], refunds = data.customer_refunds || [], invoices = data.invoices || [], entries = data.journal_entries || [];
  const inspect = (collection: string, id: string, work: () => void) => { try { work(); } catch (error) { findings.push({ code: 'invalid_record', collection, id, message: error instanceof Error ? error.message : 'غير صالح' }); } };
  for (const invoice of invoices) if (notes.some(row => row.invoice_id === invoice.id) || refunds.some(row => row.invoice_id === invoice.id) || invoice.source_event_sequence !== undefined) inspect('invoices', invoice.id, () => {
    verifySalesSource(invoice as Invoice, entries as JournalEntry[], (data.payments || []).filter(row => row.invoice_id === invoice.id), notes.filter(row => row.invoice_id === invoice.id), refunds.filter(row => row.invoice_id === invoice.id), data.financial_accounts || [], data.accounts || [], true, data.inventory_movements || []);
  });
  for (const [collection, rows] of [['credit_notes', notes], ['customer_refunds', refunds]] as const) for (const row of rows) inspect(collection, row.id, () => { ensure(invoices.some(invoice => invoice.id === row.invoice_id), 'مصدر الفاتورة مفقود.'); });
  for (const entry of entries) if (['credit_note', 'customer_refund'].includes(entry.reference_type)) inspect('journal_entries', entry.id, () => { ensure((entry.reference_type === 'credit_note' ? notes : refunds).some(row => row.id === entry.reference_id), 'مصدر التصحيح/الرد مفقود.'); });
  for (const note of notes) inspect('credit_notes', note.id, () => {
    const invoice = invoices.find(invoice => invoice.id === note.invoice_id); ensure(invoice, 'مصدر المردود مفقود.');
    const expected = new Map<string, { quantity: BigNumber; sdg: BigNumber; usd: BigNumber }>();
    if (note.kind === 'sales_return') for (const line of note.lines) {
      const item = invoice.items.find((item: Document) => item.id === line.line_id); ensure(item?.product_id && line.allocated?.cost, 'بند المردود لا يتضمن تكلفة موثقة.');
      const old = expected.get(item.product_id) || { quantity: new BigNumber(0), sdg: new BigNumber(0), usd: new BigNumber(0) };
      expected.set(item.product_id, { quantity: old.quantity.plus(line.quantity), sdg: old.sdg.plus(line.allocated.cost.sdg), usd: old.usd.plus(line.allocated.cost.usd) });
    }
    const movements = (data.inventory_movements || []).filter(row => row.reference_type === 'credit_note' && row.reference_id === note.id);
    ensure(movements.length === expected.size, 'حركات المردود ناقصة أو مكررة.');
    const used = new Set<string>();
    for (const movement of movements) {
      const amount = expected.get(movement.product_id); ensure(amount && !used.has(movement.product_id), 'صنف حركة المردود لا يطابق المصدر.'); used.add(movement.product_id);
      ensure(movement.type === 'SALES_RETURN' && movement.org_id === note.org_id && movement.costing_version === 2 && dateOnly(movement.date) === note.date && movement.journal_id === note.journal_id && amount.quantity.eq(movement.quantity) && amount.sdg.eq(movement.value_delta_sdg) && amount.usd.eq(movement.value_delta_usd), 'قيمة/كمية/قيد حركة المردود مختلفة.');
    }
  });
  for (const movement of data.inventory_movements || []) if (movement.reference_type === 'credit_note' || movement.type === 'SALES_RETURN') inspect('inventory_movements', movement.id, () => { ensure(movement.reference_type === 'credit_note' && notes.some(note => note.id === movement.reference_id && note.kind === 'sales_return'), 'مصدر حركة المردود مفقود.'); });
  return findings;
}

