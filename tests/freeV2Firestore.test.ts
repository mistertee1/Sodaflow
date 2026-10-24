import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, setDoc, doc } from 'firebase/firestore';
import { FirestoreStore } from '../server/firestoreStore';
import { Organizations } from '../server/organizations';
import { Operations, type Actor } from '../src/domain/operations';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';

let app: App, env: RulesTestEnvironment, store: FirestoreStore;
const owner: Actor = { uid: 'free-v2-emulator-owner', email: 'synthetic-free@example.test', emailVerified: true };
const now = () => new Date('2026-10-24T12:00:00Z');
const verify = async () => verifyAccountingRulesSource([{ content: readFileSync('firestore.rules', 'utf8') }]);
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Only demo-sudaflow Emulator may receive these writes');
  env = await initializeTestEnvironment({ projectId: 'demo-sudaflow', firestore: { host: '127.0.0.1', port: 8091, rules: readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: 'demo-sudaflow' }, 'free-v2-acceptance'); store = new FirestoreStore(getFirestore(app));
});
beforeEach(async () => env.clearFirestore());
after(async () => { if (env) await env.cleanup(); if (app) await deleteApp(app); });

test('Firestore new free V2 creation is atomic, retry-safe and does not permit SDK activation or foreign reads', async () => {
  const organizations = new Organizations(store, undefined, now, false, verify);
  const org = await organizations.create(owner, 'مجانية سحابية', INITIAL_SETTINGS, 'free-create', true);
  const root = `organizations/${org.id}`, ops = new Operations(store, now, undefined, verify, false);
  assert.equal(org.accounting_version, 2);
  await organizations.create(owner, 'retry', INITIAL_SETTINGS, 'free-create', true);
  const snapshot = await ops.snapshot(org.id, owner, true);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings, { requireCosting: true }), []);
  assert.equal((await getFirestore(app).collection('subscriptionEvents').get()).size, 0);
  const client = env.authenticatedContext(owner.uid, { email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(client, root)));
  await assertFails(setDoc(doc(client, root), { accounting_version: 2 }, { merge: true }));
  await assertFails(setDoc(doc(client, `${root}/meta/subscription`), { status: 'active', features: { accounting: true } }));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), root)));
  await assertFails(getDoc(doc(env.authenticatedContext('outside', { email_verified: true }).firestore(), root)));
  assert.equal((await getFirestore(app).collection('organizations').get()).size, 1);
});

test('Firestore free V2 reports work after commercial expiry without changing contract, membership or usage', async () => {
  const org = await new Organizations(store, undefined, now, false, verify).create(owner, 'تقارير مجانية', INITIAL_SETTINGS, 'free-report', true), root = `organizations/${org.id}`;
  const db = getFirestore(app);
  await db.doc(root).update({ status: 'suspended', planId: 'missing-plan', subscriptionStatus: 'expired', subscriptionEnd: '2020-01-01' });
  await db.doc(`${root}/members/viewer`).set({ uid: 'viewer', org_id: org.id, role: 'Viewer', status: 'suspended' });
  await db.doc(`${root}/meta/usage`).set({ lifetimeInvoiceCount: 1_000_000 });
  const before = (await db.doc(root).get()).data(), member = (await db.doc(`${root}/members/viewer`).get()).data();
  const ops = new Operations(store, now, () => { throw Error('Unexpected billing lookup'); }, verify, false), actor = { ...owner, uid: 'viewer' };
  for (const read of [() => ops.accountingHealth(org.id, actor), () => ops.accountingAssistance(org.id, actor), () => ops.taxReports(org.id, actor), () => ops.productProfitability(org.id, actor), () => ops.customerProfitability(org.id, actor), () => ops.cashForecastReport(org.id, actor, { days: 30 })]) assert.equal((await read()).organizationId, org.id);
  const snapshot = await ops.snapshot(org.id, actor);
  assert.equal(snapshot.subscription.max_invoices_total, Number.MAX_SAFE_INTEGER); assert.equal(snapshot.counters.lifetime_invoice_count, 1_000_000);
  assert.deepEqual((await db.doc(root).get()).data(), before); assert.deepEqual((await db.doc(`${root}/members/viewer`).get()).data(), member);
  await assert.rejects(ops.accountingHealth(org.id, { ...actor, uid: 'outside' }), (error: any) => error.status === 403);
});

test('Firestore legacy free activation keeps cost proof, dual-book reconciliation and exact Rules gate', async () => {
  const org = await new Organizations(store, undefined, now, false).create(owner, 'إثبات تكلفة مجاني', INITIAL_SETTINGS, 'legacy-free', true), root = `organizations/${org.id}`;
  await getFirestore(app).doc(root).update({ planId: 'missing-plan', subscriptionStatus: 'expired' });
  const ops = new Operations(store, now, undefined, verify, false), run = (action: string, data: Record<string, unknown>, operationId: string) => ops.execute(org.id, owner, { action, data, operationId });
  const product = (await run('product.create', { name: 'رصيد موثق', unit: 'قطعة', price_sdg: 9000, price_usd: 9, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: 10 }, 'legacy-product')).result;
  const before = (await getFirestore(app).doc(root).get()).data();
  await assert.rejects(run('accounting.activate', { reason: 'تكلفة ناقصة' }, 'unproven'), /أثبت تكلفة/);
  assert.deepEqual((await getFirestore(app).doc(root).get()).data(), before);
  const denied = new Operations(store, now, undefined, async () => verifyAccountingRulesSource([{ content: 'old deployment' }]), false);
  await assert.rejects(denied.execute(org.id, owner, { action: 'product.cost.establish', operationId: 'wrong-rules', data: { id: product.id, cost_currency: 'USD', unit_cost: 2, exchange_rate_used: 2000, reason: 'إثبات' } }), (error: any) => error.code === 'accounting_rules_not_deployed');
  assert.equal((await getFirestore(app).collection(`${root}/journal_entries`).get()).size, 0);
  await run('product.cost.establish', { id: product.id, cost_currency: 'USD', unit_cost: 2, exchange_rate_used: 2000, reason: 'وثيقة اصطناعية' }, 'establish');
  await run('accounting.activate', { reason: 'إثبات ومطابقة' }, 'activate');
  const snapshot = await ops.snapshot(org.id, owner, true);
  assert.equal(snapshot.org.accounting_version, 2); assert.equal(snapshot.org.subscriptionStatus, 'expired');
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings, { requireCosting: true }), []);
});
