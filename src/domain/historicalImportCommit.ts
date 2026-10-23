import BigNumber from 'bignumber.js';
import type { Account, Invoice, InventoryMovement, JournalEntry, JournalEntryLine, MerchantSettings, Payment, Product } from '../types';
import type { Document } from './store';
import { invoiceFinancials, journal } from './financial';
import { largeImportStagingSha256 } from './largeImportEvidence';
import { financialCollections, reconcileFinancialData, type FinancialData, type Finding } from './reconciliation';
import { dateOnly, ensure, identifier, text, validateJournal } from './validation';
import { validateHistoricalImport, type HistoricalImportContext, type HistoricalImportRow } from './historicalImport';
import { buildHistoricalSalesImportPlan, type HistoricalSalesImportPlan } from './historicalSalesImportPlan';
import type { HistoricalDocumentEvidence } from './historicalDocumentEvidence';
import { classifyAccount } from './accountClassification';
import { costState, validateCostState } from './inventoryCost';
import { salesTaxSourceQuote } from './salesTaxSources';
import { buildHistoricalPurchaseWrites } from './historicalPurchaseCommit';

export interface HistoricalImportCommitInput {
  id:string;
  expected_rows_sha256:string;
  expected_validation_context_sha256:string;
  expected_document_evidence_sha256?:string;
  reason:string;
}

export interface HistoricalImportCommitContext {
  orgId:string;
  actorUid:string;
  operationId:string;
  committedAt:string;
  settings:MerchantSettings;
  validation:HistoricalImportContext;
  accounts:Account[];
  dimensionKinds:Record<string,'cost_center'|'project'>;
  financialData:FinancialData;
}

export interface HistoricalSalesCommitWrites {
  invoices:Invoice[];
  payments:Payment[];
  inventoryMovements:InventoryMovement[];
  products:Product[];
  customers:Document[];
  invoiceNumbers:Array<{invoice_number:string;invoice_id:string}>;
}

export function assertHistoricalImportCommitPayload(value:unknown):asserts value is HistoricalImportCommitInput {
  ensure(Boolean(value)&&typeof value==='object'&&!Array.isArray(value),'بيانات اعتماد الاستيراد التاريخي غير صالحة.');
  const input=value as HistoricalImportCommitInput;
  ensure(Object.keys(input).every(key=>['id','expected_rows_sha256','expected_validation_context_sha256','expected_document_evidence_sha256','reason'].includes(key)),'حقول اعتماد الاستيراد التاريخي غير صالحة أو محمية.');
  identifier(input.id);text(input.reason,1000,true);
  ensure(/^[a-f0-9]{64}$/i.test(input.expected_rows_sha256)&&/^[a-f0-9]{64}$/i.test(input.expected_validation_context_sha256),'بصمة اعتماد الاستيراد التاريخي غير صالحة.');
  if(input.expected_document_evidence_sha256!==undefined)ensure(/^[a-f0-9]{64}$/i.test(input.expected_document_evidence_sha256),'بصمة دليل المستندات التاريخية غير صالحة.');
}

const bookAmount=(currency:string,value:number)=>currency==='SDG'?{sdg:value,usd:0}:{sdg:0,usd:value};
const groupKey=(row:HistoricalImportRow)=>JSON.stringify([dateOnly(row.date),row.currency,row.branch_id,[...(row.dimensions||[])].sort()]);

function decorate(line:JournalEntryLine,row:HistoricalImportRow,kinds:Record<string,'cost_center'|'project'>):JournalEntryLine {
  const dimensions=Object.fromEntries((row.dimensions||[]).map(id=>{ensure(Boolean(kinds[id]),'نوع البعد المحاسبي التاريخي غير معروف.',409);return[`${kinds[id]}_id`,id];}));
  return {...line,...(row.branch_id!=='main'?{branch_id:row.branch_id}:{}),...dimensions};
}

