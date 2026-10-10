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
import { openingBooksFixture, settleOpeningBooks, freshOpeningBooksFixture } from './fixtures/openingBooks';
import { journal, journalLine } from '../src/domain/financial';

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

async function atomicOpeningSetup(store:FirestoreStore,actor:{uid:string;email:string;emailVerified:boolean;authTime:number},now:Date,suffix:string,rules:string) {
  // Each scenario needs its own tenant. Initial registration intentionally reuses
  // org-<owner uid>, which would alias the two currency-shortage scenarios.
  const org=await new Organizations(store).create(actor,'افتتاح محمي حقيقي',INITIAL_SETTINGS,`atomic-${suffix}`,false),root=`organizations/${org.id}`,fresh=freshOpeningBooksFixture(org.id,actor.uid),plan={...defaultPlatformPlans(now.toISOString()).find(row=>row.id==='Enterprise')!,id:`atomic-plan-${suffix}`};
  await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:plan.id,subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')});tx.set(`plans/${plan.id}`,plan);for(const [name,rows] of Object.entries(fresh.data))for(const row of rows)tx.set(`${root}/${name}/${name==='accounts'?row.code:row.id}`,row);for(const row of fresh.data.financial_accounts)tx.set(`${root}/financial_account_mappings/${row.account_code}`,{id:row.id});tx.set(`${root}/meta/counters`,{...await tx.get(`${root}/meta/counters`),customer_count:2,product_count:1});});
  const ops=new Operations(store,()=>now,saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}])),run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org.id,actor,{action,data,operationId});
  await run('period.create',{id:'October',start_date:'2026-10-01',end_date:'2026-10-20',reason:'بدء فترة'},`period-${suffix}`);
  const request={input:fresh.input,terms:fresh.terms},preview=await ops.openingPreview(org.id,actor,request),commit={...request,expected_preview_hash:preview.preview_hash};
  const settle=(lot_id:string,amount:number,expected_sequence=0,date='2026-10-02',rate=2500)=>({lot_id,amount,expected_sequence,date,financial_account_id:'usd',currency:'USD',exchange_rate_used:rate,reason:'تسوية ذرية',reference_number:'REF'});
  return {org,root,ops,run,commit,settle};
}
test('C2 real Firestore serializes raced startup and overpayment, closes AR/AP carrying values and denies all opening SDK access',async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/);
  const app=initializeApp({projectId:project},'atomic-opening-admin'),db=getFirestore(app),store=new FirestoreStore(db),rules=await readFile('firestore.rules','utf8'),now=new Date('2026-10-20T12:00:00Z'),actor={uid:'atomic-firestore-owner',email:'atomic-firestore@example.com',emailVerified:true,authTime:now.getTime()/1000};
  try {
    const f=await atomicOpeningSetup(store,actor,now,'race',rules),start=await Promise.allSettled([f.run('opening.commit',f.commit,'atomic-start-one'),f.run('opening.commit',f.commit,'atomic-start-two')]);assert.equal(start.filter(row=>row.status==='fulfilled').length,1);let snapshot=await f.ops.snapshot(f.org.id,actor,true);assert.equal(snapshot.collections.opening_batches.length,1);assert.equal(snapshot.collections.invoices.length+snapshot.collections.purchase_bills.length,0);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
    const ar=snapshot.collections.opening_lots.find(row=>row.party_id==='a')!,ap=snapshot.collections.opening_lots.find(row=>row.party_id==='s')!,raced=await Promise.allSettled([f.run('openingSettlement.create',f.settle(ar.id,2),'atomic-ar-one'),f.run('openingSettlement.create',f.settle(ar.id,2),'atomic-ar-two')]);assert.equal(raced.filter(row=>row.status==='fulfilled').length,1);
    await f.run('openingSettlement.create',f.settle(ap.id,1),'atomic-ap-part');await f.run('openingSettlement.create',f.settle(ap.id,1,1,'2026-10-03',1000),'atomic-ap-final');const final=f.settle(ar.id,1,1,'2026-10-03',1500),result=await f.run('openingSettlement.create',final,'atomic-ar-final');assert.deepEqual(await f.run('openingSettlement.create',final,'atomic-ar-final'),result);
    snapshot=await f.ops.snapshot(f.org.id,actor,true);assert.equal(snapshot.collections.opening_settlements.length,4);assert.equal(snapshot.counters.opening_settlement_count,4);assert.equal(snapshot.collections.customers.find(row=>row.id==='a')!.balance_usd,0);assert.equal(snapshot.collections.suppliers.find(row=>row.id==='s')!.payable_due_sdg,0);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
    for(const uid of [actor.uid,'foreign-atomic-user']){const client=env.authenticatedContext(uid,{email_verified:true}).firestore();for(const name of ['opening_batches','opening_lots','opening_settlements']){await assertFails(getDocs(collection(client,`${f.root}/${name}`)));await assertFails(setDoc(doc(client,`${f.root}/${name}/forged`),{id:'forged',org_id:f.org.id}));}}
    await f.run('period.softClose',{id:'October',expected_revision:1,reason:'وقف التسوية'},'atomic-soft');await assert.rejects(f.run('openingSettlement.create',final,'atomic-ar-final'),/مبدئياً/);
  }finally{await deleteApp(app);}
});
test('C2 real Firestore rejects backdated cash shortage in either book without partial settlement, counter, audit or rate writes',async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/);
  const app=initializeApp({projectId:project},'atomic-cash-admin'),db=getFirestore(app),store=new FirestoreStore(db),rules=await readFile('firestore.rules','utf8'),now=new Date('2026-10-20T12:00:00Z'),actor={uid:'atomic-cash-owner',email:'atomic-cash@example.com',emailVerified:true,authTime:now.getTime()/1000};
  try {
    for(const [suffix,sdg,usd] of [['usd',0,9],['sdg',19999,0]] as const){const f=await atomicOpeningSetup(store,actor,now,`cash-${suffix}`,rules);await f.run('opening.commit',f.commit,`cash-start-${suffix}`);await store.transaction(async tx=>tx.set(`${f.root}/journal_entries/future-spend`,journal('future-spend',f.org.id,actor.uid,'2026-10-10','manual','future-spend','صرف لاحق',[journalLine('5200','صرف',sdg,0,usd,0),journalLine('1120','نقد',0,sdg,0,usd)])));
      const snapshot=await f.ops.snapshot(f.org.id,actor,true),lot=snapshot.collections.opening_lots.find(row=>row.party_id==='s')!,beforeCounters=(await db.doc(`${f.root}/meta/counters`).get()).data(),beforeRate=(await db.doc(`${f.root}/rate_limits/${actor.uid}`).get()).data(),beforeAudit=(await db.collection(`${f.root}/audit_logs`).get()).size;
      await assert.rejects(f.run('openingSettlement.create',f.settle(lot.id,2),`cash-short-${suffix}`),/النقدية/);assert.equal((await db.collection(`${f.root}/opening_settlements`).get()).size,0);assert.equal((await db.collection(`${f.root}/journal_entries`).get()).size,2);assert.deepEqual((await db.doc(`${f.root}/meta/counters`).get()).data(),beforeCounters);assert.deepEqual((await db.doc(`${f.root}/rate_limits/${actor.uid}`).get()).data(),beforeRate);assert.equal((await db.collection(`${f.root}/audit_logs`).get()).size,beforeAudit);assert.equal((await db.doc(`${f.root}/idempotency/cash-short-${suffix}`).get()).exists,false);assert.equal((await db.doc(`${f.root}/suppliers/s`).get()).data()!.payable_due_usd,2);
    }
  }finally{await deleteApp(app);}
});
test('C2 real Firestore race-close versus startup has one valid serial outcome and cannot alter a closed ledger',async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/);
  const app=initializeApp({projectId:project},'atomic-period-admin'),db=getFirestore(app),store=new FirestoreStore(db),rules=await readFile('firestore.rules','utf8'),now=new Date('2026-10-20T12:00:00Z'),actor={uid:'atomic-period-owner',email:'atomic-period@example.com',emailVerified:true,authTime:now.getTime()/1000};
  try {
    const f=await atomicOpeningSetup(store,actor,now,'close',rules),raced=await Promise.allSettled([f.run('period.close',{id:'October',expected_revision:1,reason:'إغلاق متزامن',fx_review_completed:true},'atomic-period-close'),f.run('opening.commit',f.commit,'atomic-period-start')]);assert.equal(raced.filter(row=>row.status==='fulfilled').length,1);const snapshot=await f.ops.snapshot(f.org.id,actor,true),closed=snapshot.collections.accounting_periods[0].status==='CLOSED';assert.equal(closed,raced[0].status==='fulfilled');assert.equal(snapshot.collections.opening_batches.length,closed?0:1);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);if(closed)await assert.rejects(f.run('opening.commit',f.commit,'atomic-period-start'),/نهائياً/);
  }finally{await deleteApp(app);}
});

