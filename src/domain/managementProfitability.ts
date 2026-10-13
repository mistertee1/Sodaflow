import BigNumber from 'bignumber.js';
import type { Customer, Invoice, JournalEntry, Payment, Product } from '../types';
import type { Document } from './store';
import { buildSalesReturnBases, returnSourceId } from './returnSources';
import { dateOnly, ensure } from './validation';

type Amount = { sdg: BigNumber; usd: BigNumber };
const amount = (): Amount => ({ sdg: new BigNumber(0), usd: new BigNumber(0) });
const add = (target: Amount, value?: { sdg?: number; usd?: number }, sign = 1) => {
  target.sdg = target.sdg.plus(new BigNumber(value?.sdg || 0).times(sign));
  target.usd = target.usd.plus(new BigNumber(value?.usd || 0).times(sign));
};

/** Source-backed product margin. Original sales use their frozen invoice/journal basis;
 * corrections use the immutable per-line allocations captured by B3. */
export function productProfitability(input: {
  orgId: string; products: Product[]; invoices: Invoice[]; creditNotes: Document[];
  entries: JournalEntry[]; inventoryMovements: Document[]; period?: { start?: string; end?: string };
}) {
  const start=input.period?.start?dateOnly(input.period.start):undefined,end=input.period?.end?dateOnly(input.period.end):undefined;
  ensure(!start||!end||start<=end,'بداية الفترة يجب أن تسبق نهايتها.');
  const inPeriod=(date:string)=>{const value=dateOnly(date);return(!start||value>=start)&&(!end||value<=end);};
  const rows=new Map(input.products.map(product=>[product.id,{product,sales:amount(),cogs:amount(),quantity:new BigNumber(0),returns:new BigNumber(0),costs_complete:true}]));
  const sources=new Map<string,{productId:string;revenue:{sdg:number;usd:number};cost?:{sdg:number;usd:number}}>();
  for(const invoice of input.invoices){
    if(invoice.org_id!==input.orgId||['void','cancelled','draft'].includes(invoice.status))continue;
    const original=input.entries.filter(entry=>entry.reference_type==='invoice'&&entry.reference_id===invoice.id);
    const proof=buildSalesReturnBases(invoice,original,input.orgId);
    invoice.items.forEach((item,index)=>{if(!item.product_id)return;const row=rows.get(item.product_id);ensure(row,`المنتج ${item.product_id} غير موجود؛ لا يمكن إصدار تقرير ربحيته.`);const basis=proof.bases[index];ensure(basis&&basis.source_id===returnSourceId(invoice.id,item.id),'دليل بند المنتج لا يطابق مصدر الفاتورة.',409);sources.set(basis.source_id,{productId:item.product_id,revenue:basis.components.revenue,cost:basis.components.cost});if(!inPeriod(invoice.issue_date))return;add(row.sales,basis.components.revenue);row.quantity=row.quantity.plus(item.quantity);if(basis.components.cost)add(row.cogs,basis.components.cost);else if(item.cost_status==='unknown')row.costs_complete=false;});
  }
  for(const note of input.creditNotes){
    if(note.org_id!==input.orgId||!inPeriod(note.date))continue;
    for(const line of note.lines||[]){const source=sources.get(returnSourceId(note.invoice_id,line.line_id));ensure(source,'مصدر بند الإشعار الدائن مفقود من التقرير.',409);const row=rows.get(source.productId)!;add(row.sales,line.allocated?.revenue,-1);add(row.cogs,line.allocated?.cost,-1);if(note.kind==='sales_return')row.returns=row.returns.plus(line.quantity||0);}
  }
  const valueAt=(product:Product,cutoff?:string)=>{let sdg=new BigNumber(product.inventory_value_sdg||0),usd=new BigNumber(product.inventory_value_usd||0);if(!cutoff)return{sdg,usd};for(const movement of input.inventoryMovements)if(movement.product_id===product.id&&dateOnly(movement.date||movement.created_at)>cutoff){sdg=sdg.minus(movement.value_delta_sdg||0);usd=usd.minus(movement.value_delta_usd||0);}return{sdg,usd};};
  const openingCutoff=start?(()=>{const day=new Date(`${start}T00:00:00Z`);day.setUTCDate(day.getUTCDate()-1);return day.toISOString().slice(0,10);})():undefined;
  return {period:{start,end},rows:[...rows.values()].map(row=>{const closing=valueAt(row.product,end),opening=openingCutoff?valueAt(row.product,openingCutoff):undefined;const average=opening?{sdg:opening.sdg.plus(closing.sdg).div(2),usd:opening.usd.plus(closing.usd).div(2)}:undefined,gross={sdg:row.sales.sdg.minus(row.cogs.sdg),usd:row.sales.usd.minus(row.cogs.usd)};return{product_id:row.product.id,product_name:row.product.name,quantity_sold:row.quantity.minus(row.returns).toNumber(),returned_quantity:row.returns.toNumber(),sales_sdg:row.sales.sdg.toNumber(),sales_usd:row.sales.usd.toNumber(),cogs_sdg:row.cogs.sdg.toNumber(),cogs_usd:row.cogs.usd.toNumber(),gross_profit_sdg:gross.sdg.toNumber(),gross_profit_usd:gross.usd.toNumber(),gross_margin_sdg:row.sales.sdg.isZero()?null:gross.sdg.div(row.sales.sdg).times(100).decimalPlaces(2).toNumber(),gross_margin_usd:row.sales.usd.isZero()?null:gross.usd.div(row.sales.usd).times(100).decimalPlaces(2).toNumber(),costs_complete:row.costs_complete,current_stock:row.product.stock_quantity||0,inventory_value_sdg:closing.sdg.toNumber(),inventory_value_usd:closing.usd.toNumber(),stock_turnover_sdg:average&&!average.sdg.isZero()?row.cogs.sdg.div(average.sdg).decimalPlaces(4).toNumber():null,stock_turnover_usd:average&&!average.usd.isZero()?row.cogs.usd.div(average.usd).decimalPlaces(4).toNumber():null};}).filter(row=>row.sales_sdg||row.sales_usd||row.cogs_sdg||row.cogs_usd||row.current_stock)};
}


