import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryStore, type Store, type Document } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { loadSubscription, invoiceQuotaReached } from '../src/domain/subscriptions';
import { Organizations } from '../server/organizations';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { platformFixture, servePlatform } from './helpers/platform';
import { liveExportFixture } from './helpers/liveExports';
import { ScheduledExportManagement } from '../src/domain/scheduledExportManagement';
import { scheduleInput } from './helpers/scheduledExports';
import { ServerLargeExportBuilder, authorizedLargeExportDownload } from '../server/largeExportWorker';
import { LargeExportWorker } from '../src/domain/largeExportWorker';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';

const now = () => new Date('2026-10-24T12:00:00.000Z');
const verify = async () => verifyAccountingRulesSource([{ content: readFileSync('firestore.rules', 'utf8') }]);
const forbidden = (error: unknown) => (error as { status: number }).status === 403;
const noCommercialPolicy = () => { throw Error('Free access must not consult a commercial plan'); };
async function freeFixture(store?: Store) {
  const f = await platformFixture();
  const base = store || f.store, root = `organizations/${f.org.id}`;
  const server: Store = { authority: 'server', transaction: work => base.transaction(work) };
  await base.transaction(async tx => {
    tx.set(root, { ...await tx.get(root), accounting_version: 2, status: 'suspended', planId: 'missing-plan', subscriptionStatus: 'expired', subscriptionEnd: '2020-01-01T00:00:00.000Z' });
    tx.set(`${root}/members/viewer`, { uid: 'viewer', org_id: f.org.id, role: 'Viewer', status: 'suspended' });
  });
  const operations = new Operations(server, now, noCommercialPolicy, verify, false);
  const run = (action: string, data: Document, operationId: string = crypto.randomUUID()) => operations.execute(f.org.id, f.owner, { action, data, operationId });
  return { ...f, server, root, operations, run, viewer: { ...f.owner, uid: 'viewer' } };
}

test('free access has no commercial reads or resolver dependency and no invoice or seat quota', async () => {
  const f = await freeFixture(), before = f.store.dump(), reads: string[] = [];
  const subscription = await f.server.transaction(tx => loadSubscription({ ...tx, get: async path => { reads.push(path); return tx.get(path); } }, f.org.id, before[f.root] as never, now(), noCommercialPolicy, false));
  assert.deepEqual(reads, []);
  for (const feature of ['accounting', 'advanced_reports', 'inventory_tracking', 'multi_currency', 'audit_trail', 'branches']) assert.equal(subscription.features[feature], true);
  assert.equal(subscription.effective_status, 'active'); assert.equal(subscription.subscription_end, null);
  for (const key of ['max_members', 'max_branches', 'max_warehouses', 'max_customers', 'max_products', 'max_invoices_total', 'max_invoices_per_month'] as const) assert.equal(subscription[key], Number.MAX_SAFE_INTEGER);
  assert.equal(invoiceQuotaReached(subscription, 1_000_000, 1_000_000), false);
  assert.deepEqual(f.store.dump(), before);
});

test('every formerly missed V2 report works on expired missing-plan companies without mutating billing', async () => {
  const f = await freeFixture();
  await f.run('dimension.create', { kind: 'branch', id: 'free-branch', code: 'FREE', name_ar: 'فرع مجاني' });
  const plan = (await f.run('budget.create', { id: 'free-budget', name: 'ميزانية مجانية', start_date: '2026-10-01', end_date: '2026-10-31', status: 'active', lines: [{ account_code: '5200', amount_sdg: 100, amount_usd: 1 }] })).result;
  const before = f.store.dump();
  const reports = await Promise.all([
    f.operations.accountingHealth(f.org.id, f.viewer), f.operations.accountingAssistance(f.org.id, f.viewer),
    f.operations.ownerFinancialSummary(f.org.id, f.owner), f.operations.branchProfitAndLoss(f.org.id, f.viewer, 'free-branch'),
    f.operations.productProfitability(f.org.id, f.viewer), f.operations.customerProfitability(f.org.id, f.viewer),
    f.operations.taxReports(f.org.id, f.viewer), f.operations.budgetReport(f.org.id, f.viewer, plan.id),
    f.operations.cashForecastReport(f.org.id, f.viewer, { asOf: '2026-10-24', days: 30 }),
  ]);
  assert.equal(reports.length, 9); reports.forEach(report => assert.equal(report.organizationId, f.org.id));
  assert.deepEqual(f.store.dump(), before);
  await assert.rejects(f.operations.ownerFinancialSummary(f.org.id, f.viewer), forbidden);
  await assert.rejects(f.operations.accountingHealth(f.org.id, { ...f.viewer, uid: 'outsider' }), forbidden);
  await assert.rejects(f.operations.taxReports(f.org.id, { ...f.viewer, emailVerified: false }), forbidden);
});

