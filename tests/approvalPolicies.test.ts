import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { MemoryStore, type Store } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { createApi } from '../server/api';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { defaultPlatformPlans } from '../src/lib/plans';
import { canApprove, requiredApprovalRole, validateApprovalData, validateApprovalPolicyInput, type ApprovalPolicy } from '../src/domain/approvalPolicies';

const now = new Date('2026-10-14T03:00:00Z');
const owner = { uid:'approval-owner', email:'owner@example.com', emailVerified:true, authTime:Math.floor(now.getTime()/1000) };
const member = (uid:string,role:'Admin'|'Accountant'|'Sales'|'Cashier'|'Viewer') => ({ uid, email:`${uid}@example.com`, emailVerified:true, role });
const policyInput = (updates:Record<string,unknown>={}) => ({
  id:'commercial',name:'السياسة التجارية',active:true,reason:'اعتماد حدود الصلاحيات',
  discount:{sales_max_percent:5,admin_max_percent:15},
  expense:{accountant_max_sdg:100000,accountant_max_usd:100,admin_max_sdg:1000000,admin_max_usd:1000},
  refund:{accountant_max_sdg:50000,accountant_max_usd:50,admin_max_sdg:500000,admin_max_usd:500},
  credit_limit:{required_role:'Admin'},
  ...updates,
});

async function fixture() {
  const store=new MemoryStore(),organizations=new Organizations(store),org=await organizations.create(owner,'مؤسسة الموافقات',INITIAL_SETTINGS,'approval-org',true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{
    tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'});
    tx.set('plans/Enterprise',defaultPlatformPlans(now.toISOString()).find(row=>row.id==='Enterprise')!);
    for(const [uid,role] of [['admin','Admin'],['accountant','Accountant'],['sales','Sales'],['cashier','Cashier'],['viewer','Viewer']] as const)tx.set(`${root}/members/${uid}`,{uid,org_id:org.id,role,status:'active'});
  });
  const ops=new Operations(store,()=>now),run=(actor:typeof owner|ReturnType<typeof member>,action:string,data:Record<string,unknown>,operationId:string=crypto.randomUUID())=>ops.execute(org.id,actor,{action,data,operationId});
  return{store,organizations,org,root,ops,run};
}

test('D4.1 approval policy validation derives dual-book escalation without permissive role aliases',()=>{
  const parsed=validateApprovalPolicyInput(policyInput());
  const policy={...parsed,org_id:'org',revision:1,previous_version_hash:null,version_hash:'',created_by:'owner',created_at:now.toISOString(),updated_by:'owner',updated_at:now.toISOString(),operation_id:'policy'} as ApprovalPolicy;
  const role=(kind:'discount'|'expense'|'refund'|'credit_limit',fields:Partial<{discount_percent:number;amount_sdg:number;amount_usd:number;overage_sdg:number;overage_usd:number}>)=>requiredApprovalRole(policy,{kind,discount_percent:0,amount_sdg:0,amount_usd:0,overage_sdg:0,overage_usd:0,...fields});
  assert.equal(role('discount',{discount_percent:5}),'Sales');assert.equal(role('discount',{discount_percent:5.0001}),'Admin');assert.equal(role('discount',{discount_percent:15.0001}),'Owner');
  assert.equal(role('expense',{amount_sdg:100000,amount_usd:100}),'Accountant');assert.equal(role('expense',{amount_sdg:1,amount_usd:100.01}),'Admin');assert.equal(role('refund',{amount_sdg:500001}),'Owner');assert.equal(role('credit_limit',{overage_sdg:1}),'Admin');
  assert.equal(canApprove('Admin','Sales'),true);assert.equal(canApprove('Accountant','Sales'),false);assert.equal(canApprove('Sales','Accountant'),false);assert.equal(canApprove('Owner','Owner'),true);
  assert.throws(()=>validateApprovalPolicyInput(policyInput({discount:{sales_max_percent:20,admin_max_percent:15}})),/يتجاوز/);
  assert.throws(()=>validateApprovalPolicyInput(policyInput({expense:{accountant_max_sdg:1000001,accountant_max_usd:0,admin_max_sdg:1000000,admin_max_usd:0}})),/المحاسب/);
});

