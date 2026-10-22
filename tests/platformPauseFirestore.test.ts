import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, getDocs, setDoc, doc, collection } from 'firebase/firestore';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { FirestoreStore } from '../server/firestoreStore';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import { Organizations } from '../server/organizations';
import { Operations, readPermissions, type Actor } from '../src/domain/operations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';

let env: RulesTestEnvironment, app: App, db: Firestore, rules: string;
const root = 'organizations/paused-org';
const owner: Actor = { uid: 'owner', email: 'owner@example.test', emailVerified: true };
const client = (uid: string, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true, ...claims }).firestore();
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Only the local demo-sudaflow emulator may receive writes');
  rules = await readFile('firestore.rules', 'utf8');
  assert.match(rules, /function platformControlsEnabled\(\) \{ return false; \}/);
  env = await initializeTestEnvironment({ projectId: 'demo-sudaflow', firestore: { host: '127.0.0.1', port: 8091, rules } });
  app = initializeApp({ projectId: 'demo-sudaflow' }, 'paused-controls-acceptance'); db = getFirestore(app);
});
beforeEach(async () => {
  await env.clearFirestore();
  const batch = db.batch();
  batch.set(db.doc(root), { id: 'paused-org', owner_uid: owner.uid, status: 'suspended', schema_version: 3, settings: INITIAL_SETTINGS, planId: 'missing-plan', subscriptionStatus: 'expired', subscriptionEnd: '2020-01-01T00:00:00Z' });
  for (const [uid, role, status] of [['admin', 'Admin', 'active'], ['accountant', 'Accountant', 'suspended'], ['sales', 'Sales', 'active'], ['cashier', 'Cashier', 'suspended'], ['viewer', 'Viewer', 'suspended'], ['removed', 'Admin', 'removed'], ['forged', 'Owner', 'active']]) batch.set(db.doc(`${root}/members/${uid}`), { uid, org_id: 'paused-org', role, status });
  for (const name of Object.keys(readPermissions)) if (name !== 'members') batch.set(db.doc(`${root}/${name}/record`), { id: 'record', org_id: 'paused-org' });
  batch.set(db.doc('organizations/foreign'), { owner_uid: 'foreign-owner', status: 'active' });
  batch.set(db.doc('organizations/foreign/invoices/private'), { id: 'private' });
  batch.set(db.doc('platformAccess/superAdmin'), { uid: 'viewer', email: 'viewer@example.test', mode: 'exclusive', active: true });
  batch.set(db.doc('platformAdmins/viewer'), { role: 'super_admin', active: true });
  batch.set(db.doc('plans/Free'), { active: true }); batch.set(db.doc('subscriptionEvents/private'), { action: 'plan.save' });
  await batch.commit();
});
after(async () => { if (env) await env.cleanup(); if (app) await deleteApp(app); });

test('shipped paused Rules allow every real role and suspended member to read company operations without a plan', async () => {
  for (const uid of ['owner', 'admin', 'accountant', 'sales', 'cashier', 'viewer']) {
    const firestore = client(uid);
    await assertSucceeds(getDoc(doc(firestore, root)));
    for (const name of Object.keys(readPermissions)) {
      const result = await assertSucceeds(getDocs(collection(firestore, `${root}/${name}`))); assert.ok(result.size > 0, name);
    }
  }
});

test('paused Rules retain isolation, verification and real ownership even with forged claims or index entries', async () => {
  for (const uid of ['outside', 'removed', 'forged']) await assertFails(getDoc(doc(client(uid, { superAdmin: true, role: 'Owner' }), root)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), root)));
  await assertFails(getDoc(doc(client('viewer', { email_verified: false }), root)));
  await assertFails(getDoc(doc(client('viewer', { superAdmin: true }), 'organizations/foreign/invoices/private')));
  await assertFails(getDocs(collection(client('viewer'), 'organizations')));
  for (const path of ['platformAccess/superAdmin', 'platformAdmins/viewer', 'plans/Free', 'subscriptionEvents/private']) await assertFails(getDoc(doc(client('viewer', { superAdmin: true }), path)));
});

test('paused Rules never permit direct financial, membership, billing, role or policy writes', async () => {
  for (const uid of ['owner', 'viewer']) for (const path of [root, `${root}/invoices/forged`, `${root}/members/viewer`, `${root}/meta/subscription`, `${root}/meta/usage`, `${root}/operationIntents/forged`, 'platformAccess/superAdmin', 'platformAdmins/viewer', 'plans/Free', 'subscriptionEvents/forged']) await assertFails(setDoc(doc(client(uid, { superAdmin: true }), path), { status: 'active', role: 'Owner', planId: 'Enterprise' }));
  assert.equal((await db.doc(root).get()).data()!.subscriptionStatus, 'expired');
});