test('C2 real Firestore preserves opening sources through ordinary sale, protected backup and two nested-tenant restores',async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/);
  const app=initializeApp({projectId:project},'opening-integration-admin'),db=getFirestore(app),store=new FirestoreStore(db),rules=await readFile('firestore.rules','utf8'),now=new Date('2026-10-20T12:00:00Z'),actor={uid:'opening-integration-owner',email:'opening-integration@example.com',emailVerified:true};
  try {
    const organizations=new Organizations(store),org=await organizations.create(actor,'دفاتر الافتتاح',INITIAL_SETTINGS,'opening-integration-org',true),root=`organizations/${org.id}`,plan={...defaultPlatformPlans(now.toISOString()).find(row=>row.id==='Enterprise')!,id:'opening-integration-plan'},data=openingBooksFixture(org.id,actor.uid);
    settleOpeningBooks(data,'a',1);settleOpeningBooks(data,'s',1);
    await store.transaction(async tx=>{const current=await tx.get(root);tx.set(root,{...current,accounting_version:2,planId:plan.id,subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')});tx.set(`plans/${plan.id}`,plan);for(const [name,rows] of Object.entries(data))for(const row of rows)tx.set(`${root}/${name}/${name==='accounts'?row.code:row.id}`,row);});
    const ops=new Operations(store,()=>now,saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}]));
    await ops.execute(org.id,actor,{action:'invoice.create',operationId:'opening-followup-sale',data:{customer_id:'a',issue_date:'2026-10-10',currency_mode:'single_usd',exchange_rate_used:2000,discount_type:'fixed',discount_value:0,items:[{product_id:'p',description:'صنف',unit:'قطعة',quantity:1,unit_price:5,currency:'USD',tax_rate:0,discount_percent:0}]}});
    let backup=await ops.snapshot(org.id,actor,true);assert.deepEqual(reconcileFinancialData(backup.collections as FinancialData,backup.settings,{requireCosting:true}),[]);assert.equal(backup.collections.customers.find(row=>row.id==='a')!.balance_usd,7);
    for(const uid of ['opening-copy-one','opening-copy-two']){
      const destination={...actor,uid},target=await organizations.create(destination,'نسخة أرصدة',INITIAL_SETTINGS,`${uid}-org`,true),path=`organizations/${target.id}`;
      await store.transaction(async tx=>{const current=await tx.get(path);tx.set(path,{...current,planId:plan.id,subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')});});
      const bad=structuredClone(backup);bad.collections.opening_settlements=[];await assert.rejects(ops.execute(target.id,destination,{action:'backup.restore',operationId:`${uid}-bad`,data:{backup:bad}}));assert.equal((await db.collection(`${path}/journal_entries`).get()).size,0);assert.equal((await db.collection(`${path}/opening_batches`).get()).size,0);
      await ops.execute(target.id,destination,{action:'backup.restore',operationId:`${uid}-restore`,data:{backup}});backup=await ops.snapshot(target.id,destination,true);assert.deepEqual(reconcileFinancialData(backup.collections as FinancialData,backup.settings,{requireCosting:true}),[]);assert.equal(backup.org.owner_uid,uid);assert.equal(backup.collections.opening_batches[0].snapshot.org_id,target.id);assert.equal(backup.collections.opening_batches[0].created_by,actor.uid);assert.equal(backup.collections.opening_settlements[0].financial_basis.org_id,target.id);
      const ar=await ops.operationalReport(target.id,destination,'receivables',{}),ap=await ops.payableReports(target.id,destination,{});assert.equal(ar.total_sdg,20000);assert.equal(ar.total_usd,11);assert.equal(ap.total_sdg,3000);assert.equal(ap.total_usd,2);assert.equal(ar.unallocated_sdg,0);assert.equal(ap.unallocated_usd,0);
      const client=env.authenticatedContext(uid,{email_verified:true}).firestore();await assertFails(getDocs(collection(client,`${path}/opening_batches`)));await assertFails(setDoc(doc(client,`${path}/opening_lots/forged`),{id:'forged',org_id:target.id}));
    }
  }finally{await deleteApp(app);}
});

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

test('B2 Firestore transfers cannot race source cash and direct SDK cannot forge mappings or journals',async()=>{
  const app=initializeApp({projectId:project},'test-cash-admin'),db=getFirestore(app);
  try {
    const store=new FirestoreStore(db),actor={uid:'cash-integration-owner',email:'cash-i@example.com',emailVerified:true},org=await new Organizations(store).create(actor,'النقدية',INITIAL_SETTINGS,'cash-integration',true),root=`organizations/${org.id}`;
    await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')}));
    const rules=await readFile('firestore.rules','utf8'),ops=new Operations(store,()=>new Date('2026-10-05T12:00:00Z'),saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}]));
    const {journalLine}=await import('../src/domain/financial');const run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org.id,actor,{action,data,operationId});
    await run('journal.create',{reference_type:'opening_balance',description:'رأس مال',date:'2026-10-01',lines:[journalLine('1110','نقد',1000,0,1,0),journalLine('3100','رأس مال',0,1000,0,1)]},'opening');await run('accounting.activate',{reason:'دفتر مطابق بلا مخزون'},'activate');
    const from=(await run('financialAccount.create',{name:'صندوق',account_code:'1110',currency:'SDG',kind:'cash'},'from')).result,to=(await run('financialAccount.create',{name:'بنك',account_code:'1130',currency:'SDG',kind:'bank'},'to')).result;
    const data={from_id:from.id,to_id:to.id,amount:800,date:'2026-10-05',reason:'تحويل مثبت'};const race=await Promise.allSettled([run('cashTransfer.create',data,'race-a'),run('cashTransfer.create',data,'race-b')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
    const winner=race[0].status==='fulfilled'?'race-a':'race-b';await run('cashTransfer.create',data,winner);const snapshot=await ops.snapshot(org.id,actor,true);assert.equal(snapshot.collections.internal_transfers.length,1);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
    const client=env.authenticatedContext(actor.uid,{email_verified:true}).firestore();for(const name of ['financial_accounts','financial_account_mappings','internal_transfers']){await assertFails(setDoc(doc(client,`${root}/${name}/forged`),{id:'forged'}));await assertFails(getDocs(collection(client,`${root}/${name}`)));}
  } finally {await deleteApp(app);}
});

test('B2 Firestore preserves bank/cash evidence across map ordering, retries and backdated changes; SDK reconciliation access stays denied', async () => {
  const app = initializeApp({ projectId: project }, 'test-reconciliation-admin'), db = getFirestore(app);
  try {
    const store = new FirestoreStore(db), actor = { uid:'reconciliation-integration-owner', email:'r-i@example.com', emailVerified:true };
    const org = await new Organizations(store).create(actor,'مطابقة فعلية',INITIAL_SETTINGS,'reconciliation-integration',true), root=`organizations/${org.id}`;
    await store.transaction(async tx => tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')}));
    const rules=await readFile('firestore.rules','utf8'), ops=new Operations(store,()=>new Date('2026-10-05T12:00:00Z'),saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}]));
    const {journalLine}=await import('../src/domain/financial'); const run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org.id,actor,{action,data,operationId});
    await run('journal.create',{reference_type:'opening_balance',description:'افتتاحي',date:'2026-10-01',lines:[journalLine('1130','بنك',1000,0,.5,0),journalLine('1110','صندوق',500,0,.25,0),journalLine('3100','رأس مال',0,1500,0,.75)]},'opening'); await run('accounting.activate',{reason:'مطابقة بلا مخزون'},'activate');
    const bank=(await run('financialAccount.create',{name:'بنك',account_code:'1130',currency:'SDG',kind:'bank'},'bank')).result,cash=(await run('financialAccount.create',{name:'صندوق',account_code:'1110',currency:'SDG',kind:'cash'},'cash')).result;
    const data={financial_account_id:bank.id,period:{start:'2026-10-01',end:'2026-10-05'},statement_opening:0,statement_closing:1000,statement_lines:[{id:'deposit',date:'2026-10-01',direction:'inflow',amount:1000,reference:'OPEN',description:''}],matches:[{statement_line_id:'deposit',journal_id:'jv-opening',line_index:0}]};
    const duplicate=await Promise.all([run('bankReconciliation.create',data,'capture'),run('bankReconciliation.create',data,'capture')]);assert.equal(duplicate[0].result.id,duplicate[1].result.id);
    await run('cashCount.create',{financial_account_id:cash.id,date:'2026-10-05',actual_count:480,difference_reason:'نقص عند الجرد'},'count');
    let report=await ops.cashReconciliationReports(org.id,actor);assert.equal(report.accounts.find(a=>a.financial_account_id===bank.id)!.current_status,'matched');assert.equal(report.accounts.find(a=>a.financial_account_id===cash.id)!.latest!.difference,-20);
    await run('journal.create',{reference_type:'manual',date:'2026-10-02',description:'حركة جديدة متعادلة',lines:[journalLine('1130','بنك',10,0,.01,0),journalLine('1130','بنك',0,10,0,.01)]},'backdate');
    report=await ops.cashReconciliationReports(org.id,actor);assert.equal(report.accounts.find(a=>a.financial_account_id===bank.id)!.current_status,'stale');
    const snapshot=await ops.snapshot(org.id,actor,true);assert.equal(snapshot.collections.bank_reconciliations.length,1);assert.equal(snapshot.collections.cash_reconciliations.length,1);assert.equal(snapshot.collections.journal_entries.length,2);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
    const client=env.authenticatedContext(actor.uid,{email_verified:true}).firestore();for(const name of ['bank_reconciliations','cash_reconciliations']){await assertFails(setDoc(doc(client,`${root}/${name}/forged`),{id:'forged'}));await assertFails(getDocs(collection(client,`${root}/${name}`)));}
  } finally { await deleteApp(app); }
});