type CustomerOutstanding = { customer_id: string; closing_sdg: number; closing_usd: number };

/** Source-backed customer margin and management summary. Sales and COGS are rebuilt
 * from immutable invoice/journal evidence, corrections use their captured allocation,
 * and outstanding balances come from the reconciled AR subledger as of the report end. */
export function customerProfitability(input: {
  orgId: string; customers: Customer[]; invoices: Invoice[]; payments: Payment[];
  creditNotes: Document[]; entries: JournalEntry[]; outstanding: CustomerOutstanding[];
  period?: { start?: string; end?: string };
}) {
  const start=input.period?.start?dateOnly(input.period.start):undefined,end=input.period?.end?dateOnly(input.period.end):undefined;
  ensure(!start||!end||start<=end,'بداية الفترة يجب أن تسبق نهايتها.');
  const inPeriod=(date:string)=>{const value=dateOnly(date);return(!start||value>=start)&&(!end||value<=end);};
  const rows=new Map(input.customers.filter(customer=>customer.org_id===input.orgId).map(customer=>[customer.id,{customer,sales:amount(),cogs:amount(),discounts:amount(),returns:amount(),invoice_count:0,credit_document_count:0,costs_complete:true,payment_weight:new BigNumber(0),payment_days:new BigNumber(0)}]));
  const invoiceIndex=new Map<string,Invoice>(),sources=new Map<string,{customerId:string;costStatus:string}>();
  for(const invoice of input.invoices){
    if(invoice.org_id!==input.orgId||['void','cancelled','draft'].includes(invoice.status))continue;
    const row=rows.get(invoice.customer_id);ensure(row,`العميل ${invoice.customer_id} غير موجود؛ لا يمكن إصدار تقرير ربحيته.`,409);
    const original=input.entries.filter(entry=>entry.reference_type==='invoice'&&entry.reference_id===invoice.id),proof=buildSalesReturnBases(invoice,original,input.orgId);
    invoiceIndex.set(invoice.id,invoice);
    for(const basis of proof.bases)sources.set(basis.source_id,{customerId:invoice.customer_id,costStatus:proof.cost_statuses[basis.source_id]||'unknown'});
    if(!inPeriod(invoice.issue_date))continue;
    for(const basis of proof.bases){add(row.sales,basis.components.revenue);if(basis.components.cost)add(row.cogs,basis.components.cost);}
    add(row.discounts,{sdg:invoice.discount_total_sdg,usd:invoice.discount_total_usd});row.invoice_count++;
    if(Object.values(proof.cost_statuses).some(status=>status==='unknown'))row.costs_complete=false;
  }
  for(const note of input.creditNotes){
    if(note.org_id!==input.orgId||!inPeriod(note.date))continue;
    ensure(['price_credit','sales_return'].includes(note.kind),'نوع تصحيح المبيعات غير صالح.',409);
    const touched=new Set<string>();
    for(const line of note.lines||[]){
      const source=sources.get(returnSourceId(note.invoice_id,line.line_id));ensure(source,'مصدر بند الإشعار الدائن مفقود من تقرير العميل.',409);
      const row=rows.get(source.customerId)!;add(row.sales,line.allocated?.revenue,-1);add(row.cogs,line.allocated?.cost,-1);
      add(note.kind==='sales_return'?row.returns:row.discounts,line.allocated?.revenue);
      if(note.kind==='sales_return'&&source.costStatus==='unknown')row.costs_complete=false;touched.add(source.customerId);
    }
    for(const customerId of touched)rows.get(customerId)!.credit_document_count++;
  }
  for(const payment of input.payments){
    if(payment.org_id!==input.orgId||!inPeriod(payment.payment_date))continue;
    const invoice=invoiceIndex.get(payment.invoice_id);ensure(invoice&&payment.customer_id===invoice.customer_id,'مرجع سند التحصيل لا يطابق فاتورة العميل.',409);
    const row=rows.get(invoice.customer_id)!,weight=new BigNumber(invoice.receivable_currency==='USD'?payment.settled_amount_usd||0:payment.settled_amount_sdg||0);
    if(weight.lte(0))continue;
    const days=Math.floor((Date.parse(`${dateOnly(payment.payment_date)}T00:00:00Z`)-Date.parse(`${dateOnly(invoice.issue_date)}T00:00:00Z`))/86400000);
    ensure(days>=0,'سند التحصيل يسبق فاتورة العميل.',409);row.payment_weight=row.payment_weight.plus(weight);row.payment_days=row.payment_days.plus(weight.times(days));
  }
  const outstanding=new Map(input.outstanding.map(row=>[row.customer_id,row]));
  const result=[...rows.values()].map(row=>{const due=outstanding.get(row.customer.id),gross={sdg:row.sales.sdg.minus(row.cogs.sdg),usd:row.sales.usd.minus(row.cogs.usd)};return{customer_id:row.customer.id,customer_name:row.customer.name,invoice_count:row.invoice_count,credit_document_count:row.credit_document_count,sales_sdg:row.sales.sdg.toNumber(),sales_usd:row.sales.usd.toNumber(),cogs_sdg:row.cogs.sdg.toNumber(),cogs_usd:row.cogs.usd.toNumber(),gross_profit_sdg:gross.sdg.toNumber(),gross_profit_usd:gross.usd.toNumber(),gross_margin_sdg:row.sales.sdg.isZero()?null:gross.sdg.div(row.sales.sdg).times(100).decimalPlaces(2).toNumber(),gross_margin_usd:row.sales.usd.isZero()?null:gross.usd.div(row.sales.usd).times(100).decimalPlaces(2).toNumber(),outstanding_sdg:due?.closing_sdg||0,outstanding_usd:due?.closing_usd||0,average_payment_days:row.payment_weight.isZero()?null:row.payment_days.div(row.payment_weight).decimalPlaces(2).toNumber(),discounts_sdg:row.discounts.sdg.toNumber(),discounts_usd:row.discounts.usd.toNumber(),returns_sdg:row.returns.sdg.toNumber(),returns_usd:row.returns.usd.toNumber(),costs_complete:row.costs_complete};}).filter(row=>row.invoice_count||row.credit_document_count||row.sales_sdg||row.sales_usd||row.outstanding_sdg||row.outstanding_usd||row.discounts_sdg||row.discounts_usd||row.returns_sdg||row.returns_usd).sort((a,b)=>b.gross_profit_sdg-a.gross_profit_sdg||b.gross_profit_usd-a.gross_profit_usd||a.customer_id.localeCompare(b.customer_id));
  const total=(field:keyof typeof result[number])=>result.reduce((sum,row)=>sum.plus(typeof row[field]==='number'?(row[field] as number):0),new BigNumber(0));
  const sales={sdg:total('sales_sdg'),usd:total('sales_usd')},cogs={sdg:total('cogs_sdg'),usd:total('cogs_usd')},gross={sdg:sales.sdg.minus(cogs.sdg),usd:sales.usd.minus(cogs.usd)};
  return{period:{start,end},totals:{customer_count:result.length,sales_sdg:sales.sdg.toNumber(),sales_usd:sales.usd.toNumber(),cogs_sdg:cogs.sdg.toNumber(),cogs_usd:cogs.usd.toNumber(),gross_profit_sdg:gross.sdg.toNumber(),gross_profit_usd:gross.usd.toNumber(),gross_margin_sdg:sales.sdg.isZero()?null:gross.sdg.div(sales.sdg).times(100).decimalPlaces(2).toNumber(),gross_margin_usd:sales.usd.isZero()?null:gross.usd.div(sales.usd).times(100).decimalPlaces(2).toNumber(),outstanding_sdg:total('outstanding_sdg').toNumber(),outstanding_usd:total('outstanding_usd').toNumber(),discounts_sdg:total('discounts_sdg').toNumber(),discounts_usd:total('discounts_usd').toNumber(),returns_sdg:total('returns_sdg').toNumber(),returns_usd:total('returns_usd').toNumber(),costs_complete:result.every(row=>row.costs_complete)},rows:result};
}
