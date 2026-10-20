import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import type { HistoricalImportRow } from '../src/domain/historicalImport';

const now=new Date('2026-10-18T23:30:00Z');
const owner:Actor={uid:'owner',email:'owner@example.com',emailVerified:true,authTime:Math.floor(now.getTime()/1000)};
const accountant:Actor={uid:'accountant',email:'accountant@example.com',emailVerified:true};
const journalRow=(overrides:Partial<HistoricalImportRow>={}):HistoricalImportRow=>({row_number:1,kind:'journal',reference:'HIST-J-1',date:'2026-01-10',currency:'SDG',branch_id:'main',lines:[{account_code:'5200',debit:100,credit:0},{account_code:'4100',debit:0,credit:100}],...overrides});

async function fixture(){
  const store=new MemoryStore(),org=await new Organizations(store).create(owner,'Historical commit',{...INITIAL_SETTINGS},'setup',true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{
    tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionEnd:'2027-01-01'});
    tx.set(`${root}/members/accountant`,{uid:'accountant',role:'Accountant',status:'active',org_id:org.id});
    tx.set(`${root}/accounting_periods/2026`,{id:'2026',org_id:org.id,schema_version:1,start_date:'2026-01-01',end_date:'2026-01-31',status:'OPEN',revision:1,created_by:'owner',created_at:'2026-01-01',operation_id:'period'});
  });
  const ops=new Operations(store,()=>now),stage=async(rows:HistoricalImportRow[],operationId='history-stage')=>(await ops.execute(org.id,accountant,{action:'historicalImport.stage',operationId,data:{file_name:'history.xlsx',file_hash:'e'.repeat(64),schema_version:1,rows}})).result;
  const commit=async(session:Record<string,any>,operationId='history-commit')=>ops.execute(org.id,accountant,{action:'historicalImport.commit',operationId,data:{id:session.id,expected_rows_sha256:session.rows_sha256,expected_validation_context_sha256:session.validation_context_sha256,reason:'اعتماد تاريخي مراجع'}});
  return{store,org,root,ops,stage,commit};
}

test('Excel4.1c atomically commits reviewed journals once with immutable proof and audit',async()=>{
  const f=await fixture(),staged=await f.stage([journalRow()]),first=await f.commit(staged),again=await f.commit(staged);
  assert.deepEqual(again,first);assert.equal(first.result.status,'completed');assert.equal(first.result.accounting_block,false);assert.equal(first.result.rows_imported,1);assert.equal(first.result.journals_created,1);
  const dump=f.store.dump(),session=dump[`${f.root}/historical_import_sessions/${staged.id}`],entry=dump[`${f.root}/journal_entries/${first.result.reconciliation.findings_count===0?`jv-hist-${staged.rows_sha256.slice(0,16)}-1`:''}`];
  assert.equal(session.status,'completed');assert.deepEqual(session.commit_journal_ids,[`jv-hist-${staged.rows_sha256.slice(0,16)}-1`]);assert.equal(entry.historical_import_session_id,staged.id);assert.equal(entry.created_at,now.toISOString());assert.equal(entry.date,'2026-01-10');
  assert.equal(dump[`${f.root}/audit_logs/audit-history-commit`].event_type,'DATA_IMPORT_COMPLETED');assert.equal(dump[`${f.root}/audit_logs/audit-history-commit`].import_metadata.rows_imported,1);
});

test('Excel4.1c aggregates each balanced legacy trial-balance group into one journal',async()=>{
  const f=await fixture(),rows:HistoricalImportRow[]=[
    {row_number:1,kind:'trial_balance',reference:'TB-1',date:'2026-01-01',currency:'USD',branch_id:'main',account_code:'5200',debit:4.25,credit:0},
    {row_number:2,kind:'trial_balance',reference:'TB-2',date:'2026-01-01',currency:'USD',branch_id:'main',account_code:'4100',debit:0,credit:4.25},
  ],staged=await f.stage(rows,'tb-stage'),result=await f.commit(staged,'tb-commit');
  assert.equal(result.result.journals_created,1);const entry=Object.values(f.store.dump()).find((row:any)=>row.historical_import_session_id===staged.id) as any;assert.equal(entry.total_debit_usd,4.25);assert.equal(entry.total_credit_usd,4.25);assert.deepEqual(entry.historical_import_row_numbers,[1,2]);
});

test('Excel4.1c rejects changed staging, blocked previews and unsupported subsidiary documents without partial writes',async()=>{
  const changed=await fixture(),changedStage=await changed.stage([journalRow()]);await changed.store.transaction(async tx=>{const saved=await tx.get(`${changed.root}/historical_import_staging/${changedStage.id}`);tx.set(`${changed.root}/historical_import_staging/${changedStage.id}`,{...saved,rows:[journalRow({reference:'TAMPERED'})]});});
  let before=changed.store.dump();await assert.rejects(changed.commit(changedStage),/بصمة/);assert.deepEqual(changed.store.dump(),before);

  const blocked=await fixture(),blockedStage=await blocked.stage([{row_number:1,kind:'trial_balance',reference:'TB-1',date:'2026-01-01',currency:'SDG',branch_id:'main',account_code:'5200',debit:100,credit:0},{row_number:2,kind:'trial_balance',reference:'TB-2',date:'2026-01-01',currency:'SDG',branch_id:'main',account_code:'4100',debit:0,credit:90}]);
  before=blocked.store.dump();await assert.rejects(blocked.commit(blockedStage),/غير جاهز/);assert.deepEqual(blocked.store.dump(),before);

  const documents=await fixture();before=documents.store.dump();
  await assert.rejects(documents.stage([{row_number:1,kind:'invoice',reference:'INV-H-1',date:'2026-01-01',currency:'SDG',branch_id:'main',account_code:'4100',counterparty_code:'customer-1',total:100,paid:0,debit:100,credit:100}]),/دليلاً أصلياً كاملاً/);
  assert.deepEqual(documents.store.dump(),before);
});

test('Excel4.1c completes with an accounting block and prevents final period close when subsidiary reconciliation differs',async()=>{
  const f=await fixture(),staged=await f.stage([journalRow({lines:[{account_code:'1200',debit:100,credit:0},{account_code:'4100',debit:0,credit:100}]})]),committed=await f.commit(staged);
  assert.equal(committed.result.status,'completed_accounting_block');assert.equal(committed.result.completion_code,'IMPORT_COMPLETED_WITH_ACCOUNTING_BLOCK');assert.ok(committed.result.reconciliation.findings_count>0);
  await f.ops.execute(f.org.id,owner,{action:'period.softClose',operationId:'soft-close',data:{id:'2026',expected_revision:1,reason:'مراجعة'}});
  await assert.rejects(f.ops.execute(f.org.id,owner,{action:'period.close',operationId:'final-close',data:{id:'2026',expected_revision:2,reason:'إغلاق',fx_review_completed:true}}),/فشل فحص الإغلاق/);
  assert.equal(f.store.dump()[`${f.root}/accounting_periods/2026`].status,'SOFT_CLOSED');
});
