import test from 'node:test';
import assert from 'node:assert/strict';
import BigNumber from 'bignumber.js';
import { usdPricingFixture } from './helpers/usdPricing';
import { productPriceQuote, productPricingMode } from '../src/domain/productPricing';
import { costState } from '../src/domain/inventoryCost';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { createApi } from '../server/api';
import express from 'express';
import type { InvoiceItem, Product } from '../src/types';

async function books(f: Awaited<ReturnType<typeof usdPricingFixture>>) {
  const snapshot = await f.snapshot();
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings, { requireCosting:true }), []);
  return snapshot;
}

test('USD reference: purchase at 1000 SDG/2000 FX then sale at 3000 FX quotes 1500; original cost, purchase and balanced books stay frozen', async () => {
  const f = await usdPricingFixture(); const purchase = (await f.purchase()).result;
  assert.equal(purchase.grand_total_sdg, 10000); assert.equal(purchase.grand_total_usd, 5);
  assert.equal((await f.currentProduct()).average_cost_usd, .5);
  await f.run('settings.update', { updates:{default_exchange_rate:3000,manual_exchange_rate:3000} });
  const line = await f.line(); assert.equal(line.unit_price, 1500); assert.equal(line.price_reference?.reference_usd, .5);
  const command = f.invoice([line]); const sale = await f.run('invoice.create', command, 'example-sale');
  assert.deepEqual(await f.run('invoice.create', command, 'example-sale'), sale);
  assert.equal(sale.result.grand_total_sdg, 1500); assert.equal(sale.result.grand_total_usd, .5);
  assert.equal(sale.result.cogs_sdg,1000); assert.equal(sale.result.cogs_usd,.5);
  assert.equal(sale.result.items[0].unit_cost_sdg,1000); assert.equal(sale.result.items[0].price_reference.version,1);
  const quote = productPriceQuote(await f.currentProduct(),'SDG',3000); assert.equal(quote.fx_cost_difference_sdg,500);
  const s = await books(f); assert.deepEqual(s.collections.purchase_bills[0],purchase);
  const posted = structuredClone(s.collections.invoices[0]);
  assert.equal(s.collections.journal_entries.filter(e=>e.reference_id===sale.result.id).length,1);
  assert.equal(s.collections.journal_entries.find(e=>e.reference_id===sale.result.id)!.lines.some((l:any)=>['4200','5500'].includes(l.account_code)),false);
  await f.run('settings.update',{updates:{default_exchange_rate:4000}});
  await f.run('product.update',{id:f.product.id,updates:{pricing_markup_percent:50}});
  assert.deepEqual((await f.snapshot()).collections.invoices[0],posted);
});

test('USD cost-plus: markup is separate from the FX-driven change; repeated lines share documented weighted cost', async () => {
  const f = await usdPricingFixture(); await f.purchase('first',2); await f.purchase('second',2,2000,2000);
  assert.equal((await f.currentProduct()).average_cost_usd,.75);
  await f.run('product.update',{id:f.product.id,updates:{pricing_markup_percent:20}});
  const line = await f.line(); assert.equal(line.unit_price,2700); assert.equal(line.price_reference?.reference_usd,.9);
  const result = await f.run('invoice.create',f.invoice([line,{...line,id:'draft-2'}]));
  assert.equal(result.result.cogs_sdg,3000); assert.equal(result.result.cogs_usd,1.5);
  assert.equal(result.result.grand_total_sdg,5400); assert.equal(result.result.grand_total_usd,1.8); await books(f);
});

test('USD reference: a stale automatic preview rolls back every invoice, stock, journal, counter and audit write', async () => {
  const f = await usdPricingFixture(); await f.purchase(); const stale = await f.line();
  await f.run('product.update',{id:f.product.id,updates:{pricing_markup_percent:20}});
  const before = await f.snapshot();
  await assert.rejects(f.run('invoice.create',f.invoice([stale]),'stale'), (e:any)=>e.status===409 && /تغير مرجع/.test(e.message));
  const after = await f.snapshot(); assert.deepEqual(after.collections,before.collections); assert.deepEqual(after.counters,before.counters); assert.deepEqual(after.org,before.org);
  assert.equal((await f.run('invoice.create',f.invoice([await f.line()]),'fresh')).result.items[0].unit_price,1800); await books(f);
});

