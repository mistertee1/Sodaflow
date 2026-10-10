import { Operations, type Actor } from '../../src/domain/operations';
import { Organizations } from '../../server/organizations';
import type { Document, Store } from '../../src/domain/store';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
import { defaultPlatformPlans } from '../../src/lib/plans';
export const equityNow=new Date('2026-10-20T12:00:00Z');
export const equityOwner:Actor={uid:'equity-owner',email:'equity@example.com',emailVerified:true,authTime:equityNow.getTime()/1000};
export async function equityFixture(store:Store,owner=equityOwner,verify?:()=>Promise<void>,funded=true) {
  const org=await new Organizations(store).create(owner,'رأس مال اختباري',INITIAL_SETTINGS,crypto.randomUUID(),true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'});tx.set('plans/Enterprise',defaultPlatformPlans(equityNow.toISOString()).find(row=>row.id==='Enterprise')!);});
  const ops=new Operations(store,()=>equityNow,undefined,verify);
  const run=(action:string,data:Document,operationId:string=crypto.randomUUID(),actor=owner)=>ops.execute(org.id,actor,{action,data,operationId});
  await run('period.create',{id:'October',start_date:'2026-10-01',end_date:'2026-10-31',reason:'فترة اختبار'},'equity-period');
  const cash=(await run('financialAccount.create',{name:'صندوق',account_code:'1110',currency:'SDG',kind:'cash'},'equity-cash')).result;
  const input=(kind='contribution',amount=1000,date='2026-10-05')=>({kind,date,financial_account_id:cash.id,amount,currency_policy:'dual',...(kind==='contribution'?{exchange_rate_used:1000}:{}),reason:'حركة المالك',reference_number:'CAP-TEST'});
  if(funded)await run('ownerEquity.create',input('contribution',1000,'2026-10-01'),'equity-funding');
  const snapshot=()=>ops.snapshot(org.id,owner,true);
  return {org,root,ops,run,cash,input,snapshot};
}
