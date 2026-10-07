import test from 'node:test';
import assert from 'node:assert/strict';
import BigNumber from 'bignumber.js';
import { quoteReturnAllocation, quoteSalesReturnCost, quotePurchaseReturnCost, quoteCreditRefund, salesCreditLines, purchaseReturnLines, creditRefundLines, type ReturnAllocation } from '../src/domain/returnQuotes';
import { BusinessError, validateJournal } from '../src/domain/validation';
import { costState } from '../src/domain/inventoryCost';
import type { InvoiceItem, Product } from '../src/types';
import type { PurchaseLine } from '../src/domain/payables';
const basis = { source_id:'invoice.line1', quantity:3, components:{ revenue:{sdg:7,usd:.07},tax:{sdg:1,usd:.01},cost:{sdg:5,usd:.05} } };
const record = (value: ReturnType<typeof quoteReturnAllocation>, id: string): ReturnAllocation => ({id,sequence:value.sequence,source_id:value.source_id,quantity:value.quantity,components:value.components});
const product = (quantity=10,sdg=50000,usd=25) => ({id:'p',name:'صنف',track_inventory:true,price_sdg:999999,price_usd:999999,...costState(quantity,sdg,usd,'2026-10-01')} as Product);
const saleItem = {id:'line1',product_id:'p',quantity:3,cost_status:'valued',total_cost_sdg:6000,total_cost_usd:3,cost_recorded_at:'2026-10-01',unit_price:999999} as InvoiceItem;
test('B3 split returns conserve original revenue/tax/cost in both books and cumulative totals are independent of request grouping',()=>{
 const previous:ReturnAllocation[]=[];for(let i=0;i<3;i++)previous.push(record(quoteReturnAllocation(basis,previous,1),`return-${i}`));
 for(const key of Object.keys(basis.components))for(const book of ['sdg','usd'] as const)assert.equal(previous.reduce((n,r)=>n.plus(r.components[key][book]),new BigNumber(0)).toNumber(),basis.components[key as keyof typeof basis.components][book]);
 const grouped=quoteReturnAllocation(basis,[],2);for(const key of Object.keys(basis.components))for(const book of ['sdg','usd'] as const)assert.equal(new BigNumber(previous[0].components[key][book]).plus(previous[1].components[key][book]).toNumber(),grouped.components[key][book]);
 assert.equal(quoteReturnAllocation(basis,previous.slice(0,2),1).remaining_quantity,0);assert.deepEqual(quoteReturnAllocation(basis,[],3).components,basis.components);
});
test('B3 fractional quantities and near-zero costs retain residuals without floating-point over-return or invented value',()=>{
 const b={source_id:'fraction.line1',quantity:.3,components:{cost:{sdg:1,usd:.01}}},previous:ReturnAllocation[]=[];
 for(let i=0;i<3;i++)previous.push(record(quoteReturnAllocation(b,previous,.1),`part-${i}`));assert.equal(previous.reduce((n,r)=>n+r.components.cost.sdg,0),1);assert.equal(previous.reduce((n,r)=>new BigNumber(n).plus(r.components.cost.usd).toNumber(),0),.01);assert.throws(()=>quoteReturnAllocation(b,previous,.000001),error=>error instanceof BusinessError && error.status===409);
 assert.deepEqual(quoteReturnAllocation({source_id:'donation',quantity:1,components:{cost:{sdg:0,usd:0}}},[],1).components.cost,{sdg:0,usd:0});
});
test('B3 duplicate, foreign, skipped-sequence, altered-component and excessive historical returns are refused',()=>{
 const first=record(quoteReturnAllocation(basis,[],1),'first');for(const rows of [[first,first],[{...first,source_id:'other'}],[{...first,sequence:2}],[{...first,quantity:4}],[{...first,components:{...first.components,cost:{sdg:999,usd:999}}}],[{...first,components:{cost:first.components.cost}}]])assert.throws(()=>quoteReturnAllocation(basis,rows,1));
 assert.throws(()=>quoteReturnAllocation(basis,[],4));assert.throws(()=>quoteReturnAllocation(basis,[],0));assert.throws(()=>quoteReturnAllocation(basis,[],.0000001));
 const before=structuredClone(basis);quoteReturnAllocation(basis,[],1);assert.deepEqual(basis,before);
});
test('B3 sales returns restore original invoice cost after WAC/retail changes and block unknown cost and backdating',()=>{
 const p=product(),before=structuredClone(p),itemBefore=structuredClone(saleItem);const q=quoteSalesReturnCost('invoice.line1',saleItem,p,[],1,'2026-10-05');assert.deepEqual(q.inventory_in,{sdg:2000,usd:1});assert.equal(q.inventory_after.stock_quantity,11);assert.equal(q.inventory_after.inventory_value_sdg,52000);assert.equal(q.inventory_after.inventory_value_usd,26);assert.equal(q.inventory_after.average_cost_usd,new BigNumber(26).div(11).decimalPlaces(12).toNumber());assert.deepEqual(p,before);assert.deepEqual(saleItem,itemBefore);
 assert.throws(()=>quoteSalesReturnCost('invoice.line1',{...saleItem,cost_status:'unknown'},p,[],1,'2026-10-05'),/غير مؤكدة/);assert.throws(()=>quoteSalesReturnCost('invoice.line1',{...saleItem,product_id:'foreign'},p,[],1,'2026-10-05'));assert.throws(()=>quoteSalesReturnCost('invoice.line1',saleItem,{...p,cost_last_movement_date:'2026-10-06'},[],1,'2026-10-05'));
});
test('B3 purchase returns separate original supplier credit from current WAC with explicit variance in each book',()=>{
 const item={id:'line1',product_id:'p',quantity:2,value_sdg:4000,value_usd:2} as PurchaseLine,p=product(2,3000,1.5);const first=quotePurchaseReturnCost('bill.line1',item,p,[],1,'2026-10-05');assert.deepEqual(first.supplier_credit,{sdg:2000,usd:1});assert.deepEqual(first.inventory_out,{sdg:1500,usd:.75});assert.deepEqual(first.variance,{sdg:500,usd:.25});
 const second=quotePurchaseReturnCost('bill.line1',item,{...p,...first.inventory_after},[record(first,'first')],1,'2026-10-05');assert.equal(second.inventory_after.stock_quantity,0);assert.equal(second.inventory_after.inventory_value_sdg,0);assert.equal(second.inventory_after.inventory_value_usd,0);assert.equal(first.inventory_out.sdg+second.inventory_out.sdg,3000);assert.equal(first.supplier_credit.sdg+second.supplier_credit.sdg,4000);
 assert.throws(()=>quotePurchaseReturnCost('bill.line1',item,product(0,0,0),[],1,'2026-10-05'),/كاف/);const loss=quotePurchaseReturnCost('bill.line1',item,product(2,5000,2.5),[],1,'2026-10-05');assert.deepEqual(loss.variance,{sdg:-500,usd:-.25});
});
test('B3 partial refunds allocate historical credit and payment FX without exceeding credit or creating duplicate residuals',()=>{
 let available={sdg:200000,usd:100};const total={settled:0,cash:0,loss:0};for(const amount of [33.33,33.33,33.34]){const q=quoteCreditRefund(available,'USD',amount,'USD',3000);total.settled+=q.settled.sdg;total.cash+=q.cash.sdg;total.loss+=q.fx_loss.sdg;assert.deepEqual(q.fx_gain,{sdg:0,usd:0});assert.equal(new BigNumber(q.settled.sdg).plus(q.fx_loss.sdg).toNumber(),q.cash.sdg);available=q.remaining_credit;}
 assert.deepEqual(available,{sdg:0,usd:0});assert.deepEqual(total,{settled:200000,cash:300000,loss:100000});assert.throws(()=>quoteCreditRefund(available,'USD',1,'USD',3000));assert.throws(()=>quoteCreditRefund({sdg:2000,usd:1},'USD',2,'USD',3000));assert.throws(()=>quoteCreditRefund({sdg:2000,usd:1},'USD',1,'USD',0));
 const gain=quoteCreditRefund({sdg:2000,usd:1},'USD',1,'USD',1000);assert.deepEqual(gain.fx_gain,{sdg:1000,usd:0});assert.deepEqual(gain.fx_loss,{sdg:0,usd:0});assert.deepEqual(gain.remaining_credit,{sdg:0,usd:0});
});
test('B3 mixed payment/native credit currencies preserve separate-book FX and remaining historical credit',()=>{
 const q=quoteCreditRefund({sdg:2000,usd:1},'USD',3000,'SDG',3000);assert.deepEqual(q.cash,{sdg:3000,usd:1});assert.deepEqual(q.settled,{sdg:2000,usd:1});assert.deepEqual(q.fx_loss,{sdg:1000,usd:0});assert.deepEqual(q.remaining_credit,{sdg:0,usd:0});
 const local=quoteCreditRefund({sdg:2000,usd:1},'SDG',1,'USD',1000);assert.deepEqual(local.settled,{sdg:1000,usd:.5});assert.deepEqual(local.cash,{sdg:1000,usd:1});assert.deepEqual(local.fx_loss,{sdg:0,usd:.5});assert.deepEqual(local.remaining_credit,{sdg:1000,usd:.5});
});