test('USD reference: manual overrides remain exact and cannot carry forged automatic reference evidence', async () => {
  const f = await usdPricingFixture(); await f.purchase(); const line = await f.line();
  const manual: InvoiceItem = {...line,price_source:'manual',unit_price:1750};
  const result = await f.run('invoice.create',f.invoice([manual])); assert.equal(result.result.items[0].unit_price,1750);
  assert.equal(result.result.items[0].price_source,'manual'); assert.equal(result.result.items[0].price_reference,undefined); await books(f);
});

test('USD reference: automatic prices are recomputed server-side and client proof is discarded, including manipulated native FX previews', async () => {
  const f = await usdPricingFixture(); await f.purchase(); const line = await f.line();
  const forged = {...line,price_reference:{...line.price_reference!,reference_usd:9999,mode:'usd_reference' as const}};
  const good = (await f.run('invoice.create',f.invoice([forged]))).result;
  assert.equal(good.items[0].price_reference.reference_usd,.5); assert.equal(good.items[0].price_reference.mode,'usd_cost_plus');
  await assert.rejects(f.run('invoice.create',f.invoice([{...line,unit_price:1}])) , /تغير مرجع/);
  await assert.rejects(f.run('invoice.create',f.invoice([{...line,price_source:'invented'} as any])),/مصدر سعر/);
  await assert.rejects(f.run('invoice.create',f.invoice([{...line,product_id:undefined}])));
  await assert.rejects(f.run('invoice.create',f.invoice([line],0)),/سعر صرف/); await books(f);
});

test('USD reference: every Gulf currency and Egypt derives from the same USD basis with its native precision', async () => {
  const f = await usdPricingFixture(); await f.purchase();
  for (const [currency,rate,expected] of [['SAR',3.75,1.88],['AED',3.67,1.84],['KWD',.307,.154],['QAR',3.64,1.82],['BHD',.377,.189],['OMR',.385,.193],['EGP',50,25]] as const) {
    const line = await f.line(3000,currency,{[currency]:rate}); assert.equal(line.unit_price,expected);
    const invoice = (await f.run('invoice.create',f.invoice([line],3000,{currency_rates_used:{[currency]:rate}}))).result;
    assert.equal(invoice.items[0].price_reference.reference_usd,.5); assert.equal(invoice.pricing.currency,currency);
    assert.equal(invoice.pricing.total,expected);
  }
  await books(f);
});

test('USD reference: precise fixed selling anchors retain more than cents and recorded USD legacy prices follow FX without rewriting catalog history', () => {
  const p = {id:'p',name:'legacy',price_sdg:1000,price_usd:.5,track_inventory:false} as Product;
  assert.equal(productPricingMode(p),'usd_reference'); assert.equal(productPriceQuote(p,'SDG',3000).unit_price,1500);
  assert.equal(p.price_sdg,1000);
  const precise = {...p,pricing_mode:'usd_reference' as const,pricing_reference_usd:new BigNumber(1000).div(3000).decimalPlaces(8).toNumber()};
  assert.equal(productPriceQuote(precise,'SDG',6000).unit_price,2000);
  assert.equal(productPricingMode({...p,price_usd:0}),'manual');
  assert.throws(()=>productPriceQuote({...p,price_usd:0},'SDG',3000),/يدوي/);
  assert.throws(()=>productPriceQuote(p,'USD',0),/سعر صرف/);
});

test('USD reference: missing historical USD cost never turns into an invented today-rate cost or a misleading zero-cost sale', async () => {
  const f = await usdPricingFixture();
  const legacy = {...await f.currentProduct(),...costState(2,2000,0,'2026-10-23')};
  assert.throws(()=>productPriceQuote(legacy,'SDG',3000),/غير موثقة/);
  assert.throws(()=>productPriceQuote({...legacy,...costState(0,0,0,'2026-10-23')},'SDG',3000),/استلم مخزون/);
  await assert.rejects(f.purchase('missing-fx',1,1000,0),/سعر صرف الشراء/);
  await assert.rejects(f.run('inventory.receive',{id:f.product.id,quantity:1,unit_cost_sdg:1000,unit_cost_usd:0,reason:'رفض تجاوز مرجع الدولار بحقلي الدفاتر',payment_method:'cash'}),/تكلفة الدولار المرجعية/);
  assert.equal((await f.snapshot()).collections.purchase_bills.length,0);
  await f.purchase('documented',1,1000,2000); assert.equal((await f.line()).unit_price,1500);
});