function reconciliationSummary(findings:Finding[]){
  const failed=(...collections:string[])=>findings.some(row=>collections.includes(row.collection));
  return {
    trial_balance:!failed('journal_entries','accounts'),
    ar_reconciled:!failed('customers','invoices','payments','credit_notes','customer_refunds')&&!findings.some(row=>row.id==='AR-control'),
    ap_reconciled:!failed('suppliers','purchase_bills','supplier_payments','purchase_returns','supplier_refunds')&&!findings.some(row=>row.id==='AP-control'),
    inventory_reconciled:!failed('products','inventory_movements')&&!findings.some(row=>row.id==='Inventory-control'),
    cash_reconciled:!failed('financial_accounts','bank_reconciliations','cash_reconciliations','internal_transfers'),
  };
}

type BookAmount={sdg:number;usd:number};
const taxConfigurationFields=['schema_version','org_id','revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active'] as const;
const addBooks=(left:BookAmount,right:BookAmount):BookAmount=>({sdg:new BigNumber(left.sdg).plus(right.sdg).toNumber(),usd:new BigNumber(left.usd).plus(right.usd).toNumber()});

function paymentMethod(code:string,currency:string):Payment['payment_method']{
  if(code===(currency==='USD'?'1120':'1110'))return'cash';
  if(code==='1130')return'bankak';
  if(code==='1140')return'fawry';
  if(code==='1150')return'bank_transfer';
  ensure(false,'حساب التحصيل التاريخي غير مدعوم في سندات القبض الأصلية؛ استخدم حساب نقد/بنك معيارياً.',409);
  return'other';
}

function postingGroup(code:string,revenueCodes:Set<string>,taxCodes:Set<string>){
  if(code==='1200')return'receivables';if(code==='1300')return'inventory';if(code==='5100')return'cogs';
  if(code==='4200')return'fx_gain';if(code==='5500')return'fx_loss';if(revenueCodes.has(code))return'sales';
  if(taxCodes.has(code))return'tax_payable';return'cash_bank';
}

function historicalTaxEvidence(plan:HistoricalSalesImportPlan['invoices'][number],evidence:HistoricalDocumentEvidence,items:Invoice['items'],context:HistoricalImportCommitContext){
  if(!plan.tax.sdg&&!plan.tax.usd)return undefined;
  const matches=context.financialData.tax_configuration_versions.filter(row=>row.version_hash===evidence.tax_configuration_version_hash);
  ensure(matches.length===1,'بصمة إعداد الضريبة التاريخية لا تطابق إصداراً واحداً محفوظاً.',409);
  const version=matches[0],configurationId=identifier(version.configuration_id);
  ensure(context.financialData.tax_configurations.some(row=>row.id===configurationId),'إعداد الضريبة التاريخي لم يعد مرتبطاً بسلسلة إعداد محفوظة.',409);
  const configuration={id:configurationId,...Object.fromEntries(taxConfigurationFields.map(key=>[key,version[key]]))};
  const currencyMode:Invoice['currency_mode']=plan.currency==='USD'?'single_usd':plan.exchange_rate_used>0?'dual':'single_sdg';
  const quote=salesTaxSourceQuote({configuration_id:configurationId,expected_configuration_revision:version.revision,issue_date:plan.issue_date,currency_mode:currencyMode,exchange_rate_used:plan.exchange_rate_used,discount_type:'fixed',discount_value:0,items},{org_id:context.orgId,configurations:[configuration as never],accounts:context.accounts},context.settings);
  ensure(quote.tax_account_code===evidence.tax_account_code,'دليل الضريبة التاريخي لا يطابق الحساب أو سياسة الإصدار المحفوظة.',409);
  ensure(new BigNumber(quote.sdg.base).eq(plan.subtotal.sdg)&&new BigNumber(quote.sdg.tax).eq(plan.tax.sdg)&&new BigNumber(quote.sdg.total).eq(plan.total.sdg)&&new BigNumber(quote.usd.base).eq(plan.subtotal.usd)&&new BigNumber(quote.usd.tax).eq(plan.tax.usd)&&new BigNumber(quote.usd.total).eq(plan.total.usd),'قيم الضريبة التاريخية لا تطابق الإصدار المحفوظ.',409);
  return{...quote,configuration_version_hash:version.version_hash};
}

