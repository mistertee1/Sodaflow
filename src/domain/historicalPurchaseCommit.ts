import BigNumber from 'bignumber.js';
import type { Product } from '../types';
import type { Document } from './store';
import type { HistoricalImportCommitContext } from './historicalImportCommit';
import type { HistoricalDocumentEvidence } from './historicalDocumentEvidence';
import type { HistoricalImportRow } from './historicalImport';
import { buildHistoricalPurchaseImportPlan } from './historicalPurchaseImportPlan';
import { purchaseTaxSourceQuote } from './purchaseTaxSources';
import { classifyAccount } from './accountClassification';
import { validateCostState } from './inventoryCost';
import { ensure } from './validation';
import { openingBalancesForParty } from './openingIntegration';

/** Converts reviewed evidence to native sources; the caller reconciles and persists atomically. */
export function buildHistoricalPurchaseWrites(rows:HistoricalImportRow[],evidence:Record<number,HistoricalDocumentEvidence>,c:HistoricalImportCommitContext,sessionId:string){
  const data=c.financialData,used=new Set(rows.flatMap(row=>evidence[row.row_number]?.lines.map(line=>line.product_id)||[]));
  const products=data.products.filter(row=>used.has(row.id)).map(row=>({id:row.id,name:String(row.name),is_active:Boolean(row.is_active),track_inventory:row.track_inventory as true,...validateCostState(row as Product)}));
  const plan=buildHistoricalPurchaseImportPlan({org_id:c.orgId,actor_id:c.actorUid,session_id:sessionId,created_at:c.committedAt,rows,evidence_by_row:evidence,evidence_context:{customers:data.customers.map(r=>r.id),suppliers:data.suppliers.map(r=>r.id),products:data.products.map(r=>r.id),accounts:c.accounts.filter(r=>r.is_active).map(r=>r.code)},products,existing_ids:[...data.purchase_bills,...data.supplier_payments,...data.inventory_movements,...data.journal_entries].map(r=>r.id),existing_supplier_references:data.purchase_bills.map(r=>`${r.supplier_id}:${r.supplier_reference}`)});
  const bills:Document[]=[],payments:Document[]=[],movements:Document[]=[],taxCodes=new Set<string>();
  const stamp={org_id:c.orgId,created_by:c.actorUid,updated_at:c.committedAt,schema_version:3,operation_id:c.operationId,historical_import_session_id:sessionId};
  for(const bill of plan.bills){
    const supplier=data.suppliers.find(r=>r.id===bill.supplier_id);ensure(supplier?.status==='active','مورد الشراء التاريخي غير نشط.',409);
    const proof=evidence[bill.historical_import_row_number],version=proof.tax_configuration_version_hash?data.tax_configuration_versions.find(r=>r.version_hash===proof.tax_configuration_version_hash):undefined;
    const inclusive=version?.calculation==='inclusive',decimals=bill.currency==='USD'?2:0;
    const items=bill.lines.map(line=>{const amount=new BigNumber(line.net).plus(inclusive?line.tax:0),unit=amount.div(line.quantity).decimalPlaces(8,BigNumber.ROUND_HALF_UP);ensure(unit.times(line.quantity).decimalPlaces(decimals,BigNumber.ROUND_HALF_UP).eq(amount),'بند الشراء التاريخي لا يعيد إنتاج أساس الضريبة.',409);return{id:line.id,product_id:line.product_id!,product_name:String(data.products.find(r=>r.id===line.product_id)!.name),quantity:line.quantity,unit_cost:unit.toNumber(),value_sdg:line.value.sdg,value_usd:line.value.usd,...(version?{tax_inventory_value_native:line.inventory_value}:{})};});
    let tax:Document|undefined;
    if(bill.tax.sdg||bill.tax.usd){
      ensure(version&&data.tax_configuration_versions.filter(r=>r.version_hash===version.version_hash).length===1,'إصدار ضريبة الشراء التاريخية مفقود أو مكرر.',409);
      ensure(data.tax_configurations.some(r=>r.id===version.configuration_id),'سلسلة ضريبة الشراء التاريخية مفقودة.',409);
      const keys=['schema_version','org_id','revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active'];
      const configuration={id:version.configuration_id,...Object.fromEntries(keys.map(key=>[key,version[key]]))};
      const quote=purchaseTaxSourceQuote({configuration_id:version.configuration_id,expected_configuration_revision:version.revision,issue_date:bill.issue_date,currency:bill.currency,exchange_rate_used:bill.exchange_rate_used,items:items.map(({product_id,quantity,unit_cost})=>({product_id,quantity,unit_cost}))},{org_id:c.orgId,configurations:[configuration as never],accounts:c.accounts});
      ensure(quote.tax_treatment==='receivable'&&quote.tax_account_code===proof.tax_account_code,'سياسة الشراء التاريخية لا تثبت ضريبة مستردة بالحساب المراجع.',409);
      for(const book of ['sdg','usd'] as const)ensure(new BigNumber(quote[book].base).eq(bill.inventory_value[book])&&new BigNumber(quote[book].tax).eq(bill.tax[book])&&new BigNumber(quote[book].total).eq(bill.total[book]),'ضريبة الشراء التاريخية لا تطابق الإصدار المحفوظ.',409);
      tax={...quote,configuration_version_hash:version.version_hash};taxCodes.add(quote.tax_account_code!);
    }
    const related=plan.payments.filter(r=>r.bill_id===bill.id);
    bills.push({...stamp,id:bill.id,supplier_id:bill.supplier_id,supplier_name:supplier.name,supplier_reference:bill.supplier_reference,issue_date:bill.issue_date,due_date:bill.due_date,currency:bill.currency,exchange_rate_used:bill.exchange_rate_used,items,...(tax?{tax_evidence:tax}:{}),grand_total_sdg:bill.total.sdg,grand_total_usd:bill.total.usd,remaining_sdg:bill.remaining.sdg,remaining_usd:bill.remaining.usd,paid_amount_sdg:bill.paid.sdg,paid_amount_usd:bill.paid.usd,advance_balance_sdg:0,advance_balance_usd:0,returned_amount_sdg:0,returned_amount_usd:0,refunded_amount_sdg:0,refunded_amount_usd:0,settlement:'credit',status:bill.status,journal_id:bill.journal_id,payment_account_code:'2110',source_event_sequence:related.length,payment_sequence:related.length,correction_count:0,...(related.length?{last_payment_date:related.at(-1)!.date}:{}),notes:'',reason:'استيراد شراء تاريخي مراجع',branch_id:bill.branch_id,created_at:bill.issue_date,historical_import_row_number:bill.historical_import_row_number});
  }
  for(const payment of plan.payments){const bill=bills.find(r=>r.id===payment.bill_id)!;payments.push({...stamp,id:payment.id,bill_id:bill.id,supplier_id:bill.supplier_id,sequence:payment.sequence,source_sequence:payment.sequence,amount:payment.amount,currency:payment.currency,exchange_rate_used:payment.exchange_rate_used,payment_date:payment.date,payment_method:'custom',payment_account_code:payment.account_code,reference_number:payment.reference,notes:'',settled_amount_sdg:payment.settled.sdg,settled_amount_usd:payment.settled.usd,cash_amount_sdg:payment.cash.sdg,cash_amount_usd:payment.cash.usd,journal_id:payment.journal_id,branch_id:bill.branch_id,created_at:payment.date,historical_import_row_number:payment.historical_import_row_number});}
  for(const movement of plan.inventory_movements){const bill=bills.find(r=>r.id===movement.reference_id)!;movements.push({...stamp,id:movement.id,product_id:movement.product_id,product_name:movement.product_name,type:'PURCHASE',quantity:movement.quantity,previous_stock:movement.previous_stock,resulting_stock:movement.resulting_stock,reference_type:'purchase_bill',reference_id:bill.id,value_delta_sdg:movement.value_delta.sdg,value_delta_usd:movement.value_delta.usd,costing_version:2,journal_id:movement.journal_id,branch_id:bill.branch_id,created_at:bill.issue_date,historical_import_row_number:movement.historical_import_row_number});}
  const updates:Document[]=products.map(product=>({...data.products.find(r=>r.id===product.id)!,...plan.product_cost_after[product.id],id:product.id}));
  const suppliers:Document[]=[...new Set(bills.map(r=>r.supplier_id))].map(id=>{const supplier=data.suppliers.find(r=>r.id===id)!,opening=openingBalancesForParty(data,'payable',id),sources=[...data.purchase_bills,...bills].filter(r=>r.supplier_id===id);return{...supplier,id,payable_due_sdg:sources.reduce((sum,r)=>sum.plus(r.remaining_sdg),new BigNumber(opening.sdg)).toNumber(),payable_due_usd:sources.reduce((sum,r)=>sum.plus(r.remaining_usd),new BigNumber(opening.usd)).toNumber(),advance_balance_sdg:sources.reduce((sum,r)=>sum.plus(r.advance_balance_sdg||0),new BigNumber(0)).toNumber(),advance_balance_usd:sources.reduce((sum,r)=>sum.plus(r.advance_balance_usd||0),new BigNumber(0)).toNumber(),updated_at:c.committedAt};});
  const groups:Record<string,string>={'1300':'inventory','2110':'payables','4200':'fx_gain','5500':'fx_loss'};
  for(const posting of plan.journal_entries)for(const line of posting.lines){const account=c.accounts.find(r=>r.code===line.account_code);ensure(account?.is_active&&classifyAccount(account).reporting_group===(groups[line.account_code]||(taxCodes.has(line.account_code)?'other_assets':'cash_bank')),'تصنيف حساب الشراء التاريخي غير صالح.',409);}
  return{bills,payments,movements,products:updates,suppliers,postings:plan.journal_entries};
}
