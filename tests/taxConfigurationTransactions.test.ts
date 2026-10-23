import assert from 'node:assert/strict';
import test from 'node:test';
import {INITIAL_SETTINGS} from '../src/data/initialData';
import {MemoryStore, type Store} from '../src/domain/store';
import {Operations, type Actor} from '../src/domain/operations';
import {createDefaultSubscription, getPlanConfig} from '../src/lib/plans';
import {remapTaxConfigurations, validateTaxConfigurationBackup, verifyTaxConfigurationSources} from '../src/domain/taxConfigurationTransactions';

const org='tax-command-org', root=`organizations/${org}`, now=new Date('2026-10-11T06:45:00Z');
const owner:Actor={uid:'owner',email:'owner@test.local',emailVerified:true,authTime:Math.floor(now.getTime()/1000)-60};
const input=(patch:Record<string,unknown>={})=>({id:'sales-tax',name:'ضريبة مبيعات اختبارية',jurisdiction:'إعداد المؤسسة',direction:'sales',rate:15,calculation:'exclusive',rounding:'half_up',recoverable:false,tax_account_code:'2130',effective_from:'2026-01-01',effective_to:null,active:true,reason:'اعتماد السياسة',...patch});
function fixture(role:'Owner'|'Accountant'|'Admin'='Owner', authority:'local'|'browser'='local') {
  const actor=role==='Owner'?{...owner}:{...owner,uid:role.toLowerCase()};
  const memory=new MemoryStore({[root]:{id:org,owner_uid:'owner',name:'مؤسسة الضريبة',status:'active',accounting_version:2,settings:INITIAL_SETTINGS},[`${root}/members/${actor.uid}`]:{uid:actor.uid,role,status:'active'},[`${root}/meta/subscription`]:{...createDefaultSubscription(org),...getPlanConfig('Enterprise'),plan:'Enterprise',org_id:org,status:'active',effective_status:'active'},[`${root}/accounts/2130`]:{id:'2130',code:'2130',org_id:org,name_ar:'ضريبة مستحقة',name_en:'Tax payable',type:'LIABILITY',nature:'CREDIT',reporting_group:'tax_payable',is_active:true,balance_sdg:0,balance_usd:0},[`${root}/accounts/1350`]:{id:'1350',code:'1350',org_id:org,name_ar:'ضريبة مستردة',name_en:'Recoverable tax',type:'ASSET',nature:'DEBIT',reporting_group:'other_assets',is_active:true,balance_sdg:0,balance_usd:0}});
  const store:Store=authority==='local'?memory:{authority:'browser',transaction:memory.transaction.bind(memory)};
  const ops=new Operations(store,()=>now),run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org,actor,{action,operationId,data});return{memory,run,actor,ops};
}

test('C5.2a creates immutable version, recent-auth audit and idempotent receipt atomically',async()=>{
  const f=fixture(),first=await f.run('taxConfiguration.create',input(),'tax-create');assert.equal(first.result.revision,1);
  const dump=f.memory.dump(),version=dump[`${root}/tax_configuration_versions/sales-tax-r1`],audit=dump[`${root}/audit_logs/audit-tax-create`];
  assert.equal(version.configuration_id,'sales-tax');assert.equal(version.reason,'اعتماد السياسة');assert.equal(version.previous_version_hash,null);assert.match(version.version_hash,/^[a-f0-9]{64}$/);assert.equal(first.result.version_hash,version.version_hash);assert.equal(audit.new_state[`${root}/tax_configurations/sales-tax`].jurisdiction,'إعداد المؤسسة');assert.deepEqual(audit.tax_configuration_evidence,{configuration_id:'sales-tax',revision:1,version_id:'sales-tax-r1'});assert.equal(audit.reauthentication.auth_time,owner.authTime);
  assert.deepEqual((await f.run('taxConfiguration.create',input(),'tax-create')).result,first.result);
});

test('C5.2a update preserves all versions, rejects stale/no-op and never returns an obsolete cached result',async()=>{
  const f=fixture();await f.run('taxConfiguration.create',input(),'tax-create');const updated=await f.run('taxConfiguration.update',input({expected_revision:1,rate:17.5,reason:'تعديل معتمد'}),'tax-update');assert.equal(updated.result.revision,2);
  const dump=f.memory.dump(),v1=dump[`${root}/tax_configuration_versions/sales-tax-r1`],v2=dump[`${root}/tax_configuration_versions/sales-tax-r2`];assert.equal(v1.rate,15);assert.equal(v2.rate,17.5);assert.equal(v2.previous_version_hash,v1.version_hash);assert.equal(updated.result.version_hash,v2.version_hash);
  await assert.rejects(f.run('taxConfiguration.update',input({expected_revision:1,rate:20}),'tax-stale'),/تغير/);
  await assert.rejects(f.run('taxConfiguration.update',input({expected_revision:2,rate:17.5}),'tax-noop'),/لم يتغير/);
  await assert.rejects(f.run('taxConfiguration.create',input(),'tax-create'),/تغير بعد العملية المحفوظة/);
});

