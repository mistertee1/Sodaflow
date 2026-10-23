import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {displayAmount,displayQuote,formatDisplayMoney,formatDisplayPair,appendDisplayColumns} from '../src/lib/displayCurrency';
import {formatMoney} from '../src/lib/currency';
import {CURRENCIES,currencyDecimals} from '../src/lib/currencyCatalog';
import {validateSettings} from '../src/domain/validation';
import {INITIAL_SETTINGS} from '../src/data/initialData';
import {MemoryStore} from '../src/domain/store';
import {Operations} from '../src/domain/operations';
import {createApi} from '../server/api';
import {buildInvoiceHtml,buildInvoiceWhatsAppMessage} from '../src/services/pdfService';
import {operationalCsv} from '../src/services/operationalExport';
import {payablesCsv} from '../src/services/payablesExport';
import {reconcileFinancialData,type FinancialData} from '../src/domain/reconciliation';
import {displayFixture,syntheticCurrencyRates} from './helpers/displayCurrency';
import type {Currency,MerchantSettings} from '../src/types';
const settings=(currency:Currency='KWD',units=.3):MerchantSettings=>({...INITIAL_SETTINGS,default_exchange_rate:2000,currency_rates:syntheticCurrencyRates,display_currency:{currency,units_per_usd:units,sdg_per_usd:2000}});

