import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { createDefaultSubscription, getPlanConfig } from '../src/lib/plans';

const now = new Date('2026-10-14T09:30:00Z');
const owner: Actor = { uid: 'gate-owner', email: 'gate-owner@example.test', emailVerified: true, authTime: Math.floor(now.getTime() / 1000) };
async function fixture() {
  const store = new MemoryStore(), org = await new Organizations(store).create(owner, 'بوابات الاعتماد', INITIAL_SETTINGS, 'setup', true), root = `organizations/${org.id}`;
  await store.transaction(async tx => { const plan = getPlanConfig('Enterprise'); tx.set(`${root}/meta/subscription`, { ...createDefaultSubscription(org.id), ...plan, plan: plan.name }); tx.set(root, { ...await tx.get(root), accounting_version:2, planId: plan.name, subscriptionStatus: 'active', subscriptionEnd: '2027-01-01' }); });
  const ops = new Operations(store, () => now, saved => saved as any), run = (action:string,data:Record<string,unknown>,operationId:string,actor=owner)=>ops.execute(org.id,actor,{action,data,operationId});
  const customer=(await run('customer.create',{name:'عميل',phone:'',preferred_currency:'SDG'},'customer')).result;
  const product=(await run('product.create',{name:'خدمة',unit:'خدمة',price_sdg:1000,price_usd:1,tax_rate:0,is_active:true,track_inventory:false,stock_quantity:0},'product')).result;
  return {store,org,root,ops,run,customer,product};
}
const tiers=[{max_value:5,required_role:'Sales'},{max_value:15,required_role:'Admin'},{max_value:null,required_role:'Owner'}];

test('D4.3.2 invoice discount gate rejects atomically and freezes the policy revision and derived effective rate',async()=>{
  const f=await fixture();
  await f.run('approvalPolicy.create',{id:'discount',subject:'discount',currency:'PERCENT',active:true,tiers,reason:'ضبط الخصومات'},'policy');
  const sales:Actor={uid:'gate-sales',email:'sales@example.test',emailVerified:true};
  const admin:Actor={uid:'gate-admin',email:'admin@example.test',emailVerified:true};
  await f.store.transaction(async tx=>{tx.set(`${f.root}/members/${sales.uid}`,{uid:sales.uid,role:'Sales',status:'active'});tx.set(`${f.root}/members/${admin.uid}`,{uid:admin.uid,role:'Admin',status:'active'});});
  const invoice={customer_id:f.customer.id,issue_date:'2026-10-14',currency_mode:'single_sdg',exchange_rate_used:0,discount_type:'fixed',discount_value:0,items:[{product_id:f.product.id,description:'خدمة',unit:'خدمة',quantity:1,unit_price:1000,currency:'SDG',tax_rate:0,discount_percent:10}]};
  const before=f.store.dump();await assert.rejects(f.run('invoice.create',invoice,'sales-denied',sales),/Admin/);assert.deepEqual(f.store.dump(),before);
  const saved=(await f.run('invoice.create',{...invoice,approval_reason:'خصم تعاقدي موثق'},'admin-approved',admin)).result;
  assert.deepEqual(saved.approval_evidence,{policy_id:'discount',policy_revision:1,subject:'discount',currency:'PERCENT',value:10,required_role:'Admin',approved:true,approved_by:admin.uid,approved_by_role:'Admin',approval_reason:'خصم تعاقدي موثق'});
  await f.run('approvalPolicy.update',{id:'discount',expected_revision:1,subject:'discount',currency:'PERCENT',active:true,tiers:[{max_value:20,required_role:'Sales'},{max_value:null,required_role:'Owner'}],reason:'تعديل لاحق'},'policy-update');
  assert.equal((await f.ops.snapshot(f.org.id,owner,true)).collections.invoices[0].approval_evidence.policy_revision,1);
});

test('D4.3.2 expense gate uses native currency, requires reason and leaves rejected writes atomic',async()=>{
  const f=await fixture();
  await f.run('approvalPolicy.create',{id:'expense-sdg',subject:'expense',currency:'SDG',active:true,tiers:[{max_value:1000,required_role:'Accountant'},{max_value:null,required_role:'Owner'}],reason:'ضبط المصروفات'},'policy');
  const accountant:Actor={uid:'gate-accountant',email:'accountant@example.test',emailVerified:true};
  await f.store.transaction(async tx=>tx.set(`${f.root}/members/${accountant.uid}`,{uid:accountant.uid,role:'Accountant',status:'active'}));
  const expense={title:'نثريات',category:'تشغيل',amount:500,currency:'SDG',date:'2026-10-14',payment_method:'cash'};
  const before=f.store.dump();await assert.rejects(f.run('expense.create',expense,'no-reason',accountant),/النص المطلوب/);assert.deepEqual(f.store.dump(),before);
  const saved=(await f.run('expense.create',{...expense,approval_reason:'فاتورة مصروف مرفقة'},'approved',accountant)).result;
  assert.equal(saved.approval_evidence.required_role,'Accountant');assert.equal(saved.approval_evidence.value,500);assert.equal(saved.approval_evidence.approved_by,accountant.uid);
  await assert.rejects(f.run('expense.create',{...expense,amount:1500,approval_reason:'أعلى من الحد'},'over',accountant),/Owner/);
});
