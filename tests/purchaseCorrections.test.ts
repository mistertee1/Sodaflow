import test from 'node:test';
import express from 'express';
import { createApi } from '../server/api';
import assert from 'node:assert/strict';
import { MemoryStore, type Store } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
const owner: Actor = { uid:'purchase-owner',email:'purchase@example.com',emailVerified:true };
async function fixture(settlement='credit') {
  const store=new MemoryStore(),org=await new Organizations(store).create(owner,'مردود المورد',INITIAL_SETTINGS,'setup',true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));
  let now=new Date('2026-10-05T12:00:00Z');const ops=new Operations(store,()=>now),run=(action:string,data:Record<string,unknown>,operationId:string=crypto.randomUUID(),actor=owner)=>ops.execute(org.id,actor,{action,data,operationId});
  const supplier=(await run('supplier.create',{name:'المورد',default_currency:'USD'},'supplier')).result;
  const product=(await run('product.create',{name:'صنف',unit:'قطعة',price_sdg:100000,price_usd:50,is_active:true,track_inventory:true,stock_quantity:10},'product')).result;
  await run('product.cost.establish',{id:product.id,cost_currency:'USD',unit_cost:10,exchange_rate_used:2000,reason:'افتتاحي'},'cost');await run('accounting.activate',{reason:'مطابقة'},'activate');
  const buy={supplier_id:supplier.id,supplier_reference:'BILL-1',issue_date:'2026-10-05',due_date:'2026-10-06',currency:'USD',exchange_rate_used:2000,settlement,payment_method:'cash',reason:'شراء',items:[{product_id:product.id,quantity:1,unit_cost:20},{product_id:product.id,quantity:2,unit_cost:20}]};
  const bill=(await run('purchase.create',buy,'buy')).result;now=new Date('2026-10-07T12:00:00Z');
  const cash=(await run('financialAccount.create',{name:'بنك المورد',account_code:'1120',currency:'USD',kind:'cash'},'cash')).result;
  const returned=(quantity=1,line_id='line-1',date='2026-10-07')=>({bill_id:bill.id,date,reason:'مردود مثبت',lines:[{line_id,quantity}]});
  const pay=(amount=60,date='2026-10-07')=>({bill_id:bill.id,amount,currency:'USD',exchange_rate_used:2000,payment_date:date,payment_method:'cash'});
  const refund=(amount=20,date='2026-10-07')=>({bill_id:bill.id,date,reason:'استرداد مثبت',financial_account_id:cash.id,amount,exchange_rate_used:3000});
  const books=async()=>{const s=await ops.snapshot(org.id,owner,true);assert.deepEqual(reconcileFinancialData(s.collections as FinancialData,s.settings,{requireCosting:true}),[]);return s;};
  return {store,org,root,ops,run,supplier,product,bill,cash,buy,returned,pay,refund,books};
}
test('B3 purchase return offsets unpaid source debt only; later payment uses corrected original carrying and dated AP',async()=>{
  const f=await fixture();await f.run('purchaseReturn.create',f.returned(),'return');let s=await f.books();assert.equal(s.collections.purchase_bills[0].remaining_usd,40);assert.equal(s.collections.suppliers[0].payable_due_usd,40);assert.equal(s.collections.suppliers[0].advance_balance_usd,0);
  const before=f.store.dump();await assert.rejects(f.run('supplierRefund.create',f.refund(),'unearned'),/رصيد مورد/);assert.deepEqual(f.store.dump(),before);
  const p=(await f.run('supplierPayment.create',{...f.pay(40),exchange_rate_used:2500},'pay')).result;assert.equal(p.settled_amount_sdg,80000);assert.equal(p.cash_amount_sdg,100000);s=await f.books();assert.equal(s.collections.purchase_bills[0].remaining_usd,0);assert.equal(s.collections.purchase_bills[0].paid_amount_usd,40);
  assert.equal((await f.ops.payableReports(f.org.id,owner,{end:'2026-10-06'})).total_usd,60);const dated=await f.ops.payableReports(f.org.id,owner,{start:'2026-10-07',end:'2026-10-07'});assert.equal(dated.total_usd,0);assert.equal(dated.unallocated_usd,0);assert.equal(dated.statements[0].opening_usd,60);assert.equal(dated.statements[0].rows.length,2);
});
test('B3 purchase return uses original supplier credit, aggregates repeated products once and freezes current WAC variance explicitly',async()=>{
  const f=await fixture();await f.run('supplierPayment.create',f.pay(),'pay');await f.run('inventory.receive',{id:f.product.id,quantity:1,cost_currency:'USD',unit_cost:50,exchange_rate_used:2000,payment_method:'cash',reason:'تكلفة لاحقة'},'later');
  const result=await f.run('purchaseReturn.create',{...f.returned(),lines:[{line_id:'line-1',quantity:1},{line_id:'line-2',quantity:2}]},'return');assert.equal(result.result.supplier_credit_usd,60);assert.equal(result.result.inventory_out_usd,45);assert.equal(result.result.variance_usd,15);assert.deepEqual(await f.run('purchaseReturn.create',{...f.returned(),lines:[{line_id:'line-1',quantity:1},{line_id:'line-2',quantity:2}]},'return'),result);
  const s=await f.books(),moves=s.collections.inventory_movements.filter(m=>m.reference_type==='purchase_return');assert.equal(moves.length,1);assert.equal(moves[0].quantity,-3);assert.equal(s.collections.products[0].stock_quantity,11);assert.equal(s.collections.products[0].inventory_value_usd,165);assert.equal(s.collections.purchase_bills[0].advance_balance_usd,60);const j=s.collections.journal_entries.find(j=>j.reference_type==='purchase_return')!;assert.equal(j.lines.find((l:any)=>l.account_code==='5910').credit_usd,15);
});
test('B3 supplier reimbursement consumes historical advance, receives cash at current FX and records gain without requiring existing cash funds',async()=>{
  const f=await fixture();await f.run('supplierPayment.create',f.pay(),'pay');await f.run('purchaseReturn.create',f.returned(),'return');const result=await f.run('supplierRefund.create',f.refund(),'refund');assert.equal(result.result.settled_amount_sdg,40000);assert.equal(result.result.cash_amount_sdg,60000);assert.deepEqual(await f.run('supplierRefund.create',f.refund(),'refund'),result);
  const s=await f.books();assert.equal(s.collections.purchase_bills[0].advance_balance_usd,0);assert.equal(s.collections.suppliers[0].advance_balance_usd,0);assert.equal(s.collections.purchase_bills[0].refunded_amount_usd,20);const j=s.collections.journal_entries.find(j=>j.reference_type==='supplier_refund')!;assert.equal(j.lines.find((l:any)=>l.account_code==='4200').credit_sdg,20000);assert.equal((await f.ops.payableReports(f.org.id,owner)).unallocated_usd,0);assert.equal(f.store.dump()[`${f.root}/audit_logs/audit-refund`].reason,'استرداد مثبت');
});
test('D4.3.2 supplier refund approval is atomic and frozen on the reimbursement document',async()=>{
  const f=await fixture();await f.run('supplierPayment.create',f.pay(),'pay');await f.run('purchaseReturn.create',f.returned(),'return');
  await f.store.transaction(async tx=>tx.set(`${f.root}/approval_policies/refund-usd`,{schema_version:1,id:'refund-usd',org_id:f.org.id,revision:4,subject:'supplier_refund',currency:'USD',active:true,tiers:[{max_value:10,required_role:'Accountant'},{max_value:null,required_role:'Owner'}],created_at:'2026-10-01T00:00:00.000Z',created_by:owner.uid,updated_at:'2026-10-01T00:00:00.000Z',updated_by:owner.uid,operation_id:'seed'}));
  const before=f.store.dump();await assert.rejects(f.run('supplierRefund.create',f.refund(),'no-reason'),/النص المطلوب/);assert.deepEqual(f.store.dump(),before);
  const saved=(await f.run('supplierRefund.create',{...f.refund(),approval_reason:'استرداد مورد معتمد'},'approved')).result;assert.equal(saved.approval_evidence.policy_revision,4);assert.equal(saved.approval_evidence.value,20);assert.equal(saved.approval_evidence.approved_by,owner.uid);
});
test('B3 cash purchase return creates source-linked supplier advance without fabricating an original AP debt or a payment',async()=>{
  const f=await fixture('cash');await f.run('purchaseReturn.create',f.returned(),'return');let s=await f.books();assert.equal(s.collections.purchase_bills[0].paid_amount_usd,60);assert.equal(s.collections.purchase_bills[0].advance_balance_usd,20);assert.equal(s.collections.supplier_payments.length,0);const r=await f.ops.payableReports(f.org.id,owner);assert.equal(r.total_usd,-20);assert.equal(r.aging[0].advance_usd,20);assert.equal(r.unallocated_usd,0);await f.run('supplierRefund.create',f.refund(),'refund');await f.books();
});
test('B3 purchase overreturn and reimbursement races preserve atomic source, stock, journal and audit changes',async()=>{
  const f=await fixture('cash');const returns=await Promise.allSettled(['a','b'].map(id=>f.run('purchaseReturn.create',f.returned(),`return-${id}`)));assert.equal(returns.filter(r=>r.status==='fulfilled').length,1);
  const refunds=await Promise.allSettled(['a','b'].map(id=>f.run('supplierRefund.create',f.refund(15),`refund-${id}`)));assert.equal(refunds.filter(r=>r.status==='fulfilled').length,1);const winner=refunds[0].status==='fulfilled'?'refund-a':'refund-b';await f.run('supplierRefund.create',f.refund(15),winner);const s=await f.books();assert.equal(s.collections.purchase_returns.length,1);assert.equal(s.collections.supplier_refunds.length,1);assert.equal(s.collections.purchase_bills[0].advance_balance_usd,5);
});
test('B3 purchase source, quantity, posting fields and original receipt tampering reject corrections atomically',async()=>{
  const f=await fixture();for(const patch of [{lines:[{line_id:'line-1',quantity:2}]},{lines:[{line_id:'line-1',quantity:1,inventory_out_usd:0}]},{lines:[{line_id:'line-1',quantity:1},{line_id:'line-1',quantity:1}]},{supplier_credit_usd:1},{bill_id:'foreign'},{date:'2026-10-04'}]){const before=f.store.dump();await assert.rejects(f.run('purchaseReturn.create',{...f.returned(),...patch}));assert.deepEqual(f.store.dump(),before);}
  const movement=Object.values(f.store.dump()).find(r=>r.type==='PURCHASE'&&r.reference_id===f.bill.id)!;await f.store.transaction(async tx=>tx.set(`${f.root}/inventory_movements/${movement.id}`,{...movement,value_delta_usd:61}));const before=f.store.dump();await assert.rejects(f.run('purchaseReturn.create',f.returned()),/استلام الشراء/);assert.deepEqual(f.store.dump(),before);
});
test('B3 frozen purchase return WAC, movements and original allocation are replayed before later payments and reports',async()=>{
  const f=await fixture();await f.run('purchaseReturn.create',f.returned(),'return');const path=`${f.root}/purchase_returns/pr-return`,saved=f.store.dump()[path];for(const patch of [{supplier_credit_usd:'20'},{variance_usd:saved.variance_usd+1},{lines:[{...saved.lines[0],quantity:2}]},{stock:[{...saved.stock[0],inventory_out_usd:0}]}]){await f.store.transaction(async tx=>tx.set(path,{...saved,...patch}));const before=f.store.dump();await assert.rejects(f.run('supplierPayment.create',f.pay(40)));await assert.rejects(f.ops.payableReports(f.org.id,owner));assert.deepEqual(f.store.dump(),before);}await f.store.transaction(async tx=>tx.set(path,saved));await f.books();
});
test('B3 purchase roles, live expiry, period locks, server proof and cash account mappings guard cached retries and new refunds',async()=>{
  const f=await fixture('cash');await f.run('purchaseReturn.create',f.returned(),'return');const sales={...owner,uid:'sales'};await f.store.transaction(async tx=>tx.set(`${f.root}/members/sales`,{uid:'sales',role:'Sales',status:'active'}));await assert.rejects(f.run('purchaseReturn.create',f.returned(),'sales-return',sales),/صلاحية/);assert.deepEqual((await f.ops.snapshot(f.org.id,sales)).collections.purchase_returns,[]);
  await f.run('financialAccount.update',{id:f.cash.id,updates:{status:'inactive'}},'inactive');await assert.rejects(f.run('supplierRefund.create',f.refund()),/نشط/);await f.run('financialAccount.update',{id:f.cash.id,updates:{status:'active'}},'active');await f.store.transaction(async tx=>tx.set(`${f.root}/financial_account_mappings/1120`,{id:'foreign'}));await assert.rejects(f.run('supplierRefund.create',f.refund()),/ربط/);
  for(const authority of ['browser','server'] as const){const store:Store={authority,transaction:work=>f.store.transaction(work)};await assert.rejects(new Operations(store).execute(f.org.id,owner,{action:'purchaseReturn.create',data:f.returned(),operationId:'return'}),/الخادم|قواعد/);}
  const paid=await fixture();await paid.run('supplierPayment.create',paid.pay(20),'paid');await paid.run('settings.update',{updates:{period_lock_date:'2026-10-07'}},'paid-lock');await assert.rejects(paid.run('supplierPayment.create',paid.pay(20),'paid'),/مقفلة/);
  await f.run('settings.update',{updates:{period_lock_date:'2026-10-07'}},'lock');await assert.rejects(f.run('purchaseReturn.create',f.returned(),'return'),/مقفلة/);await f.store.transaction(async tx=>tx.set(f.root,{...await tx.get(f.root),subscriptionEnd:'2026-10-01'}));await assert.rejects(f.run('purchaseReturn.create',f.returned(),'return'),/اشتراك|انتهى|منتهي/);
});
test('B3 signed supplier advance backup restores sources and counters, rejects dropped evidence and continues reimbursements',async()=>{
  const f=await fixture('cash');await f.run('purchaseReturn.create',f.returned(),'return');const backup=await f.books(),actor={...owner,uid:'restore'},org=await new Organizations(f.store).create(actor,'استعادة',INITIAL_SETTINGS,'restore',true);await f.store.transaction(async tx=>tx.set(`organizations/${org.id}`,{...await tx.get(`organizations/${org.id}`),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));
  for(const mutate of [(b:any)=>{delete b.collections.purchase_returns;},(b:any)=>{b.collections.purchase_returns[0].stock[0].inventory_out_usd++;},(b:any)=>{b.collections.purchase_bills[0].source_event_sequence++;}]){const bad=structuredClone(backup);mutate(bad);const before=f.store.dump();await assert.rejects(f.ops.execute(org.id,actor,{action:'backup.restore',operationId:crypto.randomUUID(),data:{backup:bad}}),/فروقات/);assert.deepEqual(f.store.dump(),before);}
  await f.ops.execute(org.id,actor,{action:'backup.restore',operationId:'restore',data:{backup}});const s=await f.ops.snapshot(org.id,actor,true);assert.equal(s.counters.purchase_return_count,1);assert.equal(s.collections.purchase_bills[0].advance_balance_usd,20);await f.ops.execute(org.id,actor,{action:'supplierRefund.create',operationId:'continued',data:f.refund()});const final=await f.ops.snapshot(org.id,actor,true);assert.deepEqual(reconcileFinancialData(final.collections as FinancialData,final.settings,{requireCosting:true}),[]);
});
test('B3 purchase fractional returns conserve original supplier value and allow later repayment of another debt without netting advances',async()=>{
  const f=await fixture('cash'),bill=(await f.run('purchase.create',{...f.buy,supplier_reference:'fraction',settlement:'credit',items:[{product_id:f.product.id,quantity:.3,unit_cost:.1}]},'tiny')).result;
  for(const [index,quantity] of [.1,.2].entries())await f.run('purchaseReturn.create',{...f.returned(),bill_id:bill.id,lines:[{line_id:'line-1',quantity}]},`tiny-${index}`);const s=await f.books();assert.equal(s.collections.purchase_bills.find(b=>b.id===bill.id)!.returned_amount_usd,.03);await f.run('purchaseReturn.create',f.returned(),'return');const second=(await f.run('purchase.create',{...f.buy,supplier_reference:'second',settlement:'credit',issue_date:'2026-10-07',due_date:'2026-10-07'},'second')).result;await f.run('supplierPayment.create',{...f.pay(),bill_id:second.id},'pay-second');await f.books();
});
test('B3 purchase stock insufficiency and historical WAC chronology fail before any partial return writes',async()=>{
  const f=await fixture();await f.run('inventory.receive',{id:f.product.id,quantity:1,cost_currency:'USD',unit_cost:50,exchange_rate_used:2000,payment_method:'cash',reason:'لاحق'},'later');const before=f.store.dump();await assert.rejects(f.run('purchaseReturn.create',f.returned(1,'line-1','2026-10-06')),/آخر حركة|تاريخ/);assert.deepEqual(f.store.dump(),before);
  const other=await fixture(),customer=(await other.run('customer.create',{name:'مشتري',phone:'',preferred_currency:'USD'},'customer')).result;
  await other.run('invoice.create',{customer_id:customer.id,issue_date:'2026-10-07',currency_mode:'single_usd',exchange_rate_used:2000,discount_type:'fixed',discount_value:0,items:[{product_id:other.product.id,description:'صنف',unit:'قطعة',quantity:12,unit_price:50,currency:'USD',tax_rate:0,discount_percent:0}]},'sale');
  const drained=other.store.dump();await assert.rejects(other.run('purchaseReturn.create',other.returned(2,'line-2')),/المخزون غير كاف/);assert.deepEqual(other.store.dump(),drained);await other.books();
});

test('B3 HTTP purchase correction and reimbursement API reject foreign/protected payloads and return committed retry results only',async()=>{
  const f=await fixture('cash'),app=express();app.use(express.json());app.use('/api',createApi({operations:f.ops,verify:async token=>{if(token!=='valid')throw Error('invalid');return owner;}}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/operations`;
  const send=(action:string,data:Record<string,unknown>,id:string,token='valid')=>fetch(base,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,data,operationId:id})});
  try {assert.equal((await send('purchaseReturn.create',f.returned(),'unauth','')).status,401);assert.equal((await send('purchaseReturn.create',{...f.returned(),bill_id:'foreign'},'foreign')).status,404);assert.equal((await send('purchaseReturn.create',{...f.returned(),supplier_credit_usd:1},'forged')).status,400);assert.equal((await send('purchaseReturn.create',f.returned(),'http-return')).status,200);const r=await send('supplierRefund.create',f.refund(),'http-refund');assert.equal(r.status,200);assert.equal((await r.json()).result.settled_amount_usd,20);assert.equal((await send('supplierRefund.create',f.refund(),'http-refund')).status,200);await f.books();}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('B3 failed purchase correction persistence and restored document collisions never overwrite financial history',async()=>{
  const f=await fixture('cash'),before=f.store.dump(),failed=new MemoryStore(before,()=>{throw Error('storage offline');});
  await assert.rejects(new Operations(failed,()=>new Date('2026-10-07T12:00:00Z')).execute(f.org.id,owner,{action:'purchaseReturn.create',operationId:'offline',data:f.returned()}),/storage offline/);assert.deepEqual(failed.dump(),before);
  await f.run('purchaseReturn.create',f.returned(),'return');await f.store.transaction(async tx=>tx.delete(`${f.root}/idempotency/return`));const saved=f.store.dump();await assert.rejects(f.run('purchaseReturn.create',f.returned(1,'line-2'),'return'),/معرّف المردود موجود/);assert.deepEqual(f.store.dump(),saved);await f.books();
});

test('B3 zero original purchase line credits preserve physical return evidence without invented zero journals',async()=>{
  const f=await fixture('cash'),product=(await f.run('product.create',{name:'عينة',unit:'قطعة',price_sdg:0,price_usd:0,is_active:true,track_inventory:true,stock_quantity:0},'zero-product')).result;
  const bill=(await f.run('purchase.create',{...f.buy,supplier_reference:'zero-line',issue_date:'2026-10-07',due_date:'2026-10-07',items:[{product_id:product.id,quantity:1,unit_cost:0,zero_cost_reason:'عينة المورد'},{product_id:f.product.id,quantity:1,unit_cost:20}]},'zero-buy')).result;
  const count=(await f.books()).collections.journal_entries.length,r=await f.run('purchaseReturn.create',{...f.returned(),bill_id:bill.id},'zero-return');assert.equal(r.result.journal_id,undefined);const s=await f.books();assert.equal(s.collections.journal_entries.length,count);assert.equal(s.collections.products.find(p=>p.id===product.id)!.stock_quantity,0);assert.equal(s.collections.inventory_movements.find(m=>m.reference_id===r.result.id)!.value_delta_usd,0);
});