test('B3 Firestore source corrections, overreturn/refund races and SDK restrictions commit stock, AR, audit and journals atomically', async () => {
  const app = initializeApp({ projectId: project }, 'test-correction-admin'), db = getFirestore(app);
  try {
    const store = new FirestoreStore(db), actor = { uid: 'correction-integration-owner', email: 'credit-i@example.com', emailVerified: true };
    const org = await new Organizations(store).create(actor, 'مردودات موثقة', INITIAL_SETTINGS, 'correction-integration', true), root = `organizations/${org.id}`;
    await store.transaction(async tx => tx.set(root, { ...await tx.get(root), planId: 'Enterprise', subscriptionEnd: '2027-01-01', subscriptionEndMillis: Date.parse('2027-01-01') }));
    const rules = await readFile('firestore.rules', 'utf8'), ops = new Operations(store, () => new Date('2026-10-07T12:00:00Z'), saved => saved as any, async () => verifyAccountingRulesSource([{ content: rules }]));
    const run = (action: string, data: Record<string, unknown>, operationId: string) => ops.execute(org.id, actor, { action, data, operationId });
    const customer = (await run('customer.create', { name: 'عميل', phone: '', preferred_currency: 'USD' }, 'customer')).result;
    const product = (await run('product.create', { name: 'صنف', unit: 'قطعة', price_sdg: 200000, price_usd: 100, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: 10 }, 'product')).result;
    await run('product.cost.establish', { id: product.id, cost_currency: 'USD', unit_cost: 20, exchange_rate_used: 2000, reason: 'افتتاحي' }, 'cost'); await run('accounting.activate', { reason: 'مطابقة' }, 'activate');
    const item = { product_id: product.id, description: 'صنف', unit: 'قطعة', quantity: 1, unit_price: 100, currency: 'USD', tax_rate: 0, discount_percent: 0 };
    const invoice = (await run('invoice.create', { customer_id: customer.id, issue_date: '2026-10-07', currency_mode: 'single_usd', exchange_rate_used: 2000, discount_type: 'fixed', discount_value: 0, items: [item, { ...item, quantity: 2 }] }, 'sale')).result;
    await run('payment.create', { invoice_id: invoice.id, amount: 300, currency: 'USD', exchange_rate_used: 2000, payment_method: 'cash' }, 'pay');
    const cash = (await run('financialAccount.create', { name: 'صندوق دولار', account_code: '1120', currency: 'USD', kind: 'cash' }, 'cash')).result;
    const note = { invoice_id: invoice.id, date: '2026-10-07', kind: 'sales_return', reason: 'رد موثق', lines: [{ line_id: 'line-1', quantity: 1 }, { line_id: 'line-2', quantity: 2 }] };
    const returns = await Promise.allSettled([run('creditNote.create', note, 'return-a'), run('creditNote.create', note, 'return-b')]); assert.equal(returns.filter(row => row.status === 'fulfilled').length, 1);
    const winner = returns[0].status === 'fulfilled' ? 'return-a' : 'return-b'; await run('creditNote.create', note, winner);
    const refund = { invoice_id: invoice.id, date: '2026-10-07', financial_account_id: cash.id, amount: 250, exchange_rate_used: 3000, reason: 'رد نقدي' };
    const refunds = await Promise.allSettled([run('customerRefund.create', refund, 'refund-a'), run('customerRefund.create', refund, 'refund-b')]); assert.equal(refunds.filter(row => row.status === 'fulfilled').length, 1);
    await run('customerRefund.create', refund, refunds[0].status === 'fulfilled' ? 'refund-a' : 'refund-b');
    const snapshot = await ops.snapshot(org.id, actor, true); assert.equal(snapshot.collections.credit_notes.length, 1); assert.equal(snapshot.collections.customer_refunds.length, 1); assert.equal(snapshot.collections.products[0].stock_quantity, 10); assert.equal(snapshot.collections.products[0].inventory_value_usd, 200); assert.equal(snapshot.collections.customers[0].balance_usd, -50); assert.equal(snapshot.collections.inventory_movements.filter(row => row.reference_type === 'credit_note').length, 1);
    assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings, { requireCosting: true }), []);
    const report = await ops.operationalReport(org.id, actor, 'receivables', { end: '2026-10-07' }); assert.equal(report.unallocated_usd, 0); assert.equal(report.aging[0].credit_usd, 50);
    const before = (await db.doc(`${root}/meta/counters`).get()).data(); await assert.rejects(run('invoice.void', { id: invoice.id, reason: 'تجاوز' }, 'void'), /المصححة/); assert.deepEqual((await db.doc(`${root}/meta/counters`).get()).data(), before);
    for (const uid of [actor.uid, 'foreign']) {
      const client = env.authenticatedContext(uid, { email_verified: true }).firestore();
      for (const name of ['credit_notes', 'customer_refunds']) { await assertFails(setDoc(doc(client, `${root}/${name}/forged`), { id: 'forged' })); await assertFails(getDocs(collection(client, `${root}/${name}`))); }
      await assertFails(setDoc(doc(client, `${root}/invoices/${invoice.id}`), { credit_balance_usd: 999 }, { merge: true }));
    }
    await store.transaction(async tx => tx.set(root, { ...await tx.get(root), subscriptionEnd: '2026-10-01', subscriptionEndMillis: Date.parse('2026-10-01') })); await assert.rejects(run('creditNote.create', note, winner), /انتهى|منتهي|الاشتراك/);
  } finally { await deleteApp(app); }
});

