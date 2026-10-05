import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { accountLedger, cashBalances, receivableReports } from '../src/domain/operationalReports';
import { getDefaultChartOfAccounts, calculateTrialBalance } from '../src/services/accountingService';
import { journal, journalLine, reverseJournal } from '../src/domain/financial';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { createApi } from '../server/api';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import type { Account, JournalEntry } from '../src/types';
const day = '2026-10-05';
const owner: Actor = { uid: 'reports-owner', email: 'reports@example.com', emailVerified: true };
const entry = (id: string, date: string, lines: JournalEntry['lines'], type: JournalEntry['reference_type'] = 'manual', ref = id) => journal(id, 'org', owner.uid, date, type, ref, `description-${id}`, lines);
const chart = () => getDefaultChartOfAccounts('org');
const customers = [{ id: 'c1', name: 'عميل', balance_sdg: 999999, balance_usd: 999999 }];
const invoice = (id: string, due_date: string) => ({ id, customer_id: 'c1', invoice_number: `INV-${id}`, issue_date: '2026-06-01', due_date, status: 'paid', remaining_sdg: 0, remaining_usd: 0 });
const sale = (id: string, amount = 1000) => entry(`j-${id}`, '2026-06-01', [journalLine('1200', 'AR', amount, 0, amount / 1000, 0), journalLine('4100', 'sales', 0, amount, 0, amount / 1000)], 'invoice', id);

