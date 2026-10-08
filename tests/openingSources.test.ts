import test from 'node:test';
import assert from 'node:assert/strict';
import BigNumber from 'bignumber.js';
import type { Document } from '../src/domain/store';
import { getDefaultChartOfAccounts } from '../src/services/accountingService';
import { costState } from '../src/domain/inventoryCost';
import { deriveOpeningSnapshot, openingActivityCollections, openingBatchEvidence, openingSettlementQuote, openingSettlementEvidence, openingLotReport, verifyOpeningSources, type OpeningSettlementInput, type OpeningTerms, type OpeningState } from '../src/domain/openingSources';
import type { OpeningInput } from '../src/domain/openingBalances';
const org='opening-sources',actor={operation_id:'operation',actor_id:'owner',created_at:'2026-10-07T00:00:00Z'};
function fixture() {
  const data:Record<string,Document[]>=Object.fromEntries(openingActivityCollections.map(name=>[name,[]]));
  Object.assign(data,{accounts:getDefaultChartOfAccounts(org),financial_accounts:[{id:'cash',org_id:org,name:'النقد',account_code:'1110',currency:'SDG',kind:'cash',status:'active'},{id:'usd',org_id:org,name:'دولار',account_code:'1120',currency:'USD',kind:'bank',status:'active'}],customers:[{id:'customer',org_id:org,status:'active',balance_sdg:0,balance_usd:0}],suppliers:[{id:'supplier',org_id:org,status:'active',payable_due_sdg:0,payable_due_usd:0}],products:[{id:'product',org_id:org,is_active:true,track_inventory:true,...costState(0,0,0,'2026-10-01')}]});
  const input:OpeningInput={batch_id:'start',date:'2026-10-01',reason:'إثبات بدء النشاط',currency_policy:'dual',cash:[{id:'cash',currency:'SDG',amount:1000,exchange_rate_used:2000}],receivables:[{id:'customer',currency:'USD',amount:3,exchange_rate_used:2000}],payables:[{id:'supplier',currency:'USD',amount:2,exchange_rate_used:2000}],inventory:[{id:'product',quantity:3,unit_cost:2,currency:'USD',exchange_rate_used:2000}],capital:{sdg:15000,usd:7.5}};
  const terms:OpeningTerms[]=[{kind:'receivable',source_id:'customer',due_date:'2026-09-15',reference:'مراجعة رصيد العميل القديم'},{kind:'payable',source_id:'supplier',due_date:'2026-10-15',reference:'رصيد مورد افتتاحي'}];
  return {data,input,terms};
}
function posted() {
  const f=fixture(),snapshot=deriveOpeningSnapshot(f.data,org,2),proof=openingBatchEvidence(f.input,snapshot,f.terms,actor);
  f.data.opening_batches=[proof.batch];f.data.opening_lots=proof.lots;f.data.journal_entries=[proof.journal];f.data.inventory_movements=proof.movements;
  // Current caches and quantities are not the frozen zero-balance eligibility snapshot.
  f.data.customers[0].balance_sdg=6000;f.data.customers[0].balance_usd=3;
  f.data.suppliers[0].payable_due_sdg=4000;f.data.products[0]={...f.data.products[0],...proof.movements[0].after};
  return {...f,proof};
}
function settle(f:ReturnType<typeof posted>,kind:'receivable'|'payable',amount:number,currency:'SDG'|'USD',rate:number,date='2026-10-02') {
  const lot=f.proof.lots.find(row=>row.kind===kind)!,state=verifyOpeningSources(f.data,org).states.get(lot.id)!,id=`s-${f.data.opening_settlements.length+1}`;
  const input:OpeningSettlementInput={id,date,financial_account_id:currency==='SDG'?'cash':'usd',currency,amount,exchange_rate_used:rate,reason:'تسوية موثقة',reference_number:id};
  const financial=f.data.financial_accounts.find(row=>row.id===input.financial_account_id)!;
  const evidence=openingSettlementEvidence(lot,state,input,financial,f.data.accounts as any,'dual',{...actor,operation_id:id});
  f.data.opening_settlements.push(evidence.event);f.data.journal_entries.push(evidence.journal);return evidence;
}
test('C2.2a eligibility derives real activity and rejects missing/foreign/duplicate collection evidence instead of trusting counters',()=>{
  const f=fixture(),before=structuredClone(f);f.data.counters=[{journal_count:0}];assert.equal(deriveOpeningSnapshot(f.data,org,2).financial_activity_count,0);
  for(const name of openingActivityCollections.filter(name=>name!=='inventory_movements')){const x=structuredClone(f);x.data[name].push({id:'actual',org_id:org});assert.equal(deriveOpeningSnapshot(x.data,org,2).financial_activity_count,1);assert.throws(()=>openingBatchEvidence(x.input,deriveOpeningSnapshot(x.data,org,2),x.terms,actor),/نشاط مالي/);}
  for(const mutate of [(d:Record<string,Document[]>)=>{delete d.payments;},(d:Record<string,Document[]>)=>d.financial_accounts.push({...d.financial_accounts[0],id:'foreign',org_id:'other'}),(d:Record<string,Document[]>)=>d.accounts.push({...d.accounts[0]})]){const x=structuredClone(before);mutate(x.data);assert.throws(()=>deriveOpeningSnapshot(x.data,org,2));}
  delete f.data.counters;assert.deepEqual(f,before);
});
test('C2.2a only source-proven zero initialization is neutral; any quantity/value/journal/unknown movement still blocks opening',()=>{
  const f=fixture();const seed={id:'seed',org_id:org,operation_id:'seed',created_at:actor.created_at,product_id:'product',type:'OPENING_BALANCE',reference_type:'manual',reference_id:'product',costing_version:2,quantity:0,previous_stock:0,resulting_stock:0,value_delta_sdg:0,value_delta_usd:0,journal_id:null};f.data.inventory_movements=[seed];assert.equal(deriveOpeningSnapshot(f.data,org,2).financial_activity_count,0);
  for(const update of [{quantity:1},{resulting_stock:1},{value_delta_sdg:1},{journal_id:'jv'},{type:'ADJUSTMENT'},{reference_id:'missing'},{costing_version:1}]){const x=structuredClone(f);Object.assign(x.data.inventory_movements[0],update);assert.equal(deriveOpeningSnapshot(x.data,org,2).financial_activity_count,1);}
  f.data.inventory_movements.push({...seed,id:'cost',type:'COST_ESTABLISHMENT'});assert.equal(deriveOpeningSnapshot(f.data,org,2).financial_activity_count,0);
  f.data.products[0].average_cost_sdg=1;assert.equal(deriveOpeningSnapshot(f.data,org,2).financial_activity_count,2);
});
test('C2.2a frozen opening evidence uses independent lots, explicit due dates and WAC source movements without invented invoices/revenue',()=>{
  const f=fixture();f.data.customers[0].notes='private internal note';f.data.customers[0].phone='0123456789';const before=structuredClone(f),q=openingBatchEvidence(f.input,deriveOpeningSnapshot(f.data,org,2),f.terms,actor);assert.deepEqual(f,before);assert.equal(q.lots.length,2);assert.equal(q.batch.snapshot.customers[0].notes,undefined);assert.equal(q.lots[1].due_date,'2026-09-15');assert.equal(q.journal.reference_type,'opening_batch');assert.equal(q.journal.is_balanced,true);assert.ok(q.journal.lines.every(row=>!['4100','5100','2130'].includes(row.account_code)));assert.equal(q.movements[0].after.average_cost_sdg,4000);assert.equal(q.movements[0].after.inventory_value_usd,6);
  assert.equal(verifyOpeningSources(posted().data,org).states.size,2);
});
test('C2.2a missing/duplicate/foreign party terms, timestamp dates, missing equity review and oversized frozen evidence fail before persistence',()=>{
  for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.terms.pop();},(f:ReturnType<typeof fixture>)=>{f.terms[1]={...f.terms[0]};},(f:ReturnType<typeof fixture>)=>{f.terms[0].source_id='unknown';},(f:ReturnType<typeof fixture>)=>{f.terms[0].due_date='2026-10-01T00:00:00Z';},(f:ReturnType<typeof fixture>)=>{f.terms[0].reference=' ';},(f:ReturnType<typeof fixture>)=>{f.input.capital.sdg=1;},(f:ReturnType<typeof fixture>)=>{f.data.accounts.find(row=>row.code==='1300')!.name_ar='x'.repeat(650000);}]){const f=fixture();mutate(f);assert.throws(()=>openingBatchEvidence(f.input,deriveOpeningSnapshot(f.data,org,2),f.terms,actor));}
});
test('C2.2a immutable original basis survives current master balance/status/stock changes but missing or remapped identities fail',()=>{
  const f=posted();f.data.customers[0].status='inactive';f.data.customers[0].balance_sdg=10;f.data.products[0].stock_quantity=1;f.data.financial_accounts[0].status='inactive';assert.equal(verifyOpeningSources(f.data,org).lots.length,2);
  for(const mutate of [(d:Record<string,Document[]>)=>{d.customers=[];},(d:Record<string,Document[]>)=>{d.financial_accounts[0].account_code='1130';},(d:Record<string,Document[]>)=>{d.products[0].track_inventory=false;},(d:Record<string,Document[]>)=>{d.opening_batches[0].snapshot.customers[0].balance_sdg=1;}]){const x=structuredClone(f.data);mutate(x);assert.throws(()=>verifyOpeningSources(x,org));}
});
test('C2.2a opening source verification refuses altered/missing/duplicate journals, lots, costs and orphan reserved references',()=>{
  const f=posted();for(const mutate of [(d:Record<string,Document[]>)=>{d.opening_lots.pop();},(d:Record<string,Document[]>)=>{d.opening_lots[0].sdg++;},(d:Record<string,Document[]>)=>{d.opening_lots[0].due_date='2026-11-01';},(d:Record<string,Document[]>)=>{d.inventory_movements[0].after.average_cost_usd=3;},(d:Record<string,Document[]>)=>{d.inventory_movements=[];},(d:Record<string,Document[]>)=>{d.journal_entries=[];},(d:Record<string,Document[]>)=>{d.journal_entries.push({...d.journal_entries[0],id:'extra'});},(d:Record<string,Document[]>)=>{d.journal_entries[0].total_credit_usd=1;},(d:Record<string,Document[]>)=>{d.journal_entries[0].lines[0].account_code='4100';},(d:Record<string,Document[]>)=>{d.opening_batches=[];},(d:Record<string,Document[]>)=>{d.opening_lots[0].org_id='other';},(d:Record<string,Document[]>)=>{d.journal_entries.push({...d.journal_entries[0],id:'orphan',reference_type:'opening_settlement',reference_id:'missing'});}]){const x=structuredClone(f.data);mutate(x);assert.throws(()=>verifyOpeningSources(x,org));}
});
test('C2.2a AR/AP partial and final settlements preserve historical carrying values while changed payment FX is separate and both books close exactly',()=>{
  const f=posted(),ar=settle(f,'receivable',1,'USD',2500),ap=settle(f,'payable',1,'USD',2500);
  assert.deepEqual(ar.event.quote.settled,{sdg:2000,usd:1});assert.deepEqual(ar.event.quote.gain,{sdg:500,usd:0});assert.ok(ar.journal.lines.some(row=>row.account_code==='4200'&&row.credit_sdg===500));
  assert.deepEqual(ap.event.quote.gain,{sdg:-500,usd:0});assert.ok(ap.journal.lines.some(row=>row.account_code==='5500'&&row.debit_sdg===500));
  settle(f,'receivable',2,'USD',1000,'2026-10-03');settle(f,'payable',1,'USD',1000,'2026-10-03');
  for(const state of verifyOpeningSources(f.data,org).states.values()){assert.equal(state.sdg,0);assert.equal(state.usd,0);assert.equal(state.sequence,2);}
  assert.equal(f.data.invoices.length,0);assert.equal(f.data.purchase_bills.length,0);
});
test('C2.2a historical allocations and payment FX remain balanced across 72 partial/final sequences',()=>{
  for(const kind of ['receivable','payable'] as const)for(const sourceRate of [1,2,2000,8260])for(const paymentRate of [1,2000,8260])for(const partial of [0.01,0.07,0.99]){
    const f=fixture();f.input.receivables=[];f.input.payables=[];f.input.inventory=[];f.input.cash=[];f.input[kind==='receivable'?'receivables':'payables']=[{id:kind==='receivable'?'customer':'supplier',currency:'USD',amount:1,exchange_rate_used:sourceRate}];f.input.capital={sdg:0,usd:0};f.input.equity_difference_reason='أساس افتتاحي مراجع';f.terms=f.terms.filter(row=>row.kind===kind);
    const proof=openingBatchEvidence(f.input,deriveOpeningSnapshot(f.data,org,2),f.terms,actor),lot=proof.lots[0];let state:OpeningState={sdg:lot.sdg,usd:lot.usd,sequence:0,last_date:lot.date};
    for(const [i,amount] of [partial,new BigNumber(1).minus(partial).toNumber()].entries()){const input={id:`s-${i}`,date:'2026-10-02',financial_account_id:'usd',currency:'USD' as const,amount,exchange_rate_used:paymentRate,reason:'صرف موثق',reference_number:''};const quote=openingSettlementQuote(lot,state,input,f.data.financial_accounts[1],f.data.accounts as any,'dual');for(const book of ['sdg','usd'] as const)assert.ok(quote.lines.reduce((n,l)=>n.plus(l[`debit_${book}`]).minus(l[`credit_${book}`]),new BigNumber(0)).isZero());state=quote.after;}assert.equal(state.sdg,0);assert.equal(state.usd,0);
  }
  const f=posted();const incoming=settle(f,'receivable',2500,'SDG',2500);assert.deepEqual(incoming.event.quote.settled,{sdg:2000,usd:1});assert.deepEqual(incoming.event.quote.after,{sdg:4000,usd:2,sequence:1,last_date:'2026-10-02'});
});
test('C2.2a settlement rejects overpay/underprecision/backdate/forged fields/inactive foreign cash and missing classified FX controls',()=>{
  const f=posted(),lot=f.proof.lots[1],state=verifyOpeningSources(f.data,org).states.get(lot.id)!,base:OpeningSettlementInput={id:'payment',date:'2026-10-02',financial_account_id:'usd',currency:'USD',amount:1,exchange_rate_used:2500,reason:'سداد',reference_number:''};
  for(const change of [{amount:4},{amount:0},{amount:0.001},{date:'2026-09-30'},{date:'2026-10-02T00:00:00Z'},{reason:' '},{exchange_rate_used:0},{financial_account_id:'other'},{settled_sdg:1}])assert.throws(()=>openingSettlementQuote(lot,state,{...base,...change},f.data.financial_accounts[1],f.data.accounts as any,'dual'));
  for(const update of [{org_id:'other'},{status:'inactive'},{currency:'SDG'}])assert.throws(()=>openingSettlementQuote(lot,state,base,{...f.data.financial_accounts[1],...update},f.data.accounts as any,'dual'));
  const accounts=structuredClone(f.data.accounts);accounts.find(row=>row.code==='4200')!.reporting_group='sales';assert.throws(()=>openingSettlementQuote(lot,state,base,f.data.financial_accounts[1],accounts as any,'dual'));
  assert.throws(()=>openingSettlementQuote(lot,{...state,sequence:200},base,f.data.financial_accounts[1],f.data.accounts as any,'dual'));
});
test('C2.2a SDG-only opening and settlement never invent USD or FX and reject foreign settlement',()=>{
  const f=fixture();f.input.currency_policy='sdg_only';f.input.cash=[];f.input.payables=[];f.input.inventory=[];f.input.receivables=[{id:'customer',currency:'SDG',amount:101}];f.input.capital={sdg:101,usd:0};f.terms=f.terms.filter(row=>row.kind==='receivable');
  const q=openingBatchEvidence(f.input,deriveOpeningSnapshot(f.data,org,2),f.terms,actor),lot=q.lots[0],state={sdg:101,usd:0,sequence:0,last_date:lot.date},input:OpeningSettlementInput={id:'sdg-pay',date:'2026-10-02',financial_account_id:'cash',currency:'SDG',amount:1,reason:'تحصيل',reference_number:''};
  const result=openingSettlementQuote(lot,state,input,f.data.financial_accounts[0],f.data.accounts as any,'sdg_only');assert.equal(result.total_credit_usd,0);assert.deepEqual(result.gain,{sdg:0,usd:0});assert.equal(result.lines.length,2);assert.throws(()=>openingSettlementQuote(lot,state,{...input,exchange_rate_used:2},f.data.financial_accounts[0],f.data.accounts as any,'sdg_only'));assert.throws(()=>openingSettlementQuote(lot,state,{...input,currency:'USD',financial_account_id:'usd'},f.data.financial_accounts[1],f.data.accounts as any,'sdg_only'));
});
test('C2.2a replay refuses altered/dropped/duplicate/out-of-order settlements and missing cash/journal proof including future events',()=>{
  const f=posted();settle(f,'receivable',1,'USD',2500);settle(f,'receivable',1,'USD',1500,'2026-10-03');
  for(const mutate of [(d:Record<string,Document[]>)=>{d.opening_settlements[0].quote.settled.sdg=1;},(d:Record<string,Document[]>)=>{d.opening_settlements[1].before.usd=1;},(d:Record<string,Document[]>)=>{d.opening_settlements[1].sequence=1;},(d:Record<string,Document[]>)=>{d.opening_settlements.shift();},(d:Record<string,Document[]>)=>{d.opening_settlements[1].lot_id='missing';},(d:Record<string,Document[]>)=>{d.journal_entries.pop();},(d:Record<string,Document[]>)=>{d.opening_settlements[1].account_basis.find((row:Document)=>row.code==='5500')!.nature='CREDIT';},(d:Record<string,Document[]>)=>{d.financial_accounts.pop();}]){const data=structuredClone(f.data);mutate(data);assert.throws(()=>openingLotReport(data,org,{end:'2026-10-01'}));}
  f.data.opening_settlements.reverse();assert.equal(verifyOpeningSources(f.data,org).states.get(f.proof.lots[1].id)!.sequence,2);
});
test('C2.2a dated opening/settlement statements and aging reconcile native carrying totals, ignore mutable caches and survive ordered JSON restore',()=>{
  const f=posted();settle(f,'receivable',1,'USD',2500);settle(f,'payable',1,'USD',2500);settle(f,'receivable',2,'USD',1000,'2026-10-05');f.data.customers[0].balance_sdg=999;
  const before=openingLotReport(f.data,org,{end:'2026-09-30'});assert.equal(before.lots.length,0);
  const original=openingLotReport(f.data,org,{end:'2026-10-01'});assert.deepEqual(original.totals,{receivable:{sdg:6000,usd:3},payable:{sdg:4000,usd:2}});assert.equal(original.lots.find(row=>row.kind==='receivable')!.aging_bucket,'1_30');assert.equal(original.lots.find(row=>row.kind==='payable')!.aging_bucket,'current');
  const range=openingLotReport(f.data,org,{start:'2026-10-02',end:'2026-10-03'}),ar=range.lots.find(row=>row.kind==='receivable')!;assert.deepEqual(ar.opening,{sdg:6000,usd:3});assert.deepEqual(ar.movement,{sdg:-2000,usd:-1});assert.deepEqual(ar.remaining,{sdg:4000,usd:2});assert.equal(ar.transactions.length,1);assert.equal(ar.transactions[0].reference_type,'opening_settlement');
  for(const kind of ['receivable','payable'] as const)for(const book of ['sdg','usd'] as const){const code=kind==='receivable'?'1200':'2110',sign=kind==='receivable'?1:-1,gl=f.data.journal_entries.filter(row=>row.date<='2026-10-03').flatMap(row=>row.lines).filter(row=>row.account_code===code).reduce((n,row)=>n.plus(new BigNumber(row[`debit_${book}`]).minus(row[`credit_${book}`]).times(sign)),new BigNumber(0));assert.ok(gl.eq(range.totals[kind][book]));}
  const clone=JSON.parse(JSON.stringify(f.data,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));assert.deepEqual(openingLotReport(clone,org,{start:'2026-10-02',end:'2026-10-03'}),range);assert.throws(()=>openingLotReport(f.data,org,{start:'2026-10-02',end:'2026-10-01'}));
});