test('B3 Firestore purchase return/reimbursement races preserve original credit, WAC variance, AP and SDK isolation atomically',async()=>{
  const app=initializeApp({projectId:project},'test-purchase-return-admin'),db=getFirestore(app);
  try {
    const store=new FirestoreStore(db),actor={uid:'purchase-correction-integration',email:'purchase-i@example.com',emailVerified:true},org=await new Organizations(store).create(actor,'تصحيح المورد',INITIAL_SETTINGS,'purchase-correction',true),root=`organizations/${org.id}`;
    await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')}));
    const rules=await readFile('firestore.rules','utf8'),ops=new Operations(store,()=>new Date('2026-10-07T12:00:00Z'),saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}]));
    const run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org.id,actor,{action,data,operationId});
    const supplier=(await run('supplier.create',{name:'المورد',default_currency:'USD'},'supplier')).result,product=(await run('product.create',{name:'صنف',unit:'قطعة',price_sdg:100000,price_usd:50,is_active:true,track_inventory:true,stock_quantity:10},'product')).result;
    await run('product.cost.establish',{id:product.id,cost_currency:'USD',unit_cost:10,exchange_rate_used:2000,reason:'افتتاحي'},'cost');await run('accounting.activate',{reason:'مطابقة'},'activate');
    const bill=(await run('purchase.create',{supplier_id:supplier.id,supplier_reference:'RETURN-1',issue_date:'2026-10-07',currency:'USD',exchange_rate_used:2000,settlement:'cash',payment_method:'cash',reason:'شراء',items:[{product_id:product.id,quantity:1,unit_cost:20},{product_id:product.id,quantity:2,unit_cost:20}]},'buy')).result;
    const cash=(await run('financialAccount.create',{name:'حساب استرداد',account_code:'1120',currency:'USD',kind:'cash'},'cash')).result;
    const returned={bill_id:bill.id,date:'2026-10-07',reason:'مردود مثبت',lines:[{line_id:'line-1',quantity:1},{line_id:'line-2',quantity:2}]},race=await Promise.allSettled(['a','b'].map(id=>run('purchaseReturn.create',returned,`return-${id}`)));assert.equal(race.filter(row=>row.status==='fulfilled').length,1);const winner=race[0].status==='fulfilled'?'return-a':'return-b';await run('purchaseReturn.create',returned,winner);
    const refund={bill_id:bill.id,date:'2026-10-07',reason:'استرداد موثق',financial_account_id:cash.id,amount:50,exchange_rate_used:3000},refundRace=await Promise.allSettled(['a','b'].map(id=>run('supplierRefund.create',refund,`refund-${id}`)));assert.equal(refundRace.filter(row=>row.status==='fulfilled').length,1);await run('supplierRefund.create',refund,refundRace[0].status==='fulfilled'?'refund-a':'refund-b');
    const snapshot=await ops.snapshot(org.id,actor,true);assert.equal(snapshot.collections.purchase_returns.length,1);assert.equal(snapshot.collections.supplier_refunds.length,1);assert.equal(snapshot.collections.purchase_returns[0].supplier_credit_usd,60);assert.equal(snapshot.collections.purchase_returns[0].inventory_out_usd,36.92);assert.equal(snapshot.collections.purchase_returns[0].variance_usd,23.08);assert.equal(snapshot.collections.purchase_bills[0].advance_balance_usd,10);assert.equal(snapshot.collections.products[0].stock_quantity,10);assert.equal(snapshot.collections.inventory_movements.filter(m=>m.reference_type==='purchase_return').length,1);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
    const report=await ops.payableReports(org.id,actor,{end:'2026-10-07'});assert.equal(report.total_usd,-10);assert.equal(report.unallocated_usd,0);assert.equal(report.aging[0].advance_usd,10);
    const before=(await db.doc(`${root}/meta/counters`).get()).data();await assert.rejects(run('supplierRefund.create',{...refund,amount:11},'overrefund'));assert.deepEqual((await db.doc(`${root}/meta/counters`).get()).data(),before);
    for(const uid of [actor.uid,'foreign']){const client=env.authenticatedContext(uid,{email_verified:true}).firestore();for(const name of ['purchase_returns','supplier_refunds']){await assertFails(setDoc(doc(client,`${root}/${name}/forged`),{id:'forged'}));await assertFails(getDocs(collection(client,`${root}/${name}`)));}await assertFails(setDoc(doc(client,`${root}/purchase_bills/${bill.id}`),{advance_balance_usd:999},{merge:true}));}
    await store.transaction(async tx=>tx.set(root,{...await tx.get(root),subscriptionEnd:'2026-10-01',subscriptionEndMillis:Date.parse('2026-10-01')}));await assert.rejects(run('purchaseReturn.create',returned,winner),/انتهى|منتهي|الاشتراك/);
  }finally{await deleteApp(app);}
});

