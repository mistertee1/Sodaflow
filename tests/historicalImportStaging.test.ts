import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { buildHistoricalImportStage } from '../src/domain/historicalImportStaging';
import type { HistoricalImportContext, HistoricalImportRow } from '../src/domain/historicalImport';

const journal=(overrides:Partial<HistoricalImportRow>={}):HistoricalImportRow=>({row_number:1,kind:'journal',reference:'HIST-J-1',date:'2026-01-10',currency:'SDG',branch_id:'main',lines:[{account_code:'1200',debit:100,credit:0},{account_code:'4100',debit:0,credit:100}],...overrides});
const validation:HistoricalImportContext={orgId:'org',accounts:['1200','4100'],branches:['main'],currencies:['SDG','USD'],dimensions:[],periods:[{start_date:'2026-01-01',end_date:'2026-12-31',status:'OPEN'}],existingReferences:[]};

test('Excel4.1b builds immutable bounded staging evidence and preserves an accounting block',async()=>{
  const rows:HistoricalImportRow[]=[{row_number:1,kind:'trial_balance',reference:'TB-1',date:'2026-01-10',currency:'SDG',branch_id:'main',account_code:'1200',debit:100,credit:0},{row_number:2,kind:'trial_balance',reference:'TB-2',date:'2026-01-10',currency:'SDG',branch_id:'main',account_code:'4100',debit:0,credit:90}],before=structuredClone(rows);
  const staged=await buildHistoricalImportStage({file_name:'legacy.xlsx',file_hash:'a'.repeat(64),schema_version:1,rows},{orgId:'org',actorUid:'accountant',operationId:'stage-one',createdAt:'2026-10-18T18:00:00Z',validation,previousSessions:[]});
  assert.deepEqual(rows,before);assert.equal(staged.result.status,'staged_accounting_block');assert.equal(staged.result.accounting_block,true);assert.match(staged.result.rows_sha256,/^[a-f0-9]{64}$/);assert.equal(staged.staging.rows.length,2);assert.equal(staged.result.rows_imported,0);assert.deepEqual(staged.staging.validation_basis.accounts,['1200','4100']);
});

test('Excel4.1b refuses row errors, unsupported fields and closed or uncovered periods before staging',async()=>{
  const context={...validation,periods:[{start_date:'2026-01-01',end_date:'2026-01-31',status:'CLOSED' as const}]};
  await assert.rejects(buildHistoricalImportStage({file_name:'legacy.xlsx',file_hash:'b'.repeat(64),schema_version:1,rows:[journal()]},{orgId:'org',actorUid:'owner',operationId:'closed',createdAt:'2026-10-18T18:00:00Z',validation:context,previousSessions:[]}),/أخطاء حاجبة/);
  await assert.rejects(buildHistoricalImportStage({file_name:'legacy.xlsx',file_hash:'b'.repeat(64),schema_version:1,rows:[journal({date:'2026-02-01'})]},{orgId:'org',actorUid:'owner',operationId:'outside',createdAt:'2026-10-18T18:00:00Z',validation:context,previousSessions:[]}),/أخطاء حاجبة/);
  await assert.rejects(buildHistoricalImportStage({file_name:'legacy.xlsx',file_hash:'b'.repeat(64),schema_version:1,rows:[journal()],context:'forged'} as never,{orgId:'org',actorUid:'owner',operationId:'forged',createdAt:'2026-10-18T18:00:00Z',validation,previousSessions:[]}),/حقول/);
});

async function fixture(){
  const owner:Actor={uid:'owner',email:'owner@example.com',emailVerified:true},accountant:Actor={uid:'accountant',email:'accountant@example.com',emailVerified:true},viewer:Actor={uid:'viewer',email:'viewer@example.com',emailVerified:true};
  const store=new MemoryStore(),org=await new Organizations(store).create(owner,'Historical staging',{...INITIAL_SETTINGS},'setup',true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{
    tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionEnd:'2027-01-01'});
    tx.set(`${root}/members/accountant`,{uid:'accountant',role:'Accountant',status:'active',org_id:org.id});
    tx.set(`${root}/members/viewer`,{uid:'viewer',role:'Viewer',status:'active',org_id:org.id});
    tx.set(`${root}/accounting_periods/2026`,{id:'2026',org_id:org.id,schema_version:1,start_date:'2026-01-01',end_date:'2026-12-31',status:'OPEN',revision:1,created_by:'owner',created_at:'2026-01-01',operation_id:'period'});
  });
  return{owner,accountant,viewer,store,org,root,ops:new Operations(store,()=>new Date('2026-10-18T18:00:00Z'))};
}

test('Excel4.1b command stages only server-derived evidence, audits and remains idempotent',async()=>{
  const f=await fixture(),data={file_name:'journals.xlsx',file_hash:'c'.repeat(64),schema_version:1,rows:[journal()]},command={action:'historicalImport.stage',operationId:'history-stage',data};
  const first=await f.ops.execute(f.org.id,f.accountant,command),again=await f.ops.execute(f.org.id,f.accountant,command);assert.deepEqual(again,first);
  const dump=f.store.dump(),id='historical-import-history-stage';assert.equal(first.result.status,'staged');assert.equal(dump[`${f.root}/historical_import_sessions/${id}`].created_by,'accountant');assert.equal(dump[`${f.root}/historical_import_staging/${id}`].rows[0].reference,'HIST-J-1');assert.equal(dump[`${f.root}/audit_logs/audit-history-stage`].event_type,'DATA_IMPORT_STARTED');assert.equal(dump[`${f.root}/audit_logs/audit-history-stage`].import_metadata.rows_imported,0);
  assert.equal(Object.keys(dump).filter(path=>path.startsWith(`${f.root}/journal_entries/`)).length,0);assert.equal(Object.keys(dump).filter(path=>path.startsWith(`${f.root}/invoices/`)).length,0);
  assert.equal((await f.ops.snapshot(f.org.id,f.accountant)).collections.historical_import_sessions.length,1);assert.equal((await f.ops.snapshot(f.org.id,f.viewer)).collections.historical_import_sessions.length,0);
});

test('Excel4.1b denies viewer access and rolls back blocked or duplicate references',async()=>{
  const f=await fixture(),base={file_name:'journals.csv',file_hash:'d'.repeat(64),schema_version:1,rows:[journal()]};
  await assert.rejects(f.ops.execute(f.org.id,f.viewer,{action:'historicalImport.stage',operationId:'viewer-stage',data:base}),/صلاحية/);
  await f.store.transaction(async tx=>tx.set(`${f.root}/journal_entries/existing`,{id:'existing',org_id:f.org.id,reference_number:'HIST-J-1'}));
  const before=f.store.dump();await assert.rejects(f.ops.execute(f.org.id,f.owner,{action:'historicalImport.stage',operationId:'duplicate-stage',data:base}),/أخطاء حاجبة/);assert.deepEqual(f.store.dump(),before);
});
