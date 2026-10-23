import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { catalogFixture } from './helpers/catalog';
import { assertAvailableProductName, normalizeProductName, productNameKey, productDuplicateGroups } from '../src/domain/productIdentity';
import { MemoryStore } from '../src/domain/store';
import { createApi } from '../server/api';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';

const duplicate=(e:unknown)=>(e as any).status===409&&(e as any).code==='duplicate_product';

test('product names ignore case, spacing, presentation forms and decorative marks while preserving different sizes and letters',async()=>{
  assert.equal(normalizeProductName('  Sugar  BOX  '),'sugar box');assert.equal(normalizeProductName('Sugar\u00a0Box'),'sugar box');
  assert.equal(normalizeProductName('سُكــر'),'سكر');assert.equal(normalizeProductName('\u200fسكر\u200e'),'سكر');
  assert.equal(normalizeProductName('Ｓｕｇａｒ'),'sugar');assert.equal(normalizeProductName('ﺳﻜﺮ'),'سكر');
  assert.notEqual(normalizeProductName('سكر 1 كجم'),normalizeProductName('سكر 5 كجم'));assert.notEqual(normalizeProductName('أرز'),normalizeProductName('ارز'));
  assert.throws(()=>normalizeProductName('ــُّ'));assert.throws(()=>normalizeProductName('  '));
  assert.equal(await productNameKey(' Sugar Box '),await productNameKey('sugar   box'));assert.match(await productNameKey('سكر'),/^[a-f0-9]{64}$/);
});

test('create rejects a differently spaced/cased duplicate with no stock, counter, audit or operation-cache side effects',async()=>{
  const f=await catalogFixture();await f.create('Sugar Box','first');const before=(f.store as MemoryStore).dump();
  await assert.rejects(f.create(' sugar  BOX ','second'),duplicate);assert.deepEqual((f.store as MemoryStore).dump(),before);
  const key=await productNameKey('Sugar Box');assert.equal(before[`${f.root}/product_names/${key}`].product_id,'prd-first');
});

test('the same retry remains idempotent but a new operation ID cannot create another product with the same name',async()=>{
  const f=await catalogFixture();const first=await f.create('منتج واحد','once');assert.deepEqual(await f.create('منتج واحد','once'),first);
  await assert.rejects(f.create('منتج واحد','different'),duplicate);assert.equal((await f.snapshot()).collections.products.length,1);
});

