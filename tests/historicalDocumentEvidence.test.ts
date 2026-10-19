import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHistoricalDocumentEvidence } from '../src/domain/historicalDocumentEvidence';
import type { HistoricalImportRow } from '../src/domain/historicalImport';

const context={customers:['customer-1'],suppliers:['supplier-1'],products:['product-1'],accounts:['1200','2110','1110','1120','2130']};
const invoice:HistoricalImportRow={row_number:1,kind:'invoice',reference:'INV-H-1',date:'2026-01-01',currency:'SDG',branch_id:'main',account_code:'4100',counterparty_code:'customer-1',total:115,paid:50,debit:115,credit:115};
const invoiceEvidence={party_id:'customer-1',due_date:'2026-01-31',exchange_rate_used:0,control_account_code:'1200',tax_account_code:'2130',tax_configuration_version_hash:'a'.repeat(64),lines:[{product_id:'product-1',description:'بضاعة تاريخية',quantity:2,net:100,tax:15,cogs:60}],payments:[{date:'2026-01-10',amount:50,account_code:'1110',exchange_rate_used:0,reference:'RCPT-1'}]};

test('Excel4.1d.1 accepts complete native invoice evidence and derives AR/COGS totals',()=>{
  assert.deepEqual(validateHistoricalDocumentEvidence(invoice,invoiceEvidence,context),{kind:'invoice',party_id:'customer-1',issue_date:'2026-01-01',due_date:'2026-01-31',currency:'SDG',exchange_rate_used:0,control_account_code:'1200',net:100,tax:15,total:115,paid:50,remaining:65,cogs:60,inventory_value:0,payment_count:1});
});

test('Excel4.1d.1 accepts complete purchase inventory and payment evidence',()=>{
  const row:HistoricalImportRow={row_number:2,kind:'purchase',reference:'PUR-H-1',date:'2026-01-02',currency:'USD',branch_id:'main',account_code:'1300',counterparty_code:'supplier-1',total:25,paid:10,debit:25,credit:25};
  const result=validateHistoricalDocumentEvidence(row,{party_id:'supplier-1',due_date:'2026-02-01',exchange_rate_used:2500,control_account_code:'2110',lines:[{product_id:'product-1',description:'مخزون قديم',quantity:5,net:25,tax:0,inventory_value:25}],payments:[{date:'2026-01-20',amount:10,account_code:'1120',exchange_rate_used:2520,reference:'PAY-1'}]},context);
  assert.equal(result.inventory_value,25);assert.equal(result.remaining,15);assert.equal(result.payment_count,1);
});

test('Excel4.1d.1 fails closed for missing COGS, tax version, party, payment or inventory proof',()=>{
  const attempts=[
    {...invoiceEvidence,lines:[{...invoiceEvidence.lines[0],cogs:0}]},
    {...invoiceEvidence,tax_configuration_version_hash:undefined},
    {...invoiceEvidence,party_id:'foreign'},
    {...invoiceEvidence,payments:[{...invoiceEvidence.payments[0],amount:49}]},
  ];
  for(const evidence of attempts)assert.throws(()=>validateHistoricalDocumentEvidence(invoice,evidence as any,context));
  const purchase:HistoricalImportRow={...invoice,row_number:3,kind:'purchase',counterparty_code:'supplier-1',total:20,paid:0,debit:20,credit:20};
  assert.throws(()=>validateHistoricalDocumentEvidence(purchase,{party_id:'supplier-1',due_date:'2026-01-31',exchange_rate_used:0,control_account_code:'2110',lines:[{product_id:'product-1',description:'مخزون',quantity:1,net:20,tax:0,inventory_value:19}]},context),/قيمة المخزون/);
});
