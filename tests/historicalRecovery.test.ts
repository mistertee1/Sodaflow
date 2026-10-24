import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApi } from '../server/api';
import { MemoryStore } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { defaultPlatformPlans } from '../src/lib/plans';
import { historicalRecoveryFixture } from './helpers/historicalRecovery';

test('staged recovery reads confirmed cloud metadata without writes, raw rows, cached review or implicit financial approval', async () => {
  const f = await historicalRecoveryFixture(), before = (f.store as MemoryStore).dump(), result = await f.recover();
  assert.deepEqual((f.store as MemoryStore).dump(), before);
  assert.equal(result.org_id, f.org.id); assert.equal(result.session.id, f.session.id);
  assert.equal(result.requires_fresh_review, true); assert.equal(result.receipt, null);
  for (const name of ['rows','document_evidence','validation_basis','proposed_changes','review_sha256']) assert.equal(name in result || name in result.session, false);
  await assert.rejects(f.run('historicalImport.commit',f.input,'forged-recovery'),(error: any)=>error.code==='historical_review_required');
});

test('committed recovery verifies receipt, audit and immutable source links after reload without replaying any transaction', async () => {
  const f = await historicalRecoveryFixture(), saved = await f.commit(), before = (f.store as MemoryStore).dump();
  const freshClient = new Operations(f.server,f.now), result = await freshClient.historicalImportRecovery(f.org.id,f.owner,f.session.id);
  assert.equal(result.requires_fresh_review,false); assert.equal(result.receipt?.id,saved.result.id);
  assert.equal(result.receipt?.review_status,'verified'); assert.match(result.receipt!.review_sha256!,/^[a-f0-9]{64}$/);
  assert.equal(result.receipt?.journals_created,1); assert.equal(result.receipt?.reconciliation.findings_count,0);
  assert.equal('changes' in result.receipt!,false); assert.deepEqual((f.store as MemoryStore).dump(),before);
  assert.deepEqual(await f.recover(),result); assert.deepEqual((f.store as MemoryStore).dump(),before);
});

test('read-only recovery keeps history available after a period closes and labels legacy missing review proof explicitly', async () => {
  const f = await historicalRecoveryFixture(); await f.commit();
  await f.store.transaction(async tx => {
    const path=`${f.root}/accounting_periods/2026`; tx.set(path,{...await tx.get(path),status:'CLOSED'});
    const auditPath=`${f.root}/audit_logs/audit-history-commit`,audit=(await tx.get(auditPath))!; delete audit.import_metadata.review_sha256;tx.set(auditPath,audit);
  });
  const before=(f.store as MemoryStore).dump(),result=await f.recover();
  assert.equal(result.receipt?.review_status,'legacy_without_review_evidence');assert.equal(result.receipt?.review_sha256,null);assert.equal(result.requires_fresh_review,false);assert.deepEqual((f.store as MemoryStore).dump(),before);
});

for (const fault of ['rows','context','document','receipt','audit','source','foreign-session','review']) test(`recovery refuses ${fault} evidence corruption without writes or a fabricated receipt`,async()=>{
  const f=await historicalRecoveryFixture();await f.commit();
  await f.store.transaction(async tx=>{
    const stagePath=`${f.root}/historical_import_staging/${f.session.id}`,sessionPath=`${f.root}/historical_import_sessions/${f.session.id}`,receiptPath=`${f.root}/idempotency/history-commit`,auditPath=`${f.root}/audit_logs/audit-history-commit`;
    if(['rows','context','document'].includes(fault)){const row=(await tx.get(stagePath))!;if(fault==='rows')row.rows[0].reference='tampered';if(fault==='context')row.validation_basis.accounts=[];if(fault==='document')row.document_evidence={unexpected:{value:1}};tx.set(stagePath,row);}
    if(fault==='receipt'){const row=(await tx.get(receiptPath))!;row.response.result.rows_imported=999;tx.set(receiptPath,row);}
    if(fault==='audit')tx.delete(auditPath);
    if(fault==='source'){const session=(await tx.get(sessionPath))!;tx.delete(`${f.root}/journal_entries/${session.commit_journal_ids[0]}`);}
    if(fault==='foreign-session')tx.set(sessionPath,{...await tx.get(sessionPath),org_id:'foreign'});
    if(fault==='review'){const row=(await tx.get(auditPath))!;row.import_metadata.review_sha256='forged';tx.set(auditPath,row);}
  });
  const before=(f.store as MemoryStore).dump();await assert.rejects(f.recover(),(error:any)=>error.code==='historical_recovery_inconsistent');assert.deepEqual((f.store as MemoryStore).dump(),before);
});

