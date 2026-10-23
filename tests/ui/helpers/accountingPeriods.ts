import { MemoryStore } from '../../../src/domain/store';
import { Operations } from '../../../src/domain/operations';
import { INITIAL_SETTINGS } from '../../../src/data/initialData';
import { getDefaultChartOfAccounts } from '../../../src/services/accountingService';
import { getPlanConfig, createDefaultSubscription } from '../../../src/lib/plans';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../../../src/types';
import { guestId, guestActor } from '../../fixtures/cloudIdentity';
export async function periodGuestFixture(funded=false, role:'Accountant'|'Admin'|'Viewer'|'Owner'='Owner') {
  const root=`organizations/${guestId}`,settings={...INITIAL_SETTINGS,business_name:'متجر الاختبار',default_exchange_rate:2000};
  const store=new MemoryStore({[root]:{id:guestId,owner_uid:'guest',name:'متجر الاختبار',status:'active',settings,schema_version:3},[`${root}/members/guest`]:{uid:'guest',role:'Owner',status:'active'},[`${root}/meta/subscription`]:{...createDefaultSubscription(guestId),...getPlanConfig('Enterprise'),plan:'Enterprise',org_id:guestId},[`${root}/meta/counters`]:DEFAULT_ORGANIZATION_COUNTERS,...Object.fromEntries(getDefaultChartOfAccounts(guestId).map(account=>[`${root}/accounts/${account.code}`,account]))});
  const ops=new Operations(store,()=>new Date('2026-10-07T12:00:00Z'));
  const run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(guestId,guestActor,{action,data,operationId});
  await run('account.create',{code:'1500',name_ar:'أصل مراجعة',name_en:'Review asset',type:'ASSET',nature:'DEBIT',is_active:true,reporting_group:'other_assets'},'asset');
  await run('accounting.activate',{reason:'اختبار واجهة الفترات'},'activate');
  if(funded){const cash=(await run('financialAccount.create',{name:'صندوق المراجعة',account_code:'1110',currency:'SDG',kind:'cash'},'cash')).result;await run('journal.create',{reference_type:'manual',date:'2026-10-07',description:'نقدية افتتاحية',lines:[{account_code:'1110',debit_sdg:100,credit_sdg:0,debit_usd:0.05,credit_usd:0},{account_code:'3100',debit_sdg:0,credit_sdg:100,debit_usd:0,credit_usd:0.05}]},'fund');await run('cashCount.create',{financial_account_id:cash.id,date:'2026-10-07',actual_count:90,difference_reason:'فرق جرد فعلي'},'difference');}
  if(role!=='Owner') {await run('period.create',{id:'2026-10',start_date:'2026-10-01',end_date:'2026-10-07',reason:'فترة اختبار الصلاحيات'},'period');await run('period.softClose',{id:'2026-10',expected_revision:1,reason:'مراجعة الصلاحيات'},'soft');await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),owner_uid:'original-owner'});tx.set(`${root}/members/guest`,{uid:'guest',role,status:'active'});});}
  return store.dump();
}