test('USD reference: invalid pricing policies and precision are rejected by product commands and restore validation', async () => {
  const f = await usdPricingFixture();
  for (const updates of [{pricing_mode:'other'},{pricing_markup_percent:-1},{pricing_markup_percent:10001},{pricing_markup_percent:.00001},{pricing_reference_usd:.000000001},{pricing_reference_usd:NaN}]) {
    await assert.rejects(f.run('product.update',{id:f.product.id,updates}));
  }
  await assert.rejects(f.run('product.create',{name:'خدمة',unit:'ساعة',price_sdg:1000,price_usd:0,tax_rate:0,is_active:true,track_inventory:false,pricing_mode:'usd_cost_plus'}),/متتبع/);
  await assert.rejects(f.run('product.update',{id:f.product.id,updates:{pricing_mode:'usd_reference',price_sdg:1000,price_usd:0,pricing_reference_usd:0}}),/مرجع/);
  const before = await f.currentProduct(); assert.equal(before.pricing_mode,'usd_cost_plus');
});

test('USD reference: HTTP keeps authentication and tenant boundaries, returns a stale-price conflict, and accepts a fresh quote', async () => {
  const f = await usdPricingFixture(); await f.purchase(); const line = await f.line();
  const app=express();app.use(express.json());app.use('/api',createApi({operations:f.ops,verify:async token=>{if(token==='owner')return f.owner;if(token==='outsider')return {...f.owner,uid:'outsider'};throw Error('invalid token');}}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/operations`;
  const post=(token:string,data:Record<string,unknown>)=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'invoice.create',data,operationId:crypto.randomUUID()})});
  try { assert.equal((await post('invalid',f.invoice([line]))).status,401);assert.equal((await post('outsider',f.invoice([line]))).status,403);
    assert.equal((await post('owner',f.invoice([{...line,unit_price:2}]))).status,409);
    assert.equal((await post('owner',f.invoice([line]))).status,200);
  } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
  await books(f);
});

test('USD reference: concurrent automatic sales cannot oversell the original USD-valued stock', async () => {
  const f=await usdPricingFixture();await f.purchase('single',1); const line=await f.line();
  const results=await Promise.allSettled([f.run('invoice.create',f.invoice([line]),'race-a'),f.run('invoice.create',f.invoice([line]),'race-b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.snapshot()).collections.invoices.length,1);assert.equal((await f.currentProduct()).stock_quantity,0);await books(f);
});

test('USD reference: authorized backup/restore preserves pricing mode, precise reference and immutable invoice pricing snapshots', async () => {
  const f=await usdPricingFixture();await f.purchase();await f.run('invoice.create',f.invoice([await f.line()])); const backup=await books(f);
  const actor={...f.owner,uid:'usd-restore'},org=await new Organizations(f.store).create(actor,'استعادة مرجع الدولار',INITIAL_SETTINGS,'restore',true);
  await f.ops.execute(org.id,actor,{action:'backup.restore',data:{backup},operationId:'restore'});
  const restored=await f.ops.snapshot(org.id,actor,true);assert.deepEqual(restored.collections.invoices[0].items[0].price_reference,backup.collections.invoices[0].items[0].price_reference);
  assert.equal(restored.collections.products[0].pricing_mode,'usd_cost_plus');assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData,restored.settings,{requireCosting:true}),[]);
  const bad=structuredClone(backup);bad.collections.products[0].pricing_markup_percent=-1;
  const badActor={...actor,uid:'usd-bad-restore'},badOrg=await new Organizations(f.store).create(badActor,'اختبار رفض نسخة',INITIAL_SETTINGS,'bad-target',true);
  await assert.rejects(f.ops.execute(badOrg.id,badActor,{action:'backup.restore',data:{backup:bad},operationId:'bad-restore'}),/المبلغ/);
  const forged=structuredClone(backup);forged.collections.invoices[0].items[0].price_reference.reference_usd=999;
  await assert.rejects(f.ops.execute(badOrg.id,badActor,{action:'backup.restore',data:{backup:forged},operationId:'bad-proof'}),/مرجع الدولار/);
});