test('HTTP free V2 reports retain no-store and reject outsiders and subscription mutations', async () => {
  const f = await freeFixture(), backend = await servePlatform(f, { viewer: f.viewer, owner: f.owner, outsider: { ...f.owner, uid: 'outsider' } });
  try {
    for (const path of ['accounting-health', 'accounting-assistance', 'product-profitability', 'customer-profitability', 'tax', 'cash-forecast']) {
      const url = `/organizations/${f.org.id}/reports/${path}`;
      const response = await backend.request(url, 'viewer'); assert.equal(response.status, 200, `${url}: ${await response.text()}`); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await backend.request(url, 'outsider')).status, 403);
    }
    assert.equal((await backend.request(`/super-admin/companies/${f.org.id}/subscription`, 'owner', { action: 'renew' })).status, 403);
  } finally { await backend.close(); }
});

test('new cloud companies start on V2 only after verified deployed Rules and remain retry-safe', async () => {
  const memory = new MemoryStore(), server: Store = { authority: 'server', transaction: work => memory.transaction(work) };
  const actor: Actor = { uid: 'new-free-v2', email: 'synthetic-new@example.test', emailVerified: true };
  let checks = 0;
  const organizations = new Organizations(server, noCommercialPolicy, now, false, async () => { checks++; await verify(); });
  const org = await organizations.create(actor, 'شركة سحابية مجانية', INITIAL_SETTINGS, 'create-free', true);
  assert.equal(org.accounting_version, 2); assert.equal(org.accounting_activated_at, now().toISOString()); assert.equal(checks, 1);
  assert.equal(Object.keys(memory.dump()).some(path => path.startsWith('subscriptionEvents/')), false);
  const operations = new Operations(server, now, noCommercialPolicy, verify, false);
  const snapshot = await operations.snapshot(org.id, actor, true);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings, { requireCosting: true }), []);
  assert.deepEqual(await organizations.create(actor, 'retry', INITIAL_SETTINGS, 'create-free', true), { ...org, subscriptionEndMillis: null });
  assert.equal(checks, 1);
  await operations.execute(org.id, actor, { action: 'customer.create', operationId: 'first-real-command', data: { name: 'عميل اصطناعي', phone: '' } });
  assert.equal((await operations.snapshot(org.id, actor)).collections.customers.length, 1);
});

test('mismatched or unreadable Rules never create a partially activated company or use browser authority', async () => {
  const memory = new MemoryStore(), server: Store = { authority: 'server', transaction: work => memory.transaction(work) };
  const actor: Actor = { uid: 'blocked-free-v2', email: 'synthetic-blocked@example.test', emailVerified: true };
  for (const verifier of [async () => verifyAccountingRulesSource([{ content: 'old rules' }]), async () => { throw Error('Rules unavailable'); }]) {
    await assert.rejects(new Organizations(server, undefined, now, false, verifier).create(actor, 'شركة', INITIAL_SETTINGS, 'blocked', true));
    assert.deepEqual(memory.dump(), {});
  }
  await assert.rejects(new Organizations({ ...server, authority: 'browser' }, undefined, now, false, verify).create(actor, 'شركة', INITIAL_SETTINGS, 'browser', true), forbidden);
  assert.deepEqual(memory.dump(), {});
});

