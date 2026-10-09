import BigNumber from 'bignumber.js';
import type { Account, JournalEntry, MerchantSettings, OrgRole } from '../types';
import { clean, type Change, type Document, type Transaction } from './store';
import { dateOnly, ensure, identifier, money, text } from './validation';
import { prepareOpeningPreview, openingPreviewHash } from './openingPreview';
import type { OpeningInput } from './openingBalances';
import { openingBatchEvidence, openingSettlementEvidence, verifyOpeningSources, type OpeningLot, type OpeningTerms } from './openingSources';
import { openingBackupCounts } from './openingIntegration';
import { financialCollections, reconcileFinancialData, type FinancialData } from './reconciliation';
import { accountLedger } from './operationalReports';
import { verifyClosedPeriodHashes } from './periodContracts';
import { verifyCashSessionHashes } from './cashReconciliation';

export const openingActions = ['opening.commit', 'openingSettlement.create'] as const;
const exact = (value: unknown, keys: string[]) => ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)), 'حقول عملية الأرصدة غير صالحة أو محمية.');
/** Validate request identity before consulting an idempotency record. Amounts and sources are still verified from current data. */
export function validateOpeningRequest(action: string, data: Document) {
  if (action === 'opening.commit') {
    exact(data, ['input', 'terms', 'expected_preview_hash']);
    ensure(data.input && typeof data.input === 'object' && !Array.isArray(data.input) && Array.isArray(data.terms) && data.terms.length <= 97, 'مدخلات الأرصدة والاستحقاقات مطلوبة.');
    ensure(typeof data.expected_preview_hash === 'string' && /^[a-f0-9]{64}$/.test(data.expected_preview_hash), 'بصمة المعاينة الحالية مطلوبة.');
    identifier(data.input.batch_id); text(data.input.reason, 1000, true);
    return data.input.date;
  }
  ensure(action === 'openingSettlement.create', 'عملية أرصدة غير معروفة.');
  exact(data, ['lot_id', 'expected_sequence', 'date', 'financial_account_id', 'currency', 'amount', 'exchange_rate_used', 'reason', 'reference_number']);
  identifier(data.lot_id); identifier(data.financial_account_id);
  ensure(Number.isSafeInteger(data.expected_sequence) && data.expected_sequence >= 0 && data.expected_sequence < 200, 'تسلسل مصدر الرصيد الحالي مطلوب.');
  text(data.reason, 1000, true); text(data.reference_number, 200);
  return data.date;
}

