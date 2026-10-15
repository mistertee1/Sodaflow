import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerFinancialSummary } from '../src/domain/ownerFinancialSummary';
import { getDefaultChartOfAccounts } from '../src/services/accountingService';
import { MemoryStore } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { defaultPlatformPlans } from '../src/lib/plans';

const entry=(org:string)=>({id:'sale',org_id:org,date:'2026-10-10',reference_type:'manual',reference_id:'sale',description:'بيع نقدي',created_by:'owner',created_at:'2026-10-10T00:00:00Z',exchange_rate_used:0,is_balanced:true,total_debit_sdg:100,total_credit_sdg:100,total_debit_usd:0,total_credit_usd:0,lines:[{account_code:'1110',account_name:'نقد',debit_sdg:100,credit_sdg:0,debit_usd:0,credit_usd:0},{account_code:'4100',account_name:'مبيعات',debit_sdg:0,credit_sdg:100,debit_usd:0,credit_usd:0}]});

test('E3 builds deterministic dual-book Owner metrics and review-only reminders without mutation',()=>{
  const org='e3-owner',accounts=getDefaultChartOfAccounts(org),journalEntries=[entry(org)],recurringExpenses=[{id:'rent',org_id:org,name:'إيجار',frequency:'monthly' as const,next_date:'2026-10-12',amount_sdg:20,amount_usd:0,status:'active' as const,revision:1,created_by:'owner',created_at:'',updated_by:'owner',updated_at:''}],fixedAssets=[{id:'asset',org_id:org,name:'حاسوب',status:'active',next_depreciation_sequence:1,schedule:[{sequence:1,date:'2026-10-31',depreciation_sdg:5,depreciation_usd:0}]}],input={orgId:org,asOf:'2026-10-15',accounts,journalEntries:journalEntries as never,receivables:[{remaining_sdg:30,remaining_usd:2}],payables:[{remaining_sdg:10,remaining_usd:1}],recurringExpenses,fixedAssets};
  const before=structuredClone(input),report=buildOwnerFinancialSummary(input);
  assert.deepEqual(report.financials,{revenue_sdg:100,revenue_usd:0,expenses_sdg:0,expenses_usd:0,net_profit_sdg:100,net_profit_usd:0,cash_sdg:100,cash_usd:0,receivables_sdg:30,receivables_usd:2,payables_sdg:10,payables_usd:1,assets_sdg:100,assets_usd:0,liabilities_sdg:0,liabilities_usd:0});
  assert.deepEqual(report.reminders.map(row=>[row.kind,row.due_date,row.execution,row.requires_confirmation]),[['recurring_expense','2026-10-12','manual_review',true],['journal_draft','2026-10-31','manual_review',true],['recurring_expense','2026-11-12','manual_review',true]]);
  assert.equal(report.summary.overdue,1);assert.equal(report.principle,'reviewable_no_automatic_financial_change');assert.deepEqual(input,before);
});

test('E3 protected summary is actual-Owner-only and performs no writes',async()=>{
  const org='e3-protected',root=`organizations/${org}`,owner={uid:'owner',email:'owner@example.com',emailVerified:true},now='2026-10-15T16:39:24.000Z',plan=defaultPlatformPlans(now).find(row=>row.id==='Enterprise')!;
  const records:Record<string,unknown>={[root]:{id:org,owner_uid:owner.uid,name:'اختبار E3',status:'active',accounting_version:2,planId:plan.id,subscriptionStatus:'active',subscriptionEnd:'2027-01-01',settings:INITIAL_SETTINGS},[`plans/${plan.id}`]:plan,[`${root}/members/accountant`]:{uid:'accountant',role:'Accountant',status:'active'},[`${root}/journal_entries/sale`]:entry(org),[`${root}/recurring_cash_sources/rent`]:{id:'rent',org_id:org,name:'إيجار',frequency:'monthly',next_date:'2026-10-20',amount_sdg:20,amount_usd:0,status:'active',revision:1,created_by:'owner',created_at:now,updated_by:'owner',updated_at:now}};
  for(const account of getDefaultChartOfAccounts(org))records[`${root}/accounts/${account.code}`]=account;
  const store=new MemoryStore(records),ops=new Operations(store,()=>new Date(now)),before=store.dump(),report=await ops.ownerFinancialSummary(org,owner,'2026-10-15');
  assert.equal(report.organizationId,org);assert.equal(report.summary.recurring_expenses,1);assert.deepEqual(store.dump(),before);
  await assert.rejects(ops.ownerFinancialSummary(org,{...owner,uid:'accountant'},'2026-10-15'),/مالك المؤسسة/);assert.deepEqual(store.dump(),before);
});
