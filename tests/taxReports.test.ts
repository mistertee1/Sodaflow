import test from 'node:test';
import assert from 'node:assert/strict';
import {taxPeriodReport} from '../src/domain/taxReports';
import type {TaxConfiguration} from '../src/domain/taxConfiguration';
import type {JournalEntry} from '../src/types';

const configuration=(id:string,direction:'sales'|'purchases',account:string,jurisdiction:string):TaxConfiguration=>({schema_version:1,id,org_id:'org',revision:1,name:id,jurisdiction,direction,rate:15,calculation:'exclusive',rounding:'half_up',recoverable:direction==='purchases',tax_account_code:account,effective_from:'2026-01-01',effective_to:null,active:true});
const entry=(id:string,date:string,lines:Partial<JournalEntry['lines'][number]>[]):JournalEntry=>({id,org_id:'org',date,description:id,reference_type:'invoice',reference_id:id,created_by:'owner',created_at:`${date}T00:00:00.000Z`,exchange_rate_used:0,lines:lines.map((line,index)=>({id:`${id}-${index}`,account_code:line.account_code!,description:id,debit_sdg:line.debit_sdg||0,credit_sdg:line.credit_sdg||0,debit_usd:line.debit_usd||0,credit_usd:line.credit_usd||0}))} as JournalEntry);

test('C5.3.2 reports opening, period movement and closing by tax control account without duplicating shared policies',()=>{
  const report=taxPeriodReport([configuration('sales-a','sales','2130','A'),configuration('sales-b','sales','2130','B'),configuration('purchase','purchases','1140','A')],[
    entry('opening','2026-09-30',[{account_code:'2130',credit_sdg:100},{account_code:'1140',debit_sdg:20}]),entry('sale','2026-10-05',[{account_code:'2130',credit_sdg:30,credit_usd:2}]),entry('credit','2026-10-06',[{account_code:'2130',debit_sdg:10,debit_usd:0.5}]),entry('purchase','2026-10-07',[{account_code:'1140',debit_sdg:15,debit_usd:1}]),entry('future','2026-11-01',[{account_code:'2130',credit_sdg:999}])
  ],{start:'2026-10-01',end:'2026-10-31'});
  assert.equal(report.controls.length,2);assert.equal(report.journal_entry_count,3);const sales=report.controls.find(row=>row.direction==='sales')!;
  assert.deepEqual(sales.configuration_ids,['sales-a','sales-b']);assert.deepEqual(sales.jurisdictions,['A','B']);assert.deepEqual(sales.opening,{sdg:100,usd:0});assert.deepEqual(sales.movement,{sdg:20,usd:1.5});assert.deepEqual(sales.closing,{sdg:120,usd:1.5});assert.deepEqual(report.purchase_tax,{sdg:15,usd:1});assert.deepEqual(report.net_tax_payable,{sdg:85,usd:0.5});
});

test('C5.3.2 rejects invalid periods and ignores non-control postings',()=>{
  assert.throws(()=>taxPeriodReport([],[],{start:'2026-10-02',end:'2026-10-01'}),/بداية/);const report=taxPeriodReport([configuration('sales','sales','2130','A')],[entry('cash','2026-10-01',[{account_code:'1110',debit_sdg:50}])],{});assert.deepEqual(report.sales_tax,{sdg:0,usd:0});assert.equal(report.journal_entry_count,0);
});