function buildNativeSalesWrites(plan:HistoricalSalesImportPlan,evidenceByRow:Record<number,HistoricalDocumentEvidence>,context:HistoricalImportCommitContext):HistoricalSalesCommitWrites{
  const customerIndex=new Map(context.financialData.customers.map(row=>[row.id,row]));
  const productIndex=new Map(context.financialData.products.map(row=>[row.id,row as unknown as Product]));
  ensure(plan.invoices.every(invoice=>invoice.revenue_account_code==='4100'),'الاعتماد الأصلي للمبيعات التاريخية يتطلب حساب إيراد المبيعات النظامي 4100.',409);
  const revenueCodes=new Set(['4100']);
  const taxCodes=new Set<string>();
  const invoices:Invoice[]=[],payments:Payment[]=[],movements:InventoryMovement[]=[];
  const invoiceNumbers:Array<{invoice_number:string;invoice_id:string}>=[];
  for(const planned of plan.invoices){
    const evidence=evidenceByRow[planned.historical_import_row_number];ensure(evidence,'دليل الفاتورة التاريخية مفقود عند الاعتماد.',409);
    const customer=customerIndex.get(planned.customer_id);ensure(customer,'عميل الفاتورة التاريخية غير موجود.',409);
    const version=evidence.tax_configuration_version_hash?context.financialData.tax_configuration_versions.find(row=>row.version_hash===evidence.tax_configuration_version_hash):undefined;
    const inclusive=Boolean(version&&version.calculation==='inclusive');
    const decimals=planned.currency==='USD'?2:0;
    const items:Invoice['items']=planned.lines.map(line=>{
      const sourceAmount=new BigNumber(line.net).plus(inclusive?line.tax:0),unitPrice=sourceAmount.dividedBy(line.quantity).decimalPlaces(decimals,BigNumber.ROUND_HALF_UP);
      ensure(unitPrice.times(line.quantity).decimalPlaces(decimals,BigNumber.ROUND_HALF_UP).eq(sourceAmount),'صافي بند الفاتورة التاريخية لا يمكن تمثيله بسعر وحدة أصلي دون اختلاق تقريب.',409);
      const product=line.product_id?productIndex.get(line.product_id):undefined;if(line.product_id)ensure(product,'منتج الفاتورة التاريخية غير موجود.',409);
      return{id:line.id,...(line.product_id?{product_id:line.product_id}:{}),description:line.description,unit:product?.unit||'قطعة',quantity:line.quantity,unit_price:unitPrice.toNumber(),currency:planned.currency,tax_rate:0,discount_percent:0,line_total:sourceAmount.toNumber(),cost_status:line.product_id?'valued':'not_tracked',...(line.product_id?{unit_cost_sdg:new BigNumber(line.total_cost.sdg).div(line.quantity).decimalPlaces(12).toNumber(),unit_cost_usd:new BigNumber(line.total_cost.usd).div(line.quantity).decimalPlaces(12).toNumber(),total_cost_sdg:line.total_cost.sdg,total_cost_usd:line.total_cost.usd,cost_recorded_at:context.committedAt}:{})};
    });
    const taxEvidence=historicalTaxEvidence(planned,evidence,items,context);
    if(evidence.tax_account_code)taxCodes.add(evidence.tax_account_code);
    const currencyMode:Invoice['currency_mode']=planned.currency==='USD'?'single_usd':planned.exchange_rate_used>0?'dual':'single_sdg';
    const invoice:Invoice={id:planned.id,invoice_number:planned.invoice_number,customer_id:planned.customer_id,customer_name:String(customer.name||planned.customer_id),customer_phone:String(customer.phone||''),customer_address:String(customer.address||''),issue_date:planned.issue_date,due_date:planned.due_date,status:planned.status,currency_mode:currencyMode,receivable_currency:planned.currency,exchange_rate_used:planned.exchange_rate_used,items,subtotal_sdg:planned.subtotal.sdg,subtotal_usd:planned.subtotal.usd,discount_type:'fixed',discount_value:0,discount_total_sdg:0,discount_total_usd:0,tax_total_sdg:planned.tax.sdg,tax_total_usd:planned.tax.usd,grand_total_sdg:planned.total.sdg,grand_total_usd:planned.total.usd,paid_amount_sdg:planned.paid.sdg,paid_amount_usd:planned.paid.usd,remaining_sdg:planned.remaining.sdg,remaining_usd:planned.remaining.usd,credit_balance_sdg:0,credit_balance_usd:0,credited_amount_sdg:0,credited_amount_usd:0,refunded_amount_sdg:0,refunded_amount_usd:0,source_event_sequence:plan.payments.filter(payment=>payment.invoice_id===planned.id).length,correction_count:0,costing_status:'complete',costing_version:2,cogs_sdg:planned.cogs.sdg,cogs_usd:planned.cogs.usd,...(taxEvidence?{tax_evidence:taxEvidence}:{}),org_id:context.orgId,branch_id:planned.branch_id,created_by:context.actorUid,created_at:planned.issue_date,updated_at:context.committedAt,schema_version:3,operation_id:context.operationId,historical_import_session_id:planned.historical_import_session_id,historical_import_row_number:planned.historical_import_row_number} as Invoice;
    if(!taxEvidence){const calculated=invoiceFinancials(invoice,context.settings);for(const field of ['subtotal_sdg','subtotal_usd','tax_total_sdg','tax_total_usd','grand_total_sdg','grand_total_usd'] as const)ensure(new BigNumber(calculated[field]).eq(invoice[field]),'بنود الفاتورة التاريخية لا تعيد إنتاج إجمالياتها الأصلية.',409);}
    invoices.push(invoice);invoiceNumbers.push({invoice_number:invoice.invoice_number,invoice_id:invoice.id});
  }
  for(const planned of plan.payments){
    const invoice=invoices.find(row=>row.id===planned.invoice_id)!;const customer=customerIndex.get(invoice.customer_id)!;
    const sameInvoice=plan.payments.filter(row=>row.invoice_id===planned.invoice_id),sequence=sameInvoice.findIndex(row=>row.id===planned.id)+1;
    payments.push({id:planned.id,invoice_id:invoice.id,invoice_number:invoice.invoice_number,customer_id:invoice.customer_id,customer_name:String(customer.name||invoice.customer_id),amount:planned.amount,currency:planned.currency,exchange_rate_used:planned.exchange_rate_used,amount_in_other_currency:planned.currency==='USD'?planned.cash.sdg:planned.cash.usd,payment_method:paymentMethod(planned.account_code,planned.currency),reference_number:planned.reference,payment_date:planned.date,operation_id:context.operationId,idempotency_key:`${context.operationId}-${planned.id}`,settled_amount_sdg:planned.settled.sdg,settled_amount_usd:planned.settled.usd,cash_amount_sdg:planned.cash.sdg,cash_amount_usd:planned.cash.usd,source_sequence:sequence,org_id:context.orgId,branch_id:invoice.branch_id,created_by:context.actorUid,created_at:planned.date,schema_version:3,historical_import_session_id:planned.historical_import_session_id,historical_import_row_number:planned.historical_import_row_number} as Payment);
  }
  const productUpdates=new Map<string,Product>();
  for(const planned of plan.inventory_movements){
    const product=productUpdates.get(planned.product_id)||productIndex.get(planned.product_id);ensure(product,'منتج حركة البيع التاريخية غير موجود.',409);
    const before=validateCostState(product),invoice=invoices.find(row=>row.id===planned.reference_id)!;
    ensure(new BigNumber(before.stock_quantity).eq(planned.previous_stock),'كمية المنتج تغيرت أثناء تخطيط الاستيراد التاريخي.',409);
    const valueSdg=new BigNumber(before.inventory_value_sdg).plus(planned.value_delta.sdg),valueUsd=new BigNumber(before.inventory_value_usd).plus(planned.value_delta.usd);
    ensure(valueSdg.gte(0)&&valueUsd.gte(0),'تكلفة البيع التاريخية تتجاوز قيمة المخزون الحالية.',409);
    const lastDate=[before.cost_last_movement_date,invoice.issue_date].sort().at(-1)!;
    const after=costState(planned.resulting_stock,valueSdg.toNumber(),valueUsd.toNumber(),before.cost_effective_date,lastDate);
    productUpdates.set(product.id,{...product,...after});
    movements.push({id:planned.id,product_id:planned.product_id,product_name:planned.product_name,type:'SALE',quantity:planned.quantity,previous_stock:planned.previous_stock,resulting_stock:planned.resulting_stock,reference_type:'invoice',reference_id:planned.reference_id,value_delta_sdg:planned.value_delta.sdg,value_delta_usd:planned.value_delta.usd,unit_cost_sdg:new BigNumber(-planned.value_delta.sdg).dividedBy(-planned.quantity).decimalPlaces(12).toNumber(),unit_cost_usd:new BigNumber(-planned.value_delta.usd).dividedBy(-planned.quantity).decimalPlaces(12).toNumber(),costing_version:2,journal_id:planned.journal_id,operation_id:context.operationId,org_id:context.orgId,branch_id:invoice.branch_id,created_by:context.actorUid,created_at:invoice.issue_date,schema_version:3,historical_import_session_id:planned.historical_import_session_id,historical_import_row_number:planned.historical_import_row_number} as InventoryMovement);
  }
  const customerTotals=new Map<string,BookAmount>();for(const invoice of invoices)customerTotals.set(invoice.customer_id,addBooks(customerTotals.get(invoice.customer_id)||{sdg:0,usd:0},{sdg:invoice.remaining_sdg,usd:invoice.remaining_usd}));
  const customers=[...customerTotals].map(([id,delta])=>{const customer=customerIndex.get(id)!;return{...customer,balance_sdg:new BigNumber(customer.balance_sdg||0).plus(delta.sdg).toNumber(),balance_usd:new BigNumber(customer.balance_usd||0).plus(delta.usd).toNumber(),...(customer.receivable_due_sdg!==undefined?{receivable_due_sdg:new BigNumber(customer.receivable_due_sdg).plus(delta.sdg).toNumber()}:{}),...(customer.receivable_due_usd!==undefined?{receivable_due_usd:new BigNumber(customer.receivable_due_usd).plus(delta.usd).toNumber()}:{}),updated_at:context.committedAt};});
  const accountIndex=new Map(context.accounts.map(account=>[account.code,account]));for(const entry of plan.journal_entries)for(const line of entry.lines){const account=accountIndex.get(line.account_code),expected=postingGroup(line.account_code,revenueCodes,taxCodes);ensure(account?.is_active&&classifyAccount(account).reporting_group===expected,`تصنيف حساب الخطة التاريخية غير صالح: ${line.account_code}`,409);}
  return{invoices,payments,inventoryMovements:movements,products:[...productUpdates.values()],customers,invoiceNumbers};
}