test('D4.1 protected policy and request workflow enforces version, reviewer role, separation of duties and idempotency',async()=>{
  const f=await fixture(),admin=member('admin','Admin'),accountant=member('accountant','Accountant'),sales=member('sales','Sales');
  const policy=(await f.run(owner,'approvalPolicy.create',policyInput(),'policy-create')).result;
  assert.equal(policy.revision,1);assert.match(policy.version_hash,/^[a-f0-9]{64}$/);
  await assert.rejects(f.run(owner,'approvalPolicy.update',policyInput({expected_revision:1}),'policy-noop'),/لم تتغير/);
  const requestData={id:'discount-10',policy_id:policy.id,kind:'discount',subject_type:'invoice',subject_id:'draft-1',reason:'خصم تفاوضي',discount_percent:10,payload:{customer_id:'customer',lines:[{product_id:'service',quantity:1}]}};
  const request=(await f.run(sales,'approvalRequest.create',requestData,'request-create')).result;
  assert.equal(request.required_role,'Admin');assert.equal(request.status,'pending');assert.match(request.request_hash,/^[a-f0-9]{64}$/);
  await assert.rejects(f.run(accountant,'approvalRequest.approve',{id:request.id,expected_revision:1,reason:'أوافق'},'weak-review'),/Admin/);
  const approved=(await f.run(admin,'approvalRequest.approve',{id:request.id,expected_revision:1,reason:'ضمن الهامش'},'approve')).result;
  assert.equal(approved.status,'approved');assert.equal(approved.revision,2);assert.match(approved.review_hash,/^[a-f0-9]{64}$/);
  assert.deepEqual((await f.run(admin,'approvalRequest.approve',{id:request.id,expected_revision:1,reason:'ضمن الهامش'},'approve')).result,approved);
  await assert.rejects(f.run(sales,'approvalRequest.create',requestData,'request-create'),/تغير/);
  await assert.rejects(f.run(admin,'approvalRequest.reject',{id:request.id,expected_revision:2,reason:'متأخر'},'late-reject'),/لم يعد معلق/);
  const self=(await f.run(admin,'approvalRequest.create',{id:'owner-discount',policy_id:policy.id,kind:'discount',subject_type:'invoice',subject_id:'draft-owner',reason:'خصم كبير',discount_percent:20,payload:{}},'owner-request')).result;
  await assert.rejects(f.run(admin,'approvalRequest.approve',{id:self.id,expected_revision:1,reason:'ذاتي'},'self-review'),/مقدم الطلب/);
});

test('D4.1 historical pending requests retain the frozen policy version and reject tampering atomically',async()=>{
  const f=await fixture(),sales=member('sales','Sales'),admin=member('admin','Admin');
  const first=(await f.run(owner,'approvalPolicy.create',policyInput(),'policy-v1')).result;
  const pending=(await f.run(sales,'approvalRequest.create',{id:'historic',policy_id:first.id,kind:'discount',subject_type:'invoice',subject_id:'draft-historic',reason:'موافقة حسب الإصدار الأول',discount_percent:10,payload:{total_sdg:1000}},'historic-request')).result;
  const second=(await f.run(owner,'approvalPolicy.update',policyInput({expected_revision:1,discount:{sales_max_percent:4,admin_max_percent:12}}),'policy-v2')).result;
  assert.equal(second.revision,2);assert.equal(second.previous_version_hash,first.version_hash);
  const approved=(await f.run(admin,'approvalRequest.approve',{id:pending.id,expected_revision:1,reason:'الإصدار الأول ساري على الطلب'},'historic-approve')).result;assert.equal(approved.policy_revision,1);assert.equal(approved.status,'approved');
  const next=(await f.run(sales,'approvalRequest.create',{id:'tampered',policy_id:first.id,kind:'discount',subject_type:'invoice',subject_id:'draft-tampered',reason:'طلب سيُختبر',discount_percent:10,payload:{}},'tampered-request')).result;
  await f.store.transaction(async tx=>tx.set(`${f.root}/approval_requests/${next.id}`,{...await tx.get(`${f.root}/approval_requests/${next.id}`),request_hash:'0'.repeat(64)}));
  const before=f.store.dump();await assert.rejects(f.run(admin,'approvalRequest.approve',{id:next.id,expected_revision:1,reason:'يجب أن يفشل'},'tampered-approve'),/بصمة/);assert.deepEqual(f.store.dump(),before);
});