test('B3 Firestore independent document exports and restored audit archives retain exact source evidence across map ordering without SDK grants',async()=>{
  const {correctionDocumentFixture}=await import('./ui/helpers/correctionDocuments');const f=await correctionDocumentFixture(),app=initializeApp({projectId:project},'document-archive-admin'),db=getFirestore(app),rules=await readFile('firestore.rules','utf8'),actor={uid:'guest',email:'guest@example.com',emailVerified:true};
  try {
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST);const store=new FirestoreStore(db);await store.transaction(async tx=>{for(const [path,row] of Object.entries(f.records))tx.set(path,row);tx.set(f.root,{...f.records[f.root],planId:'Enterprise',subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')});});
    const ops=new Operations(store,()=>new Date('2026-10-07T12:00:00Z'),saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}]));
    for(const [kind,id] of f.documents){const response=await ops.execute(f.records[f.root].id,actor,{action:'correctionDocument.export',data:{kind,id},operationId:`export-${id}`});assert.equal(response.result.document.id,id);assert.deepEqual(await ops.execute(f.records[f.root].id,actor,{action:'correctionDocument.export',data:{kind,id},operationId:`export-${id}`}),response);}
    const backup=await ops.snapshot(f.records[f.root].id,actor,true),restorer={uid:'document-restorer',email:'restorer@example.com',emailVerified:true},target=await new Organizations(store).create(restorer,'أرشيف مستعاد',INITIAL_SETTINGS,'archive-target',true),root=`organizations/${target.id}`;
    await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')}));await ops.execute(target.id,restorer,{action:'backup.restore',data:{backup},operationId:'archive-restore'});const restored=await ops.snapshot(target.id,restorer,true);assert.equal(restored.collections.audit_archives.length,backup.collections.audit_logs.length);for(const archive of restored.collections.audit_archives)assert.deepEqual(archive.source_event,backup.collections.audit_logs.find(row=>row.id===archive.source_event.id));assert.equal(restored.org.owner_uid,restorer.uid);assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData,restored.settings,{requireCosting:true}),[]);
    const direct=env.authenticatedContext(restorer.uid,{email:restorer.email,email_verified:true}).firestore();await assertFails(getDocs(collection(direct,`${root}/audit_archives`)));await assertFails(setDoc(doc(direct,`${root}/audit_archives/forged`),{id:'forged'}));await assertFails(getDocs(collection(env.authenticatedContext('guest',{email:actor.email,email_verified:true}).firestore(),`${root}/invoices`)));
    const first=restored.collections.audit_archives[0];await store.transaction(async tx=>tx.set(`${root}/audit_archives/${first.id}`,{...first,source_event:{...first.source_event,action:'forged'}}));await assert.rejects(ops.snapshot(target.id,restorer,true),/بصمة أرشيف/);
  } finally {await deleteApp(app);}
});

