import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerEquityQuote, type OwnerEquityInput, type OwnerEquitySnapshot } from '../src/domain/ownerEquity';
import { getDefaultChartOfAccounts } from '../src/services/accountingService';
import { journal, journalLine } from '../src/domain/financial';
import { MemoryStore } from '../src/domain/store';
const org='equity-fixture';
function fixture(currency:'SDG'|'USD'='SDG') {
  const code=currency==='SDG'?'1110':'1120';
  const input:OwnerEquityInput={kind:'contribution',date:'2026-10-05',financial_account_id:'cash',amount:currency==='SDG'?200:0.2,currency_policy:'dual',exchange_rate_used:2000,reason:'تمويل المالك',reference_number:'CAP-1'};
  const snapshot:OwnerEquitySnapshot={org_id:org,accounts:getDefaultChartOfAccounts(org),financial_accounts:[{id:'cash',org_id:org,account_code:code,currency,kind:'cash',status:'active',name:'نقد'}],journal_entries:[journal('opening',org,'owner','2026-10-01','manual','proof','تمويل سابق',[journalLine(code,'نقد',1000,0,1,0),journalLine('3100','رأس المال',0,1000,0,1)])],accounting_periods:[{id:'october',org_id:org,schema_version:1,start_date:'2026-10-01',end_date:'2026-10-31',status:'OPEN',revision:1,created_by:'owner',created_at:'2026-10-01',operation_id:'period'}],settings:{}};
  return {input,snapshot};
}
test('C2.3 contribution derives balanced cash/capital lines at explicit rate without income or source mutation',()=>{
  for(const currency of ['SDG','USD'] as const){const f=fixture(currency),before=structuredClone(f),q=ownerEquityQuote(f.input,f.snapshot);assert.deepEqual(f,before);assert.equal(q.amount_sdg,currency==='SDG'?200:400);assert.equal(q.amount_usd,currency==='SDG'?.1:.2);assert.equal(q.is_balanced,true);assert.equal(q.lines[0].debit_sdg,q.amount_sdg);assert.equal(q.lines[1].account_code,'3100');assert.equal(q.lines[1].credit_usd,q.amount_usd);assert.equal(q.source_balance,null);}
});
test('C2.3 drawing retains historic carrying basis and final remainder without expense or new FX',()=>{
  for(const currency of ['SDG','USD'] as const){const f=fixture(currency);f.input.kind='drawing';delete f.input.exchange_rate_used;const q=ownerEquityQuote(f.input,f.snapshot);assert.equal(q.amount_sdg,200);assert.equal(q.amount_usd,.2);assert.equal(q.exchange_rate_used,0);assert.equal(q.lines[0].account_code,'3200');assert.equal(q.lines[0].debit_sdg,200);assert.equal(q.lines[1].credit_usd,.2);assert.deepEqual(q.source_balance,{SDG:1000,USD:1});}
  const f=fixture('USD');f.input.kind='drawing';f.input.amount=.01;delete f.input.exchange_rate_used;f.snapshot.journal_entries[0]=journal('tiny',org,'owner','2026-10-01','manual','tiny','تمويل',[journalLine('1120','نقد',1,0,.03,0),journalLine('3100','رأس المال',0,1,0,.03)]);
  const allocations=[];for(let n=0;n<3;n++){const q=ownerEquityQuote(f.input,f.snapshot);allocations.push(q.amount_sdg);f.snapshot.journal_entries.push(journal(`draw-${n}`,org,'owner',f.input.date,'manual',`draw-${n}`,'سحب',q.lines));}assert.deepEqual(allocations,[0,1,0]);assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/غير كاف/);
});
test('C2.3 SDG-only is explicit and cannot discard an existing secondary cash basis',()=>{
  const f=fixture();f.input.currency_policy='sdg_only';delete f.input.exchange_rate_used;assert.equal(ownerEquityQuote(f.input,f.snapshot).amount_usd,0);
  f.input.kind='drawing';assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/إسقاط/);f.snapshot.journal_entries[0].lines.forEach(l=>{l.debit_usd=0;l.credit_usd=0;});assert.equal(ownerEquityQuote(f.input,f.snapshot).amount_usd,0);
  f.input.exchange_rate_used=2000;assert.throws(()=>ownerEquityQuote(f.input,f.snapshot));const usd=fixture('USD');usd.input.currency_policy='sdg_only';assert.throws(()=>ownerEquityQuote(usd.input,usd.snapshot));
});
test('C2.3 rejects malformed amounts/rates and forged derived fields before producing a quote',()=>{
  for(const amount of [0,-1,NaN,Infinity,1.5,1e14+1]){const f=fixture();f.input.amount=amount;assert.throws(()=>ownerEquityQuote(f.input,f.snapshot));}
  for(const rate of [undefined,0,-1,Infinity,NaN,0.000000001]){const f=fixture();f.input.exchange_rate_used=rate;assert.throws(()=>ownerEquityQuote(f.input,f.snapshot));}
  for(const patch of [{kind:'expense'},{currency_policy:'auto'},{date:'2026-02-30'},{date:'2026-10-05T00:00:00Z'},{reason:' '},{amount_sdg:999},{source_balance:{SDG:999}},{account_code:'5500'},{financial_account_id:'../foreign'}]){const f=fixture();Object.assign(f.input,patch);assert.throws(()=>ownerEquityQuote(f.input,f.snapshot));}
  const f=fixture('USD');f.input.amount=1e14;f.input.exchange_rate_used=2;assert.throws(()=>ownerEquityQuote(f.input,f.snapshot));
});
test('C2.3 rejects foreign, ambiguous, inactive, misclassified sources and corrupt journals',()=>{
  const mutations:((s:OwnerEquitySnapshot)=>void)[]=[s=>{s.financial_accounts[0].org_id='foreign';},s=>{s.financial_accounts[0].status='inactive';},s=>{s.financial_accounts.push({...s.financial_accounts[0],id:'another'});},s=>{s.accounts.find(a=>a.code==='1110')!.is_active=false;},s=>{s.accounts.find(a=>a.code==='3100')!.type='REVENUE';},s=>{s.accounts.find(a=>a.code==='3100')!.nature='DEBIT';},s=>{s.accounts.push({...s.accounts[0]});},s=>{s.accounts[0].org_id='foreign';},s=>{s.journal_entries[0].org_id='foreign';},s=>{s.journal_entries.push({...s.journal_entries[0]});},s=>{s.journal_entries[0].lines[0].debit_sdg++;},s=>{s.journal_entries[0].lines[0].account_code='missing';}];
  for(const mutate of mutations){const f=fixture();mutate(f.snapshot);const before=structuredClone(f);assert.throws(()=>ownerEquityQuote(f.input,f.snapshot));assert.deepEqual(f,before);}
  const f=fixture();f.input.kind='drawing';delete f.input.exchange_rate_used;f.snapshot.accounts.find(a=>a.code==='3200')!.type='EXPENSE';assert.throws(()=>ownerEquityQuote(f.input,f.snapshot));
});
test('C2.3 drawings check both books at each later daily close, independent of journal input order',()=>{
  const f=fixture();f.input.kind='drawing';delete f.input.exchange_rate_used;
  // Native SDG would remain positive, but this later USD debit consumes the secondary book.
  f.snapshot.journal_entries.push(journal('later',org,'owner','2026-10-07','manual','later','مصروف',[journalLine('5500','مصروف',0,0,.9,0),journalLine('1110','نقد',0,0,0,.9)]));assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/يوم لاحق/);
  f.snapshot.journal_entries.push(journal('replenish',org,'owner','2026-10-08','manual','funds','تمويل',[journalLine('1110','نقد',1000,0,1,0),journalLine('3100','رأس المال',0,1000,0,1)]));assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/يوم لاحق/);
  f.snapshot.journal_entries.reverse();assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/يوم لاحق/);
  f.input.amount=100;assert.equal(ownerEquityQuote(f.input,f.snapshot).amount_usd,.1);
  f.input.amount=1001;assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/غير كاف/);
});
test('C2.3 legacy lock, outside period, soft close and foreign periods block ordinary owner operations',()=>{
  const f=fixture();f.snapshot.settings.period_lock_date=f.input.date;assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/مقفلة/);delete f.snapshot.settings.period_lock_date;
  f.input.date='2026-09-30';assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/خارج/);f.input.date='2026-10-05';Object.assign(f.snapshot.accounting_periods[0],{status:'SOFT_CLOSED',changed_by:'owner',changed_at:'2026-10-05',reason:'إغلاق'});assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/مبدئياً/);f.snapshot.accounting_periods[0].org_id='foreign';assert.throws(()=>ownerEquityQuote(f.input,f.snapshot),/أخرى/);
});
test('C2.3 pure quote leaves the synthetic MemoryStore unchanged and deterministic under reordering',async()=>{
  const f=fixture(),store=new MemoryStore();await store.transaction(async tx=>{for(const a of f.snapshot.accounts)tx.set(`organizations/${org}/accounts/${a.code}`,a);for(const j of f.snapshot.journal_entries)tx.set(`organizations/${org}/journal_entries/${j.id}`,j);});const before=store.dump();const first=ownerEquityQuote(f.input,f.snapshot);f.snapshot.accounts.reverse();assert.deepEqual(ownerEquityQuote(f.input,f.snapshot),first);assert.deepEqual(store.dump(),before);
});