/**
 * Builds a bounded, deterministic posting plan. The caller persists every returned
 * journal and the updated session in the same transaction.
 *
 * Native documents require reviewed evidence and a zero-finding proposed state.
 * Mixed sales/purchase sessions remain blocked until a unified cost replay exists.
 */
export async function buildHistoricalImportCommit(input:HistoricalImportCommitInput,session:Document,staging:Document,context:HistoricalImportCommitContext){
  assertHistoricalImportCommitPayload(input);
  ensure(session&&staging&&session.id===input.id&&staging.session_id===session.id,'جلسة وstaging الاستيراد التاريخي غير متطابقين.',409);
  ensure(session.org_id===context.orgId&&staging.org_id===context.orgId,'جلسة الاستيراد التاريخي من مؤسسة أخرى.',409);
  ensure(session.status==='staged'&&!session.accounting_block,'الاستيراد التاريخي غير جاهز للاعتماد أو يحمل فرقاً محاسبياً.',409);
  ensure(session.schema_version===1&&staging.schema_version===1,'إصدار الاستيراد التاريخي غير مدعوم.');
  ensure(session.rows_sha256===input.expected_rows_sha256&&session.validation_context_sha256===input.expected_validation_context_sha256,'تغير دليل المعاينة؛ أعد فتح الجلسة وراجعها.',409);
  ensure(staging.rows_sha256===session.rows_sha256&&staging.validation_context_sha256===session.validation_context_sha256,'دليل staging التاريخي لا يطابق الجلسة.',409);
  ensure(Array.isArray(staging.rows)&&staging.rows.length>0&&staging.rows.length<=200,'الاعتماد الذري يدعم حتى 200 صف؛ قسّم الملف إلى دفعات أصغر.',413);
  const rows=structuredClone(staging.rows) as HistoricalImportRow[];
  ensure(await largeImportStagingSha256(rows as unknown as Document[])===session.rows_sha256,'بصمة صفوف staging التاريخي مختلفة.',409);
  ensure(await largeImportStagingSha256([staging.validation_basis])===session.validation_context_sha256,'بصمة سياق staging التاريخي مختلفة.',409);
  const documentRows=rows.filter(row=>row.kind==='invoice'||row.kind==='purchase');
  if(documentRows.length){
    ensure(Boolean(input.expected_document_evidence_sha256),'اعتماد المستندات التاريخية يتطلب بصمة دليل المستندات المراجع.',409);
    ensure(session.document_evidence_sha256===input.expected_document_evidence_sha256&&staging.document_evidence_sha256===input.expected_document_evidence_sha256,'تغير دليل المستندات التاريخية؛ أعد فتح الجلسة وراجعها.',409);
    ensure(await largeImportStagingSha256([staging.document_evidence as Document])===input.expected_document_evidence_sha256,'بصمة دليل المستندات التاريخية مختلفة.',409);
  }
  const validation=validateHistoricalImport(rows,context.validation);
  ensure(validation.can_stage&&!validation.accounting_block,'تغيرت بيانات المؤسسة أو ظهرت فروقات؛ أعد التحقق وأنشئ staging جديداً.',409);
  ensure(!(documentRows.some(row=>row.kind==='purchase')&&documentRows.some(row=>row.kind==='invoice')),'افصل المبيعات والمشتريات التاريخية لضمان تسلسل تكلفة المخزون.',409);
  ensure(!documentRows.some(row=>(row.dimensions||[]).length),'أبعاد المستندات التاريخية تحتاج خطة ترحيل موثقة.',409);
  const baseline=reconcileFinancialData(context.financialData,context.settings,{requireCosting:true});
  ensure(!baseline.length,'الدفاتر الحالية تحتوي فروقات؛ أصلحها قبل اعتماد استيراد تاريخي جديد.',409);
  const invoiceRows=rows.filter(row=>row.kind==='invoice'),evidenceByRow=(staging.document_evidence||{}) as Record<number,HistoricalDocumentEvidence>;
  const existingIds=[...context.financialData.invoices,...context.financialData.payments,...context.financialData.inventory_movements,...context.financialData.journal_entries].map(row=>row.id);
  const salesPlan=invoiceRows.length?buildHistoricalSalesImportPlan({org_id:context.orgId,actor_id:context.actorUid,session_id:session.id,created_at:context.committedAt,rows:invoiceRows,evidence_by_row:evidenceByRow,evidence_context:{customers:context.financialData.customers.map(row=>row.id),suppliers:context.financialData.suppliers.map(row=>row.id),products:context.financialData.products.map(row=>row.id),accounts:context.accounts.filter(account=>account.is_active).map(account=>account.code)},products:context.financialData.products.map(row=>({id:row.id,name:String(row.name||row.id),stock_quantity:Number(row.stock_quantity||0),track_inventory:Boolean(row.track_inventory)})),existing_ids:existingIds,existing_invoice_numbers:context.financialData.invoices.map(row=>row.invoice_number)}):undefined;
  const nativeSales=salesPlan?buildNativeSalesWrites(salesPlan,evidenceByRow,context):undefined;
  const purchaseRows=rows.filter(row=>row.kind==='purchase');
  const nativePurchases=purchaseRows.length?buildHistoricalPurchaseWrites(purchaseRows,evidenceByRow,context,session.id):undefined;

  const accountIndex=new Map(context.accounts.map(account=>[account.code,account]));
  const line=(code:string,debit:number,credit:number,currency:string,row:HistoricalImportRow)=>{
    const account=accountIndex.get(code);ensure(account?.is_active,'حساب الاعتماد التاريخي غير موجود أو غير نشط.',409);
    const amount=bookAmount(currency,debit||credit);
    return decorate({account_code:code,account_name:account.name_ar||account.name_en||code,debit_sdg:debit?amount.sdg:0,credit_sdg:credit?amount.sdg:0,debit_usd:debit?amount.usd:0,credit_usd:credit?amount.usd:0},row,context.dimensionKinds);
  };
  const prefix=session.rows_sha256.slice(0,16),postings:JournalEntry[]=[];
  for(const row of rows.filter(saved=>saved.kind==='journal').sort((a,b)=>a.row_number-b.row_number)){
    const lines=row.lines!.map(saved=>line(saved.account_code,saved.debit,saved.credit,row.currency,row));
    validateJournal(lines,context.settings);
    postings.push({...journal(`jv-hist-${prefix}-${row.row_number}`,context.orgId,context.actorUid,dateOnly(row.date),'manual',`hist-${prefix}-${row.row_number}`,`استيراد تاريخي: ${row.reference}`,lines),created_at:context.committedAt,historical_import_session_id:session.id,historical_import_row_numbers:[row.row_number],source_rows_sha256:session.rows_sha256});
  }
  const trialGroups=new Map<string,HistoricalImportRow[]>();
  for(const row of rows.filter(saved=>saved.kind==='trial_balance'))trialGroups.set(groupKey(row),[...(trialGroups.get(groupKey(row))||[]),row]);
  let group=0;
  for(const grouped of [...trialGroups.values()].sort((a,b)=>groupKey(a[0]).localeCompare(groupKey(b[0])))){
    ensure(grouped.length>=2&&grouped.length<=100,'كل مجموعة ميزان مراجعة تحتاج من طرفين إلى 100 طرف متزن؛ قسّم الملف حسب التاريخ والعملة والأبعاد.',409);
    const lines=grouped.sort((a,b)=>a.row_number-b.row_number).map(row=>line(row.account_code!,row.debit||0,row.credit||0,row.currency,row));
    validateJournal(lines,context.settings);group++;
    postings.push({...journal(`jv-hist-${prefix}-tb-${group}`,context.orgId,context.actorUid,dateOnly(grouped[0].date),'manual',`hist-${prefix}-tb-${group}`,`ميزان مراجعة تاريخي: ${grouped.map(row=>row.reference).join('، ')}`.slice(0,500),lines),created_at:context.committedAt,historical_import_session_id:session.id,historical_import_row_numbers:grouped.map(row=>row.row_number),source_rows_sha256:session.rows_sha256});
  }
  const allPostings=[...postings,...(salesPlan?.journal_entries||[]),...(nativePurchases?.postings||[])];
  ensure(allPostings.length>0&&allPostings.length<=400,'لم ينتج عن الجلسة قيود قابلة للاعتماد أو تجاوز عددها الحد الذري.',409);
  const existingJournalIds=new Set(context.financialData.journal_entries.map(row=>row.id));
  ensure(allPostings.every(entry=>!existingJournalIds.has(entry.id)),'سبق إنشاء قيد من هذه الجلسة؛ راجع سجل الاستيراد.',409);
  const nativeWriteCount=nativeSales?nativeSales.invoices.length+nativeSales.payments.length+nativeSales.inventoryMovements.length+nativeSales.products.length+nativeSales.customers.length+nativeSales.invoiceNumbers.length:0;
  const purchaseWriteCount=nativePurchases?nativePurchases.bills.length*2+nativePurchases.payments.length+nativePurchases.movements.length+nativePurchases.products.length+nativePurchases.suppliers.length:0;
  ensure(allPostings.length+nativeWriteCount+purchaseWriteCount<=400,'خطة الاعتماد التاريخي تتجاوز 400 كتابة مالية؛ قسّم الملف إلى دفعات أصغر.',413);
  const proposed=Object.fromEntries(financialCollections.map(name=>[name,[...(context.financialData[name]||[])]])) as FinancialData;
  proposed.journal_entries.push(...allPostings);
  if(nativeSales){
    proposed.invoices.push(...nativeSales.invoices);proposed.payments.push(...nativeSales.payments);proposed.inventory_movements.push(...nativeSales.inventoryMovements);
    for(const [collection,updates] of [['products',nativeSales.products],['customers',nativeSales.customers]] as const){const ids=new Set(updates.map(row=>row.id));proposed[collection]=[...proposed[collection].filter(row=>!ids.has(row.id)),...updates] as never;}
  }
  if(nativePurchases){
    proposed.purchase_bills.push(...nativePurchases.bills);proposed.supplier_payments.push(...nativePurchases.payments);proposed.inventory_movements.push(...nativePurchases.movements);
    for(const [collection,updates] of [['products',nativePurchases.products],['suppliers',nativePurchases.suppliers]] as const){const ids=new Set(updates.map(row=>row.id));proposed[collection]=[...proposed[collection].filter(row=>!ids.has(row.id)),...updates];}
  }
  const findings=reconcileFinancialData(proposed,context.settings,{requireCosting:true}),accountingBlock=findings.length>0;
  ensure(!nativePurchases||!accountingBlock,'خطة الشراء التاريخي لا تطابق AP أو المخزون أو الدفتر؛ لم تحفظ أي كتابة.',409);
  ensure(!nativeSales||!accountingBlock,'خطة المبيعات التاريخية لا تطابق المستندات الفرعية والدفتر؛ لم تُحفظ أي كتابة.',409);
  const reconciliation={checked_at:context.committedAt,findings_count:findings.length,findings:findings.slice(0,100),checks:reconciliationSummary(findings)};
  const updatedSession={...session,status:accountingBlock?'completed_accounting_block':'completed',completion_code:accountingBlock?'IMPORT_COMPLETED_WITH_ACCOUNTING_BLOCK':'IMPORT_COMPLETED',accounting_block:accountingBlock,rows_imported:rows.length,committed_by:context.actorUid,committed_at:context.committedAt,commit_operation_id:context.operationId,commit_journal_ids:allPostings.map(entry=>entry.id),commit_invoice_ids:nativeSales?.invoices.map(row=>row.id)||[],commit_payment_ids:nativeSales?.payments.map(row=>row.id)||[],commit_inventory_movement_ids:nativeSales?.inventoryMovements.map(row=>row.id)||[],reconciliation};
  Object.assign(updatedSession,{commit_purchase_bill_ids:nativePurchases?.bills.map(row=>row.id)||[],commit_supplier_payment_ids:nativePurchases?.payments.map(row=>row.id)||[]});
  updatedSession.commit_inventory_movement_ids.push(...(nativePurchases?.movements.map(row=>row.id)||[]));
  ensure(new TextEncoder().encode(JSON.stringify(updatedSession)).length<=620000,'إثبات اعتماد الاستيراد التاريخي يتجاوز الحد.',413);
  return{session:updatedSession,postings:allPostings,nativeSales,nativePurchases,result:{id:session.id,import_type:session.import_type,file_hash:session.file_hash,schema_version:session.schema_version,status:updatedSession.status,completion_code:updatedSession.completion_code,accounting_block:accountingBlock,rows_total:session.rows_total,rows_imported:rows.length,rows_failed:0,journals_created:allPostings.length,invoices_created:nativeSales?.invoices.length||0,payments_created:nativeSales?.payments.length||0,purchase_bills_created:nativePurchases?.bills.length||0,supplier_payments_created:nativePurchases?.payments.length||0,inventory_movements_created:updatedSession.commit_inventory_movement_ids.length,rows_sha256:session.rows_sha256,validation_context_sha256:session.validation_context_sha256,document_evidence_sha256:session.document_evidence_sha256,reconciliation}};
}
