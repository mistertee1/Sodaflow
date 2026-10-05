import BigNumber from 'bignumber.js';
import type { Account, JournalEntry, JournalEntryLine } from '../types';
import type { Document, Transaction } from './store';
import type { ActionType } from '../services/rbacService';
import { classifyAccount } from './accountClassification';
import { dateOnly, ensure, identifier, validateJournal } from './validation';

export type Book = 'SDG' | 'USD';
export interface ReportPeriod { start?: string; end?: string; }
export interface LedgerQuery extends ReportPeriod { accountCode: string; currency?: Book; }
type Balances = { sdg: number; usd: number };
const zero = (): Balances => ({ sdg: 0, usd: 0 });
const sum = (a: number, b: number) => new BigNumber(a).plus(b).toNumber();
const net = (line: JournalEntryLine): Balances => ({ sdg: new BigNumber(line.debit_sdg).minus(line.credit_sdg).toNumber(), usd: new BigNumber(line.debit_usd).minus(line.credit_usd).toNumber() });
const add = (a: Balances, b: Balances): Balances => ({ sdg: sum(a.sdg, b.sdg), usd: sum(a.usd, b.usd) });
const reference = (entry: JournalEntry, lineIndex: number) => ({ journal_id: entry.id, line_index: lineIndex, date: dateOnly(entry.date), entry_number: entry.entry_number, reference_type: entry.reference_type, reference_id: entry.reference_id, description: entry.description });
export function reportPeriod(period: ReportPeriod, asOf: string) {
  const end = dateOnly(period.end || asOf), start = period.start ? dateOnly(period.start) : undefined;
  ensure(!start || start <= end, 'بداية الفترة بعد نهايتها.');
  return { start, end };
}
/** Reports reject malformed or duplicated source journals instead of treating them as zero. */
function datedEntries(entries: JournalEntry[], end: string): JournalEntry[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    identifier(entry.id); ensure(!ids.has(entry.id), 'معرّف قيد مكرر؛ راجع المطابقة.', 409); ids.add(entry.id);
    dateOnly(entry.date); validateJournal(entry.lines);
  }
  return entries.filter(entry => dateOnly(entry.date) <= end).sort((a, b) => dateOnly(a.date).localeCompare(dateOnly(b.date)) || a.id.localeCompare(b.id));
}
function chartIndex(accounts: Account[], entries: JournalEntry[]) {
  const chart = new Map<string, Account>();
  for (const account of accounts) { identifier(account.code); ensure(!chart.has(account.code), 'رمز حساب مكرر؛ راجع الدليل.', 409); classifyAccount(account); chart.set(account.code, account); }
  for (const entry of entries) for (const line of entry.lines) ensure(chart.has(line.account_code), `الحساب ${line.account_code} غير موجود في الدليل.`, 409);
  return chart;
}
function documentIndex(rows: Document[], name: string) {
  const index = new Map<string, Document>();
  for (const row of rows) { identifier(row.id); ensure(!index.has(row.id), `معرّف ${name} مكرر؛ راجع المطابقة.`, 409); index.set(row.id, row); }
  return index;
}

