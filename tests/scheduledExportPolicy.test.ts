import test from 'node:test';
import assert from 'node:assert/strict';
import { assertScheduledExportAccess, createExportSchedule, updateExportSchedule, nextScheduledExportRun, scheduledExportOccurrence, scheduledArtifactExpiry, scheduledDownloadExpiry, type ScheduledExportAccess } from '../src/domain/scheduledExportPolicy';

const access=(overrides:Partial<ScheduledExportAccess>={}):ScheduledExportAccess=>({authority:'server',orgId:'org',ownerUid:'owner',uid:'accountant',role:'Accountant',emailVerified:true,activeMember:true,accountEnabled:true,organizationActive:true,accountingVersion:2,subscriptionStatus:'active',subscriptionEnd:'2099-01-01T00:00:00.000Z',features:{accounting:true,advanced_reports:true,audit_trail:true},now:new Date('2026-10-24T06:00:00Z'),...overrides});
const input=(overrides:Record<string,unknown>={})=>({name:'حزمة المحاسب',kind:'accounting',cadence:'daily',timezone:'Asia/Kuwait',time:'10:00',start_date:'2026-10-24',period_kind:'previous_day',retention_hours:24,active:true,...overrides});
const policy=(data:Record<string,unknown>={},ctx=access())=>createExportSchedule(input(data),ctx,'test');

test('daily and weekly schedules use merchant timezone, including quarter-hour offsets',()=>{
 const p=policy();assert.equal(p.next_run_at,'2026-10-24T07:00:00.000Z');
 assert.equal(policy({cadence:'weekly',weekday:1,time:'09:00'}).next_run_at,'2026-10-26T06:00:00.000Z');
 assert.equal(policy({timezone:'Asia/Kathmandu',time:'00:15',start_date:'2026-10-23'},access({now:new Date('2026-10-23T18:00:00Z')})).next_run_at,'2026-10-23T18:30:00.000Z');
});

test('monthly schedules clamp short months without drifting from the requested anchor and respect leap years',()=>{
 const ctx=access({now:new Date('2026-01-31T10:00:00Z')}),p=policy({cadence:'monthly',month_day:31,timezone:'UTC',time:'10:00',start_date:'2026-01-01'},ctx);
 assert.equal(p.next_run_at,'2026-02-28T10:00:00.000Z');assert.equal(nextScheduledExportRun(p,new Date(p.next_run_at!)),'2026-03-31T10:00:00.000Z');
 assert.equal(policy({cadence:'monthly',month_day:31,timezone:'UTC',time:'10:00',start_date:'2028-01-01'},access({now:new Date('2028-01-31T10:00:00Z')})).next_run_at,'2028-02-29T10:00:00.000Z');
});

test('spring DST gap selects the first valid local minute; a fully skipped local day advances safely',()=>{
 const p=policy({timezone:'America/New_York',time:'02:30',start_date:'2026-03-08'},access({now:new Date('2026-03-08T00:00:00Z')}));
 assert.equal(p.next_run_at,'2026-03-08T07:00:00.000Z');
 const skipped=policy({timezone:'Pacific/Apia',time:'10:00',start_date:'2011-12-30'},access({now:new Date('2011-12-29T12:00:00Z')}));
 assert.equal(skipped.next_run_at,'2011-12-30T20:00:00.000Z');
});

test('autumn DST fold schedules exactly the first occurrence and never uses the repeated wall clock',async()=>{
 const p=policy({timezone:'America/New_York',time:'01:30',start_date:'2026-11-01'},access({now:new Date('2026-11-01T00:00:00Z')}));
 assert.equal(p.next_run_at,'2026-11-01T05:30:00.000Z');
 assert.equal(nextScheduledExportRun(p,new Date('2026-11-01T05:31:00Z')),'2026-11-02T06:30:00.000Z');
 await assert.rejects(scheduledExportOccurrence({...p,next_run_at:'2026-11-01T06:30:00.000Z'},'2026-11-01T06:30:00.000Z',access({now:new Date('2026-11-01T07:00:00Z')})),(e:any)=>e.status===409);
});

test('future starts, inclusive ends, disabled policies and elapsed schedules never manufacture catch-up runs',()=>{
 assert.equal(policy({start_date:'2026-12-01'}).next_run_at,'2026-12-01T07:00:00.000Z');
 const p=policy({end_date:'2026-10-24'});assert.equal(nextScheduledExportRun(p,new Date('2026-10-24T07:00:00Z')),null);
 assert.equal(policy({active:false}).next_run_at,null);
 assert.throws(()=>policy({end_date:'2026-10-23'}));
 assert.equal(nextScheduledExportRun(policy(),new Date('2027-01-01T12:00:00Z')),'2027-01-02T07:00:00.000Z');
});

