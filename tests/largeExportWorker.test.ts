import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/domain/store';
import { Organizations } from '../server/organizations';
import { Operations, type Actor } from '../src/domain/operations';
import { LargeExportWorker, type LargeExportArtifactStore, type LargeExportContent } from '../src/domain/largeExportWorker';
import { INITIAL_SETTINGS } from '../src/data/initialData';

class Artifacts implements LargeExportArtifactStore{
  files=new Map<string,LargeExportContent>();deleted:string[]=[];
  async put(path:string,content:LargeExportContent){this.files.set(path,content);}
  async delete(path:string){this.files.delete(path);this.deleted.push(path);}
  async signedUrl(path:string,expiresAt:Date){assert.ok(this.files.has(path));return `https://signed.invalid/${encodeURIComponent(path)}?expires=${expiresAt.toISOString()}`;}
}
async function fixture(){
  const owner:Actor={uid:'owner',email:'owner@example.com',emailVerified:true},store=new MemoryStore(),org=await new Organizations(store).create(owner,'Worker',{...INITIAL_SETTINGS},'setup',true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionEnd:'2027-01-01'});tx.set(`${root}/members/accountant`,{uid:'accountant',role:'Accountant',status:'active',org_id:org.id});});
  return{owner,store,org,root,ops:new Operations(store,()=>new Date('2026-10-18T03:00:00Z'))};
}

test('Excel3.2b claims the queue once, persists a private artifact manifest and issues only short authorized URLs',async()=>{
  const f=await fixture(),accountant={...f.owner,uid:'accountant'},created=await f.ops.execute(f.org.id,accountant,{action:'largeExport.request',operationId:'worker-ok',data:{kind:'accounting'}}),artifacts=new Artifacts(),clock={now:new Date('2026-10-18T03:01:00Z')};
  const worker=new LargeExportWorker(f.store,artifacts,{build:async()=>({bytes:new TextEncoder().encode('workbook'),filename:'accounting.xls',mimeType:'application/vnd.ms-excel',recordCount:9})},()=>clock.now,()=> 'claim-one');
  const done=await worker.runNext();assert.equal(done?.status,'completed');assert.equal(done?.progress,100);assert.equal(done?.artifact.byte_size,8);assert.equal(done?.artifact.sha256.length,64);assert.equal(done?.artifact.url,undefined);assert.equal(await worker.runNext(),null);
  await assert.rejects(worker.download(f.org.id,'accounting_export_jobs',created.result.id,'other','Accountant'),/منشئها/);
  const link=await worker.download(f.org.id,'accounting_export_jobs',created.result.id,'accountant','Accountant');assert.match(link.url,/signed\.invalid/);assert.equal(link.expires_at,'2026-10-18T03:06:00.000Z');
  assert.equal(f.store.dump()[`${f.root}/audit_logs/audit-${created.result.id}-data_export_completed-1`].event_type,'DATA_EXPORT_COMPLETED');
});

test('Excel3.2b does not publish an artifact after concurrent cancellation and cleans the uploaded object',async()=>{
  const f=await fixture(),created=await f.ops.execute(f.org.id,f.owner,{action:'largeExport.request',operationId:'cancel-race',data:{kind:'company'}}),artifacts=new Artifacts();
  const put=artifacts.put.bind(artifacts);
  artifacts.put=async(path,content)=>{await put(path,content);await f.store.transaction(async tx=>tx.set(`${f.root}/company_export_jobs/${created.result.id}`,{...await tx.get(`${f.root}/company_export_jobs/${created.result.id}`),status:'cancelled',worker_claim:null}));};
  const worker=new LargeExportWorker(f.store,artifacts,{build:async()=>({bytes:new Uint8Array([1,2]),filename:'company.json',mimeType:'application/json',recordCount:1})},()=>new Date('2026-10-18T03:02:00Z'),()=> 'race-claim');
  assert.equal(await worker.run(f.org.id,'company_export_jobs',created.result.id),null);assert.equal(artifacts.files.size,0);assert.equal(artifacts.deleted.length,1);
});

