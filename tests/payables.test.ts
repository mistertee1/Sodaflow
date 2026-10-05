import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, type Store } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { financialCollections, reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { calculateTrialBalance, calculateBalanceSheet } from '../src/services/accountingService';
import { journalLine } from '../src/domain/financial';
import type { Product, Account, JournalEntry } from '../src/types';
const owner: Actor = { uid:'supplier-owner', email:'supplier@example.com', emailVerified:true };
async function fixture() {
  const store=new MemoryStore(), org=await new Organizations(store).create(owner,'موردون',INITIAL_SETTINGS,'setup',true), root=`organizations/${org.id}`;
  await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-07-01T00:00:00Z'}));
  let clock=new Date('2026-10-05T12:00:00Z'); const ops=new Operations(store,()=>clock);
  const run=(action:string,data:Record<string,unknown>,operationId:string=crypto.randomUUID(),actor=owner)=>ops.execute(org.id,actor,{action,data,operationId});
  const product=(await run('product.create',{name:'صنف',unit:'قطعة',price_sdg:10000,price_usd:5,tax_rate:0,is_active:true,track_inventory:true,stock_quantity:0},'product')).result as Product;
  await run('product.cost.establish',{id:product.id,cost_currency:'USD',unit_cost:2,exchange_rate_used:2000,reason:'فارغ موثق'},'basis'); await run('accounting.activate',{reason:'مطابقة'},'activate');
  const supplier=(await run('supplier.create',{name:'مورد الاختبار',default_currency:'USD',payment_terms_days:30},'supplier')).result;
  const purchase=(ref='P-1',quantity=10,currency='USD')=>({supplier_id:supplier.id,supplier_reference:ref,issue_date:clock.toISOString().slice(0,10),currency,exchange_rate_used:2000,settlement:'credit',reason:'فاتورة موثقة',items:[{product_id:product.id,quantity,unit_cost:2}]});
  const snapshot=()=>ops.snapshot(org.id,owner,true);
  const books=async()=>{const s=await snapshot();assert.deepEqual(reconcileFinancialData(s.collections as FinancialData,s.settings,{requireCosting:true}),[]);assert.equal(calculateTrialBalance(s.collections.accounts as Account[],s.collections.journal_entries as JournalEntry[]).isBalanced,true);assert.equal(calculateBalanceSheet(s.collections.accounts as Account[],s.collections.journal_entries as JournalEntry[]).is_balanced,true);return s;};
  return {store,org,root,ops,run,product,supplier,purchase,snapshot,books,setClock:(s:string)=>{clock=new Date(s);}};
}
test('B1 purchase receipt aggregates repeated products, posts AP exactly once and keeps selling prices independent',async()=>{
  const f=await fixture(), data=f.purchase();data.items.push({...data.items[0],quantity:5});
  const result=await f.run('purchase.create',data,'buy');assert.deepEqual(await f.run('purchase.create',data,'buy'),result);
  let s=await f.books();assert.equal(s.collections.purchase_bills.length,1);assert.equal(s.collections.products[0].stock_quantity,15);assert.equal(s.collections.products[0].inventory_value_usd,30);assert.equal(s.collections.products[0].average_cost_usd,2);
  assert.equal(s.collections.inventory_movements.filter(m=>m.reference_type==='purchase_bill').length,1);
  await assert.rejects(f.run('purchase.create',{...data,supplier_reference:'p-1'},'duplicate'),/مستخدم/);
  await assert.rejects(f.run('purchase.create',{...data,supplier_reference:'bad',items:[{...data.items[0],product_id:'foreign-product'}]},'bad'),/غير موجود/);
  assert.deepEqual((await f.snapshot()).collections,s.collections);
  await f.run('product.update',{id:f.product.id,updates:{price_usd:999}},'price');s=await f.books();assert.equal(s.collections.purchase_bills[0].grand_total_usd,30);
});
test('B1 partial/full multi-currency supplier payments settle historical carrying values and recognize FX loss/gain',async()=>{
  const f=await fixture(), bill=(await f.run('purchase.create',f.purchase(),'buy')).result;
  const payment={bill_id:bill.id,amount:10,currency:'USD',exchange_rate_used:3000,payment_date:'2026-10-05',payment_method:'bankak',reference_number:'bank-1'};
  const first=await f.run('supplierPayment.create',payment,'part');assert.equal(first.result.settled_amount_sdg,20000);assert.equal(first.result.cash_amount_sdg,30000);assert.deepEqual(await f.run('supplierPayment.create',payment,'part'),first);
  let s=await f.books();assert.equal(s.collections.purchase_bills[0].remaining_usd,10);const fx=s.collections.journal_entries.find(j=>j.reference_id===first.result.id)!;assert.equal(fx.lines.find((l:any)=>l.account_code==='5500').debit_sdg,10000);
  const second=await f.run('supplierPayment.create',{...payment,amount:15000,currency:'SDG',exchange_rate_used:1500},'final');assert.equal(second.result.settled_amount_sdg,20000);assert.equal(second.result.cash_amount_usd,10);
  s=await f.books();assert.equal(s.collections.purchase_bills[0].remaining_sdg,0);assert.equal(s.collections.purchase_bills[0].remaining_usd,0);assert.equal(s.collections.supplier_payments.length,2);assert.equal(s.collections.purchase_bills[0].status,'paid');
  const gain=s.collections.journal_entries.find(j=>j.reference_id===second.result.id)!;assert.equal(gain.lines.find((l:any)=>l.account_code==='4200').credit_sdg,5000);
  await assert.rejects(f.run('supplierPayment.create',payment,'extra'),/مسددة/);
});
test('B1 simultaneous payments cannot overpay and duplicate requests create one journal',async()=>{
  const f=await fixture(), bill=(await f.run('purchase.create',f.purchase(),'buy')).result;
  const data={bill_id:bill.id,amount:15,currency:'USD',exchange_rate_used:2000,payment_date:'2026-10-05',payment_method:'cash'};
  const result=await Promise.allSettled([f.run('supplierPayment.create',data,'race-1'),f.run('supplierPayment.create',data,'race-2')]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected').length,1);const s=await f.books();assert.equal(s.collections.supplier_payments.length,1);assert.equal(s.collections.purchase_bills[0].remaining_usd,5);
});
test('B1 cash purchase credits selected custom cash account and AP stays zero',async()=>{
  const f=await fixture();await f.run('account.create',{code:'1099',name_ar:'محفظة',name_en:'Wallet',type:'ASSET',nature:'DEBIT',reporting_group:'cash_bank',cash_flow_category:'cash',is_active:true},'wallet');
  const data={...f.purchase(),settlement:'cash',payment_method:'custom',payment_account_code:'1099'};await f.run('purchase.create',data,'cash');const s=await f.books();assert.equal(s.collections.purchase_bills[0].remaining_usd,0);assert.equal(s.collections.journal_entries.find(j=>j.reference_type==='purchase_bill')!.lines[1].account_code,'1099');
  const r=await f.ops.payableReports(f.org.id,owner);assert.equal(r.total_sdg,0);assert.equal(r.ledger_sdg,0);assert.equal(r.statements[0].closing_usd,0);
  await assert.rejects(f.run('purchase.create',{...data,supplier_reference:'wrong',payment_account_code:'2110'},'wrong'),/نقدياً/);
});
test('B1 dated supplier statements/aging include opening balances and historical remaining before later payments',async()=>{
  const f=await fixture();const dates=['2027-02-01','2027-01-02','2026-12-03','2026-11-03','2026-11-02'];
  for(const [i,due_date] of dates.entries()) await f.run('purchase.create',{...f.purchase(`AGE-${i}`,1),due_date},`age-${i}`);
  let r=await f.ops.payableReports(f.org.id,owner,{end:'2027-02-01'});assert.deepEqual(r.aging.map(b=>b.bucket),['Current','1-30','31-60','61-90','90+']);assert.equal(r.total_usd,10);
  f.setClock('2026-10-06T12:00:00Z');await f.run('supplierPayment.create',{bill_id:'pb-age-0',amount:1,currency:'USD',exchange_rate_used:2000,payment_date:'2026-10-06',payment_method:'cash'},'payment');
  r=await f.ops.payableReports(f.org.id,owner,{start:'2026-10-06',end:'2026-10-06'});assert.equal(r.statements[0].opening_usd,10);assert.equal(r.statements[0].closing_usd,9);assert.equal(r.statements[0].rows.length,1);assert.equal(r.total_usd,9);
  r=await f.ops.payableReports(f.org.id,owner,{end:'2026-10-05'});assert.equal(r.total_usd,10);assert.equal(r.statements[0].closing_usd,10);assert.equal(r.unallocated_usd,0);
  await assert.rejects(f.ops.payableReports(f.org.id,owner,{start:'2027-01-01',end:'2026-01-01'}),/بداية/);await f.books();
});
test('B1 legacy expense AP is explicit; new accrued expenses use 2140 and manual supplier AP mutation is blocked',async()=>{
  const f=await fixture();await f.store.transaction(async tx=>tx.set(f.root,{...await tx.get(f.root),accounting_version:1}));
  await f.run('expense.create',{title:'قديم',amount:1000,currency:'SDG',date:'2026-10-05',payment_method:'on_credit'},'legacy');
  await f.store.transaction(async tx=>tx.set(f.root,{...await tx.get(f.root),accounting_version:2}));
  await f.run('expense.create',{title:'جديد',amount:2000,currency:'SDG',date:'2026-10-05',payment_method:'on_credit',payment_account_code:'2110'},'new');
  const s=await f.books();assert.equal(s.collections.expenses.find(e=>e.title==='جديد')!.payment_account_code,'2140');const r=await f.ops.payableReports(f.org.id,owner);assert.equal(r.total_sdg,0);assert.equal(r.unallocated_sdg,1000);
  await assert.rejects(f.run('journal.create',{reference_type:'manual',date:'2026-10-05',description:'AP يدوي',lines:[journalLine('1110','نقد',1000),journalLine('2110','مورد',0,1000)]},'manual'),/الأصلية/);
});
test('B1 roles, tenant boundaries, inactive suppliers, expiry, cost chronology and server authority are enforced',async()=>{
  const f=await fixture(), sales={...owner,uid:'sales'};await f.store.transaction(async tx=>tx.set(`${f.root}/members/sales`,{uid:'sales',role:'Sales',status:'active',org_id:f.org.id}));
  await assert.rejects(f.run('supplier.create',{name:'مرفوض'},'no-role',sales),/صلاحية/);await assert.rejects(f.ops.payableReports(f.org.id,sales),/صلاحية/);assert.deepEqual((await f.ops.snapshot(f.org.id,sales)).collections.suppliers,[]);
  await assert.rejects(f.run('supplier.update',{id:f.supplier.id,updates:{balance_usd:1}},'balance'),/رصيد/);
  await f.run('supplier.update',{id:f.supplier.id,updates:{status:'inactive'}},'inactive');await assert.rejects(f.run('purchase.create',f.purchase(),'inactive-buy'),/نشط/);await f.run('supplier.update',{id:f.supplier.id,updates:{status:'active'}},'active');
  await assert.rejects(f.run('purchase.create',{...f.purchase(),issue_date:'2026-10-04'},'old'),/يسبق/);await assert.rejects(f.run('purchase.create',{...f.purchase(),tax_amount:1},'tax'),/ضريبة/);
  const browser:Store={authority:'browser',transaction:w=>f.store.transaction(w)};await assert.rejects(new Operations(browser).execute(f.org.id,owner,{action:'purchase.create',data:f.purchase(),operationId:'direct'}),/الخادم/);
  await f.store.transaction(async tx=>tx.set(f.root,{...await tx.get(f.root),subscriptionEnd:'2026-10-01'}));await assert.rejects(f.run('purchase.create',f.purchase(),'expired'));await assert.rejects(f.ops.payableReports(f.org.id,owner));
});
test('B1 backup restores supplier references and AP, blocks tampered obligations and logs authorized exports',async()=>{
  const f=await fixture();await f.run('purchase.create',f.purchase(),'buy');await f.books();const backup=await f.snapshot();
  const targetOwner={...owner,uid:'restore-owner'}, org=await new Organizations(f.store).create(targetOwner,'استعادة',INITIAL_SETTINGS,'restore-org',true);await f.store.transaction(async tx=>tx.set(`organizations/${org.id}`,{...await tx.get(`organizations/${org.id}`),planId:'Enterprise',subscriptionEnd:'2027-07-01'}));
  const bad=structuredClone(backup);bad.collections.purchase_bills[0].remaining_usd=999;await assert.rejects(f.ops.execute(org.id,targetOwner,{action:'backup.restore',data:{backup:bad},operationId:'bad-restore'}),/فروقات/);
  await f.ops.execute(org.id,targetOwner,{action:'backup.restore',data:{backup},operationId:'restore'});const restored=await f.ops.snapshot(org.id,targetOwner,true);assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData,restored.settings,{requireCosting:true}),[]);
  await assert.rejects(f.ops.execute(org.id,targetOwner,{action:'purchase.create',data:f.purchase(),operationId:'dup-restored'}),/مستخدم/);
  const exportResult=await f.run('payables.export',{period:{end:'2026-10-05'}},'export');assert.equal(exportResult.result.total_usd,20);assert.ok(f.store.dump()[`${f.root}/audit_logs/audit-export`]);
  const corrupted=structuredClone(backup.collections) as FinancialData;corrupted.supplier_payments.push({id:'orphan',bill_id:'missing'});assert.ok(reconcileFinancialData(corrupted,backup.settings).some(f=>f.collection==='supplier_payments'));
  assert.ok(financialCollections.includes('suppliers'));
});