test('schema rejects protected metadata, bad dates/timezones, ambiguous cadence fields, excessive retention and company periods',()=>{
 for(const values of [{next_run_at:'2026-10-24T06:00:00Z'},{created_by:'owner'},{revision:99},{timezone:'not/a-zone'},{timezone:'+03:00'},{time:'24:00'},{time:'9:00'},{start_date:'2026-02-30'},{start_date:'1999-12-31'},{end_date:'2026-01-01'},{cadence:'weekly'},{cadence:'monthly',month_day:0},{weekday:1},{month_day:1},{retention_hours:25},{retention_hours:0},{active:'true'},{period_kind:'full'}])assert.throws(()=>policy(values));
 assert.throws(()=>createExportSchedule(input(),access(),'x'.repeat(128)));
 const ctx=access({uid:'owner',role:'Owner'});assert.throws(()=>createExportSchedule(input({kind:'company'}),ctx,'bad-company'));
 assert.equal(createExportSchedule(input({kind:'company',period_kind:'full'}),ctx,'company').kind,'company');
});

test('financial roles, verified active membership, server authority, V2 and live subscriptions are required',()=>{
 for(const changes of [{authority:'browser'},{authority:'local'},{emailVerified:false},{activeMember:false},{accountEnabled:false},{organizationActive:false},{role:'Sales'},{role:'Cashier'},{role:'Viewer'},{role:'Owner'},{accountingVersion:1},{subscriptionStatus:'expired'},{subscriptionStatus:'suspended'},{subscriptionStatus:'trial',subscriptionEnd:null},{subscriptionEnd:'2026-10-24T06:00:00.000Z'}] as Partial<ScheduledExportAccess>[])assert.throws(()=>policy({},access(changes)));
 assert.throws(()=>policy({},access({features:{accounting:false,advanced_reports:true,audit_trail:true}})));
 assert.throws(()=>policy({},access({features:{accounting:true,advanced_reports:false,audit_trail:true}})));
 assert.throws(()=>policy({kind:'auditor'},access({features:{accounting:true,advanced_reports:true,audit_trail:false}})));
 assert.doesNotThrow(()=>assertScheduledExportAccess('auditor',access()));
});

test('company schedules require the actual Owner even when the caller has another financial role',()=>{
 for(const role of ['Accountant','Admin'] as const)assert.throws(()=>policy({kind:'company',period_kind:'full'},access({role})),(e:any)=>e.status===403);
 assert.equal(policy({kind:'company',period_kind:'full'},access({role:'Owner',uid:'owner'})).created_by,'owner');
});

test('existing date-only subscription ends keep their UTC meaning while malformed or expired legacy dates remain denied',()=>{
 assert.doesNotThrow(()=>policy({},access({subscriptionEnd:'2099-01-01'})));
 assert.throws(()=>policy({},access({subscriptionEnd:'2026-02-30'})));
 assert.throws(()=>policy({},access({subscriptionEnd:'2026-10-24'})),(e:any)=>e.status===403);
});

test('updates preserve creator/kind, require optimistic revision and permit actual Owner management without transferring ownership',()=>{
 const p=policy(),before=structuredClone(p),request={id:p.id,expected_revision:1,updates:{time:'11:00'}};
 const updated=updateExportSchedule(p,request,access({uid:'owner',role:'Owner'}));assert.equal(updated.revision,2);assert.equal(updated.created_by,'accountant');assert.equal(updated.updated_by,'owner');assert.equal(updated.next_run_at,'2026-10-24T08:00:00.000Z');assert.deepEqual(p,before);
 assert.throws(()=>updateExportSchedule(updated,request,access()),(e:any)=>e.status===409);
 assert.throws(()=>updateExportSchedule(p,{...request,updates:{created_by:'owner'}},access()));
 assert.throws(()=>updateExportSchedule(p,{...request,updates:{kind:'auditor'}},access()));
 assert.throws(()=>updateExportSchedule(p,request,access({uid:'another',role:'Admin'})),(e:any)=>e.status===403);
 assert.throws(()=>updateExportSchedule(p,request,access({orgId:'foreign'})),(e:any)=>e.status===403);
});

test('no-op edits and revision overflow cannot reset recurrence by manufacturing a new version',()=>{
 const p=policy();assert.throws(()=>updateExportSchedule(p,{id:p.id,expected_revision:1,updates:{}},access()),(e:any)=>e.status===409);
 assert.throws(()=>updateExportSchedule(p,{id:p.id,expected_revision:1,updates:{time:p.time}},access()),(e:any)=>e.status===409);
 assert.throws(()=>updateExportSchedule({...p,revision:Number.MAX_SAFE_INTEGER},{id:p.id,expected_revision:Number.MAX_SAFE_INTEGER,updates:{time:'11:00'}},access()),(e:any)=>e.status===409);
});

