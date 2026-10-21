import BigNumber from 'bignumber.js';
import { applyRounding } from '../lib/currency';
import type { JournalEntry, JournalEntryLine, Product } from '../types';
import { journal, journalLine } from './financial';
import type { HistoricalDocumentEvidence, HistoricalDocumentEvidenceContext } from './historicalDocumentEvidence';
import { validateHistoricalDocumentEvidence } from './historicalDocumentEvidence';
import type { HistoricalImportRow } from './historicalImport';
import { receiveCost, validateCostState, type InventoryCost } from './inventoryCost';
import { dateOnly, ensure, identifier, validateJournal } from './validation';

type Books={sdg:number;usd:number};
export interface HistoricalPurchaseProductState extends InventoryCost {id:string;name:string;is_active:boolean;track_inventory:true}
export interface HistoricalPurchasePlanInput {
  org_id:string;
  actor_id:string;
  session_id:string;
  created_at:string;
  rows:HistoricalImportRow[];
  evidence_by_row:Record<number,HistoricalDocumentEvidence>;
  evidence_context:HistoricalDocumentEvidenceContext;
  products:HistoricalPurchaseProductState[];
  existing_ids?:string[];
  /** Lower-case `supplier_id:reference` keys already reserved by native purchases. */
  existing_supplier_references?:string[];
}
export interface HistoricalPurchaseBillPlan {
  id:string;supplier_id:string;supplier_reference:string;issue_date:string;due_date:string;branch_id:string;
  currency:'SDG'|'USD';exchange_rate_used:number;inventory_value:Books;tax:Books;total:Books;paid:Books;remaining:Books;
  settlement:'credit';status:'open'|'partially_paid'|'paid';journal_id:string;
  historical_import_session_id:string;historical_import_row_number:number;
  lines:Array<HistoricalDocumentEvidence['lines'][number]&{id:string;unit_cost:number;value:Books}>;
}
export interface HistoricalSupplierPaymentPlan {
  id:string;bill_id:string;supplier_id:string;sequence:number;date:string;reference:string;account_code:string;
  currency:'SDG'|'USD';amount:number;exchange_rate_used:number;cash:Books;settled:Books;journal_id:string;
  historical_import_session_id:string;historical_import_row_number:number;
}
export interface HistoricalPurchaseInventoryMovementPlan {
  id:string;product_id:string;product_name:string;quantity:number;previous_stock:number;resulting_stock:number;
  value_delta:Books;average_cost_before:Books;average_cost_after:Books;journal_id:string;reference_id:string;
  historical_import_session_id:string;historical_import_row_number:number;
}
export interface HistoricalPurchaseImportPlan {
  bills:HistoricalPurchaseBillPlan[];
  payments:HistoricalSupplierPaymentPlan[];
  inventory_movements:HistoricalPurchaseInventoryMovementPlan[];
  journal_entries:JournalEntry[];
  product_cost_after:Record<string,InventoryCost>;
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
 * Produces the deterministic, read-only accounting plan for historical
 * purchases. The planner never replays a receipt before a product's last
 * proven cost movement: doing so would silently rewrite later WAC/COGS.
 */
export function buildHistoricalPurchaseImportPlan(input:HistoricalPurchasePlanInput):HistoricalPurchaseImportPlan{
  identifier(input.org_id);identifier(input.actor_id);const session=safeKey(input.session_id);dateOnly(input.created_at);
  ensure(Array.isArray(input.rows)&&input.rows.length>0,'خطة المشتريات التاريخية تتطلب صفاً واحداً على الأقل.');
  const accountCodes=new Set(input.evidence_context.accounts.map(code=>identifier(code)));
  ensure(accountCodes.has('1300')&&accountCodes.has('2110'),'سياق خطة المشتريات التاريخية يفتقد حساب المخزون أو ذمم الموردين.');
  const existingIds=new Set(input.existing_ids||[]),supplierReferences=new Set((input.existing_supplier_references||[]).map(value=>value.toLowerCase()));
  const productMap=new Map<string,HistoricalPurchaseProductState>();
  for(const source of input.products){
    const id=identifier(source.id);ensure(!productMap.has(id),'منتج مكرر في سياق خطة المشتريات التاريخية.');
    ensure(source.is_active&&source.track_inventory,'منتج الشراء التاريخي يجب أن يكون نشطاً ومتتبعاً في المخزون.');
    validateCostState(source as unknown as Product);productMap.set(id,structuredClone(source));
  }
  const result:HistoricalPurchaseImportPlan={bills:[],payments:[],inventory_movements:[],journal_entries:[],product_cost_after:{}};
  const rows=[...input.rows].sort((a,b)=>dateOnly(a.date).localeCompare(dateOnly(b.date))||a.row_number-b.row_number);
  for(const row of rows){
    ensure(row.kind==='purchase','خطة المشتريات التاريخية تقبل فواتير الشراء فقط.');
    ensure(row.currency==='SDG'||row.currency==='USD','عملة فاتورة الشراء التاريخية غير مدعومة.');
    ensure(row.account_code==='1300','فاتورة الشراء التاريخية يجب أن ترتبط بحساب المخزون 1300.');
    const evidence=input.evidence_by_row[row.row_number];validateHistoricalDocumentEvidence(row,evidence,input.evidence_context);
    const prefix=`hist-${session}-${row.row_number}`,billId=`pb-${prefix}`,journalId=`jv-purchase-${prefix}`;
    ensure(!existingIds.has(billId)&&!existingIds.has(journalId),'معرف شراء تاريخي موجود مسبقاً.');
    const referenceKey=`${evidence.party_id}:${row.reference.trim()}`.toLowerCase();
    ensure(!supplierReferences.has(referenceKey),'رقم فاتورة المورد التاريخية موجود مسبقاً.');supplierReferences.add(referenceKey);
    existingIds.add(billId);existingIds.add(journalId);

    const inventoryValue=books(evidence.lines.reduce((sum,line)=>sum.plus(line.inventory_value||0),new BigNumber(0)).toNumber(),row.currency,evidence.exchange_rate_used);
    const tax=books(evidence.lines.reduce((sum,line)=>sum.plus(line.tax),new BigNumber(0)).toNumber(),row.currency,evidence.exchange_rate_used);
    const total=add(inventoryValue,tax),nativeTotal=row.total||0,decimals=row.currency==='USD'?2:0;
    let remaining={...total},paid:Books={sdg:0,usd:0};
    const payments:HistoricalSupplierPaymentPlan[]=[];
    for(const [index,payment] of (evidence.payments||[]).entries()){
      const id=`sp-${prefix}-${index+1}`,paymentJournalId=`jv-supplier-pay-${prefix}-${index+1}`;
      ensure(!existingIds.has(id)&&!existingIds.has(paymentJournalId),'معرف سداد مورد تاريخي موجود مسبقاً.');existingIds.add(id);existingIds.add(paymentJournalId);
      const cash=books(payment.amount,row.currency,payment.exchange_rate_used);
      const nativeRemaining=new BigNumber(nativeTotal).minus((evidence.payments||[]).slice(0,index).reduce((sum,item)=>sum.plus(item.amount),new BigNumber(0)));
      const final=new BigNumber(payment.amount).eq(nativeRemaining);
      const settled:Books=final?{...remaining}:{
        sdg:rounded(new BigNumber(remaining.sdg).times(payment.amount).dividedBy(nativeRemaining),'sdg'),
        usd:rounded(new BigNumber(remaining.usd).times(payment.amount).dividedBy(nativeRemaining),'usd')
      };
      ensure(settled.sdg<=remaining.sdg&&settled.usd<=remaining.usd,'تخصيص سداد المورد التاريخي يتجاوز الرصيد الدفتري.');
      remaining=sub(remaining,settled);paid=add(paid,settled);
      payments.push({id,bill_id:billId,supplier_id:evidence.party_id,sequence:index+1,date:dateOnly(payment.date),reference:payment.reference,account_code:identifier(payment.account_code),currency:row.currency as 'SDG'|'USD',amount:payment.amount,exchange_rate_used:payment.exchange_rate_used,cash,settled,journal_id:paymentJournalId,historical_import_session_id:input.session_id,historical_import_row_number:row.row_number});
    }

    const plannedLines=evidence.lines.map((line,index)=>{
      const nativeValue=new BigNumber(line.inventory_value||0),unitCost=nativeValue.dividedBy(line.quantity).decimalPlaces(8,BigNumber.ROUND_HALF_UP);
      ensure(unitCost.times(line.quantity).decimalPlaces(decimals,BigNumber.ROUND_HALF_UP).eq(nativeValue),'قيمة بند الشراء التاريخي لا يمكن تمثيلها بتكلفة وحدة أصلية دون اختلاق تقريب.');
      return{...line,id:`line-${index+1}`,unit_cost:unitCost.toNumber(),value:books(nativeValue.toNumber(),row.currency,evidence.exchange_rate_used)};
    });
    const bill:HistoricalPurchaseBillPlan={id:billId,supplier_id:evidence.party_id,supplier_reference:row.reference,issue_date:dateOnly(row.date),due_date:dateOnly(evidence.due_date),branch_id:row.branch_id,currency:row.currency as 'SDG'|'USD',exchange_rate_used:evidence.exchange_rate_used,inventory_value:inventoryValue,tax,total,paid,remaining,settlement:'credit',status:(remaining.sdg===0&&remaining.usd===0)?'paid':(paid.sdg||paid.usd)?'partially_paid':'open',journal_id:journalId,historical_import_session_id:input.session_id,historical_import_row_number:row.row_number,lines:plannedLines};
    const purchaseLines=[tagged(journalLine('1300','المخزون',inventoryValue.sdg,0,inventoryValue.usd,0),row.branch_id)];
    if(tax.sdg||tax.usd)purchaseLines.push(tagged(journalLine(evidence.tax_account_code!,'ضريبة مشتريات مستردة',tax.sdg,0,tax.usd,0),row.branch_id));
    purchaseLines.push(tagged(journalLine('2110','ذمم الموردين',0,total.sdg,0,total.usd),row.branch_id));
    validateJournal(purchaseLines);result.journal_entries.push({...journal(journalId,input.org_id,input.actor_id,bill.issue_date,'purchase_bill',billId,`استيراد فاتورة الشراء التاريخية ${row.reference}`,purchaseLines,evidence.exchange_rate_used),historical_import_session_id:input.session_id,historical_import_row_numbers:[row.row_number]});

    const movementGroups=new Map<string,{quantity:BigNumber;value:Books;first:number}>();
    for(const [index,line] of plannedLines.entries()){
      const productId=identifier(line.product_id!),old=movementGroups.get(productId)||{quantity:new BigNumber(0),value:{sdg:0,usd:0},first:index};
      movementGroups.set(productId,{quantity:old.quantity.plus(line.quantity),value:add(old.value,line.value),first:old.first});
    }
    for(const [productId,movement] of [...movementGroups].sort((a,b)=>a[1].first-b[1].first)){
      const product=productMap.get(productId);ensure(product,'منتج الشراء التاريخي غير موجود في حالة التكلفة الحية.');
      const before=validateCostState(product as unknown as Product),quantity=movement.quantity.decimalPlaces(6).toNumber();
      ensure(bill.issue_date>=before.cost_last_movement_date,'تاريخ استلام الشراء التاريخي يسبق آخر حركة تكلفة موثقة؛ يلزم إعادة تشغيل تسلسل التكلفة كاملاً.');
      const after=receiveCost(product as unknown as Product,quantity,movement.value,bill.issue_date);
      const id=`mov-purchase-${prefix}-${movement.first+1}`;ensure(!existingIds.has(id),'معرف حركة استلام تاريخية موجود مسبقاً.');existingIds.add(id);
      result.inventory_movements.push({id,product_id:product.id,product_name:product.name,quantity,previous_stock:before.stock_quantity,resulting_stock:after.stock_quantity,value_delta:movement.value,average_cost_before:{sdg:before.average_cost_sdg,usd:before.average_cost_usd},average_cost_after:{sdg:after.average_cost_sdg,usd:after.average_cost_usd},journal_id:journalId,reference_id:billId,historical_import_session_id:input.session_id,historical_import_row_number:row.row_number});
      productMap.set(productId,{...product,...after});
    }
    for(const payment of payments){
      const lines=[tagged(journalLine('2110','ذمم الموردين',payment.settled.sdg,0,payment.settled.usd,0),row.branch_id),tagged(journalLine(payment.account_code,'النقد والبنوك',0,payment.cash.sdg,0,payment.cash.usd),row.branch_id)];
      const delta=sub(payment.cash,payment.settled);
      if(delta.sdg>0||delta.usd>0){ensure(accountCodes.has('5500'),'سياق خطة المشتريات التاريخية يفتقد حساب خسائر فروق العملة.');lines.push(tagged(journalLine('5500','خسائر فروق العملة',Math.max(0,delta.sdg),0,Math.max(0,delta.usd),0),row.branch_id));}
      if(delta.sdg<0||delta.usd<0){ensure(accountCodes.has('4200'),'سياق خطة المشتريات التاريخية يفتقد حساب أرباح فروق العملة.');lines.push(tagged(journalLine('4200','أرباح فروق العملة',0,Math.max(0,-delta.sdg),0,Math.max(0,-delta.usd)),row.branch_id));}
      validateJournal(lines);result.journal_entries.push({...journal(payment.journal_id,input.org_id,input.actor_id,payment.date,'supplier_payment',payment.id,`سداد فاتورة المورد التاريخية ${row.reference}`,lines,payment.exchange_rate_used),historical_import_session_id:input.session_id,historical_import_row_numbers:[row.row_number]});
    }
    result.bills.push(bill);result.payments.push(...payments);
  }
  for(const product of productMap.values())result.product_cost_after[product.id]=validateCostState(product as unknown as Product);
  return result;
}