test('B1 HTTP payable reports honor dates and refuse unauthorized or unverified identities',async()=>{
  const {default:express}=await import('express'), {createApi}=await import('../server/api');const f=await fixture();await f.run('purchase.create',f.purchase(),'http-buy');
  const sales={...owner,uid:'http-sales'};await f.store.transaction(async tx=>tx.set(`${f.root}/members/${sales.uid}`,{uid:sales.uid,role:'Sales',status:'active',org_id:f.org.id}));
  const app=express();app.use(express.json());app.use('/api',createApi({operations:f.ops,verify:async token=>token==='sales'?sales:token==='unverified'?{...owner,emailVerified:false}:owner}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/reports/payables`;
  try{const get=(token:string,q='')=>fetch(url+q,{headers:{Authorization:`Bearer ${token}`}});assert.equal((await get('sales')).status,403);assert.equal((await get('unverified')).status,403);const response=await get('owner','?end=2026-10-04');assert.equal(response.status,200);assert.equal((await response.json()).total_usd,0);assert.equal((await get('owner','?start=2027-01-01&end=2026-01-01')).status,400);}
  finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('B1 fractional settlements retain ordering at identical timestamps and reject tampered sequences',async()=>{
  const f=await fixture();await f.run('purchase.create',{...f.purchase('FRACTION',1),exchange_rate_used:35,items:[{product_id:f.product.id,quantity:1,unit_cost:.03}]},'fraction');
  for(const id of ['z-last','a-second','m-third']) await f.run('supplierPayment.create',{bill_id:'pb-fraction',amount:.01,currency:'USD',exchange_rate_used:35,payment_date:'2026-10-05',payment_method:'cash'},id);
  const s=await f.books();assert.equal(s.collections.purchase_bills[0].remaining_usd,0);assert.equal(s.collections.purchase_bills[0].remaining_sdg,0);
  const corrupt=structuredClone(s.collections) as FinancialData;corrupt.supplier_payments[0].sequence=99;assert.ok(reconcileFinancialData(corrupt,s.settings).some(f=>f.collection==='purchase_bills'));
});
