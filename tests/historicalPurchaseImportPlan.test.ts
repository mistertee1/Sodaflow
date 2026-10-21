import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalPurchaseImportPlan } from '../src/domain/historicalPurchaseImportPlan';
import { costState } from '../src/domain/inventoryCost';
import type { HistoricalImportRow } from '../src/domain/historicalImport';

const row:HistoricalImportRow={row_number:11,kind:'purchase',reference:'LEGACY-BILL-11',date:'2026-01-01',currency:'USD',branch_id:'main',account_code:'1300',counterparty_code:'supplier-1',total:115,paid:50,debit:115,credit:115};
const evidence={party_id:'supplier-1',due_date:'2026-01-31',exchange_rate_used:2500,control_account_code:'2110',tax_account_code:'2140',tax_configuration_version_hash:'b'.repeat(64),lines:[{product_id:'product-1',description:'بضاعة تاريخية',quantity:2,net:100,tax:15,inventory_value:100}],payments:[{date:'2026-01-10',amount:20,account_code:'1120',exchange_rate_used:2550,reference:'SP-1'},{date:'2026-01-20',amount:30,account_code:'1120',exchange_rate_used:2600,reference:'SP-2'}]};
const input=()=>({org_id:'org-1',actor_id:'owner-1',session_id:'session-1',created_at:'2026-02-01',rows:[row],evidence_by_row:{11:evidence},evidence_context:{customers:[],suppliers:['supplier-1'],products:['product-1'],accounts:['1300','2110','2140','1120','4200','5500']},products:[{id:'product-1',name:'منتج',is_active:true,track_inventory:true as const,...costState(10,40000,20,'2025-01-01','2025-12-31')}]});

test('Excel4.1d.3b.3 plans native USD purchase, AP, recoverable tax and chronological WAC',()=>{
  const plan=buildHistoricalPurchaseImportPlan(input()),bill=plan.bills[0],posting=plan.journal_entries[0];
  assert.deepEqual(bill.inventory_value,{sdg:250000,usd:100});assert.deepEqual(bill.tax,{sdg:37500,usd:15});assert.deepEqual(bill.total,{sdg:287500,usd:115});
  assert.deepEqual(posting.lines.map(line=>[line.account_code,line.debit_sdg,line.credit_sdg,line.debit_usd,line.credit_usd]),[['1300',250000,0,100,0],['2140',37500,0,15,0],['2110',0,287500,0,115]]);assert.equal(posting.is_balanced,true);
  assert.deepEqual(plan.product_cost_after['product-1'],{stock_quantity:12,cost_status:'valued',cost_effective_date:'2025-01-01',cost_last_movement_date:'2026-01-01',inventory_value_sdg:290000,inventory_value_usd:120,average_cost_sdg:24166.666666666668,average_cost_usd:10});
  assert.deepEqual(plan.inventory_movements[0].average_cost_before,{sdg:4000,usd:2});assert.deepEqual(plan.inventory_movements[0].average_cost_after,{sdg:24166.666666666668,usd:10});
});

test('Excel4.1d.3b.3 freezes AP carrying value and records supplier-payment FX losses',()=>{
  const plan=buildHistoricalPurchaseImportPlan(input());
  assert.deepEqual(plan.payments.map(payment=>payment.settled),[{sdg:50000,usd:20},{sdg:75000,usd:30}]);
  assert.deepEqual(plan.payments.map(payment=>payment.cash),[{sdg:51000,usd:20},{sdg:78000,usd:30}]);
  assert.equal(plan.journal_entries[1].lines.find(line=>line.account_code==='5500')?.debit_sdg,1000);
  assert.equal(plan.journal_entries[2].lines.find(line=>line.account_code==='5500')?.debit_sdg,3000);
  assert.deepEqual(plan.bills[0].remaining,{sdg:162500,usd:65});assert.equal(plan.bills[0].status,'partially_paid');
});

test('Excel4.1d.3b.3 aggregates repeated product lines and remains deterministic without input mutation',()=>{
  const source=input();source.rows[0]={...row,total:115,paid:0};source.evidence_by_row[11]={...evidence,lines:[{product_id:'product-1',description:'أول',quantity:1,net:40,tax:6,inventory_value:40},{product_id:'product-1',description:'ثان',quantity:2,net:60,tax:9,inventory_value:60}],payments:[]};
  const copy=structuredClone(source),first=buildHistoricalPurchaseImportPlan(source),second=buildHistoricalPurchaseImportPlan(source);
  assert.deepEqual(first,second);assert.deepEqual(source,copy);assert.equal(first.inventory_movements.length,1);
  assert.deepEqual(first.inventory_movements[0],{id:'mov-purchase-hist-session-1-11-1',product_id:'product-1',product_name:'منتج',quantity:3,previous_stock:10,resulting_stock:13,value_delta:{sdg:250000,usd:100},average_cost_before:{sdg:4000,usd:2},average_cost_after:{sdg:22307.69230769231,usd:9.230769230769},journal_id:'jv-purchase-hist-session-1-11',reference_id:'pb-hist-session-1-11',historical_import_session_id:'session-1',historical_import_row_number:11});
  assert.deepEqual(first.bills[0].lines.map(line=>line.unit_cost),[40,30]);
});

test('Excel4.1d.3b.3 rejects cost backdating instead of silently rewriting later COGS',()=>{
  const source=input();source.products[0]={...source.products[0],...costState(10,40000,20,'2025-01-01','2026-01-02')};
  assert.throws(()=>buildHistoricalPurchaseImportPlan(source),/يسبق آخر حركة تكلفة/);
});

test('Excel4.1d.3b.3 rejects duplicate native ids and supplier references before persistence',()=>{
  assert.throws(()=>buildHistoricalPurchaseImportPlan({...input(),existing_ids:['pb-hist-session-1-11']}),/معرف شراء تاريخي/);
  assert.throws(()=>buildHistoricalPurchaseImportPlan({...input(),existing_supplier_references:['supplier-1:legacy-bill-11']}),/رقم فاتورة المورد/);
});

test('Excel4.1d.3b.3 fails closed when a native line cannot reproduce its source value',()=>{
  const source=input();source.rows[0]={...row,total:.01,paid:0};source.evidence_by_row[11]={...evidence,lines:[{product_id:'product-1',description:'تقريب غير قابل للتمثيل',quantity:3000000,net:.01,tax:0,inventory_value:.01}],payments:[],tax_account_code:undefined,tax_configuration_version_hash:undefined};
  assert.throws(()=>buildHistoricalPurchaseImportPlan(source),/تكلفة وحدة أصلية/);
});

test('Excel4.1d.3b.3 requires the native inventory control account',()=>{
  const source=input();source.rows[0]={...row,account_code:'5100'};
  assert.throws(()=>buildHistoricalPurchaseImportPlan(source),/حساب المخزون 1300/);
});
