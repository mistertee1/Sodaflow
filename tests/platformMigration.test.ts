import test from 'node:test';
import assert from 'node:assert/strict';
import { platformFixture } from './helpers/platform';
import { initializeBillingPlans, migrateBillingOrganization, type InvoiceHistoryEvidence } from '../server/billingMigration';
import { defaultPlatformPlans, createDefaultSubscription } from '../src/lib/plans';
import { signSubscription } from '../server/subscriptions';

const now = new Date('2026-10-05T12:00:00Z'), preview = { apply: false, operator: 'migration-test', now }, apply = { ...preview, apply: true };
const empty: InvoiceHistoryEvidence = { invoiceCount: 0, numberCount: 0, invoiceEvents: 0 };
type Fixture = Awaited<ReturnType<typeof platformFixture>>;
const migrate = (f: Fixture, evidence = empty, options = apply) => f.store.transaction(tx => migrateBillingOrganization(tx, f.org.id, evidence, options));
async function legacy(f: Fixture) {
  await f.store.transaction(async tx => {
    const root = `organizations/${f.org.id}`, org = (await tx.get(root))!;
    for (const key of ['planId', 'subscriptionStatus', 'subscriptionStart', 'subscriptionEnd', 'subscriptionEndMillis', 'renewalAt', 'billingRevision', 'maxUsers', 'maxBranches', 'maxWarehouses', 'searchName', 'subscriptionMetadata']) delete org[key];
    org.created_at = '2026-10-01T12:00:00Z'; tx.set(root, org);
    tx.delete(`${root}/meta/usage`);
  });
}

test('catalog preview writes nothing and applying it never replaces an edited plan', async () => {
  const f = await platformFixture(), edited = { ...defaultPlatformPlans(now.toISOString())[0], name: 'خطة مجانية معتمدة', revision: 9, features: { ...defaultPlatformPlans()[0].features, audit_trail: true } };
  await f.store.transaction(async tx => tx.set('plans/Free', edited)); const before = f.store.dump();
  assert.equal((await initializeBillingPlans(f.store, preview)).length, 4); assert.deepEqual(f.store.dump(), before);
  await initializeBillingPlans(f.store, apply); assert.deepEqual(f.store.dump()['plans/Free'], edited);
  const migrated = f.store.dump(); assert.equal((await initializeBillingPlans(f.store, apply)).length, 0); assert.deepEqual(f.store.dump(), migrated);
});

test('organization preview preserves every document even when invoice usage needs repair', async () => {
  const f = await platformFixture(); await legacy(f); const before = f.store.dump();
  assert.equal(await migrate(f, { invoiceCount: 90, numberCount: 100, invoiceEvents: 95 }, preview), 'migrated');
  assert.deepEqual(f.store.dump(), before);
});

test('migration preserves Owner, members, financial history, counters and actual first use while keeping maximum lifetime evidence', async () => {
  const f = await platformFixture(); await legacy(f); const root = `organizations/${f.org.id}`;
  await f.store.transaction(async tx => {
    tx.set(`${root}/meta/usage`, { lifetimeInvoiceCount: 80, firstActualUseAt: '2026-10-02T10:30:00Z' });
    tx.set(`${root}/meta/counters`, { ...await tx.get(`${root}/meta/counters`), invoice_count: 90, monthly_invoice_count: 12, last_invoice_number: 150, revision: 7 });
    for (const name of ['invoices', 'payments', 'customers', 'products', 'journal_entries', 'suppliers', 'purchase_bills']) tx.set(`${root}/${name}/history`, { id: 'history', sentinel: name, value: 1234 });
  });
  const before = f.store.dump(); await migrate(f, { invoiceCount: 85, numberCount: 100, invoiceEvents: 120 }); const after = f.store.dump();
  for (const [path, doc] of Object.entries(before)) if (!['', '/meta/usage', '/meta/counters', '/meta/subscription'].some(suffix => path === root + suffix)) assert.deepEqual(after[path], doc, path);
  assert.equal(after[root].owner_uid, f.owner.uid); assert.deepEqual(after[root].settings, before[root].settings);
  assert.equal(after[`${root}/meta/usage`].lifetimeInvoiceCount, 120); assert.equal(after[`${root}/meta/usage`].firstActualUseAt, before[`${root}/meta/usage`].firstActualUseAt);
  assert.equal(after[`${root}/meta/counters`].invoice_count, 90); assert.equal(after[`${root}/meta/counters`].monthly_invoice_count, 12); assert.equal(after[`${root}/meta/counters`].last_invoice_number, 150);
  assert.equal(after[`${root}/meta/counters`].revision, 8); assert.equal(after[`${root}/meta/subscription`].plan, 'Free');
  const state = f.store.dump(); assert.equal(await migrate(f, { invoiceCount: 85, numberCount: 100, invoiceEvents: 120 }), 'unchanged'); assert.deepEqual(f.store.dump(), state);
});

test('complete canonical companies still backfill underestimated lifetime usage from retained invoice numbers', async () => {
  const f = await platformFixture();
  assert.equal(await migrate(f, { ...empty, numberCount: 100 }), 'migrated');
  const root = `organizations/${f.org.id}`, state = f.store.dump();
  assert.equal(state[`${root}/meta/usage`].lifetimeInvoiceCount, 100); assert.equal(state[`${root}/meta/counters`].lifetime_invoice_count, 100);
  assert.equal(state[root].owner_uid, f.owner.uid); assert.equal(state[root].planId, 'Free');
  assert.equal(await migrate(f, { ...empty, numberCount: 100 }), 'unchanged');
});

