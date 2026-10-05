import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, getDocs, setDoc, doc, collection } from 'firebase/firestore';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { FirestoreStore } from '../server/firestoreStore';
import { PlatformBilling } from '../server/platformBilling';
import { Organizations } from '../server/organizations';
import { initializeBillingPlans, migrateBillingOrganization } from '../server/billingMigration';
import { defaultPlatformPlans } from '../src/lib/plans';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import type { Actor } from '../src/domain/operations';
import type { Document } from '../src/domain/store';

const project = 'demo-sudaflow', day = 86400000;
const admin: Actor = { uid: 'sa-active', email: 'platform@example.test', emailVerified: true, superAdmin: true };
let env: RulesTestEnvironment, app: App, db: Firestore, store: FirestoreStore, platform: PlatformBilling;
const client = (uid: string, claims: Document = {}) => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true, ...claims }).firestore();
const future = (days: number) => new Date(Date.now() + days * day).toISOString();
const companyPath = (id: string) => `organizations/${id}`;
const clientRecord = (uid: string, id: string, name: string, claims: Document = {}) => doc(client(uid, claims), `${companyPath(id)}/${name}/history`);
const businessCollections = ['invoices', 'payments', 'customers', 'products', 'journal_entries', 'inventory_movements', 'audit_logs', 'accounts'];
async function fixture(id: string, ownerUid = `owner-${id}`) {
  const owner: Actor = { uid: ownerUid, email: `${ownerUid}@example.test`, emailVerified: true };
  const org = await new Organizations(store).create(owner, `شركة ${id}`, INITIAL_SETTINGS, `create-${id}`);
  return { org, owner, root: companyPath(org.id) };
}
const edit = (id: string, revision: number, operationId: string, action: string, payload: Document = {}) => platform.updateSubscription(admin, id, { expectedRevision: revision, operationId, action, payload, reason: 'اختبار تجاري اصطناعي' });
// Registration already has its own immutable event; count subsequent commercial changes.
const eventCount = async (id: string) => (await db.collection('subscriptionEvents').where('organizationId', '==', id).get()).docs.filter(record => record.data().action !== 'subscription.created').length;

before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Only the local demo-sudaflow emulator may receive test writes');
  env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8091, rules: await readFile('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  app = initializeApp({ projectId: project }, 'super-admin-acceptance'); db = getFirestore(app); store = new FirestoreStore(db); platform = new PlatformBilling(store, db);
  const plans = defaultPlatformPlans(), professional = plans.find(p => p.id === 'Professional')!;
  const batch = db.batch();
  for (const plan of plans) batch.set(db.doc(`plans/${plan.id}`), plan);
  batch.set(db.doc('plans/Limited'), { ...professional, id: 'Limited', features: { ...professional.features, accounting: false, inventory_tracking: false, audit_trail: false } });
  batch.set(db.doc('plans/Retired'), { ...professional, id: 'Retired', active: false });
  for (const uid of ['sa-active', 'sa-revoked', 'sa-string', 'sa-wrong-role', 'sa-registry-only']) batch.set(db.doc(`platformAdmins/${uid}`), { active: uid === 'sa-string' ? 'true' : uid !== 'sa-revoked', role: uid === 'sa-wrong-role' ? 'owner' : 'super_admin' });
  batch.set(db.doc('subscriptionEvents/seed-event'), { organizationId: 'seed-paid', action: 'subscription.seed', createdAt: future(-1) });
  batch.set(db.doc('subscriptionRequests/seed-paid'), { status: 'pending', created_at: future(-1), organizationId: 'seed-paid' });
  const seeds = [
    ['free', 'Free', 'active', 'active', null], ['paid', 'Professional', 'active', 'active', future(30)],
    ['trial', 'Professional', 'trial', 'active', future(3)], ['expired', 'Professional', 'expired', 'active', future(-1)],
    ['elapsed', 'Professional', 'active', 'active', future(-2)], ['company-suspended', 'Professional', 'active', 'suspended', future(30)],
    ['subscription-suspended', 'Professional', 'suspended', 'active', future(30)], ['cancelled', 'Professional', 'cancelled', 'active', future(30)],
    ['limited', 'Limited', 'active', 'active', future(30)], ['retired', 'Retired', 'active', 'active', future(30)],
    ['bad-date', 'Professional', 'active', 'active', future(30)], ['unmigrated', null, null, 'active', null],
  ] as const;
  for (const [suffix, planId, subscriptionStatus, status, subscriptionEnd] of seeds) {
    const id = `seed-${suffix}`, root = companyPath(id);
    batch.set(db.doc(root), { id, name: `شركة ${suffix}`, searchName: `شركة ${suffix}`, owner_uid: 'tenant-owner', status, billingRevision: 1, created_at: future(-30), settings: INITIAL_SETTINGS,
      ...(planId ? { planId, subscriptionStatus, subscriptionStart: future(-10), subscriptionEnd, ...(suffix === 'bad-date' ? {} : { subscriptionEndMillis: subscriptionEnd ? Date.parse(subscriptionEnd) : null }) } : {}) });
    batch.set(db.doc(`${root}/meta/counters`), { invoice_count: 4, lifetime_invoice_count: 4, revision: 3 });
    batch.set(db.doc(`${root}/meta/usage`), { lifetimeInvoiceCount: 4 });
    batch.set(db.doc(`${root}/meta/subscription`), { plan: planId || 'Free', status: subscriptionStatus || 'active' });
    for (const name of businessCollections) batch.set(db.doc(`${root}/${name}/history`), { id: 'history', marker: `preserve-${name}` });
    for (const [uid, role] of [['tenant-viewer', 'Viewer'], ['tenant-cashier', 'Cashier'], ['forged-owner', 'Owner']]) batch.set(db.doc(`${root}/members/${uid}`), { uid, role, status: 'active' });
  }
  await batch.commit();
});
after(async () => { if (app) await deleteApp(app); await env?.cleanup(); });