test('real Firestore server transactions allow invoice 101 for Viewer and restore strict gates without changing billing or roles', async () => {
  const store = new FirestoreStore(db), actor: Actor = { uid: 'cloud-owner', email: 'cloud-owner@example.test', emailVerified: true };
  const org = await new Organizations(store, undefined, undefined, false).create(actor, 'قبول اصطناعي', INITIAL_SETTINGS, 'pause-cloud', true), path = `organizations/${org.id}`;
  await db.doc(path).update({ status: 'suspended', subscriptionStatus: 'expired' });
  await db.doc(`${path}/members/cloud-viewer`).set({ uid: 'cloud-viewer', role: 'Viewer', status: 'suspended' });
  await db.doc(`${path}/meta/usage`).update({ lifetimeInvoiceCount: 100 });
  const before = (await db.doc(path).get()).data(), member = (await db.doc(`${path}/members/cloud-viewer`).get()).data();
  const ops = new Operations(store, undefined, undefined, async () => verifyAccountingRulesSource([{ content: rules }]), false);
  const viewer: Actor = { uid: 'cloud-viewer', email: 'cloud-viewer@example.test', emailVerified: true };
  const run = (action: string, data: Record<string, unknown>, operationId: string) => ops.execute(org.id, viewer, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل', phone: '', preferred_currency: 'SDG', balance_sdg: 0, balance_usd: 0 }, 'c')).result;
  const product = (await run('product.create', { name: 'خدمة', unit: 'خدمة', price_sdg: 100, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: false }, 'p')).result;
  const input = { customer_id: customer.id, issue_date: new Date().toISOString().slice(0, 10), currency_mode: 'single_sdg', exchange_rate_used: 0, discount_type: 'fixed', discount_value: 0, items: [{ product_id: product.id, description: product.name, unit: product.unit, quantity: 1, unit_price: 100, currency: 'SDG', tax_rate: 0, discount_percent: 0 }] };
  const first = await run('invoice.create', input, 'invoice101'); assert.deepEqual(await run('invoice.create', input, 'invoice101'), first);
  assert.equal((await db.doc(`${path}/meta/usage`).get()).data()!.lifetimeInvoiceCount, 101);
  assert.equal((await db.collection(`${path}/invoices`).get()).size, 1);
  assert.deepEqual((await db.doc(`${path}/members/cloud-viewer`).get()).data(), member);
  assert.deepEqual((await db.doc(path).get()).data(), before);
  const entries = await assertSucceeds(getDocs(collection(client('cloud-viewer'), `${path}/journal_entries`))); assert.equal(entries.size, 1);
  await assert.rejects(new Operations(store).snapshot(org.id, viewer), (error: any) => error.status === 403);
});

test('real Firestore persists all Gulf/Egypt prices and native receipts once with isolated server-only writes', async () => {
  const quotes = { SAR: 4, AED: 4, KWD: .3, QAR: 4, BHD: .4, OMR: .4, EGP: 50 };
  const store = new FirestoreStore(db), actor: Actor = { uid: 'regional-owner', email: 'regional@example.test', emailVerified: true };
  const org = await new Organizations(store, undefined, undefined, false).create(actor, 'عملات اصطناعية', { ...INITIAL_SETTINGS, default_exchange_rate: 2000, currency_rates: quotes }, 'regional-cloud', true), path = `organizations/${org.id}`;
  const ops = new Operations(store, undefined, undefined, async () => verifyAccountingRulesSource([{ content: rules }]), false);
  const run = (action: string, data: Record<string, unknown>, operationId: string, who = actor) => ops.execute(org.id, who, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل', phone: '01012345678', preferred_currency: 'EGP' }, 'customer')).result;
  await run('accounting.activate', { reason: 'اختبار اصطناعي' }, 'activate');
  for (const [currency, quote] of Object.entries(quotes)) {
    const value = { customer_id: customer.id, issue_date: new Date().toISOString().slice(0, 10), currency_mode: 'single_foreign', exchange_rate_used: 2000, currency_rates_used: { [currency]: quote }, discount_type: 'fixed', discount_value: 0, items: [{ description: 'خدمة', unit: 'ساعة', quantity: 1, unit_price: 3, currency, tax_rate: 0, discount_percent: 0 }] };
    const first = await run('invoice.create', value, 'sale-' + currency);
    assert.deepEqual(await run('invoice.create', value, 'sale-' + currency), first);
    const payment = { invoice_id: first.result.id, amount: 3, currency, currency_rates_used: { [currency]: quote * 2 }, exchange_rate_used: 3000, payment_method: 'cash' };
    const receipt = await run('payment.create', payment, 'pay-' + currency);
    assert.deepEqual(await run('payment.create', payment, 'pay-' + currency), receipt);
    const saved = (await db.doc(`${path}/invoices/${first.result.id}`).get()).data()!;
    assert.equal(saved.pricing.total, 3); assert.equal(saved.pricing_remaining, 0); assert.equal(saved.status, 'paid');
    assert.equal(saved.currency_rates_used[currency], quote); assert.equal(saved.customer_phone, '+201012345678');
  }
  const snapshot = await new Operations(new FirestoreStore(db), undefined, undefined, undefined, false).snapshot(org.id, actor, true);
  assert.equal(snapshot.collections.invoices.length, 7); assert.equal(snapshot.collections.payments.length, 7);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings), []);
  await assertFails(setDoc(doc(client(actor.uid), `${path}/payments/forged`), { amount: 1, currency: 'KWD' }));
  await assertFails(getDoc(doc(client('foreign'), `${path}/invoices/inv-sale-KWD`)));
  await assert.rejects(run('customer.create', { name: 'غير مسموح' }, 'foreign', { ...actor, uid: 'foreign' }), (error: any) => error.status === 403);
});