test('B3 malformed history and refund rates fail validation before any calculation',()=>{
 for(const rows of [[null],[{id:'bad',sequence:NaN}],[{id:'bad',sequence:1.5}],[{id:'bad',sequence:0}]])assert.throws(()=>quoteReturnAllocation(basis,rows as ReturnAllocation[],1));
 for(const rate of [NaN,Infinity,-1,'3000',.000000001,1e11])assert.throws(()=>quoteCreditRefund({sdg:2000,usd:1},'USD',1,'USD',rate as number));
 for(const value of [{sdg:-1,usd:1},{sdg:2000.5,usd:1},{sdg:2000,usd:.001}])assert.throws(()=>quoteCreditRefund(value,'USD',1,'USD',2000));
});

test('B3 physical sales return reverses original revenue/tax/COGS while a price correction leaves inventory unchanged',()=>{
 const revenue={sdg:100,usd:.5},tax={sdg:15,usd:.08},cost={sdg:60,usd:.3};
 const physical=salesCreditLines(revenue,tax,cost),priceOnly=salesCreditLines(revenue,tax);
 assert.deepEqual(physical.map(line=>line.account_code),['4100','2130','1200','1300','5100']);assert.equal(physical[2].credit_sdg,115);assert.equal(physical[2].credit_usd,.58);assert.equal(physical[3].debit_sdg,60);assert.equal(physical[4].credit_usd,.3);
 assert.deepEqual(priceOnly.map(line=>line.account_code),['4100','2130','1200']);assert.equal(validateJournal(physical).total_debit_sdg,175);assert.equal(validateJournal(priceOnly).total_debit_usd,.58);
 assert.deepEqual(salesCreditLines(revenue,{sdg:0,usd:0}).map(line=>line.account_code),['4100','1200']);assert.throws(()=>salesCreditLines({sdg:0,usd:0},{sdg:0,usd:0}));
});

