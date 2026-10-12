import BigNumber from 'bignumber.js';
import type { Invoice, JournalEntry, Product } from '../types';
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