test('C1 real Firestore serializes period close against a posting, protects SDK access and preserves closed periods across restore',async()=>{
  const app=initializeApp({projectId:project},'period-guard-admin'),db=getFirestore(app),store=new FirestoreStore(db),rules=await readFile('firestore.rules','utf8'),now=new Date('2026-10-07T12:00:00Z'),actor={uid:'period-rules-owner',email:'period@example.com',emailVerified:true,authTime:now.getTime()/1000};
  try {
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
    const org=await new Organizations(store).create(actor,'فترات حقيقية',INITIAL_SETTINGS,'period-rules-org',true),root=`organizations/${org.id}`;
    await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')}));
    const ops=new Operations(store,()=>now,saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}])),run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org.id,actor,{action,data,operationId});
    await run('accounting.activate',{reason:'تفعيل الفترات'},'period-activate');
    await run('account.create',{code:'1500',name_ar:'أصل المراجعة',type:'ASSET',nature:'DEBIT',reporting_group:'fixed_assets',is_active:true},'period-asset');
    await run('period.create',{id:'2026-10',start_date:'2026-10-01',end_date:'2026-10-07',reason:'الفترة الحالية'},'create-period');
    await run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة'},'soft-period');
    const posting={reference_type:'manual',date:'2026-10-07',description:'تسوية متزامنة',adjusting:true,reason:'تسوية أثناء المراجعة',lines:[{account_code:'1500',debit_sdg:100,credit_sdg:0,debit_usd:.05,credit_usd:0},{account_code:'3100',debit_sdg:0,credit_sdg:100,debit_usd:0,credit_usd:.05}]};
    const raced=await Promise.allSettled([run('period.close',{id:'2026-10',expected_revision:2,reason:'إغلاق مع السباق',fx_review_completed:true},'close-period'),run('journal.create',posting,'raced-period-post')]);
    assert.equal(raced[0].status,'fulfilled');const snapshot=await ops.snapshot(org.id,actor,true),closed=snapshot.collections.accounting_periods[0];assert.equal(closed.status,'CLOSED');assert.equal(closed.close_evidence.ledger_hash,await (await import('../src/domain/periodContracts')).periodLedgerHash(snapshot.collections.journal_entries,'2026-10-07'));
    const postingSaved=snapshot.collections.journal_entries.some(row=>row.id==='jv-raced-period-post');assert.equal(postingSaved,raced[1].status==='fulfilled');
    await assert.rejects(run('journal.create',posting,'raced-period-post'),/نهائياً/);
    const client=env.authenticatedContext(actor.uid,{email:actor.email,email_verified:true}).firestore();await assertFails(getDocs(collection(client,`${root}/accounting_periods`)));await assertFails(setDoc(doc(client,`${root}/accounting_periods/2026-10`),{status:'REOPENED'},{merge:true}));
    await assert.rejects(ops.execute(org.id,{...actor,authTime:actor.authTime-301},{action:'period.reopen',data:{id:'2026-10',expected_revision:3,reason:'تجاوز'},operationId:'old-period-login'}),/التحقق/);
    const targetOwner={...actor,uid:'period-restorer',email:'restore-period@example.com'},target=await new Organizations(store).create(targetOwner,'فترات مستعادة',INITIAL_SETTINGS,'period-restore-org',true),targetRoot=`organizations/${target.id}`;await store.transaction(async tx=>tx.set(targetRoot,{...await tx.get(targetRoot),planId:'Enterprise',subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')}));
    await ops.execute(target.id,targetOwner,{action:'backup.restore',data:{backup:snapshot},operationId:'restore-period-rules'});const restored=await ops.snapshot(target.id,targetOwner,true);assert.equal(restored.collections.accounting_periods[0].close_evidence.ledger_hash,closed.close_evidence.ledger_hash);assert.equal(restored.org.owner_uid,targetOwner.uid);
    await run('period.reopen',{id:'2026-10',expected_revision:3,reason:'إعادة فتح موثقة'},'fresh-period-reopen');const audit=(await db.doc(`${root}/audit_logs/audit-fresh-period-reopen`).get()).data()!;assert.equal(audit.previous_state[`${root}/accounting_periods/2026-10`].status,'CLOSED');assert.equal(audit.new_state[`${root}/accounting_periods/2026-10`].status,'REOPENED');
  }finally{await deleteApp(app);}
});

