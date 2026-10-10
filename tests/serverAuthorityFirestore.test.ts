import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { ResilientStore } from '../server/resilientStore';
import { Organizations } from '../server/organizations';
import { PlatformBilling } from '../server/platformBilling';
import { Operations, type Actor } from '../src/domain/operations';
import { defaultPlatformPlans } from '../src/lib/plans';
import { INITIAL_SETTINGS } from '../src/data/initialData';

const owner: Actor = { uid: 'remote-authority-owner', email: 'owner@example.test', emailVerified: true };
const admin: Actor = { uid: 'remote-authority-admin', email: 'admin@example.test', emailVerified: true, superAdmin: true };
let app: App, db: Firestore, store: ResilientStore, denied = false, cwd: string, dir: string;
const fault = Object.assign(new Error('permission denied injected before Firestore transaction'), { code: 7 });
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Only demo-sudaflow on a local emulator may receive test writes');
  app = initializeApp({ projectId: 'demo-sudaflow' }, 'server-authority-acceptance'); db = getFirestore(app);
  const gate = new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return async (...args: unknown[]) => { if (denied) throw fault; return Reflect.apply(target.runTransaction, target, args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  store = new ResilientStore(gate); cwd = process.cwd(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudaflow-emulator-authority-')); process.chdir(dir);
  const batch = db.batch(); for (const plan of defaultPlatformPlans()) batch.set(db.doc(`plans/${plan.id}`), plan);
  batch.set(db.doc(`platformAdmins/${admin.uid}`), { active: true, role: 'super_admin' }); await batch.commit();
});
after(async () => { if (cwd) process.chdir(cwd); if (dir) fs.rmSync(dir, { recursive: true, force: true }); if (app) await deleteApp(app); });
async function company(uid: string) {
  denied = false; const actor = { ...owner, uid };
  const org = await new Organizations(store).create(actor, 'شركة تجريبية', INITIAL_SETTINGS, `create-${uid}`, true);
  return { org, actor, root: `organizations/${org.id}` };
}
const localFile = () => path.join(dir, '.data', 'sudaflow_server_store.json');

test('real Firestore retry creates one cloud company/event and never a local company', async () => {
  const actor = { ...owner, uid: 'remote-register' }, id = `org-${actor.uid}`;
  denied = true; await assert.rejects(new Organizations(store).create(actor, 'شركة تجريبية', INITIAL_SETTINGS, 'remote-register', true), e => e === fault);
  assert.equal((await db.doc(`organizations/${id}`).get()).exists, false); assert.equal(fs.existsSync(localFile()), false);
  denied = false; const organizations = new Organizations(store);
  await organizations.create(actor, 'شركة تجريبية', INITIAL_SETTINGS, 'remote-register', true);
  await organizations.create(actor, 'شركة تجريبية', INITIAL_SETTINGS, 'remote-register', true);
  assert.equal((await db.doc(`organizations/${id}`).get()).data()?.owner_uid, actor.uid);
  assert.equal((await db.collection('subscriptionEvents').where('organizationId', '==', id).get()).size, 1);
  assert.equal(fs.existsSync(localFile()), false);
});

test('failed real subscription edit preserves quota/revision/audit, then retries exactly once', async () => {
  const f = await company('remote-commercial'), platform = new PlatformBilling(store);
  await db.doc(`${f.root}/meta/counters`).update({ revision: 8, lifetime_invoice_count: 100, invoice_count: 13 });
  await db.doc(`${f.root}/meta/usage`).update({ lifetimeInvoiceCount: 100 });
  const before = (await db.doc(f.root).get()).data(), counters = (await db.doc(`${f.root}/meta/counters`).get()).data();
  const command = { expectedRevision: 1, operationId: 'remote-upgrade', action: 'change_plan', payload: { planId: 'Professional' }, reason: 'اختبار اصطناعي' };
  denied = true; await assert.rejects(platform.updateSubscription(admin, f.org.id, command), e => e === fault);
  assert.deepEqual((await db.doc(f.root).get()).data(), before); assert.deepEqual((await db.doc(`${f.root}/meta/counters`).get()).data(), counters);
  assert.equal((await db.collection('subscriptionEvents').where('organizationId', '==', f.org.id).get()).size, 1);
  denied = false; const first = await platform.updateSubscription(admin, f.org.id, command);
  assert.deepEqual(await platform.updateSubscription(admin, f.org.id, command), first);
  const after = (await db.doc(`${f.root}/meta/counters`).get()).data()!;
  assert.equal(after.revision, 9); assert.equal(after.lifetime_invoice_count, 100); assert.equal(after.invoice_count, 13);
  assert.equal((await db.doc(`${f.root}/meta/usage`).get()).data()?.lifetimeInvoiceCount, 100);
  assert.equal((await db.collection('subscriptionEvents').where('organizationId', '==', f.org.id).get()).size, 2);
});

test('recovery retains expired cloud contract despite a forged local Free subscription', async () => {
  const f = await company('remote-expired');
  await db.doc(f.root).update({ planId: 'Professional', subscriptionStatus: 'active', subscriptionEnd: '2020-01-01T00:00:00Z', subscriptionEndMillis: Date.parse('2020-01-01') });
  fs.mkdirSync(path.dirname(localFile()), { recursive: true }); fs.writeFileSync(localFile(), JSON.stringify({ [f.root]: { ...f.org, planId: 'Free', subscriptionStatus: 'active' }, [`${f.root}/members/${f.actor.uid}`]: { uid: f.actor.uid, role: 'Owner', status: 'active' } }));
  const file = fs.readFileSync(localFile(), 'utf8'), ops = new Operations(store);
  denied = true; await assert.rejects(ops.execute(f.org.id, f.actor, { action: 'customer.create', operationId: 'expired-attempt', data: { name: 'مرفوض' } }), e => e === fault);
  denied = false; await assert.rejects(ops.execute(f.org.id, f.actor, { action: 'customer.create', operationId: 'expired-attempt', data: { name: 'مرفوض' } }), (e: unknown) => (e as { code: string }).code === 'subscription_expired');
  assert.equal((await db.collection(`${f.root}/customers`).get()).size, 0); assert.equal(fs.readFileSync(localFile(), 'utf8'), file);
});

test('recovery never resets lifetime 100 invoice quota or imports a local active admin registry', async () => {
  const f = await company('remote-quota'), ops = new Operations(store);
  const customer = (await ops.execute(f.org.id, f.actor, { action: 'customer.create', operationId: 'quota-customer', data: { name: 'عميل اصطناعي' } })).result;
  const product = (await ops.execute(f.org.id, f.actor, { action: 'product.create', operationId: 'quota-product', data: { name: 'منتج اصطناعي', unit: 'قطعة', price_sdg: 100, price_usd: 0, tax_rate: 0, is_active: true, track_inventory: false } })).result;
  await db.doc(`${f.root}/meta/counters`).update({ lifetime_invoice_count: 100 }); await db.doc(`${f.root}/meta/usage`).update({ lifetimeInvoiceCount: 100 });
  const input = { customer_id: customer.id, issue_date: new Date().toISOString().slice(0, 10), currency_mode: 'single_sdg', exchange_rate_used: 0, discount_type: 'fixed', discount_value: 0, items: [{ product_id: product.id, description: product.name, unit: 'قطعة', quantity: 1, unit_price: 100, currency: 'SDG', tax_rate: 0, discount_percent: 0 }] };
  const command = { action: 'invoice.create', operationId: 'quota-attempt', data: input };
  denied = true; await assert.rejects(ops.execute(f.org.id, f.actor, command), e => e === fault);
  denied = false; await assert.rejects(ops.execute(f.org.id, f.actor, command), /حد.*فاتورة|حد.*فواتير|الباقة/);
  assert.equal((await db.collection(`${f.root}/invoices`).get()).size, 0);
  assert.equal((await db.doc(`${f.root}/meta/usage`).get()).data()?.lifetimeInvoiceCount, 100);
  await db.doc(`platformAdmins/${admin.uid}`).update({ active: false });
  const local = JSON.parse(fs.readFileSync(localFile(), 'utf8')); local[`platformAdmins/${admin.uid}`] = { active: true, role: 'super_admin' }; fs.writeFileSync(localFile(), JSON.stringify(local));
  await assert.rejects(new PlatformBilling(store).assertAdmin(admin), (e: unknown) => (e as { status: number }).status === 403);
  assert.equal((await db.doc(`platformAdmins/${admin.uid}`).get()).data()?.active, false);
});