test('B3 purchase return variance keeps both books balanced including opposite signs in the two books',()=>{
 const lines=purchaseReturnLines({sdg:2000,usd:1},{sdg:1500,usd:1.2},'purchase-variance');
 assert.equal(lines[0].debit_sdg,2000);assert.equal(lines[1].credit_usd,1.2);assert.equal(lines[2].debit_usd,.2);assert.equal(lines[3].credit_sdg,500);assert.equal(validateJournal(lines).total_debit_sdg,2000);assert.equal(validateJournal(lines).total_debit_usd,1.2);
 assert.equal(purchaseReturnLines({sdg:2000,usd:1},{sdg:2000,usd:1},'purchase-variance').length,2);
 assert.throws(()=>purchaseReturnLines({sdg:2000,usd:1},{sdg:1500,usd:1},'1300'));
});

test('B3 customer refund and supplier reimbursement reverse cash direction and FX without netting book differences',()=>{
 const q=quoteCreditRefund({sdg:2000,usd:1},'USD',1,'USD',3000),out=creditRefundLines(q,'bank'),incoming=creditRefundLines(q,'bank','supplier');
 assert.deepEqual(out.map(line=>line.account_code),['1200','bank','5500']);assert.equal(out[0].debit_sdg,2000);assert.equal(out[1].credit_sdg,3000);assert.equal(out[2].debit_sdg,1000);
 assert.deepEqual(incoming.map(line=>line.account_code),['bank','2110','4200']);assert.equal(incoming[0].debit_sdg,3000);assert.equal(incoming[1].credit_sdg,2000);assert.equal(incoming[2].credit_sdg,1000);validateJournal(out);validateJournal(incoming);
 const altered={...q,fx_loss:{sdg:999,usd:0}};assert.throws(()=>creditRefundLines(altered,'bank'),/فروق صرف/);assert.throws(()=>creditRefundLines({...q,fx_loss:{sdg:1001,usd:0},fx_gain:{sdg:1,usd:0}},'bank'),/فروق صرف/);assert.throws(()=>creditRefundLines(q,'1200'));assert.throws(()=>creditRefundLines(q,'bank','unknown' as 'customer'));
});
