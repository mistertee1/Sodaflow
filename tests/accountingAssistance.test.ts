import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountingAssistance } from '../src/domain/accountingAssistance';
import { financialCollections, type FinancialData } from '../src/domain/reconciliation';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { MemoryStore } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { defaultPlatformPlans } from '../src/lib/plans';

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
