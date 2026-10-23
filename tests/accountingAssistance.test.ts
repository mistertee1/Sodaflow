import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountingAssistance } from '../src/domain/accountingAssistance';
import { financialCollections, type FinancialData } from '../src/domain/reconciliation';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { MemoryStore } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { defaultPlatformPlans } from '../src/lib/plans';
import { getDefaultChartOfAccounts } from '../src/services/accountingService';

const empty=()=>Object.fromEntries(financialCollections.map(name=>[name,[]])) as FinancialData;

test('E2.1 converts health findings into review-only tasks without changing sources',()=>{
  const data=empty();
  data.journal_entries.push({id:'broken',date:'2026-10-01',lines:[{account_code:'9999',debit_sdg:1,credit_sdg:0,debit_usd:0,credit_usd:0}]});
  const before=structuredClone(data),report=buildAccountingAssistance(data,INITIAL_SETTINGS,'2026-10-15');
  assert.ok(report.tasks.some(row=>row.id.startsWith('health:')&&row.priority==='blocking'));
  assert.ok(report.tasks.every(row=>row.execution==='manual_review'&&row.requires_confirmation));
  assert.equal(report.principle,'reviewable_no_automatic_financial_change');
  assert.deepEqual(data,before);
});

test('E2.1 detects deterministic due, margin and open-period anomalies',()=>{
  const data=empty();
  data.purchase_bills.push({id:'bill-1',supplier_reference:'SUP-1',status:'open',due_date:'2026-10-20',remaining_sdg:100,remaining_usd:0});
  data.invoices.push({id:'invoice-1',invoice_number:'INV-1',status:'sent',costing_status:'complete',subtotal_sdg:100,discount_total_sdg:0,cogs_sdg:120,subtotal_usd:0,discount_total_usd:0,cogs_usd:0});
  data.accounting_periods.push({id:'sep-2026',start_date:'2026-09-01',end_date:'2026-09-30',status:'OPEN'});
  const report=buildAccountingAssistance(data,INITIAL_SETTINGS,'2026-10-15');
  assert.equal(report.summary.anomalies,3);
  assert.deepEqual(report.tasks.filter(row=>row.id.startsWith('anomaly:')).map(row=>row.id),['anomaly:negative-margin:invoice-1','anomaly:period-open:sep-2026','anomaly:supplier-due:bill-1']);
  assert.deepEqual(report.tasks.filter(row=>row.id.startsWith('anomaly:')).map(row=>row.review_route),['product-profitability','period-close','payables']);
});

test('E2.3 suggests an active operating expense account without rewriting the source',()=>{
  const data=empty();
  data.accounts.push(...getDefaultChartOfAccounts('e2-smart'));
  data.expenses.push({id:'expense-rent',org_id:'e2-smart',title:'إيجار أكتوبر',category:'إيجار',amount:500,currency:'SDG',date:'2026-10-10',created_at:'2026-10-10T08:00:00Z'});
  const before=structuredClone(data),report=buildAccountingAssistance(data,INITIAL_SETTINGS,'2026-10-15');
  assert.equal(report.summary.account_suggestions,1);
  assert.deepEqual(report.account_suggestions[0],{id:'account-suggestion:expense:expense-rent',source:{collection:'expenses',id:'expense-rent'},category:'إيجار',current_account_code:null,suggested_account_code:'5200',suggested_account_name:'إيجار المحل والمخازن',confidence:'high',basis:'deterministic_expense_category_rule',status:'unassigned',execution:'manual_review',requires_confirmation:true});
  assert.deepEqual(data,before);
});

test('E2.3 reports close blockers and always requires explicit FX review',()=>{
  const data=empty(),report=buildAccountingAssistance(data,INITIAL_SETTINGS,'2026-10-15',{period_id:'sep-2026',end_date:'2026-09-30',checks:{sales_posted:true,bank_reconciled:false,journals_balanced:true},findings_count:2,missing_reconciliations:['1130'],can_close:false,ledger_hash:'a'.repeat(64)});
  assert.deepEqual(report.close_assistance,{period_id:'sep-2026',end_date:'2026-09-30',can_close:false,failing_checks:['bank_reconciled'],findings_count:2,missing_reconciliations:['1130'],fx_review_required:true,ledger_hash:'a'.repeat(64),execution:'manual_review',requires_confirmation:true});
  assert.equal(report.summary.close_blockers,4);
});

test('E2.1 protected assistance requires advanced journal access and remains read-only',async()=>{
  const org='e2-assistance',root=`organizations/${org}`,owner={uid:'owner',email:'owner@example.com',emailVerified:true},now='2026-10-15T07:50:00.000Z';
  const plan=defaultPlatformPlans(now).find(row=>row.id==='Enterprise')!;
  const store=new MemoryStore({
    [root]:{id:org,owner_uid:owner.uid,name:'مؤسسة اختبار',status:'active',accounting_version:2,planId:plan.id,subscriptionStatus:'active',subscriptionEnd:'2027-01-01',settings:INITIAL_SETTINGS},
    [`plans/${plan.id}`]:plan,
    [`${root}/members/viewer`]:{uid:'viewer',role:'Viewer',status:'active'},
    [`${root}/purchase_bills/bill-1`]:{id:'bill-1',org_id:org,supplier_reference:'SUP-1',status:'open',due_date:'2026-10-20',remaining_sdg:100,remaining_usd:0},
  });
  const ops=new Operations(store,()=>new Date(now)),before=store.dump();
  const report=await ops.accountingAssistance(org,owner,'2026-10-15');
  assert.ok(report.tasks.some(row=>row.id==='anomaly:supplier-due:bill-1'));
  assert.deepEqual(store.dump(),before);
  await assert.rejects(ops.accountingAssistance(org,{...owner,uid:'viewer'},'2026-10-15'),/صلاحية/);
});

test('E2.3 protected assistance includes the latest ended period checklist without closing it',async()=>{
  const org='e2-close',root=`organizations/${org}`,owner={uid:'owner',email:'owner@example.com',emailVerified:true},now='2026-10-15T07:50:00.000Z';
  const plan=defaultPlatformPlans(now).find(row=>row.id==='Enterprise')!;
  const period={id:'sep-2026',org_id:org,schema_version:1,start_date:'2026-09-01',end_date:'2026-09-30',status:'OPEN',revision:1,created_by:owner.uid,created_at:'2026-09-01T00:00:00Z',operation_id:'period-create'};
  const store=new MemoryStore({[root]:{id:org,owner_uid:owner.uid,name:'مؤسسة اختبار',status:'active',accounting_version:2,planId:plan.id,subscriptionStatus:'active',subscriptionEnd:'2027-01-01',settings:INITIAL_SETTINGS},[`plans/${plan.id}`]:plan,[`${root}/accounting_periods/${period.id}`]:period});
  const ops=new Operations(store,()=>new Date(now)),before=store.dump(),report=await ops.accountingAssistance(org,owner,'2026-10-15');
  assert.equal(report.close_assistance?.period_id,period.id);
  assert.equal(report.close_assistance?.can_close,true);
  assert.equal(report.close_assistance?.fx_review_required,true);
  assert.deepEqual(store.dump(),before);
});