test('existing companies keep their accounting version on registration retry and activate only with cost proof', async () => {
  const f = await freeFixture();
  await f.store.transaction(async tx => { const org = await tx.get(f.root); delete org!.accounting_version; tx.set(f.root, org!); });
  const orgs = new Organizations(f.server, undefined, now, false, async () => { throw Error('No automatic legacy migration'); });
  assert.equal((await orgs.create(f.owner, 'retry', INITIAL_SETTINGS, 'initial', true)).accounting_version, undefined);
  const product = (await f.run('product.create', { name: 'منتج قديم', unit: 'قطعة', price_sdg: 9000, price_usd: 9, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: 10 }, 'legacy-product')).result;
  const before = f.store.dump();
  await assert.rejects(f.run('accounting.activate', { reason: 'تفعيل بعد المطابقة' }, 'unproven'), /أثبت تكلفة/);
  assert.deepEqual(f.store.dump(), before);
  await f.run('product.cost.establish', { id: product.id, cost_currency: 'USD', unit_cost: 2, exchange_rate_used: 2000, reason: 'وثيقة شراء افتتاحية اصطناعية' }, 'document-cost');
  await f.run('accounting.activate', { reason: 'تكلفة موثقة ومطابقة' }, 'activate-free');
  const snapshot = await f.operations.snapshot(f.org.id, f.owner, true);
  assert.equal(snapshot.org.accounting_version, 2);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings, { requireCosting: true }), []);
  assert.deepEqual(f.store.dump()[`${f.root}/meta/subscription`], before[`${f.root}/meta/subscription`]);
});

test('free schedules and private exports ignore expiry while preserving actual export roles and revocation', async () => {
  const f = await liveExportFixture();
  await f.mutate(f.root, { planId: 'missing-plan', subscriptionStatus: 'expired', subscriptionEnd: '2020-01-01T00:00:00.000Z', status: 'suspended' });
  await f.mutate(`${f.root}/members/Accountant`, { status: 'suspended' });
  const service = new ScheduledExportManagement(f.server, f.lookup, noCommercialPolicy, f.now, f.verifySecurity, false);
  const policy = await service.create(f.org.id, f.actor('Accountant'), { operationId: 'free-schedule', input: scheduleInput() });
  assert.equal(policy.schedule.kind, 'accounting');
  const list = await service.list(f.org.id, f.actor('Accountant'));
  assert.deepEqual(list.allowed_kinds, ['accounting', 'auditor']);
  await assert.rejects(service.list(f.org.id, f.actor('Viewer')), forbidden);
  await assert.rejects(service.create(f.org.id, f.actor('Accountant'), { operationId: 'free-company-denied', input: scheduleInput({ kind: 'company', period_kind: 'full' }) }), forbidden);
  const operations = new Operations(f.server, f.now, noCommercialPolicy, f.verifySecurity, false);
  const options = { ...f.options, controlsEnabled: false, subscriptionPolicy: noCommercialPolicy };
  const worker = new LargeExportWorker(f.server, f.artifacts, new ServerLargeExportBuilder(operations, options), f.now);
  const job = (await operations.execute(f.org.id, f.owner, { action: 'largeExport.request', operationId: 'free-company-job', data: { kind: 'company' } })).result;
  assert.equal((await worker.runNext())?.status, 'completed');
  const result = await authorizedLargeExportDownload(f.server, worker, f.org.id, 'company_export_jobs', job.id, f.owner, options);
  assert.match(result.url, /^https:/);
  const bytes = [...f.artifacts.files.values()][0].bytes;
  const snapshot = JSON.parse(new TextDecoder().decode(bytes)); assert.equal(snapshot.collections.journal_entries.length, 1);
  assert.equal(snapshot.subscription.features.advanced_reports, true);
  f.accounts.get(f.owner.uid)!.disabled = true;
  await assert.rejects(authorizedLargeExportDownload(f.server, worker, f.org.id, 'company_export_jobs', job.id, f.owner, options), forbidden);
});