test('emulator commercial queries aggregate statuses, combined filters, search and stable pagination', async () => {
  const overview = await platform.overview(admin);
  assert.equal(overview.total, 12); assert.equal(overview.active, 6); assert.equal(overview.trial, 1);
  assert.equal(overview.expired, 2); assert.equal(overview.expiringSoon, 1); assert.equal(overview.needsMigration, 1);
  for (const state of ['active', 'trial', 'expired', 'suspended', 'cancelled']) for (const search of ['', 'شركة ']) {
    const filtered = await platform.companies(admin, { subscriptionStatus: state, companyStatus: 'active', planId: 'Professional', q: search });
    assert.ok(filtered.items.length > 0, `${state} filter must retain matching companies`);
    for (const row of filtered.items) { assert.equal(row.subscription.effective_status, state); assert.equal(row.companyStatus, 'active'); assert.equal(row.subscription.plan_id, 'Professional'); }
  }
  const ids: string[] = []; let cursor: string | null = null;
  do { const page = await platform.companies(admin, { limit: 3, ...(cursor ? { cursor } : {}) }); ids.push(...page.items.map(row => row.id)); cursor = page.nextCursor; } while (cursor);
  assert.equal(ids.length, 12); assert.equal(new Set(ids).size, 12);
  await assert.rejects(platform.companies(admin, { cursor: 'missing-company' }), /مؤشر الصفحة/);
  assert.equal((await platform.events(admin, { organizationId: 'seed-paid' })).items.length, 1);
  assert.equal((await platform.requests(admin, {})).items.length, 1);
});

test('rules require a verified strict claim and an active matching registry for platform commercial reads', async () => {
  const sa = client(admin.uid, { superAdmin: true });
  await assertSucceeds(getDocs(collection(sa, 'organizations'))); await assertSucceeds(getDoc(doc(sa, 'subscriptionEvents/seed-event')));
  await assertSucceeds(getDoc(doc(sa, 'plans/Retired'))); await assertSucceeds(getDoc(doc(sa, 'subscriptionRequests/seed-paid')));
  const attempts: [string, Document][] = [['sa-revoked', { superAdmin: true }], ['sa-missing', { superAdmin: true }], ['sa-wrong-role', { superAdmin: true }],
    ['sa-string', { superAdmin: true }], ['sa-registry-only', {}], [admin.uid, { superAdmin: 'true' }], [admin.uid, { superAdmin: true, email_verified: false }]];
  for (const [uid, claims] of attempts) {
    const sdk = client(uid, claims);
    await assertFails(getDoc(doc(sdk, 'organizations/seed-paid'))); await assertFails(getDoc(doc(sdk, 'subscriptionEvents/seed-event')));
  }
});

