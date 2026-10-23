import BigNumber from 'bignumber.js';
import { applyRounding } from '../lib/currency';
import type { JournalEntry, JournalEntryLine } from '../types';
import { journal, journalLine } from './financial';
import type { HistoricalDocumentEvidence, HistoricalDocumentEvidenceContext } from './historicalDocumentEvidence';
import { validateHistoricalDocumentEvidence } from './historicalDocumentEvidence';
import type { HistoricalImportRow } from './historicalImport';
import { dateOnly, ensure, identifier, validateJournal } from './validation';

type Books={sdg:number;usd:number};
export interface HistoricalSalesProductState {id:string;name:string;stock_quantity:number;track_inventory:boolean}
export interface HistoricalSalesPlanInput {
  org_id:string;
  actor_id:string;
  session_id:string;
  created_at:string;
  rows:HistoricalImportRow[];
  evidence_by_row:Record<number,HistoricalDocumentEvidence>;
  evidence_context:HistoricalDocumentEvidenceContext;
  products:HistoricalSalesProductState[];
  existing_ids?:string[];
  existing_invoice_numbers?:string[];
}
export interface HistoricalSalesInvoicePlan {
  id:string;invoice_number:string;customer_id:string;issue_date:string;due_date:string;branch_id:string;
  revenue_account_code:string;
  currency:'SDG'|'USD';exchange_rate_used:number;subtotal:Books;tax:Books;total:Books;paid:Books;remaining:Books;
  status:'sent'|'partially_paid'|'paid';cogs:Books;historical_import_session_id:string;historical_import_row_number:number;
  lines:Array<HistoricalDocumentEvidence['lines'][number]&{id:string;total_cost:Books}>;
}
export interface HistoricalSalesPaymentPlan {
  id:string;invoice_id:string;date:string;reference:string;account_code:string;currency:'SDG'|'USD';amount:number;
  exchange_rate_used:number;cash:Books;settled:Books;historical_import_session_id:string;historical_import_row_number:number;
}
export interface HistoricalSalesInventoryMovementPlan {
  id:string;product_id:string;product_name:string;quantity:number;previous_stock:number;resulting_stock:number;
  value_delta:Books;journal_id:string;reference_id:string;historical_import_session_id:string;historical_import_row_number:number;
}
export interface HistoricalSalesImportPlan {
  invoices:HistoricalSalesInvoicePlan[];payments:HistoricalSalesPaymentPlan[];inventory_movements:HistoricalSalesInventoryMovementPlan[];
  journal_entries:JournalEntry[];product_stock_after:Record<string,number>;
}

const rounded=(value:BigNumber|number,book:keyof Books)=>applyRounding(value,book==='sdg'?0:2);
const books=(amount:number,currency:string,rate:number):Books=>currency==='USD'
  ?{sdg:rounded(new BigNumber(amount).times(rate),'sdg'),usd:rounded(amount,'usd')}
  :{sdg:rounded(amount,'sdg'),usd:rate>0?rounded(new BigNumber(amount).dividedBy(rate),'usd'):0};
const add=(a:Books,b:Books):Books=>({sdg:rounded(new BigNumber(a.sdg).plus(b.sdg),'sdg'),usd:rounded(new BigNumber(a.usd).plus(b.usd),'usd')});
const sub=(a:Books,b:Books):Books=>({sdg:rounded(new BigNumber(a.sdg).minus(b.sdg),'sdg'),usd:rounded(new BigNumber(a.usd).minus(b.usd),'usd')});
const safeKey=(value:string)=>identifier(value).replace(/[^a-zA-Z0-9_-]/g,'-');
const tagged=(line:JournalEntryLine,branch_id:string)=>branch_id==='main'?line:{...line,branch_id};

/**
 * Produces the deterministic, read-only accounting plan for historical sales.
 * Persistence and cross-collection reconciliation intentionally remain a later
 * atomic transaction: callers can inspect this complete plan without writes.
 */
