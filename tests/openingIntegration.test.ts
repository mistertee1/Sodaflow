import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, type Document } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { journal, journalLine } from '../src/domain/financial';
import { openingBackupCounts, openingBalancesForParty, validateOpeningBackup, remapOpeningCollections } from '../src/domain/openingIntegration';
import { receivableReports } from '../src/domain/operationalReports';
import { payableReports } from '../src/domain/payables';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { verifyOpeningSources } from '../src/domain/openingSources';
import { operationalCsv } from '../src/services/operationalExport';

import { openingBooksFixture as fixture, settleOpeningBooks as settle } from './fixtures/openingBooks';
const source='source-opening',owner:Actor={uid:'opening-owner',email:'owner@example.com',emailVerified:true};
const iso='2026-10-01T12:00:00Z';
const ar=(d:Record<string,Document[]>,start?:string,end='2026-10-20')=>receivableReports(d.customers,d.invoices,d.payments,d.journal_entries as any,{start,end},end,{notes:d.credit_notes,refunds:d.customer_refunds,opening:d});
const ap=(d:Record<string,Document[]>,start?:string,end='2026-10-20')=>payableReports(d.suppliers,d.purchase_bills,d.supplier_payments,d.journal_entries,{start,end},end,d);
async function service(data=fixture()) {
  const seed:Record<string,Document>={[`organizations/${source}`]:{id:source,name:'مصدر',owner_uid:owner.uid,status:'active',accounting_version:2,planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01',settings:INITIAL_SETTINGS}};
  for(const [name,rows] of Object.entries(data))for(const row of rows)seed[`organizations/${source}/${name}/${name==='accounts'?row.code:row.id}`]=row;
  const store=new MemoryStore(seed),ops=new Operations(store,()=>new Date('2026-10-20T12:00:00Z'));
  const run=(action:string,body:Document)=>ops.execute(source,owner,{action,data:body,operationId:crypto.randomUUID()});return {store,ops,run};
}
test('C2 integration allocates multi-party source lines, historical carrying values and dated AR/AP to exact GL totals',()=>{
  const data=fixture();settle(data,'a',1);settle(data,'s',1);settle(data,'a',1,'2026-10-03',1000);
  assert.deepEqual(reconcileFinancialData(data as FinancialData,INITIAL_SETTINGS,{requireCosting:true}),[]);
  assert.equal(ar(data,undefined,'2026-09-30').aging.length,0);assert.equal(ap(data,undefined,'2026-09-30').aging.length,0);
  const r=ar(data,'2026-10-02','2026-10-03'),p=ap(data,'2026-10-02','2026-10-03');
  for(const report of [r,p])for(const book of ['sdg','usd']){assert.equal(report[`total_${book}` as 'total_sdg'],report[`ledger_${book}` as 'ledger_sdg']);assert.equal(report[`unallocated_${book}` as 'unallocated_sdg'],0);}
  assert.equal(r.statements.find(row=>row.customer_id==='a')!.opening_sdg,6000);assert.equal(r.statements.find(row=>row.customer_id==='a')!.closing_sdg,2000);assert.equal(r.statements.find(row=>row.customer_id==='b')!.closing_sdg,6000);assert.equal(p.statements.find(row=>row.supplier_id==='s')!.closing_sdg,2000);assert.equal(p.statements.find(row=>row.supplier_id==='t')!.closing_sdg,1000);
  assert.ok(r.aging.every(row=>row.source_type==='opening_lot' && row.invoice_id==='' && row.invoice_number==='' && row.opening_lot_id));assert.equal(new Set(p.aging.map(row=>row.source_key)).size,2);assert.ok(p.aging.every(row=>row.bill_id===''));
  const csv=operationalCsv({...r,view:'receivables',organizationId:source,generatedAt:iso},'a');assert.ok(csv.includes('opening_lot:'));assert.ok(csv.includes('opening_settlement:'));assert.ok(csv.includes('AR-A'));
});
test('C2 integration leaves unrelated manual controls explicit and rejects future tampering even in past reports',()=>{
  const data=fixture();settle(data,'a',1);const manual=journal('manual',source,owner.uid,'2026-10-04','manual','manual','مراجعة',[journalLine('1200','ذمم',100,0,.05,0),journalLine('3100','رأس مال',0,100,0,.05)]);data.journal_entries.push(manual);
  assert.equal(ar(data).unallocated_sdg,100);assert.equal(ar(data).unallocated_usd,.05);
  for(const mutate of [(d:Record<string,Document[]>)=>d.opening_lots.pop(),(d:Record<string,Document[]>)=>{d.opening_settlements[0].quote.after.sdg=0;},(d:Record<string,Document[]>)=>{d.opening_batches=[];},(d:Record<string,Document[]>)=>{d.suppliers[0].org_id='foreign';}]){const bad=structuredClone(data);mutate(bad);assert.throws(()=>ar(bad,undefined,'2026-10-01'));assert.throws(()=>ap(bad,undefined,'2026-10-01'));assert.ok(reconcileFinancialData(bad as FinancialData,INITIAL_SETTINGS).length>0);}
});
test('C2 integration preserves opening AR/AP during ordinary invoice/purchase creation, receipt and corrections',async()=>{
  const f=await service();const inv=(await f.run('invoice.create',{customer_id:'a',issue_date:'2026-10-10',currency_mode:'single_usd',exchange_rate_used:2000,discount_type:'fixed',discount_value:0,items:[{product_id:'p',description:'صنف',unit:'قطعة',quantity:1,unit_price:5,currency:'USD',tax_rate:0,discount_percent:0}]})).result;
  await f.run('payment.create',{invoice_id:inv.id,amount:1,currency:'USD',exchange_rate_used:2500,payment_method:'cash'});
  await f.run('purchase.create',{supplier_id:'s',issue_date:'2026-10-12',due_date:'2026-11-01',currency:'USD',exchange_rate_used:2000,settlement:'credit',supplier_reference:'NEW-P',items:[{product_id:'p',quantity:1,unit_cost:3}],reason:'شراء بعد الافتتاح'});
  const s=await f.ops.snapshot(source,owner,true);assert.deepEqual(reconcileFinancialData(s.collections as FinancialData,s.settings,{requireCosting:true}),[]);
  const customer=s.collections.customers.find(row=>row.id==='a')!,supplier=s.collections.suppliers.find(row=>row.id==='s')!;
  assert.equal(customer.balance_sdg,14000);assert.equal(customer.balance_usd,7);assert.equal(supplier.payable_due_sdg,10000);assert.equal(supplier.payable_due_usd,5);
  const r=await f.ops.operationalReport(source,owner,'receivables',{});assert.equal(r.unallocated_sdg,0);const p=await f.ops.payableReports(source,owner,{});assert.equal(p.unallocated_usd,0);
});
test('C2 opening backup requires complete declared counts, source replay and original tenant before any remap',()=>{
  const data=fixture();settle(data,'a',1);const backup={schema_version:3,opening_schema_version:1,org:{id:source,accounting_version:2},counters:openingBackupCounts(data),collections:data};const before=structuredClone(backup);assert.deepEqual(validateOpeningBackup(backup).opening_lots,data.opening_lots);assert.deepEqual(backup,before);
  for(const mutate of [(b:Document)=>delete b.collections.opening_lots,(b:Document)=>{b.collections.opening_settlements=[];},(b:Document)=>{b.counters.opening_lot_count=0;},(b:Document)=>delete b.opening_schema_version,(b:Document)=>{b.collections.opening_batches[0].snapshot.customers[0].org_id='foreign';},(b:Document)=>{b.org.id='foreign';}]){const bad=structuredClone(backup);mutate(bad);assert.throws(()=>validateOpeningBackup(bad));}
  const mapped:Record<string,Document[]>={...Object.fromEntries(Object.entries(data).map(([key,rows])=>[key,rows.map(row=>({...row,org_id:'destination'}))])),...remapOpeningCollections(data,'destination')};assert.equal(verifyOpeningSources(mapped,'destination').states.size,4);assert.deepEqual(reconcileFinancialData(mapped as FinancialData,INITIAL_SETTINGS,{requireCosting:true}),[]);assert.equal(mapped.opening_settlements[0].created_by,owner.uid);assert.equal(mapped.opening_batches[0].snapshot.customers[0].org_id,'destination');assert.deepEqual(backup,before);
});
test('C2 protected backup/restore twice preserves nested tenant proof, both books, ownership and original actor',async()=>{
  const data=fixture();settle(data,'a',1);settle(data,'s',1);const f=await service(data);const original=await f.ops.snapshot(source,owner,true);assert.equal(original.opening_schema_version,1);assert.equal((original.counters as Document).opening_lot_count,4);
  let backup=original;
  for(const uid of ['restore-one','restore-two']){
    const target={...owner,uid},org=await new Organizations(f.store).create(target,'استعادة افتتاح',INITIAL_SETTINGS,crypto.randomUUID(),true),root=`organizations/${org.id}`;
    await f.store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'}));
    const before=f.store.dump(),bad=structuredClone(backup);bad.collections.opening_settlements=[];await assert.rejects(f.ops.execute(org.id,target,{action:'backup.restore',operationId:crypto.randomUUID(),data:{backup:bad}}));assert.deepEqual(f.store.dump(),before);
    await f.ops.execute(org.id,target,{action:'backup.restore',operationId:crypto.randomUUID(),data:{backup}});backup=await f.ops.snapshot(org.id,target,true);assert.deepEqual(reconcileFinancialData(backup.collections as FinancialData,backup.settings,{requireCosting:true}),[]);assert.equal(backup.org.owner_uid,uid);assert.equal(backup.collections.opening_batches[0].created_by,owner.uid);assert.equal(backup.collections.opening_batches[0].snapshot.org_id,org.id);assert.equal(backup.collections.opening_settlements[0].financial_basis.org_id,org.id);
    const r=await f.ops.operationalReport(org.id,target,'receivables',{}),p=await f.ops.payableReports(org.id,target,{});for(const report of [r,p]){assert.equal(report.unallocated_sdg,0);assert.equal(report.unallocated_usd,0);}
    assert.equal(r.total_sdg,10000);assert.equal(p.total_usd,2);
  }
});
test('C2 integration rejects cache differences and deletion of a fully settled opening customer',async()=>{
  const data=fixture();settle(data,'a',3);const f=await service(data),before=f.store.dump();await assert.rejects(f.run('customer.delete',{id:'a'}),/افتتاحي/);assert.deepEqual(f.store.dump(),before);
  data.customers.find(row=>row.id==='b')!.balance_sdg=0;assert.ok(reconcileFinancialData(data as FinancialData,INITIAL_SETTINGS).some(row=>row.collection==='customers' && row.id==='b' && row.field==='balance_sdg'));
});
test('C2 invoice price credits and WAC purchase returns change only their sources while preserving separate opening AR/AP',async()=>{
  const f=await service(),invoice=(await f.run('invoice.create',{customer_id:'a',issue_date:'2026-10-10',currency_mode:'single_usd',exchange_rate_used:2000,discount_type:'fixed',discount_value:0,items:[{product_id:'p',description:'صنف',unit:'قطعة',quantity:1,unit_price:5,currency:'USD',tax_rate:0,discount_percent:0}]})).result;
  await f.run('creditNote.create',{invoice_id:invoice.id,date:'2026-10-11',reason:'خصم بعد الافتتاح',kind:'price_credit',lines:[{line_id:'line-1',amount:2}]});
  const bill=(await f.run('purchase.create',{supplier_id:'s',issue_date:'2026-10-12',due_date:'2026-11-01',currency:'USD',exchange_rate_used:2000,settlement:'credit',supplier_reference:'RETURN-P',items:[{product_id:'p',quantity:1,unit_cost:3}],reason:'شراء موثق'})).result;
  await f.run('purchaseReturn.create',{bill_id:bill.id,date:'2026-10-13',reason:'مردود موثق',lines:[{line_id:'line-1',quantity:1}]});
  const s=await f.ops.snapshot(source,owner,true);assert.deepEqual(reconcileFinancialData(s.collections as FinancialData,s.settings,{requireCosting:true}),[]);assert.equal(s.collections.customers.find(row=>row.id==='a')!.receivable_due_usd,6);assert.equal(s.collections.suppliers.find(row=>row.id==='s')!.payable_due_usd,2);assert.equal(s.collections.products[0].inventory_value_sdg,37800);assert.equal(s.collections.products[0].inventory_value_usd,18.9);
  assert.equal((await f.ops.operationalReport(source,owner,'receivables',{})).unallocated_usd,0);assert.equal((await f.ops.payableReports(source,owner,{})).unallocated_sdg,0);
});
test('C2 opening integration keeps source-free legacy backups compatible but never hides orphan opening journals',()=>{
  const empty={collections:{journal_entries:[],inventory_movements:[]}};assert.deepEqual(validateOpeningBackup(empty),{opening_batches:[],opening_lots:[],opening_settlements:[]});assert.deepEqual(openingBalancesForParty(empty.collections,'receivable','old'),{sdg:0,usd:0});
  const bad={collections:{journal_entries:[{id:'jv',org_id:source,reference_type:'opening_batch',reference_id:'gone'}],inventory_movements:[]}};assert.throws(()=>validateOpeningBackup(bad));assert.throws(()=>ar({...fixture(),opening_batches:[],opening_lots:[],opening_settlements:[]}));
});