test('B2 ledger openings, inclusive dates, stable per-line source references and debit-positive credit balances agree with trial balance', () => {
  const accounts = chart(); accounts.find(a => a.code === '1110')!.is_active = false; accounts.find(a => a.code === '1110')!.balance_sdg = 99999;
  const entries = [entry('old', '2026-09-30', [journalLine('1110', 'cash', 1000, 0, 1, 0), journalLine('3100', 'equity', 0, 1000, 0, 1)]), entry('first', '2026-10-01T00:00:00Z', [journalLine('1110', 'cash', 30, 0, .03, 0), journalLine('1110', 'cash', 20, 0, .02, 0), journalLine('4100', 'sales', 0, 50, 0, .05)]), entry('last', '2026-10-31T23:59:59Z', [journalLine('5200', 'rent', 10, 0, .01, 0), journalLine('1110', 'cash', 0, 10, 0, .01)]), entry('future', '2026-11-01', [journalLine('1110', 'cash', 999, 0, .99, 0), journalLine('3100', 'equity', 0, 999, 0, .99)])];
  const period = { start: '2026-10-01', end: '2026-10-31' }, result = accountLedger(accounts, entries, { ...period, accountCode: '1110' }, day);
  assert.equal(result.opening.SDG, 1000); assert.equal(result.closing.SDG, 1040); assert.equal(result.closing.USD, 1.04); assert.equal(result.account.is_active, false); assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map(row => [row.journal_id, row.line_index]), [['first', 0], ['first', 1], ['last', 1]]);
  assert.equal(result.rows[1].balance.SDG, 1050); assert.equal(result.total_debit.SDG, 50); assert.equal(result.total_credit.SDG, 10);
  const trial = calculateTrialBalance(accounts, entries, period).items.find(row => row.account_code === '1110')!; assert.equal(result.closing.SDG, trial.net_balance_sdg);
  const equity = accountLedger(accounts, entries, { ...period, accountCode: '3100' }, day); assert.equal(equity.closing.SDG, -1000); assert.equal(equity.account.normal_balance, 'CREDIT');
});
test('B2 native currency projection never exposes an inconsistent hidden-book running balance and malformed reports fail visibly', () => {
  const entries = [entry('usd', day, [journalLine('1110', 'cash', 30, 0, .03, 0), journalLine('4100', 'sales', 0, 30, 0, .03)]), entry('local', day, [journalLine('1110', 'cash', 7), journalLine('4100', 'sales', 0, 7)])];
  const result = accountLedger(chart(), entries, { accountCode: '1110', currency: 'USD' }, day); assert.equal(result.rows.length, 1); assert.deepEqual(result.closing, { USD: .03 }); assert.deepEqual(result.rows[0].balance, { USD: .03 });
  assert.throws(() => accountLedger(chart(), entries, { accountCode: '1110', start: '2027-01-01', end: day }, day), /بداية/);
  assert.throws(() => accountLedger(chart(), entries, { accountCode: 'missing' }, day), /غير موجود/);
  assert.throws(() => accountLedger([...chart(), chart()[0]], entries, { accountCode: '1110' }, day), /مكرر/);
  assert.throws(() => accountLedger(chart(), [...entries, entries[0]], { accountCode: '1110' }, day), /مكرر/);
  const corrupt = structuredClone(entries); corrupt[0].lines[0].debit_usd = .04; assert.throws(() => accountLedger(chart(), corrupt, { accountCode: '1110' }, day), /متزن/);
  const missing = structuredClone(entries); missing[0].lines[1].account_code = 'missing'; assert.throws(() => cashBalances(chart(), missing, {}, day), /غير موجود/);
});
test('B2 dated customer statements and all five aging buckets use GL rather than current paid/void status or amount caches', () => {
  const invoices = ['2026-10-05', '2026-09-05', '2026-08-06', '2026-07-07', '2026-07-06'].map((due, i) => invoice(`inv${i}`, due));
  const entries = invoices.map(inv => sale(inv.id));
  const payment = { id: 'pay', invoice_id: 'inv0', customer_id: 'c1', payment_date: '2026-10-06' };
  entries.push(entry('j-pay', '2026-10-06', [journalLine('1110', 'cash', 600, 0, .6, 0), journalLine('1200', 'AR', 0, 600, 0, .6)], 'payment', payment.id));
  let report = receivableReports(customers, invoices, [payment], entries, { end: day }, day);
  assert.deepEqual(report.buckets.map(b => [b.bucket, b.sdg]), [['Current', 1000], ['1-30', 1000], ['31-60', 1000], ['61-90', 1000], ['90+', 1000]]);
  assert.equal(report.total_sdg, 5000); assert.equal(report.total_usd, 5); assert.equal(report.statements[0].closing_sdg, 5000); assert.equal(report.unallocated_sdg, 0); assert.equal(report.overdue_customers[0].overdue_sdg, 4000);
  report = receivableReports(customers, invoices, [payment], entries, { start: '2026-10-06', end: '2026-10-06' }, day); assert.equal(report.statements[0].opening_sdg, 5000); assert.equal(report.statements[0].closing_sdg, 4400); assert.equal(report.statements[0].rows.length, 1); assert.equal(report.statements[0].rows[0].reference_id, 'pay');
  const voidInvoice = { ...invoice('voided', day), status: 'void' }, original = sale(voidInvoice.id), reversal = reverseJournal(original, 'jv-void-voided', '2026-10-06', 'إبطال', owner.uid);
  assert.equal(receivableReports(customers, [voidInvoice], [], [original, reversal], { end: day }, day).total_sdg, 1000);
  assert.equal(receivableReports(customers, [voidInvoice], [], [original, reversal], { end: '2026-10-06' }, day).aging.length, 0);
});
test('B2 manual and orphan AR stay explicit as unallocated; credit balances are separated from positive aging', () => {
  const inv = invoice('inv', day), payment = { id: 'pay', invoice_id: inv.id, customer_id: 'c1' };
  const entries = [sale(inv.id, 100), entry('refund-credit', day, [journalLine('4100', 'sales', 150, 0, .15, 0), journalLine('1200', 'AR', 0, 150, 0, .15)], 'payment', payment.id), entry('manual', day, [journalLine('1200', 'AR', 25, 0, .25, 0), journalLine('3100', 'capital', 0, 25, 0, .25)]), sale('orphan', 10)];
  const result = receivableReports(customers, [inv], [payment], entries, {}, day); assert.equal(result.total_sdg, -50); assert.equal(result.aging[0].remaining_sdg, 0); assert.equal(result.aging[0].credit_sdg, 50); assert.equal(result.unallocated_sdg, 35); assert.equal(result.unallocated_usd, .26); assert.equal(result.ledger_sdg, -15);
  assert.throws(() => receivableReports([], [inv], [payment], entries, {}, day), /غير موجود/);
  assert.throws(() => receivableReports(customers, [inv], [{ ...payment, customer_id: 'foreign' }], entries, {}, day), /لا يطابق/);
});
test('B2 cash totals include metadata-defined wallets and inactive cash accounts, excluding transfer inflation and prefix guesses', () => {
  const accounts = [...chart(), { code: 'wallet', name_ar: 'محفظة', name_en: 'Wallet', type: 'ASSET', nature: 'DEBIT', is_active: false, is_system: false, balance_sdg: 999, balance_usd: 999, reporting_group: 'cash_bank', org_id: 'org' } as Account, { code: '1199', name_ar: 'أصل آخر', name_en: 'Other', type: 'ASSET', nature: 'DEBIT', is_active: true, is_system: false, balance_sdg: 0, balance_usd: 0, reporting_group: 'other_assets', org_id: 'org' } as Account];
  const entries = [entry('opening', '2026-10-04', [journalLine('wallet', 'wallet', 1000, 0, 1, 0), journalLine('3100', 'equity', 0, 1000, 0, 1)]), entry('transfer', day, [journalLine('1110', 'cash', 300, 0, .3, 0), journalLine('wallet', 'wallet', 0, 300, 0, .3)]), entry('sale', day, [journalLine('wallet', 'wallet', 100, 0, .1, 0), journalLine('4100', 'sales', 0, 100, 0, .1)]), entry('expense', day, [journalLine('5200', 'rent', 30, 0, .03, 0), journalLine('wallet', 'wallet', 0, 30, 0, .03)])];
  const result = cashBalances(accounts, entries, { start: day, end: day }, day); assert.equal(result.opening_sdg, 1000); assert.equal(result.closing_sdg, 1070); assert.equal(result.closing_usd, 1.07); assert.equal(result.inflow_sdg, 100); assert.equal(result.outflow_sdg, 30); assert.ok(result.accounts.some(a => a.account.code === 'wallet')); assert.ok(!result.accounts.some(a => a.account.code === '1199')); assert.equal(result.accounts.find(a => a.account.code === 'wallet')!.closing.SDG, 770);
  const wallet = result.accounts.find(a => a.account.code === 'wallet')!; assert.equal(wallet.activity_date, day); assert.deepEqual(wallet.daily_inflow, { SDG:100,USD:.1 }); assert.deepEqual(wallet.daily_outflow,{SDG:330,USD:.33});assert.equal(wallet.recent_rows.length,4);assert.ok(wallet.recent_rows.some(row => row.journal_id === 'opening'));
});
async function fixture() {
  const store = new MemoryStore(), org = await new Organizations(store).create(owner, 'تقارير', { ...INITIAL_SETTINGS, timezone: 'Africa/Khartoum' }, 'setup', true), root = `organizations/${org.id}`;
  let now = new Date('2026-10-05T23:30:00Z');
  const ops = new Operations(store, () => now);
  const actors: Record<string, Actor> = { owner, sales: { ...owner, uid: 'sales' }, cashier: { ...owner, uid: 'cashier' }, viewer: { ...owner, uid: 'viewer' }, outsider: { ...owner, uid: 'outsider' }, unverified: { ...owner, emailVerified: false } };
  await store.transaction(async tx => { tx.set(root, { ...await tx.get(root), planId: 'Enterprise', subscriptionEnd: '2027-01-01' }); for (const [uid, role] of [['sales', 'Sales'], ['cashier', 'Cashier'], ['viewer', 'Viewer']]) tx.set(`${root}/members/${uid}`, { uid, role, status: 'active', org_id: org.id }); tx.set(`${root}/customers/c1`, customers[0]); tx.set(`${root}/invoices/inv`, invoice('inv', day)); tx.set(`${root}/journal_entries/j-inv`, { ...sale('inv'), org_id: org.id }); });
  return { store, ops, org, root, actors, setClock: (value: string) => { now = new Date(value); } };
}
test('B2 server reports enforce separate AR/GL/cash roles, live subscription, verified membership and merchant-day cutoff', async () => {
  const f = await fixture(); assert.equal((await f.ops.operationalReport(f.org.id, owner, 'receivables')).period.end, '2026-10-06');
  const sales = await f.ops.operationalReport(f.org.id, f.actors.sales, 'receivables'); assert.equal(sales.total_sdg, 1000); assert.ok(!('accounts' in sales)); assert.ok(!('journal_entries' in sales));
  for (const view of ['ledger', 'cash'] as const) await assert.rejects(f.ops.operationalReport(f.org.id, f.actors.sales, view, { accountCode: '1200' }), /صلاحية/);
  await assert.rejects(f.ops.operationalReport(f.org.id, f.actors.cashier, 'receivables'), /صلاحية/); await assert.rejects(f.ops.operationalReport(f.org.id, f.actors.outsider, 'cash'), /عضوية/); await assert.rejects(f.ops.operationalReport(f.org.id, f.actors.unverified, 'cash'), /بريد/);
  assert.equal((await f.ops.operationalReport(f.org.id, f.actors.viewer, 'ledger', { accountCode: '1200' })).closing.SDG, 1000);
  await f.store.transaction(async tx => tx.set(f.root, { ...await tx.get(f.root), subscriptionEnd: '2026-10-01' })); await assert.rejects(f.ops.operationalReport(f.org.id, owner, 'cash'));
});
test('B2 HTTP rejects repeated, unknown and malformed filters, cross-tenant access and unverified sessions without leaking GL to Sales', async () => {
  const f = await fixture(), app = express(); app.use(express.json()); app.use('/api', createApi({ operations: f.ops, verify: async token => f.actors[token] || f.actors.outsider })); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); const base = `http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/reports/`;
  try {
    const get = (view: string, token = 'owner') => fetch(base + view, { headers: { Authorization: `Bearer ${token}` } });
    let response = await get('ledger?accountCode=1200&end=2026-10-05'); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.json()).closing.SDG, 1000);
    for (const query of ['ledger', 'ledger?accountCode=1200&currency=EUR', 'ledger?accountCode=1200&branch_id=foreign', 'cash?end=2026-02-30', 'cash?end=2026-10-01&end=2026-10-05', 'receivables?start=2027-01-01&end=2026-10-05', 'cash?start=']) assert.equal((await get(query)).status, 400, query);
    for (const view of ['ledger?accountCode=1200', 'cash']) assert.equal((await get(view, 'sales')).status, 403); assert.equal((await get('receivables', 'cashier')).status, 403); assert.equal((await get('cash', 'outsider')).status, 403); assert.equal((await get('cash', 'unverified')).status, 403);
    response = await get('receivables', 'sales'); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.total_sdg, 1000); assert.ok(!JSON.stringify(data).includes('4100')); assert.ok(!JSON.stringify(data).includes('cash_bank'));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('B2 export audits requested report, filters and book; current role and entitlement also guard an idempotent retry', async () => {
  const f = await fixture(), command = { action: 'operational.export', operationId: 'export-ledger', data: { view: 'ledger', query: { accountCode: '1200', currency: 'USD', start: '2026-06-01', end: day } } };
  const result = await f.ops.execute(f.org.id, owner, command); assert.equal(result.result.closing.USD, 1); assert.deepEqual(await f.ops.execute(f.org.id, owner, command), result);
  const audit = f.store.dump()[`${f.root}/audit_logs/audit-export-ledger`]; assert.equal(audit.export_metadata.report, 'ledger'); assert.equal(audit.export_metadata.currency, 'USD'); assert.equal(audit.export_metadata.account_code, '1200'); assert.equal(audit.actor_uid, owner.uid);
  await assert.rejects(f.ops.execute(f.org.id, f.actors.sales, { ...command, operationId: 'sales-export' }), /صلاحية/);
  await assert.rejects(f.ops.execute(f.org.id, owner, { ...command, operationId: 'unsupported', data: { view: 'cash', query: { branch_id: 'fake' } } }), /غير مدعوم/);
  await f.store.transaction(async tx => tx.set(f.root, { ...await tx.get(f.root), subscriptionEnd: '2026-10-01' })); await assert.rejects(f.ops.execute(f.org.id, owner, command));
});
test('B2 CSV retains both source identifiers and separate books while escaping formula-like user text', async () => {
  const { operationalCsv } = await import('../src/services/operationalExport');
  const report = { ...accountLedger(chart(), [sale('csv')], { accountCode: '1200' }, day), organizationId: 'org', generatedAt: day, view: 'ledger' as const };
  report.rows[0].description = '\t=HYPERLINK("https://invalid")'; const csv = operationalCsv(report); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"j-csv:0"')); assert.ok(csv.includes('مدين SDG')); assert.ok(csv.includes('مدين USD')); assert.ok(csv.includes("'\t=HYPERLINK"));
});