/** Debit-positive balances; cached account balances are never used. Currency filtering projects a single book. */
export function accountLedger(accounts: Account[], entries: JournalEntry[], query: LedgerQuery, asOf: string) {
  const period = reportPeriod(query, asOf), dated = datedEntries(entries, period.end), chart = chartIndex(accounts, dated);
  ensure(query.currency === undefined || ['SDG', 'USD'].includes(query.currency), 'عملة التقرير غير مدعومة.');
  const account = chart.get(identifier(query.accountCode)); ensure(account, 'الحساب غير موجود في الدليل.', 404);
  const currencies: Book[] = query.currency ? [query.currency] : ['SDG', 'USD'];
  let opening = zero(), balance = zero();
  const debit = zero(), credit = zero();
  const rows: Document[] = [];
  const project = (value: Balances) => Object.fromEntries(currencies.map(currency => [currency, value[currency === 'SDG' ? 'sdg' : 'usd']]));
  for (const entry of dated) for (const [lineIndex, line] of entry.lines.entries()) {
    if (line.account_code !== account.code) continue;
    balance = add(balance, net(line));
    if (period.start && dateOnly(entry.date) < period.start) { opening = { ...balance }; continue; }
    debit.sdg = sum(debit.sdg, line.debit_sdg); debit.usd = sum(debit.usd, line.debit_usd);
    credit.sdg = sum(credit.sdg, line.credit_sdg); credit.usd = sum(credit.usd, line.credit_usd);
    if (query.currency && !line[`debit_${query.currency.toLowerCase() as 'sdg' | 'usd'}`] && !line[`credit_${query.currency.toLowerCase() as 'sdg' | 'usd'}`]) continue;
    rows.push({ ...reference(entry, lineIndex), debit: project({ sdg: line.debit_sdg, usd: line.debit_usd }), credit: project({ sdg: line.credit_sdg, usd: line.credit_usd }), balance: project(balance) });
  }
  return { period: { start: period.start || '', end: period.end }, account: { code: account.code, name_ar: account.name_ar, name_en: account.name_en, is_active: account.is_active, ...classifyAccount(account) }, balance_convention: 'debit_positive' as const, currencies, opening: project(opening), total_debit: project(debit), total_credit: project(credit), closing: project(balance), rows };
}

