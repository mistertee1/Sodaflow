import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { MemoryStore, type Store } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { createDefaultSubscription, getPlanConfig, defaultPlatformPlans } from '../src/lib/plans';
import { createApi } from '../server/api';
import type { OpeningInput } from '../src/domain/openingBalances';
import type { OpeningTerms } from '../src/domain/openingSources';
const now=new Date('2026-10-08T12:00:00Z'),owner:Actor={uid:'opening-owner',email:'opening@example.com',emailVerified:true};
async function fixture() {
  const store=new MemoryStore(),org=await new Organizations(store).create(owner,'بداية النشاط',INITIAL_SETTINGS,crypto.randomUUID(),true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{tx.set(`${root}/meta/subscription`,{...createDefaultSubscription(org.id),...getPlanConfig('Enterprise'),plan:'Enterprise',org_id:org.id});tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2026-11-01T00:00:00Z'});});
  const ops=new Operations(store,()=>now),run=(action:string,data:Record<string,unknown>)=>ops.execute(org.id,owner,{action,data,operationId:crypto.randomUUID()});
  await run('accounting.activate',{reason:'بداية V2'});await run('period.create',{id:'October',start_date:'2026-10-01',end_date:'2026-10-31',reason:'الفترة الأولى'});
  const cash=(await run('financialAccount.create',{name:'صندوق نقدية',account_code:'1110',currency:'SDG',kind:'cash'})).result;
  const request:{input:OpeningInput;terms:OpeningTerms[]}={input:{batch_id:'first',date:'2026-10-01',reason:'أرصدة بدء النشاط',currency_policy:'dual',cash:[{id:cash.id,currency:'SDG',amount:1001,exchange_rate_used:2000}],receivables:[],payables:[],inventory:[],capital:{sdg:1000,usd:0.5}},terms:[]};
  return {store,org,root,ops,run,cash,request};
}
test('C2.2b preview is fresh/read-only and preserves unresolved equity review without exposing frozen masters or granting posting',async()=>{
  const f=await fixture(),before=f.store.dump(),response=await f.ops.openingPreview(f.org.id,owner,f.request);
  assert.deepEqual(f.store.dump(),before);assert.equal(response.quote.equity_review_complete,false);assert.equal(response.quote.requires_equity_review,true);assert.deepEqual(response.quote.opening_equity,{sdg:1,usd:0});assert.equal(response.posting_available,false);assert.equal(response.requires_owner_confirmation,true);assert.equal(response.source_count,1);assert.match(response.preview_hash,/^[a-f0-9]{64}$/);assert.equal((response as any).snapshot,undefined);assert.equal((response as any).plan,undefined);
  const later=await new Operations(f.store,()=>new Date(now.getTime()+60000)).openingPreview(f.org.id,owner,f.request);assert.equal(later.preview_hash,response.preview_hash);assert.notEqual(later.generatedAt,response.generatedAt);assert.deepEqual(f.store.dump(),before);const reversed:Store={authority:'local',transaction:work=>f.store.transaction(tx=>work({...tx,list:async path=>(await tx.list(path)).reverse()}))};assert.equal((await new Operations(reversed,()=>now).openingPreview(f.org.id,owner,f.request)).preview_hash,response.preview_hash);
});
test('C2.2b live membership and dedicated permission restrict previews to verified actual Owner or active Accountant, never an implicit Super Admin',async()=>{
  const f=await fixture();for(const role of ['Admin','Accountant','Sales','Cashier','Viewer','Owner']){
    const actor={...owner,uid:role,superAdmin:true};await f.store.transaction(async tx=>tx.set(`${f.root}/members/${role}`,{uid:role,role,status:'active'}));const before=f.store.dump();
    if(role==='Accountant')assert.equal((await f.ops.openingPreview(f.org.id,actor,f.request)).source_count,1);else await assert.rejects(f.ops.openingPreview(f.org.id,actor,f.request));assert.deepEqual(f.store.dump(),before);
  }
  await assert.rejects(f.ops.openingPreview(f.org.id,{...owner,emailVerified:false},f.request));await assert.rejects(f.ops.openingPreview('foreign-org',owner,f.request));
  await f.store.transaction(async tx=>tx.set(`${f.root}/members/Accountant`,{uid:'Accountant',role:'Accountant',status:'suspended'}));await assert.rejects(f.ops.openingPreview(f.org.id,{...owner,uid:'Accountant'},f.request));
});
test('C2.2b browser authority, absent/failing deployed rules proof and source read failure fail closed without turning missing evidence into an empty company',async()=>{
  const f=await fixture(),browser:Store={authority:'browser',transaction:work=>f.store.transaction(work)},server:Store={authority:'server',transaction:work=>f.store.transaction(work)},before=f.store.dump();
  await assert.rejects(new Operations(browser,()=>now).openingPreview(f.org.id,owner,f.request),/الخادم/);await assert.rejects(new Operations(server,()=>now).openingPreview(f.org.id,owner,f.request),/قواعد/);
  let checks=0;const service=new Operations(server,()=>now,undefined,async()=>{checks++;});await service.openingPreview(f.org.id,owner,f.request);await service.openingPreview(f.org.id,owner,f.request);assert.equal(checks,2);
  await assert.rejects(new Operations(server,()=>now,undefined,async()=>{throw new Error('rules unavailable');}).openingPreview(f.org.id,owner,f.request));
  const unreadable:Store={authority:'local',transaction:work=>f.store.transaction(tx=>work({...tx,list:async path=>{if(path.endsWith('/payments'))throw new Error('read unavailable');return tx.list(path);}}))};await assert.rejects(new Operations(unreadable,()=>now).openingPreview(f.org.id,owner,f.request),/read unavailable/);assert.deepEqual(f.store.dump(),before);
});
test('C2.2b live plan/accounting/multi-currency/inventory entitlement is rechecked on repeated previews; suspended and expired organizations fail',async()=>{
  const f=await fixture();await f.ops.openingPreview(f.org.id,owner,f.request);
  for(const change of [{status:'suspended'},{subscriptionEnd:'2026-10-07',planId:'Enterprise'},{accounting_version:1}]){const clone=new MemoryStore(f.store.dump());await clone.transaction(async tx=>tx.set(f.root,{...await tx.get(f.root),...change}));await assert.rejects(new Operations(clone,()=>now).openingPreview(f.org.id,owner,f.request));}
  for(const flag of ['accounting','multi_currency']){const clone=new MemoryStore(f.store.dump());await clone.transaction(async tx=>{const plan=defaultPlatformPlans(now.toISOString()).find(row=>row.id==='Enterprise')!;tx.set('plans/Enterprise',{...plan,features:{...plan.features,[flag]:false}});});await assert.rejects(new Operations(clone,()=>now).openingPreview(f.org.id,owner,f.request));}
  const clone=new MemoryStore(f.store.dump());await clone.transaction(async tx=>{const plan=defaultPlatformPlans(now.toISOString()).find(row=>row.id==='Enterprise')!;tx.set('plans/Enterprise',{...plan,features:{...plan.features,multi_currency:false}});});const input={...f.request.input,currency_policy:'sdg_only' as const,cash:[{id:f.cash.id,currency:'SDG' as const,amount:1000}],capital:{sdg:1000,usd:0}};assert.equal((await new Operations(clone,()=>now).openingPreview(f.org.id,owner,{input,terms:[]})).quote.total_debit_usd,0);
});
test('C2.2b preview requires covered open period, respects legacy lock and rejects future dates without modifying periods',async()=>{
  const f=await fixture();for(const update of [{status:'SOFT_CLOSED',changed_by:owner.uid,changed_at:now.toISOString(),reason:'مراجعة'},{start_date:'2026-10-02'}]){const clone=new MemoryStore(f.store.dump());await clone.transaction(async tx=>tx.set(`${f.root}/accounting_periods/October`,{...await tx.get(`${f.root}/accounting_periods/October`),...update}));await assert.rejects(new Operations(clone,()=>now).openingPreview(f.org.id,owner,f.request));}
  const empty=new MemoryStore(f.store.dump());await empty.transaction(async tx=>tx.delete(`${f.root}/accounting_periods/October`));await assert.rejects(new Operations(empty,()=>now).openingPreview(f.org.id,owner,f.request),/أنشئ فترة/);
  const locked=new MemoryStore(f.store.dump());await locked.transaction(async tx=>{const org=await tx.get(f.root);tx.set(f.root,{...org,settings:{...org!.settings,period_lock_date:'2026-10-01'}});});await assert.rejects(new Operations(locked,()=>now).openingPreview(f.org.id,owner,f.request),/مقفلة/);
  await assert.rejects(f.ops.openingPreview(f.org.id,owner,{...f.request,input:{...f.request.input,date:'2026-10-09'}}),/مستقبلي/);
});
test('C2.2b changed source mappings/revisions/input change the preview digest; hidden financial history and stale zero counters block it',async()=>{
  const f=await fixture(),base=await f.ops.openingPreview(f.org.id,owner,f.request);
  for(const mutate of [async(tx:any)=>{tx.set(`${f.root}/financial_accounts/${f.cash.id}`,{...await tx.get(`${f.root}/financial_accounts/${f.cash.id}`),name:'اسم جديد'});},async(tx:any)=>{tx.set(`${f.root}/accounting_periods/October`,{...await tx.get(`${f.root}/accounting_periods/October`),revision:2});}]){const clone=new MemoryStore(f.store.dump());await clone.transaction(mutate);assert.notEqual((await new Operations(clone,()=>now).openingPreview(f.org.id,owner,f.request)).preview_hash,base.preview_hash);}
  assert.notEqual((await f.ops.openingPreview(f.org.id,owner,{...f.request,input:{...f.request.input,reason:'سبب جديد'}})).preview_hash,base.preview_hash);
  await f.store.transaction(async tx=>{tx.set(`${f.root}/payments/hidden`,{id:'hidden',org_id:f.org.id,amount:1});tx.set(`${f.root}/meta/counters`,{journal_count:0,invoice_count:0});});const before=f.store.dump();await assert.rejects(f.ops.openingPreview(f.org.id,owner,f.request),/نشاط مالي/);assert.deepEqual(f.store.dump(),before);
});
test('C2.2b real zero-stock product initialization can be previewed as opening inventory, while inventory feature and explicit party due dates still gate it',async()=>{
  const f=await fixture(),product=(await f.run('product.create',{name:'صنف بدء النشاط',unit:'قطعة',price_sdg:1000,price_usd:0.5,tax_rate:0,is_active:true,track_inventory:true,stock_quantity:0})).result;
  const input={...f.request.input,inventory:[{id:product.id,quantity:2,unit_cost:3,currency:'USD' as const,exchange_rate_used:2000}],equity_difference_reason:'أرصدة مخزون راجعها المالك'};
  const before=f.store.dump(),preview=await f.ops.openingPreview(f.org.id,owner,{input,terms:[]});assert.equal(preview.source_count,2);assert.equal(preview.quote.sources.find(row=>row.kind==='inventory')!.sdg,12000);assert.deepEqual(f.store.dump(),before);
  await f.store.transaction(async tx=>{const plan=defaultPlatformPlans(now.toISOString()).find(row=>row.id==='Enterprise')!;tx.set('plans/Enterprise',{...plan,features:{...plan.features,inventory_tracking:false}});});await assert.rejects(f.ops.openingPreview(f.org.id,owner,{input,terms:[]}));
  const q=await fixture();await q.store.transaction(async tx=>tx.set(`${q.root}/customers/customer`,{id:'customer',org_id:q.org.id,name:'عميل',phone:'private-phone',notes:'private-note',balance_sdg:0,balance_usd:0}));const request={input:{...q.request.input,receivables:[{id:'customer',currency:'SDG' as const,amount:100,exchange_rate_used:2000}]},terms:[]};await assert.rejects(q.ops.openingPreview(q.org.id,owner,request),/استحقاق/);const result=await q.ops.openingPreview(q.org.id,owner,{...request,terms:[{kind:'receivable',source_id:'customer',due_date:'2026-09-15',reference:'رصيد مستقل'}]});assert.ok(!JSON.stringify(result).includes('private-phone'));assert.ok(!JSON.stringify(result).includes('private-note'));assert.equal(result.terms[0].due_date,'2026-09-15');
});
test('C2.2b HTTP preview requires authenticated tenant identity, disables response caching and rejects protected body/query fields without any writes',async()=>{
  const f=await fixture(),app=express();app.use(express.json());app.use('/api',createApi({operations:f.ops,verify:async token=>{if(token!=='valid')throw Error('invalid');return owner;}}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/opening-balances/preview`,before=f.store.dump();
  const send=(body:any=f.request,path=url,auth=true)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer valid'}:{})},body:JSON.stringify(body)});
  try{assert.equal((await send(f.request,url,false)).status,401);assert.equal((await send(f.request,url.replace(f.org.id,'other-org'))).status,403);for(const body of [null,[],{},{input:null,terms:[]},{...f.request,auth_time:123},{...f.request,financial_activity_count:0},{...f.request,snapshot:{}},{...f.request,preview_hash:'f'.repeat(64)},{...f.request,input:{...f.request.input,journal_id:'forged'}}])assert.equal((await send(body)).status,400);assert.equal((await send(f.request,url+'?orgId=other')).status,400);const result=await send();assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');const data=await result.json();assert.equal(data.posting_available,false);assert.equal(data.quote.equity_review_complete,false);assert.match(data.preview_hash,/^[a-f0-9]{64}$/);assert.deepEqual(f.store.dump(),before);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