test('all client commercial and financial writes stay denied even for Super Admin', async () => {
  const paths = ['organizations/seed-paid', 'organizations/seed-paid/meta/subscription', 'organizations/seed-paid/meta/usage', 'organizations/seed-paid/meta/counters',
    'plans/Professional', 'platformAdmins/sa-active', 'billingTrialClaims/tenant-owner', 'subscriptionEvents/seed-event', 'subscriptionRequests/seed-paid', 'platformOperations/forged',
    'organizations/seed-paid/invoices/history', 'organizations/seed-paid/members/forged-owner'];
  for (const sdk of [client('tenant-owner'), client(admin.uid, { superAdmin: true })]) for (const path of paths) await assertFails(setDoc(doc(sdk, path), { bypass: true }, { merge: true }));
  assert.equal((await db.doc('organizations/seed-paid').get()).data()?.bypass, undefined);
});

test('platform commercial access does not grant tenant financial, membership or sync counter access', async () => {
  const sdk = client(admin.uid, { superAdmin: true });
  for (const path of ['invoices/history', 'payments/history', 'customers/history', 'products/history', 'journal_entries/history', 'members/tenant-viewer', 'meta/counters'])
    await assertFails(getDoc(doc(sdk, `organizations/seed-paid/${path}`)));
});

test('expiry and suspension retain operational history but deny protected feature reads', async () => {
  for (const suffix of ['expired', 'elapsed', 'company-suspended', 'subscription-suspended', 'cancelled']) {
    const id = `seed-${suffix}`;
    for (const name of ['invoices', 'payments', 'customers', 'products']) await assertSucceeds(getDoc(clientRecord('tenant-owner', id, name)));
    await assertSucceeds(getDoc(doc(client('tenant-owner'), `${companyPath(id)}/meta/counters`)));
    for (const name of ['journal_entries', 'accounts', 'inventory_movements', 'audit_logs']) await assertFails(getDoc(clientRecord('tenant-owner', id, name)));
  }
});

test('rules use live plan features and fail closed for missing dates, missing migration and invalid tenant roles', async () => {
  for (const suffix of ['limited', 'bad-date', 'unmigrated']) for (const name of ['journal_entries', 'inventory_movements', 'audit_logs']) await assertFails(getDoc(clientRecord('tenant-owner', `seed-${suffix}`, name)));
  await assertSucceeds(getDoc(clientRecord('tenant-owner', 'seed-retired', 'journal_entries')));
  await assertFails(getDoc(doc(client('tenant-owner'), 'plans/Retired')));
  for (const [uid, claims] of [['foreign-owner', {}], ['forged-owner', {}], ['tenant-owner', { email_verified: false }]] as [string, Document][]) await assertFails(getDoc(clientRecord(uid, 'seed-paid', 'invoices', claims)));
  await assertSucceeds(getDoc(clientRecord('tenant-viewer', 'seed-paid', 'journal_entries')));
  await assertFails(getDoc(clientRecord('tenant-cashier', 'seed-paid', 'journal_entries')));
});