test('D4.1 protected reads filter requester visibility and API/browser gates fail closed',async()=>{
  const f=await fixture(),sales=member('sales','Sales'),cashier=member('cashier','Cashier'),admin=member('admin','Admin');
  const policy=(await f.run(owner,'approvalPolicy.create',policyInput(),'policy-read')).result;
  await f.run(sales,'approvalRequest.create',{id:'sales-own',policy_id:policy.id,kind:'discount',subject_type:'invoice',subject_id:'draft-sales',reason:'طلب مبيعات',discount_percent:10,payload:{}},'sales-own');
  assert.deepEqual((await f.ops.approvalRequests(f.org.id,sales)).requests.map(row=>row.id),['sales-own']);assert.equal((await f.ops.approvalRequests(f.org.id,cashier)).requests.length,0);assert.equal((await f.ops.approvalRequests(f.org.id,admin,'pending')).requests.length,1);
  await assert.rejects(f.ops.approvalPolicies(f.org.id,sales),/صلاحية/);await assert.rejects(f.ops.approvalRequests(f.org.id,admin,'unknown'),/حالة/);
  const browser:Store={authority:'browser',transaction:work=>f.store.transaction(work)},server:Store={authority:'server',transaction:work=>f.store.transaction(work)};
  await assert.rejects(new Operations(browser,()=>now).approvalRequests(f.org.id,admin),/الخادم/);await assert.rejects(new Operations(server,()=>now).approvalRequests(f.org.id,admin),/قواعد حماية/);
  const beforeBrowserWrite=f.store.dump();await assert.rejects(new Operations(browser,()=>now).execute(f.org.id,admin,{action:'approvalRequest.reject',operationId:'browser-review',data:{id:'sales-own',expected_revision:1,reason:'محاولة من المتصفح'}}),/الخادم/);assert.deepEqual(f.store.dump(),beforeBrowserWrite);
  const app=express();app.use(express.json());app.use('/api',createApi({operations:f.ops,verify:async token=>token==='sales'?sales:admin}));const http=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>http.once('listening',resolve));
  try{const base=`http://127.0.0.1:${(http.address() as any).port}/api/organizations/${f.org.id}`;let response=await fetch(`${base}/approval-requests`,{headers:{authorization:'Bearer sales'}});assert.equal(response.status,200);assert.deepEqual((await response.json()).requests.map((row:any)=>row.id),['sales-own']);response=await fetch(`${base}/approval-policies`,{headers:{authorization:'Bearer sales'}});assert.equal(response.status,403);response=await fetch(`${base}/approval-requests?extra=1`,{headers:{authorization:'Bearer admin'}});assert.equal(response.status,400);}finally{await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));}
  const expired=await fixture(),expiredSales=member('sales','Sales'),expiredPolicy=(await expired.run(owner,'approvalPolicy.create',policyInput(),'expired-policy')).result;
  await expired.store.transaction(async tx=>tx.set(expired.root,{...await tx.get(expired.root),subscriptionEnd:'2026-10-13T23:59:59Z'}));const beforeExpiredWrite=expired.store.dump();
  await assert.rejects(expired.run(expiredSales,'approvalRequest.create',{id:'expired-request',policy_id:expiredPolicy.id,kind:'discount',subject_type:'invoice',subject_id:'expired-draft',reason:'يجب رفضه',discount_percent:10,payload:{}},'expired-request'),/الاشتراك/);assert.deepEqual(expired.store.dump(),beforeExpiredWrite);
});