test('Excel3.2b sanitizes failures, supports retry queueing, then expires and deletes completed artifacts',async()=>{
  const f=await fixture(),accountant={...f.owner,uid:'accountant'},created=await f.ops.execute(f.org.id,accountant,{action:'largeExport.request',operationId:'worker-fail',data:{kind:'accounting'}}),artifacts=new Artifacts(),clock={now:new Date('2026-10-18T03:03:00Z')};
  const failedWorker=new LargeExportWorker(f.store,artifacts,{build:async()=>{throw new Error('secret bucket detail');}},()=>clock.now,()=> 'failure-claim'),failed=await failedWorker.runNext();assert.equal(failed?.status,'failed');assert.deepEqual(failed?.failure,{code:'export_generation_failed',message:'تعذر إنشاء ملف التصدير. أعد المحاولة أو تواصل مع الدعم.'});assert.doesNotMatch(JSON.stringify(failed),/secret bucket detail/);assert.equal(failed?.artifact,null);
  const retried=await f.ops.execute(f.org.id,accountant,{action:'largeExport.retry',operationId:'retry-worker',data:{id:created.result.id}});assert.equal(retried.result.attempt,2);
  const okWorker=new LargeExportWorker(f.store,artifacts,{build:async()=>({bytes:new Uint8Array([7]),filename:'retry.xls',mimeType:'application/vnd.ms-excel',recordCount:1})},()=>clock.now,()=> 'retry-claim');assert.equal((await okWorker.runNext())?.status,'completed');
  clock.now=new Date('2026-10-19T03:03:01Z');const expired=await okWorker.expire(f.org.id,'accounting_export_jobs',created.result.id);assert.equal(expired?.status,'expired');assert.equal(expired?.artifact,null);assert.equal(artifacts.files.size,0);
  await assert.rejects(okWorker.download(f.org.id,'accounting_export_jobs',created.result.id,'accountant','Accountant'),/غير متاح/);
});

test('Excel3.2b recovers an abandoned claim once and fails closed after bounded worker attempts',async()=>{
  const f=await fixture(),created=await f.ops.execute(f.org.id,f.owner,{action:'largeExport.request',operationId:'stale-worker',data:{kind:'company'}}),artifacts=new Artifacts(),path=`${f.root}/company_export_jobs/${created.result.id}`;
  await f.store.transaction(async tx=>tx.set(path,{...await tx.get(path),status:'running',attempt:1,max_attempts:2,worker_claim:'dead',started_at:'2026-10-18T02:00:00Z'}));
  const recovered=new LargeExportWorker(f.store,artifacts,{build:async()=>({bytes:new Uint8Array([1]),filename:'recovered.json',mimeType:'application/json',recordCount:1})},()=>new Date('2026-10-18T03:00:01Z'),()=> 'recovered');const done=await recovered.runNext();assert.equal(done?.status,'completed');assert.equal(done?.attempt,2);assert.equal(done?.recovered_at,'2026-10-18T03:00:01.000Z');
  const exhausted=await f.ops.execute(f.org.id,f.owner,{action:'largeExport.request',operationId:'exhausted-worker',data:{kind:'company'}}),exhaustedPath=`${f.root}/company_export_jobs/${exhausted.result.id}`;
  await f.store.transaction(async tx=>tx.set(exhaustedPath,{...await tx.get(exhaustedPath),status:'running',attempt:2,max_attempts:2,worker_claim:'dead-again',started_at:'2026-10-18T02:00:00Z'}));assert.equal(await recovered.runNext(),null);const saved=f.store.dump()[exhaustedPath];assert.equal(saved.status,'failed');assert.equal(saved.failure.code,'worker_timeout');assert.equal(f.store.dump()[`large_export_queue/${f.org.id}.${exhausted.result.id}`],undefined);
});