test('recovery enforces live identity, tenant membership, role, subscription, feature and server authority',async()=>{
  const f=await historicalRecoveryFixture();
  for(const actor of [{...f.owner,emailVerified:false},{...f.owner,uid:'foreign'},{...f.owner,uid:'Viewer'}])await assert.rejects(f.recover(actor),(error:any)=>error.status===403);
  assert.equal((await f.recover({...f.owner,uid:'Accountant'})).session.id,f.session.id);
  await assert.rejects(new Operations(f.store).historicalImportRecovery(f.org.id,f.owner,f.session.id),(error:any)=>error.status===403);
  await assert.rejects(f.ops.historicalImportRecovery(f.org.id,f.owner,'absent'),(error:any)=>error.status===404);
  await f.store.transaction(async tx=>tx.set(f.root,{...await tx.get(f.root),subscriptionStatus:'expired',subscriptionEnd:'2020-01-01'}));
  await assert.rejects(f.recover(),(error:any)=>error.status===403);
});

test('recovery rechecks revoked membership, disabled accounting feature and V2 status on every read',async()=>{
  const f=await historicalRecoveryFixture(),accountant={...f.owner,uid:'Accountant'};
  await f.recover(accountant);
  await f.store.transaction(async tx=>tx.set(`${f.root}/members/Accountant`,{uid:'Accountant',org_id:f.org.id,role:'Accountant',status:'suspended'}));
  await assert.rejects(f.recover(accountant),(error:any)=>error.status===403);
  const plan=defaultPlatformPlans().find(row=>row.id==='Enterprise')!;
  await f.store.transaction(async tx=>tx.set('plans/Enterprise',{...plan,features:{...plan.features,accounting:false}}));
  await assert.rejects(f.recover(),(error:any)=>error.code==='feature_unavailable');
  await f.store.transaction(async tx=>{tx.set('plans/Enterprise',plan);tx.set(f.root,{...await tx.get(f.root),accounting_version:1});});
  await assert.rejects(f.recover(),(error:any)=>error.status===409);
});

test('HTTP recovery is no-store, rejects anonymous/foreign/filter requests and reports cloud read failure instead of an empty session',async()=>{
  let unavailable=false;const memory=new MemoryStore(),f=await historicalRecoveryFixture(memory),serverStore={authority:'server' as const,transaction:<T>(work:Parameters<typeof memory.transaction<T>>[0])=>{if(unavailable)return Promise.reject(Object.assign(Error('Synthetic read unavailable'),{code:14}));return memory.transaction(work);}};
  const app=express();app.use(express.json());app.use('/api',createApi({operations:new Operations(serverStore,f.now),verify:async token=>token==='owner'?f.owner:token==='outsider'?{...f.owner,uid:'foreign'}:Promise.reject(Error('invalid'))}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/organizations/${f.org.id}/historical-import/sessions/${f.session.id}`,get=(token='owner',suffix='')=>fetch(url+suffix,{headers:{Authorization:`Bearer ${token}`}});
  try{
    assert.equal((await get('invalid')).status,401);assert.equal((await get('outsider')).status,403);assert.equal((await get('owner','?approve=true')).status,400);
    const before=memory.dump(),response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).receipt,null);assert.deepEqual(memory.dump(),before);
    unavailable=true;const failed=await get();assert.equal(failed.status,503);assert.equal((await failed.json()).code,'service_unavailable');assert.deepEqual(memory.dump(),before);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