test('concurrent differently named requests for the same normalized identity reserve exactly one product and claim',async()=>{
  const f=await catalogFixture();const results=await Promise.allSettled([f.create('  Test ITEM','race-a'),f.create('test   item  ','race-b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const snapshot=await f.snapshot();assert.equal(snapshot.collections.products.length,1);assert.equal(snapshot.counters.product_count,1);
  assert.equal(Object.keys((f.store as MemoryStore).dump()).filter(p=>p.startsWith(`${f.root}/product_names/`)).length,1);
});

test('inactive and legacy products without claims still prevent new duplicates, including Arabic decorative aliases',async()=>{
  const f=await catalogFixture();const p=(await f.create('سكر','old')).result;await f.run('product.update',{id:p.id,updates:{is_active:false}});
  await f.store.transaction(async tx=>tx.delete(`${f.root}/product_names/${await productNameKey(p.name)}`));
  await assert.rejects(f.create('سُكــر','new'),duplicate);assert.equal((await f.snapshot()).collections.products.length,1);
});

test('rename collisions are rejected atomically, own name edits work and old names are released only by their owner',async()=>{
  const f=await catalogFixture(),a=(await f.create('Apple','apple')).result,b=(await f.create('Banana','banana')).result;
  await assert.rejects(f.run('product.update',{id:a.id,updates:{name:' BANANA '}},'bad-rename'),duplicate);
  await f.run('product.update',{id:a.id,updates:{name:' APPLE ',price_usd:1}},'own-name');
  await f.run('product.update',{id:a.id,updates:{name:'Pear'}},'rename');await f.create('apple','new-apple');
  const data=(f.store as MemoryStore).dump();assert.equal(data[`${f.root}/product_names/${await productNameKey('Banana')}`].product_id,b.id);
  assert.equal(data[`${f.root}/product_names/${await productNameKey('Pear')}`].product_id,a.id);
});

test('preexisting duplicate IDs and stock remain intact; ordinary edits work, new collisions do not, and review groups identify both',async()=>{
  const f=await catalogFixture();const first=(await f.create('Legacy Name','legacy')).result;
  await f.store.transaction(async tx=>tx.set(`${f.root}/products/legacy-copy`,{...first,id:'legacy-copy',name:' legacy  NAME ',stock_quantity:7}));
  await f.run('product.update',{id:'legacy-copy',updates:{price_usd:2}},'metadata');const s=await f.snapshot();
  assert.equal(s.collections.products.find(p=>p.id==='legacy-copy')!.stock_quantity,7);assert.equal(s.collections.products.length,2);
  assert.equal(productDuplicateGroups(s.collections.products as any).length,1);assertAvailableProductName(s.collections.products as any,'legacy NAME','legacy-copy',' legacy  NAME ');
  await assert.rejects(f.create('LEGACY NAME','third'),duplicate);
  await f.run('product.update',{id:'legacy-copy',updates:{name:'Legacy Name 5 kg'}},'resolve');assert.equal(productDuplicateGroups((await f.snapshot()).collections.products as any).length,0);
});

test('deleting an unlinked product releases its own claim; deleting a financially linked product keeps both source and claim',async()=>{
  const f=await catalogFixture();const a=(await f.create('Reusable','reusable')).result;await f.run('product.delete',{id:a.id});await f.create('Reusable','replacement');
  const customer=(await f.run('customer.create',{name:'عميل',phone:'',preferred_currency:'SDG'})).result;
  await f.run('invoice.create',{customer_id:customer.id,issue_date:'2026-10-23',currency_mode:'dual',exchange_rate_used:2000,discount_type:'fixed',discount_value:0,items:[{id:'one',product_id:'prd-replacement',description:'Reusable',unit:'قطعة',quantity:1,unit_price:1000,currency:'SDG',tax_rate:0,discount_percent:0,line_total:1000}]});
  await assert.rejects(f.run('product.delete',{id:'prd-replacement'}),/مرتبط/);await assert.rejects(f.create('reusable'),duplicate);
  const snapshot=await f.snapshot();assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings),[]);
});

test('orphaned technical reservations can be reclaimed without renaming or deleting a surviving product',async()=>{
  const f=await catalogFixture();const hash=await productNameKey('Restored');await f.store.transaction(async tx=>tx.set(`${f.root}/product_names/${hash}`,{product_id:'deleted-product'}));
  const p=(await f.create('Restored','restored')).result;assert.equal((f.store as MemoryStore).dump()[`${f.root}/product_names/${hash}`].product_id,p.id);
});

test('a failed persistence rolls back the claim and retries once without duplicate inventory records',async()=>{
  let fail=false;const store=new MemoryStore({},()=>{if(fail)throw Error('Synthetic persistence failed');});const f=await catalogFixture(store);fail=true;
  await assert.rejects(f.create('Rollback','rollback'),/Synthetic/);assert.equal(store.dump()[`${f.root}/product_names/${await productNameKey('Rollback')}`],undefined);
  fail=false;await f.create('Rollback','rollback');assert.equal((await f.snapshot()).collections.products.length,1);
});

test('the same product name is allowed in separate companies but cross-tenant HTTP access and direct duplicate requests remain denied',async()=>{
  const store=new MemoryStore(),f=await catalogFixture(store,'one'),g=await catalogFixture(store,'two');await f.create('Shared');await g.create('Shared');
  const app=express();app.use(express.json());app.use('/api',createApi({operations:f.ops,verify:async token=>{if(token==='one')return f.actor;if(token==='two')return g.actor;throw Error('invalid token');}}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url=`http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/operations`;
  const post=(token:string)=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'product.create',data:f.input('shared'),operationId:crypto.randomUUID()})});
  try{const response=await post('one');assert.equal(response.status,409);assert.equal((await response.json()).code,'duplicate_product');assert.equal((await post('two')).status,403);assert.equal((await post('invalid')).status,401);}
  finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('backup restore preserves existing duplicate identities and history, then blocks subsequent duplicate creation',async()=>{
  const f=await catalogFixture();const first=(await f.create('Backup Item','source')).result;
  await f.store.transaction(async tx=>tx.set(`${f.root}/products/backup-copy`,{...first,id:'backup-copy',name:' backup ITEM '}));const backup=await f.snapshot();
  const target=await catalogFixture(f.store,'restore');await target.run('backup.restore',{backup},'restore');
  assert.equal((await target.snapshot()).collections.products.length,2);await assert.rejects(target.create('BACKUP ITEM'),duplicate);
});
