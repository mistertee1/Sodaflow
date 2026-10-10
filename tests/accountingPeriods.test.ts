import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { MemoryStore, type Store } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { journalLine } from '../src/domain/financial';
import { getPlanConfig,createDefaultSubscription } from '../src/lib/plans';
import { assertRecentOwner,validatePeriods,periodLedgerHash } from '../src/domain/periodContracts';
import { createApi } from '../server/api';

const time=new Date('2026-10-07T12:00:00Z'), owner:Actor={uid:'period-owner',email:'p@example.com',emailVerified:true,authTime:time.getTime()/1000};
async function fixture() {
  const store=new MemoryStore(),organizations=new Organizations(store),org=await organizations.create(owner,'الفترات',INITIAL_SETTINGS,crypto.randomUUID(),true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>tx.set(`${root}/meta/subscription`,{...createDefaultSubscription(org.id),...getPlanConfig('Enterprise'),org_id:org.id,plan:'Enterprise'}));
  const ops=new Operations(store,()=>time),run=(action:string,data:Record<string,unknown>,operationId:string=crypto.randomUUID(),actor=owner)=>ops.execute(org.id,actor,{action,data,operationId});
  await run('accounting.activate',{reason:'اختبار الفترات'});
  const create=()=>run('period.create',{id:'2026-10',start_date:'2026-10-01',end_date:'2026-10-07',reason:'دورة أكتوبر'},'period');
  const rows=(name:string)=>Object.entries(store.dump()).filter(([path])=>path.startsWith(`${root}/${name}/`)).map(([,row])=>row);
  const manual=(amount=100)=>({reference_type:'manual',description:'رأس مال',date:'2026-10-07',lines:[journalLine('1110','cash',amount,0,amount/2000,0),journalLine('3100','capital',0,amount,0,amount/2000)]});
  return {store,org,root,ops,run,create,rows,manual,organizations};
}
test('C1 period creation validates real dates, exact nonoverlap, caller fields and unique tenant IDs atomically',async()=>{
  const f=await fixture();await f.create();
  for(const data of [{id:'same',start_date:'2026-10-07',end_date:'2026-11-01'},{id:'bad',start_date:'2026-02-30',end_date:'2026-03-01'},{id:'long',start_date:'2025-01-01',end_date:'2026-01-02'},{id:'forged',start_date:'2026-11-01',end_date:'2026-11-30',status:'CLOSED'},{id:'../org',start_date:'2026-11-01',end_date:'2026-11-30'}]){const before=f.store.dump();await assert.rejects(f.run('period.create',{...data,reason:'اختبار'}));assert.deepEqual(f.store.dump(),before);}
  await f.run('period.create',{id:'next',start_date:'2026-10-08',end_date:'2026-10-31',reason:'الفترة التالية'});assert.equal((await f.ops.periodReports(f.org.id,owner)).periods.length,2);
  const row=f.rows('accounting_periods')[0];assert.throws(()=>validatePeriods([{...row,org_id:'foreign'}],f.org.id),/أخرى/);
});
test('C1 soft close rejects ordinary postings by every role and permits only explicitly reasoned Owner/Accountant manual adjustments',async()=>{
  const f=await fixture();await f.create();await f.run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة مبدئية'},'soft');
  for(const role of ['Owner','Accountant','Admin']){const actor=role==='Owner'?owner:{...owner,uid:role};if(role!=='Owner')await f.store.transaction(async tx=>tx.set(`${f.root}/members/${role}`,{uid:role,role,status:'active'}));const before=f.store.dump();await assert.rejects(f.run('journal.create',f.manual(),'normal-'+role,actor),/مبدئياً/);assert.deepEqual(f.store.dump(),before);}
  const accountant={...owner,uid:'Accountant'};await assert.rejects(f.run('journal.create',{...f.manual(),adjusting:true},'no-reason',accountant));
  const posted=(await f.run('journal.create',{...f.manual(),adjusting:true,reason:'تسوية المراجعة'},'adjust',accountant)).result;assert.equal(posted.adjusting,true);assert.equal(posted.period_id,'2026-10');assert.equal(posted.adjustment_reason,'تسوية المراجعة');
  await assert.rejects(f.run('journal.create',{...f.manual(),adjusting:true,reason:'تجاوز'},'admin-adjust',{...owner,uid:'Admin'}),/مبدئياً/);
  await assert.rejects(f.run('expense.create',{title:'تجاوز',date:'2026-10-07',adjusting:true,reason:'تجاوز'},'expense-adjust',accountant),/مبدئياً/);
  const audit=f.store.dump()[`${f.root}/audit_logs/audit-soft`];assert.equal(audit.previous_state[`${f.root}/accounting_periods/2026-10`].status,'OPEN');assert.equal(audit.new_state[`${f.root}/accounting_periods/2026-10`].status,'SOFT_CLOSED');
});
test('C1 close requires soft status, FX review and current zero-difference native cash evidence; stale matches block close',async()=>{
  const f=await fixture();await f.create();await assert.rejects(f.run('period.close',{id:'2026-10',expected_revision:1,reason:'نهائي',fx_review_completed:true}),/مبدئي/);
  const cash=(await f.run('financialAccount.create',{name:'الصندوق',account_code:'1110',currency:'SDG',kind:'cash'})).result;await f.run('journal.create',f.manual());await f.run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة'});
  await assert.rejects(f.run('period.close',{id:'2026-10',expected_revision:2,reason:'نهائي'}),/الصرف/);
  assert.equal((await f.ops.periodReports(f.org.id,owner,'2026-10')).checklist?.can_close,false);
  await assert.rejects(f.run('period.close',{id:'2026-10',expected_revision:2,reason:'نهائي',fx_review_completed:true}),/مطابق|فحص/);
  await f.run('cashCount.create',{financial_account_id:cash.id,date:'2026-10-07',actual_count:100,difference_reason:''},'count');
  await f.run('cashCount.create',{financial_account_id:cash.id,date:'2026-10-07',actual_count:90,difference_reason:'فرق الجرد الأحدث'},'difference-count');
  await assert.rejects(f.run('period.close',{id:'2026-10',expected_revision:2,reason:'نهائي',fx_review_completed:true}),/مطابق|فحص/);
  await f.run('cashCount.create',{financial_account_id:cash.id,date:'2026-10-07',actual_count:100,difference_reason:''},'refreshed-count');
  await f.run('journal.create',{...f.manual(60),adjusting:true,reason:'قيد بعد الجرد'},'after-count');await assert.rejects(f.run('period.close',{id:'2026-10',expected_revision:2,reason:'نهائي',fx_review_completed:true}),/مطابق|فحص/);
  await f.run('cashCount.create',{financial_account_id:cash.id,date:'2026-10-07',actual_count:160,difference_reason:''},'new-count');
  const closed=(await f.run('period.close',{id:'2026-10',expected_revision:2,reason:'راجعنا الفروقات',fx_review_completed:true},'close')).result;assert.equal(closed.status,'CLOSED');assert.equal(closed.close_evidence.findings_count,0);assert.equal(closed.close_evidence.reconciliations[0].id,'cr-new-count');
  await assert.rejects(f.run('journal.create',{...f.manual(),adjusting:true,reason:'تجاوز نهائي'}),/نهائياً/);
});
test('C1 all protected financial dates and cached requests obey period coverage and close without partial writes',async()=>{
  const f=await fixture();await f.create();const manual=f.manual();await f.run('journal.create',manual,'cached');await f.run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة'});
  const inputs:[string,Record<string,unknown>][]=[['journal.create',manual],['invoice.create',{issue_date:'2026-10-07'}],['purchase.create',{issue_date:'2026-10-07'}],['expense.create',{date:'2026-10-07'}],['supplierPayment.create',{bill_id:'none',payment_date:'2026-10-07'}],['creditNote.create',{invoice_id:'none',date:'2026-10-07'}],['customerRefund.create',{invoice_id:'none',financial_account_id:'none',date:'2026-10-07'}],['purchaseReturn.create',{bill_id:'none',date:'2026-10-07'}],['supplierRefund.create',{bill_id:'none',financial_account_id:'none',date:'2026-10-07'}],['cashTransfer.create',{date:'2026-10-07'}],['product.stock',{}],['product.cost.establish',{}],['inventory.receive',{}],['payment.create',{}],['product.create',{track_inventory:true}]];
  for(const [action,data] of inputs){const before=f.store.dump();await assert.rejects(f.run(action,data,action==='journal.create'?'cached':crypto.randomUUID()),/مبدئياً/);assert.deepEqual(f.store.dump(),before);}
  await f.run('period.reopen',{id:'2026-10',expected_revision:2,reason:'مراجعة جديدة'});await assert.rejects(f.run('journal.create',{...manual,date:'2026-10-08'}),/خارج الفترات/);
  assert.deepEqual((await f.run('journal.create',manual,'cached')).result,f.rows('journal_entries')[0]);
});
test('C1 reopen requires verified recent auth_time of actual Owner and reason; cached lifecycle cannot report an obsolete state',async()=>{
  const f=await fixture();await f.create();await f.run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة'},'soft');
  const data={id:'2026-10',expected_revision:2,reason:'إعادة المراجعة'};
  for(const actor of [{...owner,authTime:undefined},{...owner,authTime:owner.authTime!-301},{...owner,authTime:owner.authTime!+31}]){const before=f.store.dump();await assert.rejects(f.run('period.reopen',data,'reopen',actor),/التحقق/);assert.deepEqual(f.store.dump(),before);}
  for(const role of ['Admin','Accountant']){const actor={...owner,uid:role};await f.store.transaction(async tx=>tx.set(`${f.root}/members/${role}`,{uid:role,role,status:'active'}));await assert.rejects(f.run('period.reopen',data,role,actor),/صلاحية/);}
  await assert.rejects(f.run('period.reopen',{...data,reason:''},'no-reason'));await assert.rejects(f.run('period.reopen',{...data,authTime:owner.authTime},'forged'),/مدخلات/);
  const reopened=(await f.run('period.reopen',data,'reopen')).result;assert.equal(reopened.previous_status,'SOFT_CLOSED');assert.equal(reopened.reopened_by,owner.uid);assert.equal(reopened.reopen_reason,data.reason);
  assert.equal(f.store.dump()[`${f.root}/audit_logs/audit-reopen`].reauthentication.auth_time,owner.authTime);
  await f.run('period.softClose',{id:'2026-10',expected_revision:3,reason:'إقفال جديد'},'second-soft');await assert.rejects(f.run('period.reopen',data,'reopen'),/تغيرت/);
  assert.doesNotThrow(()=>assertRecentOwner('Owner',owner.authTime!-300,time));assert.throws(()=>assertRecentOwner('Admin',owner.authTime,time));
});
test('C1 period commands enforce browser authority, current subscription and membership before cached mutations',async()=>{
  const f=await fixture();await f.create();const data={id:'2026-10',start_date:'2026-10-01',end_date:'2026-10-07',reason:'دورة أكتوبر'};
  const browser:Store={authority:'browser',transaction:work=>f.store.transaction(work)};await assert.rejects(new Operations(browser,()=>time).execute(f.org.id,owner,{action:'period.create',data,operationId:'period'}),/الخادم/);
  await f.store.transaction(async tx=>tx.set(f.root,{...await tx.get(f.root),planId:'Enterprise',subscriptionEnd:'2026-10-06'}));await assert.rejects(f.run('period.create',data,'period'),/اشتراك|منتهي|انتهى/);
});
test('C1 legacy lock remains additive and cannot be cleared through settings without recent Owner reauthentication and reason',async()=>{
  const f=await fixture();await f.run('settings.update',{updates:{period_lock_date:'2026-10-07'}},'lock');await f.create();await assert.rejects(f.run('journal.create',f.manual()),/مقفلة/);
  await assert.rejects(f.run('settings.update',{updates:{period_lock_date:''},reason:'فتح' },'old-login',{...owner,authTime:undefined}),/التحقق/);await assert.rejects(f.run('settings.update',{updates:{period_lock_date:''}},'missing-reason'));
  await f.run('settings.update',{updates:{period_lock_date:''},reason:'ترحيل الحماية للفترات'},'unlock');await f.run('journal.create',f.manual());const audit=f.store.dump()[`${f.root}/audit_logs/audit-unlock`];assert.deepEqual(audit.legacy_period_lock,{previous:'2026-10-07',new:null});
});
test('C1 closed periods survive backup/restore tenant remapping; missing periods or altered closure proof reject atomically',async()=>{
  const f=await fixture();await f.create();await f.run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة'});await f.run('period.close',{id:'2026-10',expected_revision:2,reason:'إقفال فارغ',fx_review_completed:true});
  const backup=await f.ops.snapshot(f.org.id,owner,true),targetOwner={...owner,uid:'new-period-owner'},target=await f.organizations.create(targetOwner,'نسخة فترات',INITIAL_SETTINGS,'new-period-org');await f.store.transaction(async tx=>tx.set(`organizations/${target.id}/meta/subscription`,{...createDefaultSubscription(target.id),...getPlanConfig('Enterprise'),org_id:target.id,plan:'Enterprise'}));
  for(const broken of [ {...backup,collections:{...backup.collections,accounting_periods:[]}}, {...backup,collections:{...backup.collections,accounting_periods:backup.collections.accounting_periods.map(row=>({...row,close_evidence:{...row.close_evidence,ledger_hash:'0'.repeat(64)}}))}} ]){const before=f.store.dump();await assert.rejects(f.ops.execute(target.id,targetOwner,{action:'backup.restore',data:{backup:broken},operationId:crypto.randomUUID()}));assert.deepEqual(f.store.dump(),before);}
  await f.ops.execute(target.id,targetOwner,{action:'backup.restore',data:{backup},operationId:'restore-periods'});const copied=await f.ops.snapshot(target.id,targetOwner,true);assert.equal(copied.collections.accounting_periods[0].org_id,target.id);assert.equal(copied.collections.accounting_periods[0].status,'CLOSED');assert.equal(copied.org.owner_uid,targetOwner.uid);assert.equal(copied.collections.accounting_periods[0].close_evidence.ledger_hash,await periodLedgerHash(copied.collections.journal_entries,'2026-10-07'));
  await assert.rejects(f.ops.execute(target.id,targetOwner,{action:'journal.create',data:f.manual(),operationId:'blocked-restore'}),/نهائياً/);
});
test('C1 real HTTP uses trusted actor auth_time and protected reports, rejecting request-supplied reauthentication and stale sessions',async()=>{
  const f=await fixture();await f.create();await f.run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة'});const app=express();app.use(express.json());app.use('/api',createApi({operations:f.ops,verify:async token=>token==='fresh'?owner:{...owner,authTime:owner.authTime!-301}}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}`;
  try {assert.equal((await fetch(base+'/accounting-periods')).status,401);const report=await fetch(base+'/accounting-periods?periodId=2026-10',{headers:{Authorization:'Bearer fresh'}});assert.equal(report.status,200);assert.equal((await report.json()).checklist.can_close,true);
    const send=(token:string,data:Record<string,unknown>)=>fetch(base+'/operations',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'period.reopen',data,operationId:crypto.randomUUID(),authTime:owner.authTime})});const data={id:'2026-10',expected_revision:2,reason:'فتح موثق'};assert.equal((await send('stale',data)).status,401);assert.equal((await send('fresh',{...data,authTime:owner.authTime})).status,400);assert.equal((await send('fresh',data)).status,200);
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('C1 funded closed cash restores the exact period and matching source; stripped or substituted reconciliation proof is rejected',async()=>{
  const f=await fixture();await f.create();const cash=(await f.run('financialAccount.create',{name:'صندوق محفوظ',account_code:'1110',currency:'SDG',kind:'cash'})).result;
  await f.run('journal.create',f.manual());await f.run('cashCount.create',{financial_account_id:cash.id,date:'2026-10-07',actual_count:100,difference_reason:''},'cash-proof');await f.run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة'});await f.run('period.close',{id:'2026-10',expected_revision:2,reason:'إغلاق مطابق',fx_review_completed:true});
  const backup=await f.ops.snapshot(f.org.id,owner,true),targetOwner={...owner,uid:'cash-period-restorer'},target=await f.organizations.create(targetOwner,'نقدية مقفلة',INITIAL_SETTINGS,'cash-period-target');await f.store.transaction(async tx=>tx.set(`organizations/${target.id}/meta/subscription`,{...createDefaultSubscription(target.id),...getPlanConfig('Enterprise'),org_id:target.id,plan:'Enterprise'}));
  for(const proofs of [[],backup.collections.accounting_periods[0].close_evidence.reconciliations.map((row:any)=>({...row,id:'foreign-proof'})),backup.collections.accounting_periods[0].close_evidence.reconciliations.map((row:any)=>({...row,ledger_hash:'0'.repeat(64)}))]) {
    const broken={...backup,collections:{...backup.collections,accounting_periods:backup.collections.accounting_periods.map(row=>({...row,close_evidence:{...row.close_evidence,reconciliations:proofs}}))}},before=f.store.dump();
    await assert.rejects(f.ops.execute(target.id,targetOwner,{action:'backup.restore',data:{backup:broken},operationId:crypto.randomUUID()}),/إثبات|مصدر/);assert.deepEqual(f.store.dump(),before);
  }
  await f.ops.execute(target.id,targetOwner,{action:'backup.restore',data:{backup},operationId:'cash-period-restore'});const copied=await f.ops.snapshot(target.id,targetOwner,true);assert.equal(copied.collections.accounting_periods[0].close_evidence.reconciliations[0].id,'cr-cash-proof');assert.equal(copied.collections.cash_reconciliations[0].actual_count,100);assert.equal(copied.org.owner_uid,targetOwner.uid);
});