test('C2 protected opening preview reads real Firestore zero initialization without writes, rechecks live catalog and denies opening SDK access',async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/);
  const app=initializeApp({projectId:project},'opening-preview-admin'),db=getFirestore(app),store=new FirestoreStore(db),rules=await readFile('firestore.rules','utf8'),now=new Date('2026-10-08T12:00:00Z'),actor={uid:'opening-rules-owner',email:'opening-rules@example.com',emailVerified:true};
  try {
    const org=await new Organizations(store).create(actor,'معاينة افتتاح حقيقية',INITIAL_SETTINGS,'opening-preview-org',true),root=`organizations/${org.id}`,plan={...defaultPlatformPlans(now.toISOString()).find(row=>row.id==='Enterprise')!,id:'opening-preview-plan'};
    await store.transaction(async tx=>{const current=await tx.get(root);tx.set(root,{...current,planId:plan.id,subscriptionEnd:'2027-01-01',subscriptionEndMillis:Date.parse('2027-01-01')});tx.set(`plans/${plan.id}`,plan);tx.set(`${root}/members/opening-rules-accountant`,{uid:'opening-rules-accountant',org_id:org.id,role:'Accountant',status:'active'});});
    const ops=new Operations(store,()=>now,saved=>saved as any,async()=>verifyAccountingRulesSource([{content:rules}])),run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org.id,actor,{action,data,operationId});
    await run('accounting.activate',{reason:'بدء مؤسسة بلا حركة مالية'},'opening-activate');await run('period.create',{id:'2026-10',start_date:'2026-10-01',end_date:'2026-10-31',reason:'الفترة الأولى'},'opening-period');
    const cash=(await run('financialAccount.create',{name:'صندوق الافتتاح',account_code:'1110',currency:'SDG',kind:'cash'},'opening-cash')).result,product=(await run('product.create',{name:'صنف صفري',unit:'قطعة',price_sdg:2000,price_usd:1,is_active:true,track_inventory:true,stock_quantity:0},'opening-product')).result;
    const request={input:{batch_id:'startup',date:'2026-10-01',reason:'معاينة دون ترحيل',currency_policy:'dual' as const,cash:[{id:cash.id,currency:'SDG' as const,amount:1000,exchange_rate_used:2000}],receivables:[],payables:[],inventory:[{id:product.id,currency:'USD' as const,quantity:2,unit_cost:3,exchange_rate_used:2000}],capital:{sdg:13000,usd:6.5}},terms:[]};
    const before=(await db.doc(`${root}/meta/counters`).get()).data(),sourceBefore=(await db.collection(`${root}/inventory_movements`).get()).docs.map(row=>row.data());
    const preview=await ops.openingPreview(org.id,actor,request),again=await ops.openingPreview(org.id,{...actor,uid:'opening-rules-accountant'},request);assert.equal(preview.preview_hash,again.preview_hash);assert.equal(preview.source_count,2);assert.equal(preview.quote.total_debit_sdg,13000);assert.equal(preview.quote.is_balanced,true);assert.equal(preview.posting_available,true);assert.equal(again.posting_available,false);
    assert.deepEqual((await db.doc(`${root}/meta/counters`).get()).data(),before);assert.deepEqual((await db.collection(`${root}/inventory_movements`).get()).docs.map(row=>row.data()),sourceBefore);for(const name of ['journal_entries','opening_batches','opening_lots','opening_settlements'])assert.equal((await db.collection(`${root}/${name}`).get()).size,0);
    for(const uid of [actor.uid,'foreign-opening-user']){const client=env.authenticatedContext(uid,{email_verified:true}).firestore();for(const name of ['opening_batches','opening_lots','opening_settlements']){await assertFails(getDocs(collection(client,`${root}/${name}`)));await assertFails(setDoc(doc(client,`${root}/${name}/forged`),{id:'forged',org_id:org.id}));}}
    await store.transaction(async tx=>tx.set(`plans/${plan.id}`,{...plan,features:{...plan.features,multi_currency:false}}));await assert.rejects(ops.openingPreview(org.id,actor,request),/ميزة/);assert.deepEqual((await db.doc(`${root}/meta/counters`).get()).data(),before);
    await store.transaction(async tx=>tx.set(`plans/${plan.id}`,plan));await run('period.softClose',{id:'2026-10',expected_revision:1,reason:'إيقاف المعاينة للفترة'},'opening-soft');await assert.rejects(ops.openingPreview(org.id,actor,request),/مبدئياً/);
  }finally{await deleteApp(app);}
});