test('Firestore commercial transactions serialize concurrent revisions and preserve accounting fields', async () => {
  const f = await fixture('concurrent'), before = (await db.doc(`${f.root}/meta/counters`).get()).data()!;
  await db.doc(f.root).update({ accounting_version: 2, accountingCosting: { sentinel: 'retained' } });
  const results = await Promise.allSettled([edit(f.org.id, 1, 'race-suspended', 'set_status', { status: 'suspended' }), edit(f.org.id, 1, 'race-cancelled', 'set_status', { status: 'cancelled' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  assert.equal(await eventCount(f.org.id), 1);
  const root = (await db.doc(f.root).get()).data()!, counters = (await db.doc(`${f.root}/meta/counters`).get()).data()!;
  assert.equal(root.billingRevision, 2); assert.equal(root.owner_uid, f.owner.uid); assert.equal(root.accounting_version, 2); assert.deepEqual(root.accountingCosting, { sentinel: 'retained' });
  assert.equal(counters.revision, (before.revision || 0) + 1);
  for (const key of Object.keys(before).filter(key => !['revision', 'updated_at'].includes(key))) assert.deepEqual(counters[key], before[key]);
});

test('Firestore lost-response retries retain one activation, audit event and tenant sync revision', async () => {
  const f = await fixture('retry');
  const body = { expectedRevision: 1, operationId: 'firestore-retry', action: 'change_plan', payload: { planId: 'Professional', providerReference: 'synthetic-bank-1' }, reason: 'إعادة محاولة اصطناعية', method: 'bank_transfer' };
  const first = await platform.updateSubscription(admin, f.org.id, body), before = (await db.doc(`${f.root}/meta/counters`).get()).data();
  assert.deepEqual(await platform.updateSubscription(admin, f.org.id, body), first);
  await assert.rejects(platform.updateSubscription(admin, f.org.id, { ...body, payload: { planId: 'Business' } }), (error: any) => error.status === 409);
  assert.equal(await eventCount(f.org.id), 1); assert.deepEqual((await db.doc(`${f.root}/meta/counters`).get()).data(), before);
  assert.equal((await db.doc(f.root).get()).data()?.subscriptionMetadata.providerReference, 'synthetic-bank-1');
});

test('Firestore reserves a single seven-day trial across concurrent companies of one Owner', async () => {
  const first = await fixture('trial-first', 'shared-trial-owner'), second = await fixture('trial-second', 'shared-trial-owner');
  assert.notEqual(first.org.id, second.org.id);
  const results = await Promise.allSettled([edit(first.org.id, 1, 'trial-one', 'set_status', { status: 'trial' }), edit(second.org.id, 1, 'trial-two', 'set_status', { status: 'trial' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  const claim = (await db.doc('billingTrialClaims/shared-trial-owner').get()).data()!;
  assert.equal(Date.parse(claim.endedAt) - Date.parse(claim.startedAt), 7 * day);
  assert.equal(await eventCount(first.org.id) + await eventCount(second.org.id), 1);
  await assert.rejects(edit(claim.organizationId, 2, 'trial-extension', 'extend', { days: 7 }), /7 أيام/);
  assert.equal((await db.doc(companyPath(claim.organizationId)).get()).data()?.owner_uid, 'shared-trial-owner');
});

test('a real server plan edit immediately changes SDK entitlements without permitting a client edit', async () => {
  const id = 'LiveToggle', plan = { ...defaultPlatformPlans().find(p => p.id === 'Professional')!, id };
  await db.doc(`plans/${id}`).set(plan);
  const f = await fixture('live-features'); await edit(f.org.id, 1, 'activate-live-features', 'change_plan', { planId: id });
  await db.doc(`${f.root}/journal_entries/history`).set({ id: 'history' });
  await assertSucceeds(getDoc(clientRecord(f.owner.uid, f.org.id, 'journal_entries')));
  await platform.updatePlan(admin, id, { operationId: 'turn-off-accounting', expectedRevision: plan.revision, reason: 'إيقاف ميزة اصطناعي', plan: { ...plan, features: { ...plan.features, accounting: false } } });
  await assertFails(getDoc(clientRecord(f.owner.uid, f.org.id, 'journal_entries')));
  await assertFails(setDoc(doc(client(f.owner.uid), `plans/${id}`), { features: { accounting: true } }, { merge: true }));
});

test('revoked platform registry rejects the next real transaction with no commercial changes', async () => {
  const f = await fixture('revocation'); await db.doc('platformAdmins/temporary-admin').set({ role: 'super_admin', active: true });
  const actor = { ...admin, uid: 'temporary-admin' }; await platform.assertAdmin(actor); await db.doc('platformAdmins/temporary-admin').update({ active: false });
  const before = (await db.doc(f.root).get()).data();
  await assert.rejects(platform.updateSubscription(actor, f.org.id, { action: 'change_plan', payload: { planId: 'Business' }, expectedRevision: 1, operationId: 'revoked-edit', reason: 'محاولة مرفوضة' }), (error: any) => error.status === 403);
  assert.deepEqual((await db.doc(f.root).get()).data(), before); assert.equal(await eventCount(f.org.id), 0);
});

test('actual Firestore migration previews without writes, preserves history and repairs a canonical lifetime quota once', async () => {
  const f = await fixture('migration'), rootBefore = (await db.doc(f.root).get()).data()!;
  await db.doc(`${f.root}/meta/counters`).update({ invoice_count: 3, invoice_seq: 21, revision: 8, lifetime_invoice_count: 0 });
  await db.doc(`${f.root}/meta/usage`).set({ lifetimeInvoiceCount: 0, firstActualUseAt: '2026-09-03T00:00:00.000Z' });
  await db.doc(`${f.root}/invoices/history`).set({ id: 'history', total_usd: 45, marker: 'untouched' });
  const evidence = { invoiceCount: 3, numberCount: 100, invoiceEvents: 90 }, options = { apply: false, operator: 'synthetic-migration', now: new Date() };
  const countersBefore = (await db.doc(`${f.root}/meta/counters`).get()).data();
  assert.equal(await store.transaction(tx => migrateBillingOrganization(tx, f.org.id, evidence, options)), 'migrated');
  assert.deepEqual((await db.doc(f.root).get()).data(), rootBefore); assert.deepEqual((await db.doc(`${f.root}/meta/counters`).get()).data(), countersBefore); assert.equal(await eventCount(f.org.id), 0);
  assert.equal(await store.transaction(tx => migrateBillingOrganization(tx, f.org.id, evidence, { ...options, apply: true })), 'migrated');
  const after = (await db.doc(f.root).get()).data()!, usage = (await db.doc(`${f.root}/meta/usage`).get()).data()!, counters = (await db.doc(`${f.root}/meta/counters`).get()).data()!;
  assert.equal(after.owner_uid, f.owner.uid); assert.equal(after.planId, 'Free'); assert.equal(counters.lifetime_invoice_count, 100); assert.equal(counters.invoice_count, 3); assert.equal(counters.invoice_seq, 21); assert.equal(counters.revision, 9);
  assert.equal(usage.firstActualUseAt, '2026-09-03T00:00:00.000Z'); assert.equal(usage.lifetimeInvoiceCount, 100);
  assert.deepEqual((await db.doc(`${f.root}/invoices/history`).get()).data(), { id: 'history', total_usd: 45, marker: 'untouched' });
  assert.equal(await store.transaction(tx => migrateBillingOrganization(tx, f.org.id, evidence, { ...options, apply: true })), 'unchanged');
  assert.equal(await eventCount(f.org.id), 1); assert.deepEqual((await db.doc(`${f.root}/meta/counters`).get()).data(), counters);
});

test('Firestore migration requires review for invalid contracts and cannot overwrite edited catalog definitions', async () => {
  const f = await fixture('invalid-contract'); await db.doc(f.root).update({ planId: 'Professional', subscriptionEnd: null, subscriptionEndMillis: null });
  const before = (await db.doc(f.root).get()).data();
  await assert.rejects(store.transaction(tx => migrateBillingOrganization(tx, f.org.id, { invoiceCount: 0, numberCount: 0, invoiceEvents: 0 }, { apply: true, operator: 'synthetic-migration' })), /contract review/);
  assert.deepEqual((await db.doc(f.root).get()).data(), before); assert.equal(await eventCount(f.org.id), 0);
  const free = (await db.doc('plans/Free').get()).data()!; await db.doc('plans/Free').update({ name: 'اسم معتمد' }); await db.doc('plans/Starter').delete();
  assert.deepEqual(await initializeBillingPlans(store, { apply: false, operator: 'synthetic-migration' }), ['Starter']); assert.equal((await db.doc('plans/Starter').get()).exists, false);
  assert.deepEqual(await initializeBillingPlans(store, { apply: true, operator: 'synthetic-migration' }), ['Starter']); assert.equal((await db.doc('plans/Free').get()).data()?.name, 'اسم معتمد');
  assert.deepEqual(await initializeBillingPlans(store, { apply: true, operator: 'synthetic-migration' }), []);
  await db.doc('plans/Free').set(free);
});
