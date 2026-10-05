import test from 'node:test';
import assert from 'node:assert/strict';
import { platformFixture } from './helpers/platform';
import { Operations } from '../src/domain/operations';
import type { Document } from '../src/domain/store';
import { defaultPlatformPlans, getPlanConfig } from '../src/lib/plans';
import { INITIAL_SETTINGS } from '../src/data/initialData';

type Fixture = Awaited<ReturnType<typeof platformFixture>>;
const defaults = () => defaultPlatformPlans();
const failure = (status: number, code?: string) => (error: any) => error.status === status && (!code || error.code === code);
const events = (f: Fixture) => Object.values(f.store.dump()).filter(d => d.action?.startsWith('subscription.') || d.action === 'plan.save');
async function change(f: Fixture, action: string, payload: Document = {}, extra: Document = {}) {
  const root = f.store.dump()[`organizations/${f.org.id}`];
  return f.platform.updateSubscription(f.admin, f.org.id, { action, payload, expectedRevision: root.billingRevision, operationId: crypto.randomUUID(), reason: 'تعديل تجاري للاختبار', ...extra });
}
async function savePlan(f: Fixture, plan: Document, id = plan.id, extra: Document = {}) {
  const old = (await f.platform.plans(f.admin)).find(p => p.id === id);
  return f.platform.updatePlan(f.admin, id, { plan, expectedRevision: old?.revision || 0, operationId: crypto.randomUUID(), reason: 'إعداد باقة للاختبار', ...extra });
}
async function sales(f: Fixture) {
  const run = (action: string, data: Document, operationId: string = crypto.randomUUID()) => f.operations.execute(f.org.id, f.owner, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل اختبار', phone: '', preferred_currency: 'SDG', balance_sdg: 0, balance_usd: 0 })).result;
  const product = (await run('product.create', { name: 'منتج اختبار', unit: 'قطعة', price_sdg: 100, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: false })).result;
  const invoice = () => ({ customer_id: customer.id, issue_date: new Date().toISOString().slice(0, 10), currency_mode: 'single_sdg', exchange_rate_used: 0, discount_type: 'fixed', discount_value: 0, items: [{ product_id: product.id, description: product.name, unit: 'قطعة', quantity: 1, unit_price: 100, currency: 'SDG', tax_rate: 0, discount_percent: 0 }] });
  return { run, invoice, customer, product };
}

test('plan changes expose one canonical plan identity, dates and live limits in every projection', async () => {
  const f = await platformFixture();
  const result = await change(f, 'change_plan', { planId: 'Professional' });
  const company = await f.platform.company(f.admin, f.org.id);
  const snapshot = await f.operations.snapshot(f.org.id, f.owner);
  for (const sub of [result.subscription, company.subscription, snapshot.subscription]) {
    assert.equal(sub.plan, 'Professional'); assert.equal(sub.plan_id, 'Professional');
    assert.equal(sub.max_members, 10); assert.equal(sub.max_invoices_per_month, 500);
    assert.equal(sub.effective_status, 'active');
    assert.equal(Date.parse(sub.subscription_end!) - Date.parse(sub.subscription_start!), 30 * 86400000);
  }
  assert.equal(company.billingRevision, 2);
});

test('dynamic plans use canonical features only and tolerate identifiers inherited by JavaScript objects', async () => {
  const f = await platformFixture();
  const custom = { ...defaults().find(p => p.id === 'Professional')!, id: 'constructor', name: 'باقة مخصصة', limits: { ...defaults()[2].limits, maxUsers: 4, maxInvoices: 3, invoicePeriod: 'lifetime' } };
  await savePlan(f, custom);
  await change(f, 'change_plan', { planId: custom.id });
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/meta/subscription`, { plan: 'Enterprise', status: 'active', features: { unapproved_feature: true }, max_members: 999999 }));
  const snapshot = await f.operations.snapshot(f.org.id, f.owner);
  assert.equal(snapshot.subscription.plan, 'constructor'); assert.equal(snapshot.subscription.max_members, 4);
  assert.equal(snapshot.subscription.max_invoices_total, 3);
  assert.deepEqual(snapshot.subscription.features, custom.features);
  assert.equal(getPlanConfig('constructor' as any).name, 'Free');
});

test('commercial retries are exactly once; a changed payload cannot reuse the operation identifier', async () => {
  const f = await platformFixture();
  const body = { action: 'change_plan', payload: { planId: 'Starter' }, expectedRevision: 1, operationId: 'retry-activation', reason: 'اشتراك مدفوع', method: 'bank_transfer' };
  const first = await f.platform.updateSubscription(f.admin, f.org.id, body);
  const state = f.store.dump();
  assert.deepEqual(await f.platform.updateSubscription(f.admin, f.org.id, body), first);
  assert.deepEqual(f.store.dump(), state);
  await assert.rejects(f.platform.updateSubscription(f.admin, f.org.id, { ...body, payload: { planId: 'Business' } }), failure(409));
  assert.deepEqual(f.store.dump(), state);
  const log = events(f).filter(e => e.action === 'subscription.change_plan');
  assert.equal(log.length, 1); assert.equal(log[0].performedBy, f.admin.uid);
  assert.equal(log[0].previousValue.planId, 'Free'); assert.equal(log[0].newValue.planId, 'Starter');
  assert.equal(log[0].method, 'bank_transfer'); assert.equal(log[0].reason, body.reason);
});

test('a commercial edit publishes a tenant revision once and preserves all business counter values', async () => {
  for (const initialRevision of [undefined, 7]) {
  const f = await platformFixture(), path = `organizations/${f.org.id}/meta/counters`;
  await f.store.transaction(async tx => tx.set(path, { ...await tx.get(path), ...(initialRevision === undefined ? {} : { revision: initialRevision }), invoice_count: 12, lifetime_invoice_count: 105, inventory_movement_seq: 19 }));
  const before = f.store.dump()[path];
  const body = { action: 'change_plan', payload: { planId: 'Professional' }, expectedRevision: 1, operationId: 'commercial-revision', reason: 'تفعيل مع تحديث المزامنة' };
  await f.platform.updateSubscription(f.admin, f.org.id, body);
  const after = f.store.dump()[path];
  assert.equal(after.revision, (before.revision || 0) + 1);
  for (const key of Object.keys(before).filter(key => !['revision', 'updated_at'].includes(key))) assert.deepEqual(after[key], before[key]);
  await f.platform.updateSubscription(f.admin, f.org.id, body); assert.deepEqual(f.store.dump()[path], after);
  }
});

test('optimistic revisions allow exactly one concurrent commercial edit and one audit event', async () => {
  const f = await platformFixture();
  const edit = (status: string) => f.platform.updateSubscription(f.admin, f.org.id, { action: 'set_status', payload: { status }, expectedRevision: 1, operationId: 'race-' + status, reason: 'تعديل متزامن' });
  const outcomes = await Promise.allSettled([edit('suspended'), edit('cancelled')]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  assert.equal(events(f).filter(e => e.action === 'subscription.set_status').length, 1);
  assert.equal((await f.platform.company(f.admin, f.org.id)).billingRevision, 2);
});

test('failed persistence rolls back company, trial claim, projection, audit and idempotency together', async () => {
  let fail = false;
  const f = await platformFixture(() => { if (fail) throw new Error('test persistence failed'); });
  const before = f.store.dump(); fail = true;
  await assert.rejects(change(f, 'set_status', { status: 'trial' }), /test persistence failed/);
  fail = false; assert.deepEqual(f.store.dump(), before);
  await change(f, 'set_status', { status: 'trial' });
  assert.equal(f.store.dump()[`billingTrialClaims/${f.owner.uid}`].organizationId, f.org.id);
});

test('a trial lasts seven days, cannot be extended and is granted only once across the owner companies', async () => {
  const f = await platformFixture();
  const trial = await change(f, 'set_status', { status: 'trial', end: '2099-01-01T00:00:00Z' });
  assert.equal(Date.parse(trial.subscription.subscription_end) - Date.parse(trial.subscription.subscription_start), 7 * 86400000);
  const state = f.store.dump();
  await assert.rejects(change(f, 'extend', { days: 7 }), /7 أيام/); assert.deepEqual(f.store.dump(), state);
  await change(f, 'renew', { days: 30 });
  await assert.rejects(change(f, 'set_status', { status: 'trial' }), failure(409));
  const second = await f.organizations.create(f.owner, 'شركة ثانية', INITIAL_SETTINGS, 'second-company');
  await assert.rejects(f.platform.updateSubscription(f.admin, second.id, { action: 'set_status', payload: { status: 'trial' }, expectedRevision: 1, operationId: 'second-trial', reason: 'تجربة ثانية' }), failure(409));
});

test('expired subscriptions keep historical invoices readable and deny every protected mutation', async () => {
  const f = await platformFixture(), s = await sales(f);
  const issued = await s.run('invoice.create', s.invoice());
  await change(f, 'change_plan', { planId: 'Professional' });
  await change(f, 'set_status', { status: 'expired', end: new Date(Date.now() - 1000).toISOString() });
  const before = f.store.dump();
  for (const [action, data] of [['invoice.create', s.invoice()], ['customer.create', { name: 'ممنوع' }], ['settings.update', { updates: { business_name: 'ممنوع' } }], ['invitation.create', { email: 'staff@example.test', role: 'Sales' }]] as const)
    await assert.rejects(s.run(action, data), failure(403, 'subscription_expired'));
  assert.deepEqual(f.store.dump(), before);
  const history = await f.operations.snapshot(f.org.id, f.owner);
  assert.equal(history.collections.invoices[0].id, issued.result.id); assert.deepEqual(history.collections.journal_entries, []);
  await assert.rejects(f.operations.snapshot(f.org.id, f.owner, true), failure(403, 'subscription_expired'));
  await s.run('subscription.request', { plan: 'Business' }, 'renewal-request');
  assert.equal(f.store.dump()[`organizations/${f.org.id}`].planId, 'Professional');
  await change(f, 'extend', { days: 2 });
  assert.equal((await f.platform.company(f.admin, f.org.id)).subscription.effective_status, 'active');
});

test('company suspension blocks mutations and preserves read-only history until reactivation', async () => {
  const f = await platformFixture(), s = await sales(f); const sale = await s.run('invoice.create', s.invoice());
  await change(f, 'company_status', { status: 'suspended' });
  await assert.rejects(s.run('invoice.create', s.invoice()), failure(403));
  assert.equal((await f.operations.snapshot(f.org.id, f.owner)).collections.invoices[0].id, sale.result.id);
  await change(f, 'company_status', { status: 'active' }); await s.run('invoice.create', s.invoice());
  assert.equal((await f.operations.snapshot(f.org.id, f.owner)).collections.invoices.length, 2);
});

test('live plan feature edits immediately change backend access; deactivation stops new activation and renewal', async () => {
  const f = await platformFixture(); await change(f, 'change_plan', { planId: 'Professional' });
  await f.operations.advancedReports(f.org.id, f.owner);
  const plan = (await f.platform.plans(f.admin)).find(p => p.id === 'Professional')!;
  await savePlan(f, { ...plan, features: { ...plan.features, advanced_reports: false }, active: false });
  await assert.rejects(f.operations.advancedReports(f.org.id, f.owner), failure(403, 'feature_unavailable'));
  assert.equal((await f.operations.snapshot(f.org.id, f.owner)).subscription.effective_status, 'active');
  await assert.rejects(change(f, 'renew'), /معطلة/);
  await assert.rejects(change(f, 'change_plan', { planId: 'Professional' }), /غير متاحة/);
});

test('Free catalog invariants stay fixed at zero price, no expiry, 100 lifetime invoices and two seats', async () => {
  const f = await platformFixture(), free = defaults()[0], before = f.store.dump();
  for (const plan of [{ ...free, price: 1 }, { ...free, durationDays: 7 }, { ...free, limits: { ...free.limits, maxUsers: 3 } }, { ...free, limits: { ...free.limits, maxInvoices: 101 } }, { ...free, limits: { ...free.limits, invoicePeriod: 'month' } }])
    await assert.rejects(savePlan(f, plan), failure(400));
  assert.deepEqual(f.store.dump(), before);
  const result = await savePlan(f, { ...free, features: { ...free.features, audit_trail: true } });
  assert.equal(result.features.audit_trail, true);
});

test('plan validation and stale revisions reject malformed changes without partial audit records', async () => {
  const f = await platformFixture(), plan = defaults()[1];
  for (const invalid of [{ ...plan, price: -1 }, { ...plan, price: 0.001 }, { ...plan, durationDays: 0 }, { ...plan, features: { ...plan.features, accounting: 'yes' } }, { ...plan, limits: { ...plan.limits, maxUsers: 1.5 } }]) {
    const before = f.store.dump(); await assert.rejects(savePlan(f, invalid), failure(400)); assert.deepEqual(f.store.dump(), before);
  }
  await savePlan(f, plan, plan.id, { operationId: 'plan-save' });
  const before = f.store.dump();
  await assert.rejects(savePlan(f, plan, plan.id, { expectedRevision: 1 }), failure(409)); assert.deepEqual(f.store.dump(), before);
});

test('pending invitations reserve the one additional Free seat; acceptance and removal never change ownership', async () => {
  const f = await platformFixture(), run = (action: string, data: Document) => f.operations.execute(f.org.id, f.owner, { action, data, operationId: crypto.randomUUID() });
  const invite = await run('invitation.create', { email: 'one@example.test', role: 'Cashier' });
  await assert.rejects(run('invitation.create', { email: 'two@example.test', role: 'Sales' }), /موظف واحد/);
  await f.organizations.accept({ uid: 'one', email: 'one@example.test', emailVerified: true }, f.org.id, invite.result.id);
  await assert.rejects(run('invitation.create', { email: 'two@example.test', role: 'Sales' }), /موظف واحد/);
  await run('member.remove', { uid: 'one' });
  await run('invitation.create', { email: 'two@example.test', role: 'Sales' });
  assert.equal(f.store.dump()[`organizations/${f.org.id}`].owner_uid, f.owner.uid);
});

test('downgrade and invoice void cannot reset lifetime usage or admit the 101st Free invoice', async () => {
  const f = await platformFixture(), s = await sales(f);
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/meta/usage`, { lifetimeInvoiceCount: 99 }));
  const sale = await s.run('invoice.create', s.invoice()); await s.run('invoice.void', { id: sale.result.id, reason: 'إبطال للاختبار' });
  await assert.rejects(s.run('invoice.create', s.invoice()), /100 فاتورة إجمالاً/);
  await change(f, 'change_plan', { planId: 'Professional' }); await s.run('invoice.create', s.invoice());
  await change(f, 'change_plan', { planId: 'Free' });
  await assert.rejects(s.run('invoice.create', s.invoice()), /100 فاتورة إجمالاً/);
  assert.equal(f.store.dump()[`organizations/${f.org.id}/meta/usage`].lifetimeInvoiceCount, 101);
});