test('unverified legacy paid data is blocked instead of silently downgraded or granted', async () => {
  const f = await platformFixture(); await legacy(f);
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/meta/subscription`, { ...createDefaultSubscription(f.org.id), plan: 'Enterprise' }));
  const before = f.store.dump();
  await assert.rejects(migrate(f, empty, preview), /Unverified legacy paid/); await assert.rejects(migrate(f), /Unverified legacy paid/); assert.deepEqual(f.store.dump(), before);
});

test('verified legacy paid contracts retain their non-expiring term without altering financial records', async () => {
  const f = await platformFixture(); await legacy(f);
  const oldSecret = process.env.BILLING_SIGNING_SECRET; process.env.BILLING_SIGNING_SECRET = 'migration-test-signature-secret-only-for-synthetic-data-2026';
  try {
    const saved = signSubscription({ ...createDefaultSubscription(f.org.id), plan: 'Enterprise', updated_at: '2026-10-01T12:00:00Z' }, process.env.BILLING_SIGNING_SECRET);
    await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/meta/subscription`, saved));
    await migrate(f); const org = f.store.dump()[`organizations/${f.org.id}`];
    assert.equal(org.planId, 'Enterprise'); assert.equal(org.subscriptionEnd, null); assert.equal(org.subscriptionMetadata.legacyNonExpiring, true);
    assert.equal((await f.operations.snapshot(f.org.id, f.owner)).subscription.effective_status, 'active');
  } finally { if (oldSecret === undefined) delete process.env.BILLING_SIGNING_SECRET; else process.env.BILLING_SIGNING_SECRET = oldSecret; }
});

test('legacy trials derive seven days, preserve an expired trial and permanently reserve the Owner claim', async () => {
  const f = await platformFixture(); await legacy(f);
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}`, { ...await tx.get(`organizations/${f.org.id}`), subscriptionStatus: 'trial', subscriptionStart: '2026-09-20T12:00:00Z' }));
  await migrate(f); const state = f.store.dump(), org = state[`organizations/${f.org.id}`];
  assert.equal(org.subscriptionEnd, '2026-09-27T12:00:00.000Z'); assert.equal(org.subscriptionStatus, 'expired'); assert.equal(org.subscriptionMetadata.trialUsed, true);
  assert.equal(state[`billingTrialClaims/${f.owner.uid}`].organizationId, f.org.id);
  await assert.rejects(f.platform.updateSubscription(f.admin, f.org.id, { action: 'set_status', payload: { status: 'trial' }, expectedRevision: org.billingRevision, operationId: 'repeat-migrated-trial', reason: 'تكرار غير مسموح' }), /استخدم التجربة/);
});

test('a paid canonical contract missing its end requires review and malformed dates or usage cannot mutate state', async () => {
  const f = await platformFixture(), root = `organizations/${f.org.id}`;
  for (const patch of [{ planId: 'Professional', subscriptionEnd: null }, { subscriptionStart: 'invalid-date' }]) {
    const original = f.store.dump()[root]; await f.store.transaction(async tx => tx.set(root, { ...original, ...patch })); const before = f.store.dump();
    await assert.rejects(migrate(f), /review/); assert.deepEqual(f.store.dump(), before); await f.store.transaction(async tx => tx.set(root, original));
  }
  await assert.rejects(migrate(f, { ...empty, numberCount: -1 }), /non-negative/);
});

test('migration normalizes expiry milliseconds while preserving the commercial method and reference', async () => {
  const f = await platformFixture(), root = `organizations/${f.org.id}`, end = '2026-11-01T12:00:00Z';
  await f.store.transaction(async tx => tx.set(root, { ...await tx.get(root), planId: 'Professional', subscriptionEnd: end, subscriptionEndMillis: 1, subscriptionMetadata: { method: 'bank_transfer', providerReference: 'TRANSFER-KEEP' } }));
  await migrate(f); const org = f.store.dump()[root];
  assert.equal(org.subscriptionEndMillis, Date.parse(end)); assert.equal(org.subscriptionMetadata.method, 'bank_transfer'); assert.equal(org.subscriptionMetadata.providerReference, 'TRANSFER-KEEP');
});

test('pending upgrade requests are indexed once and a fulfilled request is never reopened', async () => {
  const f = await platformFixture(), root = `organizations/${f.org.id}`, request = { status: 'pending', requested_plan: 'Business', operationId: 'retained-request', created_at: now.toISOString() };
  await f.store.transaction(async tx => tx.set(`${root}/meta/subscription_request`, request)); await migrate(f);
  assert.equal(f.store.dump()[`subscriptionRequests/${f.org.id}`].operationId, request.operationId);
  await f.store.transaction(async tx => tx.set(`subscriptionRequests/${f.org.id}`, { ...request, status: 'fulfilled' }));
  assert.equal(await migrate(f), 'unchanged'); assert.equal(f.store.dump()[`subscriptionRequests/${f.org.id}`].status, 'fulfilled');
});

test('storage failure rolls back billing migration and its immutable audit records together', async () => {
  let fail = false; const f = await platformFixture(() => { if (fail) throw new Error('migration persistence failed'); }); await legacy(f); const before = f.store.dump();
  fail = true; await assert.rejects(migrate(f), /migration persistence failed/); fail = false; assert.deepEqual(f.store.dump(), before);
});
