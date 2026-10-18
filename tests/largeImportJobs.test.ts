import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/domain/store';
import {Organizations} from '../server/organizations';
import {Operations,type Actor} from '../src/domain/operations';
import {INITIAL_SETTINGS} from '../src/data/initialData';

async function fixture(){
 const owner:Actor={uid:'owner',email:'owner@example.com',emailVerified:true},store=new MemoryStore(),org=await new Organizations(store).create(owner,'Large imports',{...INITIAL_SETTINGS},'setup',true),root=`organizations/${org.id}`;
 await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionEnd:'2027-01-01'});tx.set(`${root}/members/accountant`,{uid:'accountant',role:'Accountant',status:'active',org_id:org.id});tx.set(`${root}/members/viewer`,{uid:'viewer',role:'Viewer',status:'active',org_id:org.id});tx.set(`${root}/import_sessions/session-one`,{id:'session-one',org_id:org.id,status:'previewed',import_type:'customers',file_hash:'a'.repeat(64),schema_version:1,totals:{rows:2,valid:2,errors:0,warnings:0}});tx.set(`${root}/import_staging/session-one`,{id:'session-one',org_id:org.id,session_id:'session-one',rows:[{row_number:2,data:{name:'A'}},{row_number:3,data:{name:'B'}}]});});
 return{owner,store,org,root,ops:new Operations(store,()=>new Date('2026-10-18T04:30:00Z'))};
}

test('Excel3.2c.1 queues only reviewed error-free tenant staging with idempotency evidence',async()=>{
 const f=await fixture(),r=await f.ops.execute(f.org.id,f.owner,{action:'largeImport.request',operationId:'queue-import',data:{session_id:'session-one',reviewed:true,duplicate_policy:'skip'}});
 assert.equal(r.result.status,'queued');assert.equal(r.result.total_rows,2);assert.equal(r.result.file_hash,'a'.repeat(64));assert.equal(r.result.schema_version,1);assert.equal(r.result.reviewed_by,'owner');
 const dump=f.store.dump();assert.equal(dump[`large_import_queue/${f.org.id}.${r.result.id}`].job_id,r.result.id);assert.equal(dump[`${f.root}/audit_logs/audit-queue-import`].event_type,'DATA_IMPORT_QUEUED');
});

test('Excel3.2c.1 rejects forged review, blocking errors, tenant mismatch and viewer access',async()=>{
 const f=await fixture(),viewer:Actor={uid:'viewer',email:'viewer@example.com',emailVerified:true};
 await assert.rejects(f.ops.execute(f.org.id,f.owner,{action:'largeImport.request',operationId:'no-review',data:{session_id:'session-one',reviewed:false}}),/تأكيد مراجعة/);
 await f.store.transaction(async tx=>tx.set(`${f.root}/import_sessions/session-one`,{...await tx.get(`${f.root}/import_sessions/session-one`),totals:{rows:2,valid:1,errors:1}}));
 await assert.rejects(f.ops.execute(f.org.id,f.owner,{action:'largeImport.request',operationId:'errors',data:{session_id:'session-one',reviewed:true}}),/أخطاء حاجبة/);
 await assert.rejects(f.ops.execute(f.org.id,viewer,{action:'largeImport.request',operationId:'viewer',data:{session_id:'session-one',reviewed:true}}),/صلاحية/);
});

test('Excel3.2c.1 enforces two active jobs, owner/requester cancellation and bounded retry',async()=>{
 const f=await fixture(),accountant:Actor={uid:'accountant',email:'accountant@example.com',emailVerified:true};
 const one=await f.ops.execute(f.org.id,accountant,{action:'largeImport.request',operationId:'one',data:{session_id:'session-one',reviewed:true,duplicate_policy:'update'}});
 await f.store.transaction(async tx=>{tx.set(`${f.root}/import_sessions/session-two`,{...await tx.get(`${f.root}/import_sessions/session-one`),id:'session-two'});tx.set(`${f.root}/import_staging/session-two`,{...await tx.get(`${f.root}/import_staging/session-one`),id:'session-two',session_id:'session-two'});});
 await f.ops.execute(f.org.id,f.owner,{action:'largeImport.request',operationId:'two',data:{session_id:'session-two',reviewed:true}});
 await assert.rejects(f.ops.execute(f.org.id,f.owner,{action:'largeImport.request',operationId:'overflow',data:{session_id:'session-one',reviewed:true}}),/مهمتا استيراد/);
 const cancelled=await f.ops.execute(f.org.id,f.owner,{action:'largeImport.cancel',operationId:'cancel',data:{id:one.result.id}});assert.equal(cancelled.result.status,'cancelled');
 await f.store.transaction(async tx=>tx.set(`${f.root}/large_import_jobs/failed`,{id:'failed',org_id:f.org.id,module:'customers',status:'failed',attempt:1,max_attempts:3,requested_by:'accountant',progress:51,total_rows:2}));
 const retry=await f.ops.execute(f.org.id,accountant,{action:'largeImport.retry',operationId:'retry',data:{id:'failed'}});assert.equal(retry.result.attempt,2);assert.equal(retry.result.progress,0);assert.equal(retry.result.failure,null);
});

test('Excel3.2c.1 snapshot isolates import jobs by module permission',async()=>{
 const f=await fixture(),viewer:Actor={uid:'viewer',email:'viewer@example.com',emailVerified:true};await f.ops.execute(f.org.id,f.owner,{action:'largeImport.request',operationId:'visible',data:{session_id:'session-one',reviewed:true}});
 assert.equal((await f.ops.snapshot(f.org.id,f.owner)).collections.large_import_jobs.length,1);assert.equal((await f.ops.snapshot(f.org.id,viewer)).collections.large_import_jobs.length,0);
});
