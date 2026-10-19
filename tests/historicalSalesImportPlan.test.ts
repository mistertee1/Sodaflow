import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalSalesImportPlan } from '../src/domain/historicalSalesImportPlan';
import type { HistoricalImportRow } from '../src/domain/historicalImport';

const row:HistoricalImportRow={row_number:7,kind:'invoice',reference:'LEGACY-INV-7',date:'2026-01-01',currency:'USD',branch_id:'main',account_code:'4100',counterparty_code:'customer-1',total:115,paid:50,debit:115,credit:115};
const evidence={party_id:'customer-1',due_date:'2026-01-31',exchange_rate_used:2500,control_account_code:'1200',tax_account_code:'2130',tax_configuration_version_hash:'a'.repeat(64),lines:[{product_id:'product-1',description:'بضاعة تاريخية',quantity:2,net:100,tax:15,cogs:60}],payments:[{date:'2026-01-10',amount:20,account_code:'1120',exchange_rate_used:2550,reference:'R-1'},{date:'2026-01-20',amount:30,account_code:'1120',exchange_rate_used:2600,reference:'R-2'}]};
const input=()=>({org_id:'org-1',actor_id:'owner-1',session_id:'session-1',created_at:'2026-02-01',rows:[row],evidence_by_row:{7:evidence},evidence_context:{customers:['customer-1'],suppliers:[],products:['product-1'],accounts:['1200','4100','5100','1300','2130','1120','4200','5500']},products:[{id:'product-1',name:'منتج',stock_quantity:10,track_inventory:true}]});

test('Excel4.1d.3b.1 plans native USD invoice, AR, tax and COGS in both books',()=>{
  const plan=buildHistoricalSalesImportPlan(input());const invoice=plan.invoices[0],posting=plan.journal_entries[0];
  assert.deepEqual(invoice.total,{sdg:287500,usd:115});assert.deepEqual(invoice.cogs,{sdg:150000,usd:60});
  assert.deepEqual(posting.lines.map(line=>[line.account_code,line.debit_sdg,line.credit_sdg,line.debit_usd,line.credit_usd]),[['1200',287500,0,115,0],['4100',0,250000,0,100],['2130',0,37500,0,15],['5100',150000,0,60,0],['1300',0,150000,0,60]]);
  assert.equal(posting.is_balanced,true);
});

test('Excel4.1d.3b.1 allocates carrying value and records realized FX per historical receipt',()=>{
  const plan=buildHistoricalSalesImportPlan(input());
  assert.deepEqual(plan.payments.map(payment=>payment.settled),[{sdg:50000,usd:20},{sdg:75000,usd:30}]);
  assert.deepEqual(plan.payments.map(payment=>payment.cash),[{sdg:51000,usd:20},{sdg:78000,usd:30}]);
  assert.equal(plan.journal_entries[1].lines.find(line=>line.account_code==='4200')?.credit_sdg,1000);
  assert.equal(plan.journal_entries[2].lines.find(line=>line.account_code==='4200')?.credit_sdg,3000);
  assert.deepEqual(plan.invoices[0].remaining,{sdg:162500,usd:65});assert.equal(plan.invoices[0].status,'partially_paid');
});

test('Excel4.1d.3b.1 produces deterministic ids and stock movement without mutating input',()=>{
  const source=input(),copy=structuredClone(source),first=buildHistoricalSalesImportPlan(source),second=buildHistoricalSalesImportPlan(source);
  assert.deepEqual(first,second);assert.deepEqual(source,copy);
  assert.deepEqual(first.inventory_movements[0],{id:'mov-hist-session-1-7-1',product_id:'product-1',product_name:'منتج',quantity:-2,previous_stock:10,resulting_stock:8,value_delta:{sdg:-150000,usd:-60},journal_id:'jv-inv-hist-session-1-7',reference_id:'inv-hist-session-1-7',historical_import_session_id:'session-1',historical_import_row_number:7});
  assert.equal(first.product_stock_after['product-1'],8);
});

test('Excel4.1d.3b.1 applies invoice chronology and fails closed on insufficient stock',()=>{
  const source=input();source.rows=[row,{...row,row_number:8,reference:'LEGACY-INV-8',date:'2026-01-02'}];source.evidence_by_row[8]={...evidence,payments:[]};source.rows[1].paid=0;
  source.products[0].stock_quantity=3;
  assert.throws(()=>buildHistoricalSalesImportPlan(source),/المخزون التاريخي غير كافٍ/);
});

test('Excel4.1d.3b.1 rejects duplicate native ids and invoice numbers before persistence',()=>{
  assert.throws(()=>buildHistoricalSalesImportPlan({...input(),existing_ids:['inv-hist-session-1-7']}),/معرف مبيعات تاريخي/);
  assert.throws(()=>buildHistoricalSalesImportPlan({...input(),existing_invoice_numbers:['LEGACY-INV-7']}),/رقم فاتورة تاريخية/);
});
