import BigNumber from 'bignumber.js';
import type { Account, JournalEntry } from '../types';
import type { Document } from './store';
import type { PayableContext } from './payables';
import { classifyAccount } from './accountClassification';
import { assertOpenPeriod, dateOnly, ensure, identifier, money, text } from './validation';
import { journal, journalLine } from './financial';
import { accountLedger } from './operationalReports';
export const cashCollections = ['financial_accounts', 'internal_transfers'] as const;
export interface FinancialAccount { id: string; name: string; account_code: string; currency: 'SDG' | 'USD'; kind: 'cash' | 'bank' | 'wallet'; status: 'active' | 'inactive'; org_id: string; created_at: string; updated_at: string; }
export function validateFinancialAccount(record: Document, accounts: Document[]) {
  identifier(record.id); identifier(record.account_code); text(record.name, 200, true);
  ensure(['SDG', 'USD'].includes(record.currency) && ['cash', 'bank', 'wallet'].includes(record.kind) && ['active', 'inactive'].includes(record.status), 'بيانات الحساب المالي غير صالحة.');
  const native = ({ '1110': 'SDG', '1120': 'USD' } as Record<string, string>)[record.account_code];
  ensure(!native || native === record.currency, 'عملة الخزينة الأساسية لا تطابق ربط الحساب.');
  const account = accounts.find(account => account.code === record.account_code);
  ensure(account && account.type === 'ASSET' && account.nature === 'DEBIT' && classifyAccount(account as Account).reporting_group === 'cash_bank', 'اربط الحساب المالي بحساب أصل نقدي أو بنكي مدين في الدليل.');
}
/** A same-currency transfer moves source carrying values proportionally; it never creates FX income or expense. */
export function transferCarryingValue(amount: number, currency: 'SDG' | 'USD', source: { SDG: number; USD: number }) {
  money(amount, currency === 'SDG' ? 0 : 2, true); money(source.SDG, 0); money(source.USD, 2);
  const native = source[currency]; ensure(amount <= native, 'رصيد المصدر غير كاف للتحويل.', 409);
  const other = currency === 'SDG' ? 'USD' : 'SDG', otherDecimals = other === 'SDG' ? 0 : 2;
  const otherAmount = amount === native ? source[other] : new BigNumber(source[other]).times(amount).dividedBy(native).decimalPlaces(otherDecimals, BigNumber.ROUND_HALF_UP).toNumber();
  return { sdg: currency === 'SDG' ? amount : otherAmount, usd: currency === 'USD' ? amount : otherAmount };
}
export async function cashCommand(action: string, data: Document, c: PayableContext): Promise<Document> {
  const stamp = { org_id: c.orgId, created_at: c.iso, updated_at: c.iso, created_by: c.actor, operation_id: c.operationId, schema_version: 3 };
  if (action.startsWith('financialAccount.')) {
    const updating = action === 'financialAccount.update', id = updating ? identifier(data.id) : `fa-${c.operationId}`;
    const old = updating ? await c.required('financial_accounts', id) : {};
    const input = updating ? data.updates : data; ensure(input && typeof input === 'object' && !Array.isArray(input), 'بيانات الحساب المالي غير صالحة.');
    ensure(!['balance_sdg', 'balance_usd', 'current_balance'].some(key => input[key] !== undefined), 'الرصيد المالي يُحسب من القيود فقط.');
    if (updating) ensure(['account_code', 'currency', 'kind'].every(key => input[key] === undefined || input[key] === old[key]), 'ربط الحساب المالي وعملته ونوعه ثابتة؛ أنشئ حساباً آخر.');
    const fields = updating ? ['name', 'status'] : ['name', 'account_code', 'currency', 'kind', 'status'];
    const result: Document = { ...old, ...Object.fromEntries(fields.filter(key => input[key] !== undefined).map(key => [key, input[key]])), ...(!updating ? stamp : {}), id, status: input.status || old.status || 'active', updated_at: c.iso };
    const accounts = await c.tx.list(`${c.root}/accounts`); validateFinancialAccount(result, accounts);
    const path = `${c.root}/financial_account_mappings/${result.account_code}`, mapping = await c.tx.get(path);
    ensure(!mapping || mapping.id === id, 'حساب الدليل مرتبط بحساب مالي آخر.', 409);
    if (!updating) { ensure(accounts.find(account => account.code === result.account_code)?.is_active, 'حساب الدليل غير نشط.'); ensure(!await c.tx.get(`${c.root}/financial_accounts/${id}`), 'الحساب المالي موجود مسبقاً.', 409); c.set(path, { id }); }
    c.set(`${c.root}/financial_accounts/${id}`, result); return result;
  }
  ensure(action === 'cashTransfer.create', 'عملية نقدية غير معروفة.');
  const from = await c.required('financial_accounts', data.from_id), to = await c.required('financial_accounts', data.to_id);
  ensure(from.id !== to.id && from.account_code !== to.account_code, 'اختر حسابين مختلفين للتحويل.');
  ensure(from.status === 'active' && to.status === 'active', 'الحساب المالي غير نشط.');
  ensure(from.currency === to.currency, 'التحويل الداخلي يدعم حسابين بنفس العملة؛ تحويل العملات يحتاج عملية صرف مستقلة.');
  const date = dateOnly(data.date); assertOpenPeriod(date, c.settings);
  const accounts = await c.tx.list(`${c.root}/accounts`), entries = await c.tx.list(`${c.root}/journal_entries`) as JournalEntry[];
  validateFinancialAccount(from, accounts); validateFinancialAccount(to, accounts);
  ensure([from, to].every(record => accounts.find(account => account.code === record.account_code)?.is_active), 'حساب الدليل غير نشط.');
  const ledger = accountLedger(accounts as Account[], entries, { accountCode: from.account_code, end: date }, date);
  const quote = transferCarryingValue(data.amount, from.currency, ledger.closing as { SDG: number; USD: number });
  // A backdated transfer cannot consume funds already spent on a later day.
  const future = accountLedger(accounts as Account[], entries, { accountCode: from.account_code }, '9999-12-31');
  const daily = new Map<string, Document>(); for (const row of future.rows) if (row.date > date) daily.set(row.date, row);
  for (const row of daily.values()) ensure(row.balance[from.currency] >= data.amount, 'التحويل بتاريخ قديم يسبب عجزاً في يوم لاحق.', 409);
  const id = `tr-${c.operationId}`, journalId = `jv-transfer-${c.operationId}`;
  const result = { ...stamp, id, from_id: from.id, to_id: to.id, from_account_code: from.account_code, to_account_code: to.account_code, currency: from.currency, amount: data.amount, amount_sdg: quote.sdg, amount_usd: quote.usd, source_balance_sdg: ledger.closing.SDG, source_balance_usd: ledger.closing.USD, date, reference_number: text(data.reference_number || '', 200), reason: text(data.reason, 500, true), journal_id: journalId };
  await c.post(journal(journalId, c.orgId, c.actor, date, 'internal_transfer', id, `تحويل ${from.name} إلى ${to.name}`, [journalLine(to.account_code, to.name, quote.sdg, 0, quote.usd, 0), journalLine(from.account_code, from.name, 0, quote.sdg, 0, quote.usd)]));
  for (const record of [from, to]) c.set(`${c.root}/financial_accounts/${record.id}`, { ...record, revision: (record.revision || 0) + 1, last_transfer_id: id, updated_at: c.iso });
  c.set(`${c.root}/internal_transfers/${id}`, result); return result;
}
export function reconcileCashManagement(data: Record<string, Document[]>) {
  const findings: { code: string; collection: string; id: string; message: string }[] = [];
  const accounts = data.accounts || [], financial = data.financial_accounts || [], transfers = data.internal_transfers || [], entries = data.journal_entries || [];
  const inspect = (collection: string, id: string, work: () => void) => { try { work(); } catch (e) { findings.push({ code: 'invalid_record', collection, id, message: e instanceof Error ? e.message : 'غير صالح' }); } };
  const mappings = new Set<string>();
  for (const record of financial) inspect('financial_accounts', record.id, () => { validateFinancialAccount(record, accounts); ensure(!mappings.has(record.account_code), 'حساب الدليل مرتبط أكثر من مرة.'); mappings.add(record.account_code); });
  for (const transfer of transfers) inspect('internal_transfers', transfer.id, () => {
    const from = financial.find(record => record.id === transfer.from_id), to = financial.find(record => record.id === transfer.to_id);
    ensure(from && to && from.id !== to.id && from.account_code !== to.account_code, 'مراجع حساب التحويل غير صالحة.');
    ensure(from.account_code === transfer.from_account_code && to.account_code === transfer.to_account_code && from.currency === to.currency && from.currency === transfer.currency, 'عملة أو ربط حساب التحويل غير صالح.');
    dateOnly(transfer.date); text(transfer.reason, 500, true); text(transfer.reference_number, 200);
    const quote = transferCarryingValue(transfer.amount, transfer.currency, { SDG: transfer.source_balance_sdg, USD: transfer.source_balance_usd });
    ensure(new BigNumber(quote.sdg).eq(transfer.amount_sdg) && new BigNumber(quote.usd).eq(transfer.amount_usd), 'قيم التحويل لا تطابق القيمة الدفترية المثبتة.');
    const journals = entries.filter(entry => entry.reference_type === 'internal_transfer' && entry.reference_id === transfer.id);
    ensure(journals.length === 1 && journals[0].id === transfer.journal_id && dateOnly(journals[0].date) === dateOnly(transfer.date), 'قيد التحويل ناقص أو مكرر.');
    const lines = journals[0].lines; ensure(lines.length === 2, 'قيد التحويل لا يتضمن إيراداً أو مصروفاً.');
    for (const [code, debit] of [[to.account_code, true], [from.account_code, false]] as const) {
      const rows = lines.filter((line: Document) => line.account_code === code); ensure(rows.length === 1, 'حساب قيد التحويل مختلف.');
      for (const book of ['sdg', 'usd']) ensure(new BigNumber(rows[0][`${debit ? 'debit' : 'credit'}_${book}`]).eq(transfer[`amount_${book}`]) && rows[0][`${debit ? 'credit' : 'debit'}_${book}`] === 0, 'مبلغ قيد التحويل مختلف.');
    }
  });
  for (const entry of entries.filter(entry => entry.reference_type === 'internal_transfer')) if (!transfers.some(transfer => transfer.id === entry.reference_id)) findings.push({ code: 'missing_source', collection: 'journal_entries', id: entry.id, message: 'مصدر التحويل غير موجود.' });
  return findings;
}
