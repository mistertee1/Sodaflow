import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { setDoc, getDoc, getDocs, doc, collection } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreStore } from '../server/firestoreStore';
import { BrowserFirestoreStore } from '../src/services/browserFirestoreStore';
import { readFirebaseOrganizations } from '../src/services/firebaseOrganizations';
import { Organizations } from '../server/organizations';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { Operations } from '../src/domain/operations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { getPlanConfig, createDefaultSubscription, defaultPlatformPlans } from '../src/lib/plans';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../src/types';
import { getDefaultChartOfAccounts } from '../src/services/accountingService';

let env: RulesTestEnvironment;
const project = 'demo-sudaflow';
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Emulator required; never use a live project');
  env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8091, rules: await readFile('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const plan of defaultPlatformPlans()) await setDoc(doc(db, 'plans', plan.id), plan);
    await setDoc(doc(db, 'organizations', 'rules-org'), { id: 'rules-org', owner_uid: 'owner', status: 'active', schema_version: 3, settings: INITIAL_SETTINGS, planId: 'Free', subscriptionStatus: 'active', subscriptionEnd: null, subscriptionEndMillis: null });
    await setDoc(doc(db, 'organizations/rules-org/meta', 'counters'), { ...DEFAULT_ORGANIZATION_COUNTERS, revision: 0 });
    await setDoc(doc(db, 'organizations/rules-org/meta', 'subscription'), createDefaultSubscription('rules-org'));
    for (const account of getDefaultChartOfAccounts('rules-org')) await setDoc(doc(db, 'organizations/rules-org/accounts', account.code), account);
    for (const [uid, role, status] of [['cashier', 'Cashier', 'active'], ['viewer', 'Viewer', 'active'], ['suspended', 'Admin', 'suspended'], ['forged-owner', 'Owner', 'active']]) await setDoc(doc(db, 'organizations/rules-org/members', uid), { uid, org_id: 'rules-org', role, status });
    for (const uid of ['owner', 'viewer', 'suspended', 'forged-owner']) {
      await setDoc(doc(db, `user_organizations/${uid}/orgs/rules-org`), { org_id: 'rules-org', role: uid === 'owner' ? 'Owner' : 'Admin' });
      await setDoc(doc(db, `user_organizations/${uid}/orgs/stale-org`), { org_id: 'stale-org', role: 'Owner' });
    }
    for (const name of ['invoices', 'expenses', 'journal_entries', 'products', 'customers']) await setDoc(doc(db, `organizations/rules-org/${name}`, 'record'), { id: 'record' });
  });
});
after(async () => { await env?.cleanup(); });

test('direct Firestore rules deny tenant writes and protect subscription and role boundaries', async () => {
  const owner = env.authenticatedContext('owner', { email: 'owner@example.com', email_verified: true }).firestore();
  const viewer = env.authenticatedContext('viewer', { email: 'viewer@example.com', email_verified: true }).firestore();
  const cashier = env.authenticatedContext('cashier', { email: 'cashier@example.com', email_verified: true }).firestore();

  await assertFails(setDoc(doc(owner, 'organizations/rules-org/meta/subscription'), { plan: 'Enterprise', status: 'active' }, { merge: true }));
  await assertFails(setDoc(doc(owner, 'organizations/rules-org/invoices/forged'), { id: 'forged', org_id: 'rules-org', created_by: 'other', schema_version: 3 }));
  await assertFails(setDoc(doc(viewer, 'organizations/rules-org/invoices/forged'), { id: 'forged', org_id: 'rules-org', created_by: 'viewer', schema_version: 3 }));
  await assertFails(setDoc(doc(cashier, 'organizations/rules-org/products/record'), { id: 'record', org_id: 'rules-org', price_usd: 999 }, { merge: true }));
});

test('cashier reads operational data required by direct sync; suspended/foreign users remain blocked', async () => {
  const cashier = env.authenticatedContext('cashier', { email: 'cashier@example.com', email_verified: true }).firestore();
  await assertSucceeds(getDocs(collection(cashier, 'organizations/rules-org/invoices')));
  await assertFails(getDocs(collection(cashier, 'organizations/rules-org/expenses'))); await assertFails(getDoc(doc(cashier, 'organizations/rules-org/journal_entries/record')));
  for (const uid of ['foreign', 'suspended', 'forged-owner']) await assertFails(getDoc(doc(env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore(), 'organizations/rules-org/invoices/record')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('viewer', { email: 'viewer@example.com', email_verified: true }).firestore(), 'organizations/rules-org/journal_entries/record')));
});