test('display stays in original units until an explicit valid per-company quote exists',()=>{
  assert.equal(displayQuote(INITIAL_SETTINGS),undefined);assert.equal(formatDisplayMoney(1234,'SDG',INITIAL_SETTINGS),formatMoney(1234,'SDG',INITIAL_SETTINGS));
  assert.equal(formatDisplayPair(2000,1,INITIAL_SETTINGS),'2,000 SDG / 1.00 USD');
});
test('all supported display currencies use the manually supplied quote and their own minor units',()=>{
  for(const row of CURRENCIES){const rate=row.code==='USD'?1:row.code==='SDG'?2000:syntheticCurrencyRates[row.code];const s=settings(row.code,rate);assert.equal(displayAmount(2,'USD',s),rate*2);assert.equal(formatDisplayMoney(2,'USD',s),formatMoney(rate*2,row.code,s));assert.equal(Number((rate*2).toFixed(currencyDecimals(row.code))),rate*2);}
});
test('presentation converts signed values once, supports milliunits and respects configured rounding',()=>{
  assert.equal(formatDisplayMoney(1000,'SDG',settings()),'0.150 KWD');assert.equal(formatDisplayMoney(-1000,'SDG',settings()),'-0.150 KWD');assert.equal(formatDisplayMoney(0,'SDG',settings()),'0.000 KWD');
  assert.equal(formatDisplayMoney(1.23456789,'USD',settings()),'0.370 KWD');assert.equal(formatDisplayMoney(1.23456789,'USD',{...settings(),rounding_rule:'ceil'}),'0.371 KWD');
  assert.equal(formatDisplayMoney(4,'SAR',settings()),'0.300 KWD');assert.equal(formatDisplayMoney(1.234,'KWD',settings()),'1.234 KWD');
});
test('unequal parallel books remain visible with their source and are never added or discarded',()=>{
  assert.equal(formatDisplayPair(1000,.5,settings()),'0.150 KWD');
  assert.equal(formatDisplayPair(1000,0,settings()),'0.150 KWD (دفتر SDG) / 0.000 KWD (دفتر USD)');
  assert.equal(formatDisplayPair(1000,2,settings()),'0.150 KWD (دفتر SDG) / 0.600 KWD (دفتر USD)');
  assert.equal(formatDisplayPair(0,2,settings()),'0.000 KWD (دفتر SDG) / 0.600 KWD (دفتر USD)');
});
test('a missing foreign source quote is explicit, never a guessed or zero balance; frozen source rates can be supplied',()=>{
  const s={...settings('SAR',4),currency_rates:{}};assert.equal(displayAmount(1,'KWD',s),undefined);assert.match(formatDisplayMoney(1,'KWD',s),/سعر KWD غير محدد/);
  assert.equal(formatDisplayMoney(1.2,'KWD',{...s,currency_rates:{KWD:.3}}),'16.00 SAR');assert.equal(displayAmount(NaN,'USD',s),undefined);assert.equal(displayAmount(1,'ZZZ',s),undefined);
});
test('server settings validation rejects incomplete, unsupported, nonpositive, excessive and inconsistent manual quotes',()=>{
  for(const quote of [null,{},[],{currency:'XYZ',units_per_usd:1,sdg_per_usd:2000},{currency:'KWD',units_per_usd:0,sdg_per_usd:2000},{currency:'KWD',units_per_usd:-1,sdg_per_usd:2000},{currency:'KWD',units_per_usd:1,sdg_per_usd:0},{currency:'KWD',units_per_usd:Infinity,sdg_per_usd:2000},{currency:'KWD',units_per_usd:1e11,sdg_per_usd:2000},{currency:'KWD',units_per_usd:.123456789,sdg_per_usd:2000},{currency:'USD',units_per_usd:2,sdg_per_usd:2000},{currency:'SDG',units_per_usd:2,sdg_per_usd:2000},{currency:'KWD',units_per_usd:.3,sdg_per_usd:2000,override:true}])assert.throws(()=>validateSettings({...INITIAL_SETTINGS,display_currency:quote as any}));
  assert.equal(validateSettings(settings()).display_currency!.currency,'KWD');
});
test('CSV presentation appends labeled converted columns while retaining every exact original value and source identifier',()=>{
  const h=['id','movement_sdg','balance_usd','note'],rows=[['source-1',1000,.5,'=HYPERLINK()']];const before=structuredClone({h,rows}),result=appendDisplayColumns(h,rows,settings());
  assert.deepEqual(result.rows[0].slice(0,4),rows[0]);assert.deepEqual(result.rows[0].slice(4),['0.150 KWD','0.150 KWD']);assert.deepEqual({h,rows},before);assert.equal(result.headers[4],'عرض KWD: movement_sdg');
});
test('applying a manual display quote preserves issued native invoices, receipts, books, stock and document/PDF messages',async()=>{
  const f=await displayFixture();const invoice=(await f.run('invoice.create',f.sale(),'sale')).result;await f.run('payment.create',{invoice_id:invoice.id,amount:.2,currency:'KWD',currency_rates_used:{KWD:.4},exchange_rate_used:2500,payment_method:'cash'},'receipt');
  const before=await f.snapshot(),records=(f.store as MemoryStore).dump(),doc=before.collections.invoices[0] as any;
  const html=buildInvoiceHtml(doc,before.settings),message=buildInvoiceWhatsAppMessage(doc,before.settings);
  const command={updates:{display_currency:{currency:'SAR',units_per_usd:4,sdg_per_usd:3000},default_transaction_currency:'SAR',currency_rates:{...syntheticCurrencyRates,SAR:4}},reason:'عرض يدوي فقط'};
  const applied=await f.run('settings.update',command,'display');const after=await f.snapshot();assert.deepEqual(after.settings.display_currency,command.updates.display_currency);
  for(const name of ['invoices','payments','products','inventory_movements','journal_entries','customers','accounts','purchase_bills','expenses'])assert.deepEqual(after.collections[name],before.collections[name],name);
  assert.equal(buildInvoiceHtml(doc,after.settings),html);assert.equal(buildInvoiceWhatsAppMessage(doc,after.settings),message);assert.match(html,/1.234/);
  assert.deepEqual(reconcileFinancialData(after.collections as FinancialData,after.settings),[]);
  assert.deepEqual(await f.run('settings.update',command,'display'),applied);assert.deepEqual((await f.snapshot()).counters,after.counters);
  assert.equal((f.store as MemoryStore).dump()[`${f.root}/audit_logs/audit-display`].action,'settings.update');assert.deepEqual((f.store as MemoryStore).dump()[`${f.root}/invoices/${invoice.id}`],records[`${f.root}/invoices/${invoice.id}`]);
});
test('invalid or failed Apply is fully atomic and can retry with the same operation ID',async()=>{
  let fail=false;const store=new MemoryStore({},()=>{if(fail)throw Error('Synthetic write unavailable');});const f=await displayFixture(store,'failure'),before=store.dump();
  await assert.rejects(f.run('settings.update',{updates:{display_currency:{currency:'KWD',units_per_usd:0,sdg_per_usd:2000}}},'invalid'));assert.deepEqual(store.dump(),before);
  fail=true;await assert.rejects(f.apply('KWD',.3,'retry'),/Synthetic/);assert.deepEqual(store.dump(),before);fail=false;await f.apply('KWD',.3,'retry');assert.equal((await f.snapshot()).settings.display_currency!.units_per_usd,.3);
});
test('manual display settings remain tenant-local and concurrent unrelated setting edits are not overwritten',async()=>{
  const store=new MemoryStore(),f=await displayFixture(store,'one'),g=await displayFixture(store,'two');await Promise.all([f.apply(),f.run('settings.update',{updates:{address:'عنوان جديد',currency_rates:{SAR:5}}},'address')]);
  assert.equal((await f.snapshot()).settings.address,'عنوان جديد');assert.equal((await f.snapshot()).settings.currency_rates!.SAR,5);assert.equal((await f.snapshot()).settings.display_currency!.currency,'KWD');assert.equal((await g.snapshot()).settings.display_currency,undefined);
  await assert.rejects(f.run('settings.update',{updates:{display_currency:settings().display_currency}},'foreign',g.actor),(e:any)=>e.status===403);
});
test('real HTTP settings enforces authenticated owner/admin permissions when platform controls are active',async()=>{
  const f=await displayFixture();await f.store.transaction(async tx=>tx.set(`${f.root}/members/display-sales`,{uid:'display-sales',role:'Sales',status:'active'}));
  const ops=new Operations(f.store,f.now),app=express();app.use(express.json());app.use('/api',createApi({operations:ops,verify:async token=>token==='owner'?f.actor:token==='sales'?{...f.actor,uid:'display-sales'}:Promise.reject(Error('bad token'))}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url=`http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/operations`;
  const post=(token:string)=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'settings.update',data:{updates:{display_currency:settings().display_currency}},operationId:crypto.randomUUID()})});
  try{assert.equal((await post('sales')).status,403);assert.equal((await post('bad')).status,401);assert.equal((await post('owner')).status,200);}finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
test('report exports record the manual quote and selected equivalents while retaining native CSV source columns',()=>{
  const report:any={view:'cash',organizationId:'synthetic',generatedAt:'2026-10-23',period:{end:'2026-10-23'},opening_sdg:1000,opening_usd:.5,closing_sdg:2000,closing_usd:1,accounts:[{account:{code:'1110',name_ar:'نقد'},opening:{SDG:1000,USD:.5},closing:{SDG:2000,USD:1}}]};
  const csv=operationalCsv(report,'',settings());assert.match(csv,/display_quote/);assert.match(csv,/0.150 KWD/);assert.match(csv,/"1000","2000","0.5","1"/);assert.match(csv,/عرض KWD/);
  const payable:any={period:{end:'2026-10-23'},statements:[{supplier_id:'supplier',supplier_name:'مورد',opening_sdg:1000,opening_usd:.5,closing_sdg:2000,closing_usd:1,rows:[]}]};const ap=payablesCsv(payable,'supplier',settings());assert.match(ap,/display_quote/);assert.match(ap,/0.300 KWD/);assert.match(ap,/balance_sdg/);
});
