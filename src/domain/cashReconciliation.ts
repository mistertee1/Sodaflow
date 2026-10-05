import BigNumber from 'bignumber.js';
import type { Account, JournalEntry } from '../types';
import type { Document, Transaction } from './store';
import type { PayableContext } from './payables';
import { accountLedger, merchantDay, reportPeriod, type ReportPeriod } from './operationalReports';
import { validateFinancialAccount } from './cashManagement';
import { dateOnly, ensure, identifier, money, text } from './validation';
export const cashReconciliationCollections = ['bank_reconciliations', 'cash_reconciliations'] as const;
const signedMoney = (value: number, decimals: number) => { ensure(typeof value === 'number' && Number.isFinite(value), 'الرصيد غير صالح.'); money(Math.abs(value), decimals); return value; };
const sourceKey = (row: Document) => `${row.journal_id}:${row.line_index}`;
const nativeDelta = (row: Document, currency: string) => new BigNumber(row[`debit_${currency.toLowerCase()}`]).minus(row[`credit_${currency.toLowerCase()}`]).toNumber();
const nativeClosing = (record: Document) => record.ledger_snapshot[`closing_${record.currency.toLowerCase()}`];
const canonicalRow = (row: Document) => ({ journal_id: row.journal_id, line_index: row.line_index, date: row.date, reference_type: row.reference_type, reference_id: row.reference_id, debit_sdg: row.debit.SDG, credit_sdg: row.credit.SDG, debit_usd: row.debit.USD, credit_usd: row.credit.USD });
function stable(value: unknown): string { if (Array.isArray(value)) return '['+value.map(stable).join(',')+']'; if (value && typeof value === 'object') return '{'+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+stable(item)).join(',')+'}'; return JSON.stringify(value); }
async function hash(value: unknown) { const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(result)].map(n => n.toString(16).padStart(2,'0')).join(''); }
export async function captureCashLedger(accounts: Account[], entries: JournalEntry[], accountCode: string, period: ReportPeriod, asOf: string, enforceLimit = true) {
  const ledger = accountLedger(accounts, entries, { ...period, accountCode }, asOf);
  ensure(!enforceLimit || ledger.rows.length <= 1000, 'حركات المطابقة تتجاوز 1000؛ اختر فترة أقصر.', 413);
  const all = accountLedger(accounts, entries, { accountCode, end: ledger.period.end }, asOf);
  ensure(!enforceLimit || all.rows.length <= 1000, 'إثبات المطابقة يتجاوز 1000 طرف حتى نهاية الفترة؛ يحتاج إجراء مطابقة موسع.', 413);
  return { period: ledger.period, opening_rows: all.rows.filter(row => row.date < ledger.period.start).map(canonicalRow), opening_sdg: ledger.opening.SDG || 0, opening_usd: ledger.opening.USD || 0, closing_sdg: ledger.closing.SDG || 0, closing_usd: ledger.closing.USD || 0, rows: ledger.rows.map(canonicalRow), ledger_hash: await hash({ account_code: accountCode, period: ledger.period, rows: all.rows.map(canonicalRow) }) };
}
function bankResult(record: Document) {
  const decimals = record.currency === 'USD' ? 2 : 0, lines = record.statement_lines;
  signedMoney(record.statement_opening, decimals); signedMoney(record.statement_closing, decimals);
  ensure(Array.isArray(lines) && lines.length <= 100, 'كشف البنك يدعم 100 حركة يدوية كحد أقصى.');
  const lineIndex = new Map<string, Document>(); let closing = new BigNumber(record.statement_opening);
  for (const row of lines) {
    identifier(row.id); ensure(!lineIndex.has(row.id), 'معرّف حركة البنك مكرر.'); lineIndex.set(row.id, row);
    const date = dateOnly(row.date); ensure(date >= record.ledger_snapshot.period.start && date <= record.ledger_snapshot.period.end, 'حركة البنك خارج فترة المطابقة.');
    ensure(['inflow','outflow'].includes(row.direction), 'اتجاه حركة البنك غير صالح.'); money(row.amount, decimals, true); text(row.reference, 200); text(row.description, 500);
    closing = row.direction === 'inflow' ? closing.plus(row.amount) : closing.minus(row.amount);
  }
  ensure(closing.eq(record.statement_closing), 'رصيد إقفال كشف البنك لا يساوي الافتتاحي وحركات الكشف.');
  const ledger = new Map<string, Document>(record.ledger_snapshot.rows.filter((row: Document) => nativeDelta(row,record.currency) !== 0).map((row: Document) => [sourceKey(row),row]));
  ensure(Array.isArray(record.matches) && record.matches.length <= 100, 'بيانات ربط الحركات غير صالحة.');
  const matchedStatements = new Set<string>(), matchedLedger = new Set<string>();
  for (const match of record.matches) {
    identifier(match.statement_line_id); identifier(match.journal_id); ensure(Number.isInteger(match.line_index) && match.line_index >= 0 && match.line_index < 100, 'رقم طرف المطابقة غير صالح.');
    const key = sourceKey(match), statement = lineIndex.get(match.statement_line_id), book = ledger.get(key);
    ensure(statement && book && !matchedStatements.has(statement.id) && !matchedLedger.has(key), 'الحركة ناقصة أو رُبطت أكثر من مرة.');
    const expected = statement.direction === 'inflow' ? statement.amount : -statement.amount;
    ensure(new BigNumber(nativeDelta(book,record.currency)).eq(expected), 'مبلغ أو اتجاه حركة البنك لا يطابق قيد النظام.');
    matchedStatements.add(statement.id); matchedLedger.add(key);
  }
  const difference = new BigNumber(record.statement_closing).minus(nativeClosing(record)).toNumber();
  const openingDifference = new BigNumber(record.statement_opening).minus(record.ledger_snapshot[`opening_${record.currency.toLowerCase()}`]).toNumber();
  if (difference || openingDifference) text(record.difference_reason, 1000, true); else text(record.difference_reason, 1000);
  const unmatched = lines.length - matchedStatements.size + ledger.size - matchedLedger.size;
  return { difference, opening_difference: openingDifference, status: difference || openingDifference ? 'adjustment_required' : unmatched ? 'pending' : 'matched', statement_rows: lines.map((row: Document) => ({ ...row, status: matchedStatements.has(row.id) ? 'matched' : 'unmatched' })), ledger_rows: [...ledger.values()].map(row => ({ ...row, status: matchedLedger.has(sourceKey(row)) ? 'matched' : 'pending' })) };
}
function cashResult(record: Document) {
  money(record.actual_count, record.currency === 'USD' ? 2 : 0);
  const difference = new BigNumber(record.actual_count).minus(nativeClosing(record)).toNumber();
  text(record.difference_reason,1000,!!difference);
  return { difference, status: difference ? 'adjustment_required' : 'matched' };
}
export async function cashReconciliationCommand(action: string, data: Document, c: PayableContext): Promise<Document> {
  const bank = action === 'bankReconciliation.create'; ensure(bank || action === 'cashCount.create', 'عملية المطابقة غير معروفة.');
  const financial = await c.required('financial_accounts',data.financial_account_id); ensure(financial.status === 'active', 'الحساب المالي غير نشط.');
  ensure(bank ? ['bank','wallet'].includes(financial.kind) : financial.kind === 'cash', bank ? 'مطابقة البنك تتطلب حساب بنك أو محفظة.' : 'الجرد يتطلب حساب صندوق.');
  const accounts = await c.tx.list(`${c.root}/accounts`) as Account[]; validateFinancialAccount(financial,accounts);
  const asOf = merchantDay(new Date(c.iso),c.settings.timezone || 'Africa/Khartoum');
  const period = bank ? reportPeriod({start:dateOnly(data.period?.start),end:dateOnly(data.period?.end)},asOf) : {start:dateOnly(data.date),end:dateOnly(data.date)};
  ensure(period.end <= asOf,'لا يمكن إثبات مطابقة أو جرد بتاريخ مستقبلي.');
  const entries = await c.tx.list(`${c.root}/journal_entries`) as JournalEntry[];
  ensure(Number.isSafeInteger(financial.reconciliation_sequence || 0) && (financial.reconciliation_sequence || 0) >= 0 && (financial.reconciliation_sequence || 0) < Number.MAX_SAFE_INTEGER, 'عداد المطابقة غير صالح؛ راجع السجل.', 409);
  const snapshot = await captureCashLedger(accounts,entries,financial.account_code,period,asOf);
  const id = `${bank?'br':'cr'}-${c.operationId}`, result: Document = { id, org_id:c.orgId, schema_version:3, financial_account_id:financial.id, account_code:financial.account_code, currency:financial.currency, sequence:(financial.reconciliation_sequence||0)+1, ledger_snapshot:snapshot, difference_reason:text(data.difference_reason||'',1000), created_at:c.iso, created_by:c.actor, operation_id:c.operationId, ...(bank ? {statement_opening:data.statement_opening,statement_closing:data.statement_closing,statement_lines:data.statement_lines,matches:data.matches||[]} : {actual_count:data.actual_count}) };
  const comparison = bank ? bankResult(result) : cashResult(result); result.status=comparison.status;result.difference=comparison.difference;if(bank)result.opening_difference=(comparison as ReturnType<typeof bankResult>).opening_difference;
  ensure(new TextEncoder().encode(JSON.stringify(result)).length<=300000,'حجم سجل المطابقة كبير؛ اختر فترة أقصر.',413);
  c.set(`${c.root}/${bank?'bank_reconciliations':'cash_reconciliations'}/${id}`,result);
  c.set(`${c.root}/financial_accounts/${financial.id}`,{...financial,reconciliation_sequence:result.sequence,last_reconciliation_id:id,updated_at:c.iso});
  return result; // A count/match never automatically alters the financial books.
}
function validateSnapshot(record: Document, data: Record<string,Document[]>) {
  const snapshot = record.ledger_snapshot; ensure(snapshot && Array.isArray(snapshot.rows) && Array.isArray(snapshot.opening_rows) && snapshot.rows.length + snapshot.opening_rows.length<=1000 && /^[a-f0-9]{64}$/.test(snapshot.ledger_hash),'إثبات دفتر المطابقة غير صالح.');
  const period = reportPeriod(snapshot.period,snapshot.period?.end); ensure(period.start,'بداية فترة المطابقة مطلوبة.');
  const seen = new Set<string>(); let sdg=new BigNumber(signedMoney(snapshot.opening_sdg,0)),usd=new BigNumber(signedMoney(snapshot.opening_usd,2));signedMoney(snapshot.closing_sdg,0);signedMoney(snapshot.closing_usd,2);
  let openingSdg = new BigNumber(0), openingUsd = new BigNumber(0);
  for(const row of [...snapshot.opening_rows, ...snapshot.rows]){
    identifier(row.journal_id);ensure(Number.isInteger(row.line_index)&&row.line_index>=0&&row.line_index<100&&!seen.has(sourceKey(row)),'طرف مطابقة ناقص أو مكرر.');seen.add(sourceKey(row));
    const entry=(data.journal_entries||[]).find(entry=>entry.id===row.journal_id),line=entry?.lines?.[row.line_index];
    ensure(entry&&line&&line.account_code===record.account_code&&dateOnly(entry.date)===dateOnly(row.date)&&row.date<=period.end&&entry.reference_type===row.reference_type&&entry.reference_id===row.reference_id,'مرجع طرف المطابقة مختلف.');
    ensure(snapshot.opening_rows.includes(row) ? row.date<period.start : row.date>=period.start,'تصنيف حركة الإثبات قبل/داخل الفترة غير صحيح.');
    for(const field of ['debit_sdg','credit_sdg','debit_usd','credit_usd']) ensure(new BigNumber(line[field]).eq(row[field]),'قيمة طرف المطابقة مختلفة.');
    if (snapshot.opening_rows.includes(row)) { openingSdg=openingSdg.plus(row.debit_sdg).minus(row.credit_sdg); openingUsd=openingUsd.plus(row.debit_usd).minus(row.credit_usd); }
    else { sdg=sdg.plus(row.debit_sdg).minus(row.credit_sdg);usd=usd.plus(row.debit_usd).minus(row.credit_usd); }
  }
  ensure(openingSdg.eq(snapshot.opening_sdg)&&openingUsd.eq(snapshot.opening_usd),'الرصيد الافتتاحي لا يطابق مصادر إثبات المطابقة.');
  ensure(sdg.eq(snapshot.closing_sdg)&&usd.eq(snapshot.closing_usd),'إقفال إثبات المطابقة لا يساوي حركاته.');
}
/** Recompute saved evidence hashes, independent of later backdated journals and Firestore map key order. */
export async function verifyCashSessionHashes(data: Record<string,Document[]>) {
  for (const collection of cashReconciliationCollections) for (const record of data[collection] || []) {
    const snapshot = record.ledger_snapshot;
    ensure(snapshot && Array.isArray(snapshot.opening_rows) && Array.isArray(snapshot.rows), 'إثبات المطابقة ناقص.', 409);
    const rows = [...snapshot.opening_rows, ...snapshot.rows].map(row => canonicalRow({ ...row, debit: { SDG:row.debit_sdg, USD:row.debit_usd }, credit: { SDG:row.credit_sdg, USD:row.credit_usd } }));
    ensure(snapshot.ledger_hash === await hash({ account_code:record.account_code, period:{start:snapshot.period.start,end:snapshot.period.end}, rows }), 'بصمة إثبات المطابقة لا تطابق مصادره.', 409);
  }
}
export function reconcileCashSessions(data: Record<string,Document[]>) {
  const findings:{code:string;collection:string;id:string;message:string}[]=[];
  const sequences = new Set<string>();
  for(const collection of cashReconciliationCollections)for(const record of data[collection]||[]){try{
    const financial=(data.financial_accounts||[]).find(account=>account.id===record.financial_account_id);ensure(financial&&financial.account_code===record.account_code&&financial.currency===record.currency,'مرجع حساب المطابقة غير صالح.');
    ensure(collection==='bank_reconciliations'?['bank','wallet'].includes(financial.kind):financial.kind==='cash','نوع حساب المطابقة غير صالح.');dateOnly(record.created_at);identifier(record.created_by);
    ensure(Number.isInteger(record.sequence)&&record.sequence>0&&!sequences.has(`${financial.id}:${record.sequence}`),'ترتيب سجل المطابقة غير صالح.');sequences.add(`${financial.id}:${record.sequence}`);
    validateSnapshot(record,data);const result=collection==='bank_reconciliations'?bankResult(record):cashResult(record);ensure(result.status===record.status&&new BigNumber(result.difference).eq(record.difference),'نتيجة سجل المطابقة مختلفة.');
    if(collection==='bank_reconciliations')ensure(new BigNumber((result as ReturnType<typeof bankResult>).opening_difference).eq(record.opening_difference),'فرق افتتاحي المطابقة مختلف.');
  }catch(e){findings.push({code:'invalid_record',collection,id:record.id,message:e instanceof Error?e.message:'غير صالح'});}}
  for (const account of data.financial_accounts||[]) { const records=cashReconciliationCollections.flatMap(name=>data[name]||[]).filter(record=>record.financial_account_id===account.id), sequence=Math.max(0,...records.map(record=>record.sequence||0)); if((account.reconciliation_sequence||0)!==sequence || sequence && !records.some(record=>record.sequence===sequence&&record.id===account.last_reconciliation_id)) findings.push({code:'invalid_record',collection:'financial_accounts',id:account.id,message:'عداد ومؤشر المطابقة لا يطابقان السجلات.'}); }
  // Pending differences and stale historical sessions are evidence, not a new financial posting or a restore veto.
  return findings;
}
export async function cashReconciliationReports(tx: Transaction, root: string, asOf: string) {
  const [accounts,entries,financial,bank,cash] = await Promise.all(['accounts','journal_entries','financial_accounts','bank_reconciliations','cash_reconciliations'].map(name=>tx.list(`${root}/${name}`)));
  const data={accounts,journal_entries:entries,financial_accounts:financial,bank_reconciliations:bank,cash_reconciliations:cash};ensure(!reconcileCashSessions(data).length,'سجل المطابقة يحتاج مراجعة مصدرية.',409);
  await verifyCashSessionHashes(data);
  const records:Document[]=[];
  for(const [kind,sessions] of [['bank',bank],['cash',cash]] as const)for(const saved of sessions){
    if(saved.ledger_snapshot.period.end>dateOnly(asOf))continue;
    const current=await captureCashLedger(accounts as Account[],entries as JournalEntry[],saved.account_code,saved.ledger_snapshot.period,asOf,false);
    const same=current.ledger_hash===saved.ledger_snapshot.ledger_hash&&stable(current)===stable(saved.ledger_snapshot);
    const result=kind==='bank'?bankResult(saved):cashResult(saved);
    records.push({...saved,kind,...result,effective_status:same?saved.status:'stale',ledger_changed:!same,current_book_balance:current[`closing_${saved.currency.toLowerCase() as 'sdg'|'usd'}`]});
  }
  records.sort((a,b)=>b.sequence-a.sequence||b.id.localeCompare(a.id));
  return {as_of:dateOnly(asOf),records,accounts:financial.map(account=>({financial_account_id:account.id,name:account.name,account_code:account.account_code,currency:account.currency,kind:account.kind,latest:records.find(record=>record.financial_account_id===account.id)||null, current_status:(()=>{const latest=records.find(record=>record.financial_account_id===account.id);return !latest?'unmatched':latest.effective_status==='matched'&&latest.ledger_snapshot.period.end<dateOnly(asOf)?'pending':latest.effective_status;})()}))};
}
