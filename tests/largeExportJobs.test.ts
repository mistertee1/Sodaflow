import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/domain/store';
import { Organizations } from '../server/organizations';
import { Operations, type Actor } from '../src/domain/operations';
import { INITIAL_SETTINGS } from '../src/data/initialData';

async function fixture(){
  const owner:Actor={uid:'owner',email:'owner@example.com',emailVerified:true},store=new MemoryStore();
  const org=await new Organizations(store).create(owner,'Large exports',{...INITIAL_SETTINGS},'setup',true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionEnd:'2027-01-01'});tx.set(`${root}/members/accountant`,{uid:'accountant',role:'Accountant',status:'active',org_id:org.id});tx.set(`${root}/members/viewer`,{uid:'viewer',role:'Viewer',status:'active',org_id:org.id});});
  return {owner,store,org,root,ops:new Operations(store,()=>new Date('2026-10-18T02:00:00Z'))};
}

test('Excel3.2a queues bounded tenant export jobs with Owner-only company scope and persisted audit',async()=>{
  const f=await fixture(),accountant:Actor={...f.owner,uid:'accountant',email:'accountant@example.com'};
  const company=await f.ops.execute(f.org.id,f.owner,{action:'largeExport.request',operationId:'company-large',data:{kind:'company',format:'json'}});
  assert.equal(company.result.status,'queued');assert.equal(company.result.attempt,1);assert.equal(company.result.expires_at,null);
  const accounting=await f.ops.execute(f.org.id,accountant,{action:'largeExport.request',operationId:'accounting-large',data:{kind:'accounting',format:'xlsx',period:{start:'2026-10-01',end:'2026-10-31'}}});
  assert.equal(accounting.result.kind,'accounting');assert.deepEqual(accounting.result.period,{start:'2026-10-01',end:'2026-10-31'});
  const dump=f.store.dump();assert.equal(dump[`${f.root}/company_export_jobs/${company.result.id}`].requested_by,f.owner.uid);assert.equal(dump[`${f.root}/audit_logs/audit-company-large`].event_type,'DATA_EXPORT_QUEUED');
  const accountantSnapshot=await f.ops.snapshot(f.org.id,accountant);assert.equal(accountantSnapshot.collections.accounting_export_jobs.length,1);assert.equal(accountantSnapshot.collections.company_export_jobs.length,0);
  const ownerSnapshot=await f.ops.snapshot(f.org.id,f.owner);assert.equal(ownerSnapshot.collections.accounting_export_jobs.length,1);assert.equal(ownerSnapshot.collections.company_export_jobs.length,1);
});

test('Excel3.2a rejects company jobs for non-owner, forged fields, invalid periods and active-job overflow',async()=>{
  const f=await fixture(),accountant:Actor={...f.owner,uid:'accountant',email:'accountant@example.com'},viewer:Actor={...f.owner,uid:'viewer',email:'viewer@example.com'};
  await assert.rejects(f.ops.execute(f.org.id,accountant,{action:'largeExport.request',operationId:'not-owner',data:{kind:'company'}}),/مالك المؤسسة الفعلي/);
  await assert.rejects(f.ops.execute(f.org.id,viewer,{action:'largeExport.request',operationId:'viewer',data:{kind:'accounting'}}),/صلاحية/);
  await assert.rejects(f.ops.execute(f.org.id,f.owner,{action:'largeExport.request',operationId:'forged',data:{kind:'company',status:'completed'}}),/حقول مهمة التصدير/);
  await assert.rejects(f.ops.execute(f.org.id,f.owner,{action:'largeExport.request',operationId:'period',data:{kind:'accounting',period:{start:'2026-11-01',end:'2026-10-01'}}}),/فترة مهمة التصدير/);
  for(let i=0;i<3;i++)await f.ops.execute(f.org.id,f.owner,{action:'largeExport.request',operationId:`queued-${i}`,data:{kind:'company'}});
  await assert.rejects(f.ops.execute(f.org.id,f.owner,{action:'largeExport.request',operationId:'overflow',data:{kind:'company'}}),/ثلاث مهام/);
});

test('Excel3.2a cancellation and bounded retry preserve ownership, attempts and no artifact leakage',async()=>{
  const f=await fixture(),accountant:Actor={...f.owner,uid:'accountant',email:'accountant@example.com'};
  const queued=await f.ops.execute(f.org.id,accountant,{action:'largeExport.request',operationId:'cancel-me',data:{kind:'accounting'}});
  const cancelled=await f.ops.execute(f.org.id,accountant,{action:'largeExport.cancel',operationId:'cancel-command',data:{id:queued.result.id}});
  assert.equal(cancelled.result.status,'cancelled');assert.equal(cancelled.result.artifact,null);assert.equal(f.store.dump()[`${f.root}/audit_logs/audit-cancel-command`].event_type,'DATA_EXPORT_CANCELLED');
  await f.store.transaction(async tx=>tx.set(`${f.root}/accounting_export_jobs/failed-job`,{id:'failed-job',org_id:f.org.id,kind:'accounting',format:'xlsx',status:'failed',progress:45,attempt:1,max_attempts:3,requested_by:'accountant',artifact:{url:'https://invalid.example/file'},expires_at:'2026-10-19T00:00:00Z',failure:{code:'worker_failed'}}));
  const retry=await f.ops.execute(f.org.id,accountant,{action:'largeExport.retry',operationId:'retry-command',data:{id:'failed-job'}});
  assert.equal(retry.result.status,'queued');assert.equal(retry.result.attempt,2);assert.equal(retry.result.progress,0);assert.equal(retry.result.artifact,null);assert.equal(retry.result.expires_at,null);
  await assert.rejects(f.ops.execute(f.org.id,accountant,{action:'largeExport.retry',operationId:'retry-again',data:{id:'failed-job'}}),/الفاشلة فقط/);
});