test('paid monthly invoice quotas reset on a new month while retaining lifetime consumption', async () => {
  const f = await platformFixture(), base = defaults()[1];
  await savePlan(f, { ...base, id: 'monthly-two', durationDays: 90, limits: { ...base.limits, maxInvoices: 2 } });
  await change(f, 'change_plan', { planId: 'monthly-two' });
  const s = await sales(f); await s.run('invoice.create', s.invoice()); await s.run('invoice.create', s.invoice());
  await assert.rejects(s.run('invoice.create', s.invoice()), /الشهري/);
  const nextMonth = new Date(); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 2);
  const nextOps = new Operations(f.store, () => nextMonth);
  await nextOps.execute(f.org.id, f.owner, { action: 'invoice.create', data: { ...s.invoice(), issue_date: nextMonth.toISOString().slice(0, 10) }, operationId: 'next-month-sale' });
  const snapshot = await nextOps.snapshot(f.org.id, f.owner);
  assert.equal(snapshot.counters.monthly_invoice_count, 1); assert.equal(snapshot.counters.lifetime_invoice_count, 3);
});

test('company filters and dashboard derive expired status from dates consistently', async () => {
  const f = await platformFixture(); await change(f, 'change_plan', { planId: 'Professional' });
  await f.store.transaction(async tx => {
    const path = `organizations/${f.org.id}`, org = (await tx.get(path))!;
    tx.set(path, { ...org, subscriptionEnd: new Date(Date.now() - 1000).toISOString(), subscriptionEndMillis: Date.now() - 1000 });
  });
  const overview = await f.platform.overview(f.admin);
  assert.equal(overview.expired, 1); assert.equal(overview.active, 0);
  assert.equal((await f.platform.companies(f.admin, { subscriptionStatus: 'expired' })).items.length, 1);
  assert.equal((await f.platform.companies(f.admin, { subscriptionStatus: 'active' })).items.length, 0);
});

test('upgrade request fulfillment is atomic and stale requests cannot be approved', async () => {
  const f = await platformFixture();
  await f.operations.execute(f.org.id, f.owner, { action: 'subscription.request', data: { plan: 'Business' }, operationId: 'requested-upgrade' });
  const before = f.store.dump();
  await assert.rejects(change(f, 'change_plan', { planId: 'Business', requestOperationId: 'wrong-request' }), failure(409)); assert.deepEqual(f.store.dump(), before);
  await change(f, 'change_plan', { planId: 'Business', requestOperationId: 'requested-upgrade' });
  assert.equal(f.store.dump()[`subscriptionRequests/${f.org.id}`].status, 'fulfilled');
  assert.equal(f.store.dump()[`organizations/${f.org.id}/meta/subscription_request`].status, 'fulfilled');
  assert.equal((await f.platform.requests(f.admin, {})).items.length, 0);
});