test('C1.2 checklist summaries include source failures beyond the 100-row display slice and refuse closing atomically',async()=>{
  const f=await fixture();await f.create();
  await f.store.transaction(async tx=>{
    for(let i=0;i<101;i++)tx.set(`${f.root}/products/unknown-${i}`,{id:`unknown-${i}`,org_id:f.org.id,name:'صنف غير مقيم',track_inventory:true,stock_quantity:1,cost_status:'unknown'});
    tx.set(`${f.root}/suppliers/bad-source`,{id:'bad-source',org_id:f.org.id,name:'مورد غير صالح',default_currency:'XXX'});
  });
  const report=await f.ops.periodReports(f.org.id,owner,'2026-10');assert.ok(report.checklist!.findings_count>100);assert.equal(report.checklist!.findings.length,100);assert.equal(report.checklist!.checks.inventory_reconciled,false);assert.equal(report.checklist!.findings.some(row=>row.collection==='suppliers'),false);assert.equal(report.checklist!.checks.ap_reconciled,false);assert.equal(report.checklist!.can_close,false);
  await f.run('period.softClose',{id:'2026-10',expected_revision:1,reason:'فحص المصدر'});const before=f.store.dump();await assert.rejects(f.run('period.close',{id:'2026-10',expected_revision:2,reason:'لا يتجاوز الملاحظات',fx_review_completed:true}),/فحص/);assert.deepEqual(f.store.dump(),before);
});

test('C1.2 an unmapped or unmatched wallet is a bank-check failure and cannot appear reconciled in the closing assistant',async()=>{
  const f=await fixture();await f.create();await f.run('financialAccount.create',{name:'محفظة بنكية',account_code:'1130',currency:'SDG',kind:'wallet'});
  await f.run('journal.create',{reference_type:'manual',description:'تمويل المحفظة',date:'2026-10-07',lines:[journalLine('1130','wallet',100,0,0.05,0),journalLine('3100','capital',0,100,0,0.05)]});
  const report=await f.ops.periodReports(f.org.id,owner,'2026-10');assert.deepEqual(report.checklist!.missing_reconciliations,['1130']);assert.equal(report.checklist!.checks.bank_reconciled,false);assert.equal(report.checklist!.checks.cash_reconciled,true);assert.equal(report.checklist!.can_close,false);
});