test('C5.2a rejects a missing or altered immutable version before another update',async()=>{
  for(const mutate of [(row:Record<string,unknown>)=>{row.rate=99;},(_row:Record<string,unknown>,all:Record<string,Record<string,unknown>>)=>{delete all[`${root}/tax_configuration_versions/sales-tax-r1`];}]) {
    const f=fixture();await f.run('taxConfiguration.create',input(),'tax-create');
    const documents=f.memory.dump(),row=documents[`${root}/tax_configuration_versions/sales-tax-r1`];mutate(row,documents);
    const damaged=new MemoryStore(documents),ops=new Operations(damaged,()=>now);
    await assert.rejects(ops.execute(org,owner,{action:'taxConfiguration.update',operationId:'tax-update',data:input({expected_revision:1,rate:17})}),/سلسلة|يطابق/);
    assert.equal(damaged.dump()[`${root}/tax_configurations/sales-tax`].revision,1);
  }
});

test('C5.2a is owner-only, server-authoritative, recently authenticated and validates the control account',async()=>{
  for(const role of ['Accountant','Admin'] as const)await assert.rejects(fixture(role).run('taxConfiguration.create',input(),`tax-${role}`),/صلاحية|مالك/);
  const old=fixture();old.actor.authTime=Math.floor(now.getTime()/1000)-3600;await assert.rejects(old.run('taxConfiguration.create',input(),'tax-old-auth'),/تحقق|الدخول/);
  await assert.rejects(fixture().run('taxConfiguration.create',input({tax_account_code:'1350'}),'tax-wrong-account'),/التزاماً ضريبياً/);
  await assert.rejects(fixture('Owner','browser').run('taxConfiguration.create',input(),'tax-browser'),/خدمة الخادم/);
});

test('C5.2a rolls back invalid, invented or colliding requests without partial versions',async()=>{
  const f=fixture();await assert.rejects(f.run('taxConfiguration.create',input({rate:101}),'tax-invalid'));await assert.rejects(f.run('taxConfiguration.create',input({forged_balance:10}),'tax-forged'));assert.equal(f.memory.dump()[`${root}/tax_configurations/sales-tax`],undefined);
  await f.run('taxConfiguration.create',input(),'tax-create');await assert.rejects(f.run('taxConfiguration.create',input(),'tax-duplicate'),/موجود/);assert.equal(Object.keys(f.memory.dump()).filter(key=>key.includes('/tax_configuration_versions/')).length,1);
});

test('C5.2c backup proves the complete tax version chain and remaps tenant identity',async()=>{
  const f=fixture();await f.run('taxConfiguration.create',input(),'tax-create');await f.run('taxConfiguration.update',input({expected_revision:1,rate:17,reason:'تعديل النسخة'}),'tax-update');
  const backup=await new Operations(f.memory,()=>now).snapshot(org,owner,true);
  assert.equal(backup.tax_configuration_schema_version,1);assert.equal(backup.counters.tax_configuration_count,1);assert.equal(backup.counters.tax_configuration_version_count,2);
  const validated=await validateTaxConfigurationBackup(backup);assert.equal(validated.tax_configuration_versions.length,2);
  const remapped=await remapTaxConfigurations(backup.collections,'restored-tax-org');await verifyTaxConfigurationSources(remapped,'restored-tax-org');assert.equal(remapped.tax_configurations[0].org_id,'restored-tax-org');assert.equal(remapped.tax_configurations[0].source_org_id,org);
});

test('C5.2c rejects missing, orphaned or tampered tax policy history before restore',async()=>{
  const f=fixture();await f.run('taxConfiguration.create',input(),'tax-create');const backup=await new Operations(f.memory,()=>now).snapshot(org,owner,true);
  for(const mutate of [(b:any)=>{b.collections.tax_configuration_versions[0].rate=99;},(b:any)=>{b.collections.tax_configuration_versions=[];},(b:any)=>{b.counters.tax_configuration_version_count=0;}]){const damaged=structuredClone(backup);mutate(damaged);await assert.rejects(validateTaxConfigurationBackup(damaged),/بصمة|ناقصة|عدادات/);}
});

test('C5.3.2 protects the tax report and reads authoritative control-account postings',async()=>{
  const f=fixture();await f.run('taxConfiguration.create',input(),'tax-create');
  await f.memory.transaction(async tx=>tx.set(`${root}/journal_entries/tax-entry`,{id:'tax-entry',org_id:org,date:'2026-10-01',description:'قيد ضريبة',reference_type:'invoice',reference_id:'invoice-1',created_by:'owner',created_at:now.toISOString(),exchange_rate_used:0,lines:[{id:'tax',account_code:'2130',description:'ضريبة',debit_sdg:0,credit_sdg:150,debit_usd:0,credit_usd:0}]}));
  const report=await f.ops.taxReports(org,f.actor,{start:'2026-10-01',end:'2026-10-31'});assert.deepEqual(report.sales_tax,{sdg:150,usd:0});assert.equal(report.controls[0].closing.sdg,150);
  const sales=fixture('Admin');sales.actor.uid='sales';await sales.memory.transaction(async tx=>tx.set(`${root}/members/sales`,{uid:'sales',role:'Sales',status:'active'}));await assert.rejects(sales.ops.taxReports(org,sales.actor),/صلاحية/);
});