/** Historic AR is read from source-linked control lines, independent of today's invoice status and balance caches. */
export function receivableReports(customers: Document[], invoices: Document[], payments: Document[], entries: JournalEntry[], periodInput: ReportPeriod, asOf: string) {
  const period = reportPeriod(periodInput, asOf), dated = datedEntries(entries, period.end);
  const customerIndex = documentIndex(customers, 'العميل'), invoiceIndex = documentIndex(invoices, 'الفاتورة'), paymentIndex = documentIndex(payments, 'السند');
  const invoiceBalances = new Map<string, Balances>(), customerBalances = new Map<string, Balances>(), openings = new Map<string, Balances>(), movements = new Map<string, Document[]>();
  let control = zero(), allocated = zero();
  const sourceInvoice = (entry: JournalEntry) => {
    if (entry.reference_type === 'invoice') return invoiceIndex.get(entry.reference_id);
    if (entry.reference_type === 'void' && entry.id === `jv-void-${entry.reference_id}`) return invoiceIndex.get(entry.reference_id);
    if (entry.reference_type === 'payment') {
      const payment = paymentIndex.get(entry.reference_id), invoice = payment && invoiceIndex.get(payment.invoice_id);
      if (invoice) ensure(payment!.customer_id === invoice.customer_id, 'مرجع عميل السند لا يطابق الفاتورة.', 409);
      return invoice;
    }
    return undefined;
  };
  for (const entry of dated) {
    const lines = entry.lines.map((line, index) => ({ line, index })).filter(item => item.line.account_code === '1200');
    if (!lines.length) continue;
    const invoice = sourceInvoice(entry);
    if (invoice) ensure(customerIndex.has(invoice.customer_id), 'عميل الفاتورة غير موجود؛ راجع المطابقة.', 409);
    for (const { line, index } of lines) {
      const delta = net(line); control = add(control, delta);
      if (!invoice) continue; // Manual/legacy and orphan-source AR remain explicit control differences.
      ensure(dateOnly(invoice.issue_date) <= dateOnly(entry.date), 'قيد العميل يسبق إصدار الفاتورة.', 409);
      allocated = add(allocated, delta);
      invoiceBalances.set(invoice.id, add(invoiceBalances.get(invoice.id) || zero(), delta));
      const balance = add(customerBalances.get(invoice.customer_id) || zero(), delta); customerBalances.set(invoice.customer_id, balance);
      if (period.start && dateOnly(entry.date) < period.start) openings.set(invoice.customer_id, { ...balance });
      else {
        const rows = movements.get(invoice.customer_id) || [];
        rows.push({ ...reference(entry, index), invoice_id: invoice.id, invoice_number: invoice.invoice_number, debit_sdg: line.debit_sdg, credit_sdg: line.credit_sdg, debit_usd: line.debit_usd, credit_usd: line.credit_usd, balance_sdg: balance.sdg, balance_usd: balance.usd });
        movements.set(invoice.customer_id, rows);
      }
    }
  }
  const aging = [...invoiceBalances].map(([invoiceId, balance]) => {
    const invoice = invoiceIndex.get(invoiceId)!;
    const dueDate = dateOnly(invoice.due_date || invoice.issue_date), days = Math.floor((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);
    return { invoice_id: invoiceId, invoice_number: invoice.invoice_number, customer_id: invoice.customer_id, customer_name: customerIndex.get(invoice.customer_id)!.name, issue_date: dateOnly(invoice.issue_date), due_date: dueDate, overdue_days: Math.max(0, days), bucket: days <= 0 ? 'Current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+', remaining_sdg: Math.max(0, balance.sdg), remaining_usd: Math.max(0, balance.usd), credit_sdg: Math.max(0, -balance.sdg), credit_usd: Math.max(0, -balance.usd) };
  }).filter(row => row.remaining_sdg || row.remaining_usd || row.credit_sdg || row.credit_usd).sort((a, b) => b.overdue_days - a.overdue_days || a.invoice_id.localeCompare(b.invoice_id));
  const statements = customers.map(customer => {
    const opening = openings.get(customer.id) || zero(), closing = customerBalances.get(customer.id) || zero();
    return { customer_id: customer.id, customer_name: customer.name, opening_sdg: opening.sdg, opening_usd: opening.usd, closing_sdg: closing.sdg, closing_usd: closing.usd, rows: movements.get(customer.id) || [] };
  });
  const buckets = ['Current', '1-30', '31-60', '61-90', '90+'].map(bucket => ({ bucket, sdg: aging.filter(row => row.bucket === bucket).reduce((n, row) => sum(n, row.remaining_sdg), 0), usd: aging.filter(row => row.bucket === bucket).reduce((n, row) => sum(n, row.remaining_usd), 0) }));
  const overdueCustomers = customers.map(customer => {
    const due = aging.filter(row => row.customer_id === customer.id && row.overdue_days > 0);
    return { customer_id: customer.id, customer_name: customer.name, overdue_sdg: due.reduce((n, row) => sum(n, row.remaining_sdg), 0), overdue_usd: due.reduce((n, row) => sum(n, row.remaining_usd), 0), oldest_overdue_days: Math.max(0, ...due.map(row => row.overdue_days)) };
  }).filter(row => row.overdue_sdg || row.overdue_usd).sort((a, b) => b.overdue_sdg - a.overdue_sdg || b.overdue_usd - a.overdue_usd || a.customer_id.localeCompare(b.customer_id));
  return { period: { start: period.start || '', end: period.end }, aging, buckets, statements, overdue_customers: overdueCustomers, total_sdg: allocated.sdg, total_usd: allocated.usd, ledger_sdg: control.sdg, ledger_usd: control.usd, unallocated_sdg: new BigNumber(control.sdg).minus(allocated.sdg).toNumber(), unallocated_usd: new BigNumber(control.usd).minus(allocated.usd).toNumber() };
}

/** Cash accounts follow classification, including inactive accounts with history. Transfers are shown per account, not as revenue. */
export function cashBalances(accounts: Account[], entries: JournalEntry[], periodInput: ReportPeriod, asOf: string) {
  const period = reportPeriod(periodInput, asOf), dated = datedEntries(entries, period.end), chart = chartIndex(accounts, dated);
  const cash = [...chart.values()].filter(account => classifyAccount(account).reporting_group === 'cash_bank');
  const balances = cash.map(account => ({ ...accountLedger(accounts, entries, { ...periodInput, accountCode: account.code }, asOf) }));
  const total = (field: 'opening' | 'closing', book: Book) => balances.reduce((n, balance) => sum(n, balance[field][book] || 0), 0);
  // Aggregate inflow/outflow is net cash movement per journal, so internal cash transfers never inflate it.
  let inflow = zero(), outflow = zero();
  const cashCodes = new Set(cash.map(account => account.code));
  for (const entry of dated) {
    if (period.start && dateOnly(entry.date) < period.start) continue;
    const change = entry.lines.filter(line => cashCodes.has(line.account_code)).reduce((n, line) => add(n, net(line)), zero());
    inflow = add(inflow, { sdg: Math.max(0, change.sdg), usd: Math.max(0, change.usd) });
    outflow = add(outflow, { sdg: Math.max(0, -change.sdg), usd: Math.max(0, -change.usd) });
  }
  return { period: { start: period.start || '', end: period.end }, accounts: balances, opening_sdg: total('opening', 'SDG'), opening_usd: total('opening', 'USD'), closing_sdg: total('closing', 'SDG'), closing_usd: total('closing', 'USD'), inflow_sdg: inflow.sdg, inflow_usd: inflow.usd, outflow_sdg: outflow.sdg, outflow_usd: outflow.usd };
}

export interface OperationalReportTypes { ledger: ReturnType<typeof accountLedger>; receivables: ReturnType<typeof receivableReports>; cash: ReturnType<typeof cashBalances>; }

export type OperationalView = keyof OperationalReportTypes;
export function operationalPermissions(view: OperationalView): ActionType[] {
  ensure(['ledger', 'receivables', 'cash'].includes(view), 'نوع التقرير غير صالح.');
  return view === 'receivables' ? ['reports:view', 'customers:read', 'invoices:read', 'payments:read'] : ['journal:read', 'accounts:read'];
}
export function validateReportQuery(view: OperationalView, query: ReportPeriod & Partial<LedgerQuery>) {
  ensure(query && typeof query === 'object' && !Array.isArray(query), 'مرشحات التقرير غير صالحة.');
  const allowed = ['start', 'end', ...(view === 'ledger' ? ['accountCode', 'currency'] : [])];
  for (const [key, value] of Object.entries(query)) {
    ensure(allowed.includes(key), 'مرشح التقرير غير مدعوم.');
    ensure(value === undefined || typeof value === 'string' && value.length > 0, 'مرشح التقرير يجب أن يكون قيمة واحدة غير فارغة.');
  }
  ensure(view !== 'ledger' || typeof query.accountCode === 'string', 'اختر حساب دفتر الأستاذ.');
  ensure(!query.currency || ['SDG', 'USD'].includes(query.currency), 'عملة التقرير غير مدعومة.');
}
export function merchantDay(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export async function readOperationalReport<View extends OperationalView>(tx: Transaction, root: string, view: View, query: ReportPeriod & Partial<LedgerQuery>, asOf: string): Promise<OperationalReportTypes[View]> {
  validateReportQuery(view, query);
  const entries = await tx.list(`${root}/journal_entries`) as JournalEntry[];
  let report: Document;
  if (view === 'receivables') {
    const [customers, invoices, payments] = await Promise.all(['customers', 'invoices', 'payments'].map(name => tx.list(`${root}/${name}`)));
    report = receivableReports(customers, invoices, payments, entries, query, asOf);
  } else {
    const accounts = await tx.list(`${root}/accounts`) as Account[];
    report = view === 'ledger' ? accountLedger(accounts, entries, query as LedgerQuery, asOf) : cashBalances(accounts, entries, query, asOf);
  }
  return report as OperationalReportTypes[View];
}