test('occurrence keys are deterministic, tenant/revision scoped, and advance once past missed schedules',async()=>{
 const p=policy(),ctx=access({now:new Date('2026-10-28T12:00:00Z')}),before=structuredClone(p),one=await scheduledExportOccurrence(p,p.next_run_at!,ctx),two=await scheduledExportOccurrence(p,p.next_run_at!,ctx);
 assert.deepEqual(one,two);assert.equal(one.local_date,'2026-10-24');assert.equal(one.next_run_at,'2026-10-29T07:00:00.000Z');assert.deepEqual(one.period,{start:'2026-10-23',end:'2026-10-23'});assert.match(one.operation_id,/^[a-f0-9]{64}$/);assert.deepEqual(p,before);
 assert.notEqual((await scheduledExportOccurrence({...p,revision:2},p.next_run_at!,ctx)).operation_id,one.operation_id);
 assert.notEqual((await scheduledExportOccurrence({...p,org_id:'another'},p.next_run_at!,{...ctx,orgId:'another'})).operation_id,one.operation_id);
 await assert.rejects(scheduledExportOccurrence(p,p.next_run_at!,access({now:new Date('2026-10-24T06:59:59Z')})),(e:any)=>e.status===409);
 await assert.rejects(scheduledExportOccurrence({...p,next_run_at:'2026-10-24T08:00:00.000Z'},'2026-10-24T08:00:00.000Z',ctx),(e:any)=>e.status===409);
});

test('periods use the original local due date and real calendar month boundaries',async()=>{
 const p=policy({cadence:'monthly',month_day:1,period_kind:'previous_month'}),ctx=access({now:new Date('2026-11-03T12:00:00Z')});
 assert.equal(p.next_run_at,'2026-11-01T07:00:00.000Z');assert.deepEqual((await scheduledExportOccurrence(p,p.next_run_at!,ctx)).period,{start:'2026-10-01',end:'2026-10-31'});
 const mtd=policy({period_kind:'month_to_date'});assert.deepEqual((await scheduledExportOccurrence(mtd,mtd.next_run_at!,access({now:new Date('2026-10-24T08:00:00Z')}))).period,{start:'2026-10-01',end:'2026-10-24'});
});

test('execution rechecks current permission, membership, subscription and policy state without relying on the creation decision',async()=>{
 const p=policy(),now=new Date('2026-10-24T08:00:00Z');
 for(const changes of [{activeMember:false},{accountEnabled:false},{organizationActive:false},{role:'Viewer'},{subscriptionStatus:'expired'},{features:{accounting:true,advanced_reports:false,audit_trail:true}},{uid:'other'},{orgId:'foreign'}] as Partial<ScheduledExportAccess>[])await assert.rejects(scheduledExportOccurrence(p,p.next_run_at!,access({now,...changes})));
 await assert.rejects(scheduledExportOccurrence({...p,active:false},p.next_run_at!,access({now})));
 await assert.rejects(scheduledExportOccurrence({...p,end_date:'2026-10-24'},p.next_run_at!,access({now:new Date('2026-10-25T08:00:00Z')})));
});

test('artifact retention and download links stop at the configured expiry and never last more than five minutes',()=>{
 const p=policy({retention_hours:1}),completed='2026-10-24T08:00:00.000Z',artifact={org_id:p.org_id,schedule_id:p.id,policy_revision:1,requested_by:p.created_by,completed_at:completed,expires_at:scheduledArtifactExpiry(p,completed)};
 assert.equal(artifact.expires_at,'2026-10-24T09:00:00.000Z');assert.equal(scheduledDownloadExpiry(p,artifact,access({now:new Date('2026-10-24T08:10:00Z')})),'2026-10-24T08:15:00.000Z');
 assert.equal(scheduledDownloadExpiry(p,artifact,access({now:new Date('2026-10-24T08:58:00Z')})),'2026-10-24T09:00:00.000Z');
 assert.throws(()=>scheduledDownloadExpiry(p,artifact,access({now:new Date('2026-10-24T09:00:00Z')})),(e:any)=>e.status===410);
 assert.throws(()=>scheduledDownloadExpiry(p,{...artifact,expires_at:'2099-01-01T00:00:00.000Z'},access({now:new Date(completed)})),(e:any)=>e.status===409);
});

test('downloads recheck live scope, creator/Owner, revision, state and current entitlements; stored data confers no access',()=>{
 const p=policy(),completed='2026-10-24T08:00:00.000Z',artifact={org_id:p.org_id,schedule_id:p.id,policy_revision:1,requested_by:p.created_by,completed_at:completed,expires_at:scheduledArtifactExpiry(p,completed)},now=new Date('2026-10-24T08:10:00Z');
 assert.doesNotThrow(()=>scheduledDownloadExpiry(p,artifact,access({uid:'owner',role:'Owner',now})));
 for(const changes of [{uid:'other',role:'Admin'},{activeMember:false},{accountEnabled:false},{organizationActive:false},{subscriptionStatus:'expired'},{role:'Viewer'},{orgId:'foreign'}] as Partial<ScheduledExportAccess>[])assert.throws(()=>scheduledDownloadExpiry(p,artifact,access({now,...changes})));
 for(const record of [{...artifact,org_id:'foreign'},{...artifact,policy_revision:2},{...artifact,requested_by:'other'}])assert.throws(()=>scheduledDownloadExpiry(p,record,access({now})));
 assert.throws(()=>scheduledDownloadExpiry({...p,active:false},artifact,access({now})));
});