test('C2.3 real Firestore serializes owner drawings, returns one duplicate and denies every owner/foreign direct SDK source read/write',async()=>{
  const {equityFixture,equityOwner}=await import('./fixtures/ownerEquity');
  const app=initializeApp({projectId:project},'owner-equity-atomic'),db=getFirestore(app),store=new FirestoreStore(db),rules=await readFile('firestore.rules','utf8');
  try {
    const f=await equityFixture(store,equityOwner,async()=>{await verifyAccountingRulesSource([{content:rules}]);});
    const race=await Promise.allSettled([f.run('ownerEquity.create',f.input('drawing',800),'fs-draw-one'),f.run('ownerEquity.create',f.input('drawing',800),'fs-draw-two')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    const data=f.input('drawing',100),dupe=await Promise.all([f.run('ownerEquity.create',data,'fs-same'),f.run('ownerEquity.create',data,'fs-same')]);assert.deepEqual(dupe[0],dupe[1]);
    const snapshot=await f.snapshot();assert.equal(snapshot.collections.owner_equity_events.length,3);assert.equal(snapshot.counters.owner_equity_event_count,3);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
    for(const uid of [equityOwner.uid,'foreign-equity-sdk']){const client=env.authenticatedContext(uid,{email_verified:true}).firestore();await assertFails(getDocs(collection(client,`${f.root}/owner_equity_events`)));await assertFails(getDoc(doc(client,`${f.root}/owner_equity_events/oe-equity-funding`)));await assertFails(setDoc(doc(client,`${f.root}/owner_equity_events/forged`),{id:'forged',org_id:f.org.id}));}
    const beforeCounters=(await db.doc(`${f.root}/meta/counters`).get()).data(),beforeSources=(await db.collection(`${f.root}/owner_equity_events`).get()).size;await assert.rejects(f.run('ownerEquity.create',f.input('drawing',101),'fs-no-funds'));assert.deepEqual((await db.doc(`${f.root}/meta/counters`).get()).data(),beforeCounters);assert.equal((await db.collection(`${f.root}/owner_equity_events`).get()).size,beforeSources);assert.equal((await db.doc(`${f.root}/idempotency/fs-no-funds`).get()).exists,false);
  }finally{await deleteApp(app);}
});
test('C2.3 real Firestore restores original equity sources twice with exact nested tenant and journal proof, rejecting a dropped source first',async()=>{
  const {equityFixture,equityOwner}=await import('./fixtures/ownerEquity');const app=initializeApp({projectId:project},'owner-equity-restore'),db=getFirestore(app),store=new FirestoreStore(db),rules=await readFile('firestore.rules','utf8');
  try {
    const f=await equityFixture(store,{...equityOwner,uid:'equity-fs-backup-owner'},async()=>{await verifyAccountingRulesSource([{content:rules}]);});await f.run('ownerEquity.create',f.input('drawing',250),'fs-backup-draw');let backup=await f.snapshot();
    for(const uid of ['equity-fs-copy-one','equity-fs-copy-two']){const actor={...equityOwner,uid},org=await new Organizations(store).create(actor,'استعادة رأس المال',INITIAL_SETTINGS,uid,true),root=`organizations/${org.id}`;await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));const bad=structuredClone(backup);delete (bad.collections as any).owner_equity_events;await assert.rejects(f.ops.execute(org.id,actor,{action:'backup.restore',data:{backup:bad},operationId:uid+'-bad'}));assert.equal((await db.collection(`${root}/journal_entries`).get()).size,0);
      await f.ops.execute(org.id,actor,{action:'backup.restore',data:{backup},operationId:uid+'-restore'});backup=await f.ops.snapshot(org.id,actor,true);assert.equal(backup.collections.owner_equity_events.length,2);assert.equal(backup.collections.owner_equity_events[0].account_basis[0].org_id,org.id);assert.deepEqual(reconcileFinancialData(backup.collections as FinancialData,backup.settings,{requireCosting:true}),[]);
    }
  }finally{await deleteApp(app);}
});