export function buildHistoricalSalesImportPlan(input:HistoricalSalesPlanInput):HistoricalSalesImportPlan{
  identifier(input.org_id);identifier(input.actor_id);const session=safeKey(input.session_id);dateOnly(input.created_at);
  ensure(Array.isArray(input.rows)&&input.rows.length>0,'خطة المبيعات التاريخية تتطلب صفاً واحداً على الأقل.');
  const existingIds=new Set(input.existing_ids||[]),invoiceNumbers=new Set(input.existing_invoice_numbers||[]),productMap=new Map(input.products.map(product=>[identifier(product.id),{...product}]));
  const result:HistoricalSalesImportPlan={invoices:[],payments:[],inventory_movements:[],journal_entries:[],product_stock_after:{}};
  const rows=[...input.rows].sort((a,b)=>dateOnly(a.date).localeCompare(dateOnly(b.date))||a.row_number-b.row_number);
  for(const row of rows){
    ensure(row.kind==='invoice','خطة المبيعات التاريخية تقبل فواتير البيع فقط.');
    const evidence=input.evidence_by_row[row.row_number];validateHistoricalDocumentEvidence(row,evidence,input.evidence_context);
    const prefix=`hist-${session}-${row.row_number}`,invoiceId=`inv-${prefix}`,journalId=`jv-inv-${prefix}`;
    ensure(!existingIds.has(invoiceId)&&!existingIds.has(journalId),'معرف مبيعات تاريخي موجود مسبقاً.');
    ensure(!invoiceNumbers.has(row.reference),'رقم فاتورة تاريخية موجود مسبقاً.');invoiceNumbers.add(row.reference);
    const net=books(evidence.lines.reduce((sum,line)=>sum.plus(line.net),new BigNumber(0)).toNumber(),row.currency,evidence.exchange_rate_used);
    const tax=books(evidence.lines.reduce((sum,line)=>sum.plus(line.tax),new BigNumber(0)).toNumber(),row.currency,evidence.exchange_rate_used);
    const total=add(net,tax),nativeTotal=row.total||0;
    let remaining={...total},paid:Books={sdg:0,usd:0};
    const payments:HistoricalSalesPaymentPlan[]=[];
    for(const [index,payment] of (evidence.payments||[]).entries()){
      const id=`pay-${prefix}-${index+1}`;ensure(!existingIds.has(id),'معرف تحصيل تاريخي موجود مسبقاً.');
      const cash=books(payment.amount,row.currency,payment.exchange_rate_used);
      const nativeRemaining=nativeTotal-(evidence.payments||[]).slice(0,index).reduce((sum,item)=>sum+item.amount,0);
      const final=payment.amount===nativeRemaining;
      const settled:Books=final?{...remaining}:{
        sdg:rounded(new BigNumber(remaining.sdg).times(payment.amount).dividedBy(nativeRemaining),'sdg'),
        usd:rounded(new BigNumber(remaining.usd).times(payment.amount).dividedBy(nativeRemaining),'usd')
      };
      ensure(settled.sdg<=remaining.sdg&&settled.usd<=remaining.usd,'تخصيص التحصيل التاريخي يتجاوز الرصيد الدفتري.');
      remaining=sub(remaining,settled);paid=add(paid,settled);
      payments.push({id,invoice_id:invoiceId,date:dateOnly(payment.date),reference:payment.reference,account_code:identifier(payment.account_code),currency:row.currency as 'SDG'|'USD',amount:payment.amount,exchange_rate_used:payment.exchange_rate_used,cash,settled,historical_import_session_id:input.session_id,historical_import_row_number:row.row_number});
    }
    const cogs=books(evidence.lines.reduce((sum,line)=>sum.plus(line.cogs||0),new BigNumber(0)).toNumber(),row.currency,evidence.exchange_rate_used);
    let costRemaining={...cogs};
    const plannedLines=evidence.lines.map((line,index)=>{
      ensure(Boolean(line.product_id)||(line.cogs||0)===0,'تكلفة البيع التاريخية تتطلب منتج مخزون موثقاً.');
      const last=index===evidence.lines.length-1,totalCost=last?{...costRemaining}:books(line.cogs||0,row.currency,evidence.exchange_rate_used);
      ensure(totalCost.sdg<=costRemaining.sdg&&totalCost.usd<=costRemaining.usd,'توزيع تكلفة البيع التاريخية يتجاوز الإجمالي.');
      costRemaining=sub(costRemaining,totalCost);
      return{...line,id:`line-${index+1}`,total_cost:totalCost};
    });
    ensure(costRemaining.sdg===0&&costRemaining.usd===0,'توزيع تكلفة البيع التاريخية غير متوازن.');
    const invoice:HistoricalSalesInvoicePlan={id:invoiceId,invoice_number:row.reference,customer_id:evidence.party_id,issue_date:dateOnly(row.date),due_date:dateOnly(evidence.due_date),branch_id:row.branch_id,revenue_account_code:row.account_code||'4100',currency:row.currency as 'SDG'|'USD',exchange_rate_used:evidence.exchange_rate_used,subtotal:net,tax,total,paid,remaining,status:(remaining.sdg===0&&remaining.usd===0)?'paid':(paid.sdg||paid.usd)?'partially_paid':'sent',cogs,historical_import_session_id:input.session_id,historical_import_row_number:row.row_number,lines:plannedLines};
    const invoiceLines=[tagged(journalLine('1200','ذمم العملاء',total.sdg,0,total.usd,0),row.branch_id),tagged(journalLine(row.account_code||'4100','إيراد المبيعات',0,net.sdg,0,net.usd),row.branch_id)];
    if(tax.sdg||tax.usd)invoiceLines.push(tagged(journalLine(evidence.tax_account_code!,'ضريبة المبيعات المستحقة',0,tax.sdg,0,tax.usd),row.branch_id));
    if(cogs.sdg||cogs.usd)invoiceLines.push(tagged(journalLine('5100','تكلفة البضاعة المباعة',cogs.sdg,0,cogs.usd,0),row.branch_id),tagged(journalLine('1300','المخزون',0,cogs.sdg,0,cogs.usd),row.branch_id));
    validateJournal(invoiceLines);result.journal_entries.push({...journal(journalId,input.org_id,input.actor_id,invoice.issue_date,'invoice',invoiceId,`استيراد الفاتورة التاريخية ${row.reference}`,invoiceLines,evidence.exchange_rate_used),historical_import_session_id:input.session_id,historical_import_row_numbers:[row.row_number]});
    const movementGroups=new Map<string,{quantity:BigNumber;cost:Books;first:number}>();
    for(const [index,line] of plannedLines.entries())if(line.product_id){
      const old=movementGroups.get(line.product_id)||{quantity:new BigNumber(0),cost:{sdg:0,usd:0},first:index};
      movementGroups.set(line.product_id,{quantity:old.quantity.plus(line.quantity),cost:add(old.cost,line.total_cost),first:old.first});
    }
    for(const [productId,movement] of [...movementGroups].sort((a,b)=>a[1].first-b[1].first)){
      const product=productMap.get(productId);ensure(product?.track_inventory,'منتج الفاتورة التاريخية غير متتبع في المخزون.');
      const quantity=movement.quantity.decimalPlaces(6).toNumber();ensure(product.stock_quantity>=quantity,`المخزون التاريخي غير كافٍ للمنتج: ${product.name}`);
      const previous=product.stock_quantity;product.stock_quantity=new BigNumber(previous).minus(quantity).decimalPlaces(6).toNumber();
      const id=`mov-${prefix}-${movement.first+1}`;ensure(!existingIds.has(id),'معرف حركة مخزون تاريخية موجود مسبقاً.');
      result.inventory_movements.push({id,product_id:product.id,product_name:product.name,quantity:-quantity,previous_stock:previous,resulting_stock:product.stock_quantity,value_delta:{sdg:-movement.cost.sdg,usd:-movement.cost.usd},journal_id:journalId,reference_id:invoiceId,historical_import_session_id:input.session_id,historical_import_row_number:row.row_number});
    }
    for(const payment of payments){
      const lines=[tagged(journalLine(payment.account_code,'النقد والبنوك',payment.cash.sdg,0,payment.cash.usd,0),row.branch_id),tagged(journalLine('1200','ذمم العملاء',0,payment.settled.sdg,0,payment.settled.usd),row.branch_id)];
      const delta=sub(payment.cash,payment.settled);
      if(delta.sdg>0||delta.usd>0)lines.push(tagged(journalLine('4200','أرباح فروق العملة',0,Math.max(0,delta.sdg),0,Math.max(0,delta.usd)),row.branch_id));
      if(delta.sdg<0||delta.usd<0)lines.push(tagged(journalLine('5500','خسائر فروق العملة',Math.max(0,-delta.sdg),0,Math.max(0,-delta.usd),0),row.branch_id));
      validateJournal(lines);result.journal_entries.push({...journal(`jv-${payment.id}`,input.org_id,input.actor_id,payment.date,'payment',payment.id,`تحصيل الفاتورة التاريخية ${row.reference}`,lines,payment.exchange_rate_used),historical_import_session_id:input.session_id,historical_import_row_numbers:[row.row_number]});
    }
    result.invoices.push(invoice);result.payments.push(...payments);
  }
  for(const product of productMap.values())result.product_stock_after[product.id]=product.stock_quantity;
  return result;
}