export async function readOpeningFinancialData(tx: Transaction, root: string, orgId: string, seed: Record<string, Document[]> = {}): Promise<FinancialData> {
  const data = { ...seed };
  await Promise.all([...new Set(financialCollections)].map(async name => { if (!data[name]) data[name] = await tx.list(`${root}/${name}`); }));
  for (const name of financialCollections) ensure(Array.isArray(data[name]) && data[name].length <= 1200 && data[name].every(row => row && typeof row === 'object' && !Array.isArray(row) && row.org_id === orgId), 'مصادر العملية ناقصة أو تنتمي لمؤسسة أخرى أو تتجاوز حد المعاملة.', 413);
  return data as FinancialData;
}
export async function assertOpeningFinancialData(data: FinancialData, settings: MerchantSettings) {
  ensure(!reconcileFinancialData(data, settings, { requireCosting: true }).length, 'دفاتر الأرصدة تحتوي فروقات أو مراجع ناقصة؛ راجع المطابقة قبل العملية.', 409);
  await verifyClosedPeriodHashes(data.accounting_periods, data.journal_entries, data);
  await verifyCashSessionHashes(data);
}
interface Context {
  tx: Transaction; root: string; orgId: string; version: number; role: OrgRole; settings: MerchantSettings;
  now: Date; actor: string; operationId: string;
}
/** Proposes complete immutable sources and live caches without relying on read-your-writes support in the store. */
export async function openingTransaction(action: string, request: Document, c: Context) {
  const iso = c.now.toISOString(), identity = { operation_id: c.operationId, actor_id: c.actor, created_at: iso };
  const prepared = action === 'opening.commit' ? await prepareOpeningPreview(c.tx, c.root, c.orgId, c.version, c.role, c.settings, c.now, request as { input: OpeningInput; terms: OpeningTerms[] }) : undefined;
  if (prepared) ensure(prepared.preview.preview_hash === request.expected_preview_hash, 'المعاينة تغيرت؛ أعد المعاينة والتأكيد قبل تسجيل الأرصدة.', 409);
  const original = await readOpeningFinancialData(c.tx, c.root, c.orgId, prepared?.data);
  await assertOpeningFinancialData(original, c.settings);
  const usedCash=prepared?prepared.plan.quote.sources.filter(row=>row.kind==='cash').map(row=>row.source_id):[request.financial_account_id];
  for(const id of usedCash) { const financial=original.financial_accounts.find(row=>row.id===id);ensure(financial && (await c.tx.get(`${c.root}/financial_account_mappings/${identifier(financial.account_code)}`))?.id===id,'ربط حساب نقدية الأرصدة يحتاج مراجعة.',409); }

  const staged = clean(original), changes: Change[] = [], before = new Map<string, Document>();
  const save = (name: keyof FinancialData, record: Document, creating = false) => {
    const id = identifier(name === 'accounts' ? record.code : record.id), rows = staged[name], index = rows.findIndex(row => (name === 'accounts' ? row.code : row.id) === id), path = `${c.root}/${name}/${id}`;
    ensure(!creating || index < 0, 'معرف مصدر الأرصدة أو القيد موجود مسبقاً.', 409);
    if (index >= 0) { before.set(path, clean(rows[index])); rows[index] = clean(record); } else rows.push(clean(record));
    changes.push({ path, value: clean(record) });
  };
  let result: Document, proof: Document;
  if (prepared) {
    const evidence = openingBatchEvidence(prepared.plan.input, prepared.plan.snapshot, prepared.plan.terms, identity);
    save('opening_batches', evidence.batch, true); for (const lot of evidence.lots) save('opening_lots', lot, true);
    for (const movement of evidence.movements) save('inventory_movements', movement, true);
    save('journal_entries', evidence.journal, true);
    for (const source of evidence.batch.quote.sources) {
      const name = source.kind === 'cash' ? 'financial_accounts' : source.kind === 'receivable' ? 'customers' : source.kind === 'payable' ? 'suppliers' : 'products';
      const old = staged[name].find(row => row.id === source.source_id)!;
      const fields = source.kind === 'cash' ? {} : source.kind === 'receivable' ? { balance_sdg: source.sdg, balance_usd: source.usd, receivable_due_sdg: source.sdg, receivable_due_usd: source.usd, credit_balance_sdg: 0, credit_balance_usd: 0 } : source.kind === 'payable' ? { payable_due_sdg: source.sdg, payable_due_usd: source.usd, advance_balance_sdg: 0, advance_balance_usd: 0 } : evidence.movements.find(row => row.product_id === source.source_id)!.after;
      save(name, { ...old, ...fields, revision: (old.revision || 0) + 1, last_opening_batch_id: evidence.batch.id, updated_at: iso });
    }
    proof = { batch_id: evidence.batch.id, journal_id: evidence.journal.id, expected_preview_hash: request.expected_preview_hash, source_count: evidence.batch.quote.sources.length, lot_count: evidence.lots.length, inventory_movement_count: evidence.movements.length, capital: evidence.batch.quote.capital, opening_equity: evidence.batch.quote.opening_equity, equity_difference_reason: evidence.batch.quote.equity_difference_reason };
    result = { id: evidence.batch.id, date: evidence.batch.quote.date, reason: evidence.batch.quote.reason, ...proof };
  } else {
    const verified = verifyOpeningSources(original, c.orgId), lot = verified.lots.find(row => row.id === request.lot_id);
    ensure(lot, 'مصدر الرصيد الافتتاحي غير موجود.', 404);
    const state = verified.states.get(lot.id)!, batch = verified.batches.find(row => row.id === lot.batch_id)!;
    ensure(state.sequence === request.expected_sequence, 'تسلسل الرصيد تغير؛ حدّث المصدر قبل التسوية.', 409);
    const financial = original.financial_accounts.find(row => row.id === request.financial_account_id);
    ensure(financial && original.financial_accounts.filter(row => row.account_code === financial.account_code).length === 1, 'الحساب المالي مفقود أو ربطه مكرر.', 409);
    const input = { id: `os-${c.operationId}`, date: request.date, financial_account_id: request.financial_account_id, currency: request.currency, amount: request.amount, exchange_rate_used: request.exchange_rate_used, reason: request.reason, reference_number: request.reference_number };
    const evidence = openingSettlementEvidence(lot as OpeningLot, state, input, financial, original.accounts as Account[], batch.input.currency_policy, identity);
    assertCashAvailability(original, financial, evidence.event.quote, lot.kind === 'payable');
    save('opening_settlements', evidence.event, true); save('journal_entries', evidence.journal, true);
    const name = lot.kind === 'receivable' ? 'customers' : 'suppliers', party = staged[name].find(row => row.id === lot.party_id)!;
    const fields: Document = {};
    for (const book of ['sdg', 'usd'] as const) {
      const settled = evidence.event.quote.settled[book];
      if (lot.kind === 'receivable') {
        fields[`balance_${book}`] = new BigNumber(party[`balance_${book}`]).minus(settled).toNumber();
        const opening = verified.lots.filter(row => row.kind === 'receivable' && row.party_id === party.id).reduce((n, row) => n.plus(verified.states.get(row.id)![book]), new BigNumber(0));
        const due = original.invoices.filter(row => row.customer_id === party.id && !['void', 'cancelled', 'draft'].includes(row.status)).reduce((n, row) => n.plus(row[`remaining_${book}`] || 0), opening);
        fields[`receivable_due_${book}`] = due.minus(settled).toNumber();
      } else fields[`payable_due_${book}`] = new BigNumber(party[`payable_due_${book}`]).minus(settled).toNumber();
    }
    save(name, { ...party, ...fields, revision: (party.revision || 0) + 1, last_opening_settlement_id: evidence.event.id, updated_at: iso });
    save('financial_accounts', { ...financial, revision: (financial.revision || 0) + 1, last_opening_settlement_id: evidence.event.id, updated_at: iso });
    proof = { lot_id: lot.id, batch_id: lot.batch_id, journal_id: evidence.journal.id, financial_account_id: financial.id, sequence: evidence.event.sequence, before: state, after: evidence.event.quote.after, cash: evidence.event.quote.cash, settled: evidence.event.quote.settled, gain: evidence.event.quote.gain };
    result = { id: evidence.event.id, date: evidence.event.quote.date, reason: evidence.event.quote.reason, currency: input.currency, amount: input.amount, reference_number: input.reference_number, ...proof };
  }
  // FirestoreStore buffers writes and reads the old snapshot. Check an explicit overlay before submitting anything.
  await assertOpeningFinancialData(staged, c.settings);
  // Check physical document paths independently of an id field inside a queried record.
  await Promise.all(changes.map(async change=>{const actual=await c.tx.get(change.path),expected=before.get(change.path);ensure(expected?actual && await openingPreviewHash(actual)===await openingPreviewHash(expected):!actual,'مسار مصدر الأرصدة موجود أو لا يطابق السجل المقروء.',409);}));

  ensure(changes.length + 4 <= 450, 'عدد سجلات الأرصدة يتجاوز الحد الذري المسموح.', 413);
  return { result, proof, changes, before, counters: { ...openingBackupCounts(staged), inventory_movement_count: staged.inventory_movements.length } };
}
function assertCashAvailability(data: FinancialData, financial: Document, quote: Document, outgoing: boolean) {
  const at = accountLedger(data.accounts as Account[], data.journal_entries as JournalEntry[], { accountCode: financial.account_code, end: quote.date }, quote.date);
  const future = accountLedger(data.accounts as Account[], data.journal_entries as JournalEntry[], { accountCode: financial.account_code }, '9999-12-31');
  const daily = new Map<string, Document>(); for (const row of future.rows) if (row.date > quote.date) daily.set(row.date, row);
  for (const balance of [at.closing, ...[...daily.values()].map(row => row.balance)]) for (const [book, key] of [['sdg', 'SDG'], ['usd', 'USD']] as const) {
    const after = new BigNumber(balance[key]).plus(outgoing ? -quote.cash[book] : quote.cash[book]);
    if (outgoing) ensure(after.gte(0), 'رصيد النقدية غير كاف في تاريخ التسوية أو يوم لاحق في أحد الدفترين.', 409);
    money(after.abs().toNumber(), book === 'sdg' ? 0 : 2);
  }
  ensure(dateOnly(quote.date) === quote.date && ['SDG', 'USD'].includes(financial.currency), 'تاريخ أو عملة النقدية غير صالح.');
}