test('unverified recipient cannot use a forged payload email to create own membership or tenant index', async () => {
  const db = env.authenticatedContext('attacker', { email: 'attacker@example.com', email_verified: false }).firestore();
  await assertFails(setDoc(doc(db, 'organizations/rules-org/members/attacker'), { uid: 'attacker', org_id: 'rules-org', role: 'Owner', email: 'recipient@example.com', status: 'active', invitation_id: 'stolen' }));
  await assertFails(setDoc(doc(db, 'user_organizations/attacker/orgs/rules-org'), { org_id: 'rules-org', role: 'Owner' }));
  await assertFails(setDoc(doc(db, 'users/attacker/journal_entries/forged'), { lines: [{}] }));
});

test('browser Firestore cannot bypass API-only writes or activate costing by forged requests', async () => {
  const db = env.authenticatedContext('owner', { email: 'owner@example.com', email_verified: true }).firestore();
  const store = new BrowserFirestoreStore(db as unknown as import('firebase/firestore').Firestore);
  const ops = new Operations(store), actor = { uid: 'owner', email: 'owner@example.com', emailVerified: true };
  await assert.rejects(ops.execute('rules-org', actor, { action: 'customer.create', operationId: 'browser-customer', data: { name: 'تجاوز', phone: '' } }));
  await assertFails(setDoc(doc(db, 'organizations/rules-org'), { accounting_version: 2 }, { merge: true }));
  await assertFails(setDoc(doc(db, 'organizations/rules-org/products/record'), { cost_status: 'valued', stock_quantity: 999, inventory_value_sdg: 1, inventory_value_usd: 1 }, { merge: true }));
  await assertFails(setDoc(doc(db, 'organizations/rules-org/journal_entries/forged'), { lines: [] }));
  await assert.rejects(ops.execute('rules-org', actor, { action: 'accounting.activate', operationId: 'browser-v2', data: { reason: 'تجاوز' } }), /خدمة الخادم/);
});

test('real Firestore concurrent sales, duplicate retry, stock and customer balances commit together', async () => {
  const app = initializeApp({ projectId: project }, 'test-admin'), db = getFirestore(app);
  try {
    const store = new FirestoreStore(db), actor = { uid: 'integration-owner', email: 'i@example.com', emailVerified: true }, orgs = new Organizations(store);
    const rules = await readFile('firestore.rules', 'utf8');
    const org = await orgs.create(actor, 'اختبار التكامل', INITIAL_SETTINGS, 'integration', true), ops = new Operations(store, () => new Date('2026-10-05T12:00:00Z'), saved => saved as any, async () => { assert.ok(process.env.FIRESTORE_EMULATOR_HOST); verifyAccountingRulesSource([{ content: rules }]); });
    await store.transaction(async tx => { tx.set(`organizations/${org.id}/meta/subscription`, { ...createDefaultSubscription(org.id), ...getPlanConfig('Enterprise'), plan: 'Enterprise' }); tx.set(`organizations/${org.id}`, { ...await tx.get(`organizations/${org.id}`), planId: 'Enterprise', subscriptionEnd: '2027-01-01T00:00:00Z', subscriptionEndMillis: Date.parse('2027-01-01') }); });
    const run = (action: string, data: Record<string, unknown>, operationId: string) => ops.execute(org.id, actor, { action, data, operationId });
    const customer = (await run('customer.create', { name: 'عميل', phone: '', preferred_currency: 'USD' }, 'customer')).result;
    const product = (await run('product.create', { name: 'منتج', unit: 'قطعة', price_sdg: 2000, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: 10 }, 'product')).result;
    await run('product.cost.establish', { id: product.id, cost_currency: 'USD', unit_cost: 2, exchange_rate_used: 2000, reason: 'تكلفة افتتاحية موثقة' }, 'cost');
    await run('accounting.activate', { reason: 'مطابقة الاختبار' }, 'activate');
    const line = { product_id: product.id, description: 'منتج', unit: 'قطعة', quantity: 2, unit_price: 100, currency: 'USD', tax_rate: 0, discount_percent: 0 };
    const data = { customer_id: customer.id, issue_date: '2026-10-05', currency_mode: 'single_usd', exchange_rate_used: 2000, discount_type: 'fixed', discount_value: 0, items: [line, { ...line, quantity: 1 }] };
    const results = await Promise.all([run('invoice.create', data, 'sale-a'), run('invoice.create', data, 'sale-b')]);
    await run('invoice.create', data, 'sale-a'); assert.notEqual(results[0].result.invoice_number, results[1].result.invoice_number);
    const s = await ops.snapshot(org.id, actor); assert.equal(s.collections.invoices.length, 2); assert.equal(s.collections.products[0].stock_quantity, 4); assert.equal(s.collections.customers[0].balance_usd, 600); assert.equal(s.counters.invoice_count, 2);
    const receipt = { invoice_id: results[0].result.id, amount: 50, currency: 'USD', exchange_rate_used: 3000, payment_method: 'bankak' };
    await Promise.all([run('payment.create', receipt, 'payment'), run('payment.create', receipt, 'payment')]);
    const full = await ops.snapshot(org.id, actor); assert.equal(full.collections.payments.length, 1); assert.equal(full.collections.customers[0].balance_usd, 550);
    assert.equal(full.collections.products[0].inventory_value_usd, 8); assert.deepEqual(reconcileFinancialData(full.collections as FinancialData, full.settings, { requireCosting: true }), []);
    const client = env.authenticatedContext(actor.uid, { email_verified: true }).firestore();
    await assertFails(setDoc(doc(client, `organizations/${org.id}/products/${product.id}`), { stock_quantity: 999 }, { merge: true }));
    await assertFails(setDoc(doc(client, `organizations/${org.id}`), { accounting_version: 1 }, { merge: true }));
    const before = await db.doc(`organizations/${org.id}/meta/counters`).get(); await assert.rejects(run('invoice.create', { ...data, items: [{ ...line, quantity: 5 }] }, 'oversell'), /المخزون/);
    assert.deepEqual((await db.doc(`organizations/${org.id}/meta/counters`).get()).data(), before.data());
  } finally { await deleteApp(app); }
});