test('D4.1 approval backup verifies hashes, counts and tenant remap before atomic restore',async()=>{
  const f=await fixture(),sales=member('sales','Sales'),admin=member('admin','Admin');
  const policy=(await f.run(owner,'approvalPolicy.create',policyInput(),'backup-policy')).result,request=(await f.run(sales,'approvalRequest.create',{id:'backup-request',policy_id:policy.id,kind:'discount',subject_type:'invoice',subject_id:'backup-draft',reason:'نسخ الطلب',discount_percent:10,payload:{amount:1000}},'backup-request')).result;
  await f.run(admin,'approvalRequest.approve',{id:request.id,expected_revision:1,reason:'معتمد للنسخ'},'backup-approve');
  const backup=await f.ops.snapshot(f.org.id,owner,true);assert.equal(backup.approval_schema_version,1);assert.equal(backup.counters.approval_request_count,1);await validateApprovalData(backup.collections,f.org.id);
  const corrupt=structuredClone(backup);corrupt.collections.approval_requests[0].payload.amount=1001;await assert.rejects(validateApprovalData(corrupt.collections,f.org.id),/بصمة/);
  const targetOwner={...owner,uid:'approval-restore-owner',email:'restore@example.com'},target=await f.organizations.create(targetOwner,'استعادة الموافقات',INITIAL_SETTINGS,'approval-restore',true),targetRoot=`organizations/${target.id}`;
  await f.store.transaction(async tx=>tx.set(targetRoot,{...await tx.get(targetRoot),accounting_version:2,planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'}));
  const targetOps=new Operations(f.store,()=>now),before=f.store.dump();await assert.rejects(targetOps.execute(target.id,targetOwner,{action:'backup.restore',operationId:'corrupt-restore',data:{backup:corrupt}}),/بصمة/);assert.deepEqual(f.store.dump(),before);
  await targetOps.execute(target.id,targetOwner,{action:'backup.restore',operationId:'valid-restore',data:{backup}});const restored=await targetOps.snapshot(target.id,targetOwner,true);assert.equal(restored.collections.approval_requests[0].org_id,target.id);assert.equal(restored.collections.approval_policies[0].org_id,target.id);await validateApprovalData(restored.collections,target.id);
});

test('D4.2 customer terms and exact operation approvals are enforced and consumed atomically',async()=>{
  const f=await fixture(),sales=member('sales','Sales'),admin=member('admin','Admin'),accountant=member('accountant','Accountant');
  const policy=(await f.run(owner,'approvalPolicy.create',policyInput(),'integration-policy')).result;
  const customer=(await f.run(owner,'customer.create',{name:'عميل ائتماني',phone:'',preferred_currency:'SDG',payment_terms_days:15,credit_limit_sdg:500,credit_limit_usd:null},'credit-customer')).result;
  const invoice={customer_id:customer.id,issue_date:'2026-10-14',currency_mode:'single_sdg',exchange_rate_used:0,discount_type:'fixed',discount_value:0,items:[{description:'خدمة',unit:'خدمة',quantity:1,unit_price:1000,currency:'SDG',tax_rate:0,discount_percent:0}]};
  const before=f.store.dump();
  await assert.rejects(f.run(sales,'invoice.create',invoice,'credit-sale'),/credit_limit/);assert.deepEqual(f.store.dump(),before);
  const requestResult=(await f.run(sales,'approvalRequest.createForOperation',{policy_id:policy.id,target_action:'invoice.create',target_operation_id:'credit-sale',reason:'تجاوز مدروس للحد',command_data:invoice},'credit-request')).result;
  assert.equal(requestResult.requests.length,1);const request=requestResult.requests[0];assert.equal(request.kind,'credit_limit');assert.equal(request.overage_sdg,500);
  await f.run(admin,'approvalRequest.approve',{id:request.id,expected_revision:1,reason:'العميل موثوق'},'credit-review');
  const command={...invoice,approval_request_ids:[request.id]},issued=(await f.run(sales,'invoice.create',command,'credit-sale')).result;
  assert.equal(issued.due_date,'2026-10-29');assert.equal(issued.payment_terms_days,15);assert.equal(issued.approval_evidence[0].request_id,request.id);
  assert.deepEqual((await f.run(sales,'invoice.create',command,'credit-sale')).result,issued);
  const consumed=await f.store.transaction(tx=>tx.get(`${f.root}/approval_requests/${request.id}`));assert.equal(consumed.consumed_operation_id,'credit-sale');assert.match(consumed.consumption_hash,/^[a-f0-9]{64}$/);
  await assert.rejects(f.run(sales,'invoice.create',{...invoice,approval_request_ids:[request.id]},'different-sale'),/لا يطابق|استهلك|تتطلب موافقة/);
  await assert.rejects(f.run(owner,'invoice.update',{id:issued.id,updates:{due_date:'2026-10-30'}},'override-terms'),/شروط السداد/);

  const expense={title:'حملة كبيرة',category:'تسويق',amount:200000,currency:'SDG',date:'2026-10-14'};
  await assert.rejects(f.run(accountant,'expense.create',expense,'large-expense'),/expense/);
  const expenseRequest=(await f.run(accountant,'approvalRequest.createForOperation',{policy_id:policy.id,target_action:'expense.create',target_operation_id:'large-expense',reason:'ميزانية الحملة',command_data:expense},'expense-request')).result.requests[0];
  assert.equal(expenseRequest.required_role,'Admin');await f.run(admin,'approvalRequest.approve',{id:expenseRequest.id,expected_revision:1,reason:'ضمن الميزانية'},'expense-review');
  const savedExpense=(await f.run(accountant,'expense.create',{...expense,approval_request_ids:[expenseRequest.id]},'large-expense')).result;
  assert.equal(savedExpense.approval_evidence[0].request_id,expenseRequest.id);
  const backup=await f.ops.snapshot(f.org.id,owner,true);await validateApprovalData(backup.collections,f.org.id);
  const corrupt=structuredClone(backup.collections);corrupt.approval_requests.find((row:any)=>row.id===expenseRequest.id).consumption_hash='0'.repeat(64);await assert.rejects(validateApprovalData(corrupt,f.org.id),/استهلاك/);
});
