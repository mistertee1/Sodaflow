import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ResilientStore } from '../server/resilientStore';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import { usdPricingFixture } from './helpers/usdPricing';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
let app:App, env:RulesTestEnvironment, store:ResilientStore;
before(async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/,'Synthetic writes only to demo-sudaflow Emulator');
  const rules=fs.readFileSync('firestore.rules','utf8');
  env=await initializeTestEnvironment({projectId:'demo-sudaflow',firestore:{host:'127.0.0.1',port:8091,rules}});
  app=initializeApp({projectId:'demo-sudaflow'},'usd-pricing-acceptance');store=new ResilientStore(getFirestore(app));
});
after(async()=>{if(env)await env.cleanup();if(app)await deleteApp(app);});
const verify=async()=>verifyAccountingRulesSource([{content:fs.readFileSync('firestore.rules','utf8')}]);

test('USD pricing on real Firestore: original purchase cost survives new FX, automatic sale is idempotent and no direct client can replace price evidence',async()=>{
  const f=await usdPricingFixture(store,'emulator-example',verify);const purchase=(await f.purchase()).result;
  const line=await f.line();assert.equal(line.unit_price,1500);
  const data=f.invoice([line]),sale=await f.run('invoice.create',data,'sale');assert.deepEqual(await f.run('invoice.create',data,'sale'),sale);
  assert.equal(sale.result.cogs_sdg,1000);assert.equal(sale.result.cogs_usd,.5);
  const s=await f.snapshot();assert.deepEqual(s.collections.purchase_bills[0],purchase);assert.equal(s.collections.invoices.length,1);
  assert.deepEqual(reconcileFinancialData(s.collections as FinancialData,s.settings,{requireCosting:true}),[]);
  const client=env.authenticatedContext(f.owner.uid,{email:f.owner.email,email_verified:true}).firestore();
  assert.equal((await getDoc(doc(client,`${f.root}/products/${f.product.id}`))).exists(),true);
  await assertFails(setDoc(doc(client,`${f.root}/products/${f.product.id}`),{pricing_reference_usd:.01},{merge:true}));
  await assertFails(setDoc(doc(client,`${f.root}/invoices/${sale.result.id}`),{items:[{...line,unit_price:1}]},{merge:true}));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),`${f.root}/products/${f.product.id}`)));
});

test('USD pricing on real Firestore: stale cost-plus preview fails atomically and concurrent sales cannot oversell',async()=>{
  const f=await usdPricingFixture(store,'emulator-stale',verify);await f.purchase('only',1);const stale=await f.line();
  await f.run('product.update',{id:f.product.id,updates:{pricing_markup_percent:20}});const before=await f.snapshot();
  await assert.rejects(f.run('invoice.create',f.invoice([stale]),'stale'),(e:any)=>e.status===409);const after = await f.snapshot(); assert.deepEqual(after.collections,before.collections); assert.deepEqual(after.counters,before.counters); assert.deepEqual(after.org,before.org);
  const line=await f.line();const results=await Promise.allSettled([f.run('invoice.create',f.invoice([line]),'race-a'),f.run('invoice.create',f.invoice([line]),'race-b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.snapshot()).collections.invoices.length,1);
});