test('Firebase organization fallback respects tenant rules and ignores stale membership indexes', async () => {
  for (const uid of ['owner', 'viewer']) {
    const db = env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
    const orgs = await readFirebaseOrganizations(db as unknown as import('firebase/firestore').Firestore, uid);
    assert.deepEqual(orgs.map(org => org.id), ['rules-org']);
  }
  for (const uid of ['foreign', 'suspended', 'forged-owner']) {
    const db = env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
    assert.deepEqual(await readFirebaseOrganizations(db as unknown as import('firebase/firestore').Firestore, uid), []);
  }
  const foreign = env.authenticatedContext('foreign', { email_verified: true }).firestore();
  await assertFails(readFirebaseOrganizations(foreign as unknown as import('firebase/firestore').Firestore, 'owner'));
});

test('B1 Firestore transactions keep repeated purchase lines, concurrent supplier payments and AP/stock atomic', async () => {
  const app=initializeApp({projectId:project},'test-supplier-admin'), db=getFirestore(app);
  try {
    const store=new FirestoreStore(db), actor={uid:'supplier-integration-owner',email:'supplier-i@example.com',emailVerified:true};
    const org=await new Organizations(store).create(actor,'الموردون',INITIAL_SETTINGS,'supplier-integration',true), root=`organizations/${org.id}`;
    await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01T00:00:00Z',subscriptionEndMillis:Date.parse('2027-01-01')}));
    const rules=await readFile('firestore.rules','utf8'), ops=new Operations(store,()=>new Date('2026-10-05T12:00:00Z'),saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}]));
    const run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org.id,actor,{action,data,operationId});
    const p=(await run('product.create',{name:'صنف',unit:'قطعة',price_sdg:10000,price_usd:5,tax_rate:0,is_active:true,track_inventory:true,stock_quantity:0},'product')).result;
    await run('product.cost.establish',{id:p.id,cost_currency:'USD',unit_cost:2,exchange_rate_used:2000,reason:'فارغ موثق'},'basis');await run('accounting.activate',{reason:'مطابقة'},'activate');
    const supplier=(await run('supplier.create',{name:'المورد'},'supplier')).result;
    const purchase={supplier_id:supplier.id,supplier_reference:'FS-1',issue_date:'2026-10-05',currency:'USD',exchange_rate_used:2000,settlement:'credit',reason:'وثيقة',items:[{product_id:p.id,quantity:5,unit_cost:2},{product_id:p.id,quantity:5,unit_cost:2}]};
    const buys=await Promise.all([run('purchase.create',purchase,'buy'),run('purchase.create',purchase,'buy')]);assert.equal(buys[0].result.id,buys[1].result.id);
    const payment={bill_id:buys[0].result.id,amount:15,currency:'USD',exchange_rate_used:3000,payment_date:'2026-10-05',payment_method:'bankak'};
    const paid=await Promise.allSettled([run('supplierPayment.create',payment,'pay-a'),run('supplierPayment.create',payment,'pay-b')]);assert.equal(paid.filter(r=>r.status==='fulfilled').length,1);assert.equal(paid.filter(r=>r.status==='rejected').length,1);
    const winner=paid[0].status==='fulfilled'?'pay-a':'pay-b';await run('supplierPayment.create',payment,winner);
    const snapshot=await ops.snapshot(org.id,actor,true);assert.equal(snapshot.collections.purchase_bills.length,1);assert.equal(snapshot.collections.supplier_payments.length,1);assert.equal(snapshot.collections.products[0].stock_quantity,10);assert.equal(snapshot.collections.purchase_bills[0].remaining_usd,5);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
    const client=env.authenticatedContext(actor.uid,{email_verified:true}).firestore();
    for(const name of ['suppliers','purchase_bills','supplier_payments']) {await assertFails(setDoc(doc(client,`${root}/${name}/forged`),{id:'forged'}));await assertFails(getDocs(collection(client,`${root}/${name}`)));}
  } finally {await deleteApp(app);}
});
