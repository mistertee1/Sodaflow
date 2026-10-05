import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, type Store } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { journalLine } from '../src/domain/financial';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { transferCarryingValue } from '../src/domain/cashManagement';
const owner: Actor = { uid:'cash-owner', email:'cash@example.com', emailVerified:true };
async function fixture(currency='SDG') {
  const store=new MemoryStore(), org=await new Organizations(store).create(owner,'نقدية',INITIAL_SETTINGS,'setup',true), root=`organizations/${org.id}`;
  await store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));
  const ops=new Operations(store,()=>new Date('2026-10-05T12:00:00Z'));
  const run=(action:string,data:Record<string,unknown>,operationId:string=crypto.randomUUID(),actor=owner)=>ops.execute(org.id,actor,{action,data,operationId});
  await run('account.create',{code:'wallet',name_ar:'محفظة',name_en:'Wallet',type:'ASSET',nature:'DEBIT',reporting_group:'cash_bank',is_active:true},'wallet');
  await run('journal.create',{reference_type:'opening_balance',date:'2026-10-01',description:'افتتاحي موثق',lines:[journalLine(currency==='USD'?'1120':'1110','نقد',1000,0,1,0),journalLine('3100','رأس مال',0,1000,0,1)]},'opening');
  await run('accounting.activate',{reason:'دفتر بلا مخزون مطابق'},'activate');
  const from=(await run('financialAccount.create',{name:'صندوق',account_code:currency==='USD'?'1120':'1110',currency,kind:'cash'},'from')).result, to=(await run('financialAccount.create',{name:'محفظة',account_code:'wallet',currency,kind:'wallet'},'to')).result;
  const transfer=(amount=100,date='2026-10-05')=>({from_id:from.id,to_id:to.id,amount,date,reason:'تحويل داخلي مثبت',reference_number:'T-1'});
  const books=async()=>{const s=await ops.snapshot(org.id,owner,true);assert.deepEqual(reconcileFinancialData(s.collections as FinancialData,s.settings,{requireCosting:true}),[]);return s;};
  return {store,org,root,ops,run,from,to,transfer,books};
}
test('B2 financial accounts map custom cash classification uniquely and cannot accept balances or change established identity',async()=>{
  const f=await fixture();await assert.rejects(f.run('financialAccount.create',{name:'مكرر',account_code:'1110',currency:'SDG',kind:'cash'},'duplicate'),/مرتبط/);
  await assert.rejects(f.run('financialAccount.create',{name:'مخزون',account_code:'1300',currency:'SDG',kind:'bank'},'wrong'),/أصل نقدي/);
  await assert.rejects(f.run('financialAccount.update',{id:f.from.id,updates:{currency:'USD'}},'currency'),/ثابتة/);await assert.rejects(f.run('financialAccount.update',{id:f.from.id,updates:{balance_sdg:1}},'balance'),/القيود/);
  await f.run('financialAccount.update',{id:f.from.id,updates:{name:'صندوق جديد'}},'name');assert.equal((await f.books()).collections.financial_accounts.find(a=>a.id===f.from.id)!.name,'صندوق جديد');
});
test('B2 transfer is atomic and exactly once, preserves source carrying values in both books and never posts income/expense',async()=>{
  const f=await fixture(), command=f.transfer(250), result=await f.run('cashTransfer.create',command,'transfer');assert.equal(result.result.amount_sdg,250);assert.equal(result.result.amount_usd,.25);assert.deepEqual(await f.run('cashTransfer.create',command,'transfer'),result);
  const s=await f.books(), entry=s.collections.journal_entries.find(j=>j.reference_type==='internal_transfer')!;assert.equal(entry.lines.length,2);assert.deepEqual(entry.lines.map((l:any)=>l.account_code),['wallet','1110']);assert.equal(s.collections.internal_transfers.length,1);
  const report=await f.ops.operationalReport(f.org.id,owner,'cash',{start:'2026-10-05',end:'2026-10-05'});assert.equal(report.closing_sdg,1000);assert.equal(report.inflow_sdg,0);assert.equal(report.outflow_sdg,0);assert.equal(report.accounts.find(a=>a.account.code==='wallet')!.closing.USD,.25);
  assert.equal(f.store.dump()[`${f.root}/audit_logs/audit-transfer`].new_state[`${f.root}/internal_transfers/tr-transfer`].source_balance_sdg,1000);
});
test('B2 concurrent distinct transfers cannot spend the same source funds twice; retrying one command creates one source journal',async()=>{
  const f=await fixture(), data=f.transfer(800), race=await Promise.allSettled([f.run('cashTransfer.create',data,'race-a'),f.run('cashTransfer.create',data,'race-b')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
  const winner=race[0].status==='fulfilled'?'race-a':'race-b';await f.run('cashTransfer.create',data,winner);const s=await f.books();assert.equal(s.collections.internal_transfers.length,1);assert.equal(s.collections.journal_entries.filter(j=>j.reference_type==='internal_transfer').length,1);
});
test('B2 same-currency USD transfer moves historical pool basis, conserving final fractional allocation without a new FX rate',async()=>{
  assert.deepEqual(transferCarryingValue(.01,'USD',{SDG:1,USD:.03}),{sdg:0,usd:.01});assert.deepEqual(transferCarryingValue(.01,'USD',{SDG:1,USD:.02}),{sdg:1,usd:.01});assert.deepEqual(transferCarryingValue(.01,'USD',{SDG:0,USD:.01}),{sdg:0,usd:.01});
  const f=await fixture('USD');const r=await f.run('cashTransfer.create',f.transfer(.25),'usd');assert.equal(r.result.amount_sdg,250);assert.equal(r.result.amount_usd,.25);await f.books();
});
test('B2 invalid, cross-tenant, inactive, cross-currency, locked and backdated insufficient transfers roll back without journal or balance edits',async()=>{
  const f=await fixture();for(const input of [{from_id:'foreign'},{to_id:f.from.id},{amount:0},{amount:1001},{amount:1.5},{reason:''},{date:'2026-09-30'}]){const before=f.store.dump();await assert.rejects(f.run('cashTransfer.create',{...f.transfer(),...input}));assert.deepEqual(f.store.dump(),before);}
  await f.run('financialAccount.update',{id:f.to.id,updates:{status:'inactive'}},'inactive');await assert.rejects(f.run('cashTransfer.create',f.transfer(),'no-active'),/نشط/);await f.run('financialAccount.update',{id:f.to.id,updates:{status:'active'}},'active');
  const usd=(await f.run('financialAccount.create',{name:'دولار',account_code:'1120',currency:'USD',kind:'cash'},'usd-account')).result;await assert.rejects(f.run('cashTransfer.create',{...f.transfer(),to_id:usd.id},'cross-currency'),/بنفس العملة/);
  await f.run('expense.create',{title:'صرف لاحق',amount:950,currency:'SDG',exchange_rate_used:1000,date:'2026-10-07',payment_method:'cash'},'later');await assert.rejects(f.run('cashTransfer.create',f.transfer(100,'2026-10-05'),'old'),/يوم لاحق/);
  await f.run('settings.update',{updates:{period_lock_date:'2026-10-05'}},'lock');await assert.rejects(f.run('cashTransfer.create',f.transfer(10),'locked'),/مقفلة/);
});
test('B2 roles, expired entitlement and browser authority cannot bypass transfer commands or disclose new collections',async()=>{
  const f=await fixture(), sales={...owner,uid:'sales'};await f.store.transaction(async tx=>tx.set(`${f.root}/members/sales`,{uid:'sales',role:'Sales',status:'active'}));await assert.rejects(f.run('cashTransfer.create',f.transfer(),'sales-transfer',sales),/صلاحية/);assert.deepEqual((await f.ops.snapshot(f.org.id,sales)).collections.financial_accounts,[]);
  const browser:Store={authority:'browser',transaction:work=>f.store.transaction(work)};await assert.rejects(new Operations(browser).execute(f.org.id,owner,{action:'cashTransfer.create',data:f.transfer(),operationId:'browser'}),/الخادم/);
  await f.store.transaction(async tx=>tx.set(f.root,{...await tx.get(f.root),subscriptionEnd:'2026-10-01'}));await assert.rejects(f.run('cashTransfer.create',f.transfer(),'expired'));
});
test('B2 financial backup restores mappings and transfer sources, refuses tampered amounts, and does not ignore orphan transfer journals in old backups',async()=>{
  const f=await fixture();await f.run('cashTransfer.create',f.transfer(250),'transfer');const backup=await f.books(), target={...owner,uid:'restore-cash'}, org=await new Organizations(f.store).create(target,'استعادة',INITIAL_SETTINGS,'restore',true);await f.store.transaction(async tx=>tx.set(`organizations/${org.id}`,{...await tx.get(`organizations/${org.id}`),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));
  const bad=structuredClone(backup);bad.collections.internal_transfers[0].amount_usd=.3;await assert.rejects(f.ops.execute(org.id,target,{action:'backup.restore',data:{backup:bad},operationId:'bad'}),/فروقات/);
  await f.ops.execute(org.id,target,{action:'backup.restore',data:{backup},operationId:'restore'});assert.equal(f.store.dump()[`organizations/${org.id}/financial_account_mappings/1110`].id,f.from.id);const restored=await f.ops.snapshot(org.id,target,true);assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData,restored.settings,{requireCosting:true}),[]);
  const old=structuredClone(backup);delete (old.collections as any).internal_transfers;delete (old.collections as any).financial_accounts;const another={...owner,uid:'restore-orphan'}, orphan=await new Organizations(f.store).create(another,'مراجع ناقصة',INITIAL_SETTINGS,'orphan',true);await f.store.transaction(async tx=>tx.set(`organizations/${orphan.id}`,{...await tx.get(`organizations/${orphan.id}`),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));await assert.rejects(f.ops.execute(orphan.id,another,{action:'backup.restore',data:{backup:old},operationId:'old'}),/فروقات/);
});
