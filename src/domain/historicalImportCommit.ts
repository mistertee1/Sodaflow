import type { Account, JournalEntry, JournalEntryLine, MerchantSettings } from '../types';
import type { Document } from './store';
import { journal } from './financial';
import { largeImportStagingSha256 } from './largeImportEvidence';
import { financialCollections, reconcileFinancialData, type FinancialData, type Finding } from './reconciliation';
import { dateOnly, ensure, identifier, text, validateJournal } from './validation';
import { validateHistoricalImport, type HistoricalImportContext, type HistoricalImportRow } from './historicalImport';

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

/**
 * Builds a bounded, deterministic posting plan. The caller persists every returned
 * journal and the updated session in the same transaction.
 *
 * Historical invoices and purchases deliberately remain blocked here: their current
 * staged rows do not yet carry enough payment/inventory/COGS/tax evidence to create
 * native subsidiary documents without inventing accounting history.
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
  const unsupported=documentRows;
  ensure(!unsupported.length,'اعتماد الفواتير والمشتريات التاريخية يتطلب أدلة مستقلة للدفعات والمخزون وCOGS والضريبة؛ هذه الجلسة تبقى للمراجعة دون كتابة.',409);

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
  ensure(postings.length>0&&postings.length<=200,'لم ينتج عن الجلسة قيود قابلة للاعتماد أو تجاوز عددها الحد الذري.',409);
  const existingIds=new Set(context.financialData.journal_entries.map(row=>row.id));
  ensure(postings.every(entry=>!existingIds.has(entry.id)),'سبق إنشاء قيد من هذه الجلسة؛ راجع سجل الاستيراد.',409);
  const baseline=reconcileFinancialData(context.financialData,context.settings,{requireCosting:true});
  ensure(!baseline.length,'الدفاتر الحالية تحتوي فروقات؛ أصلحها قبل اعتماد استيراد تاريخي جديد.',409);
  const proposed=Object.fromEntries(financialCollections.map(name=>[name,[...(context.financialData[name]||[])]])) as FinancialData;
  proposed.journal_entries.push(...postings);
  const findings=reconcileFinancialData(proposed,context.settings,{requireCosting:true}),accountingBlock=findings.length>0;
  const reconciliation={checked_at:context.committedAt,findings_count:findings.length,findings:findings.slice(0,100),checks:reconciliationSummary(findings)};
  const updatedSession={...session,status:accountingBlock?'completed_accounting_block':'completed',completion_code:accountingBlock?'IMPORT_COMPLETED_WITH_ACCOUNTING_BLOCK':'IMPORT_COMPLETED',accounting_block:accountingBlock,rows_imported:rows.length,committed_by:context.actorUid,committed_at:context.committedAt,commit_operation_id:context.operationId,commit_journal_ids:postings.map(entry=>entry.id),reconciliation};
  ensure(new TextEncoder().encode(JSON.stringify(updatedSession)).length<=620000,'إثبات اعتماد الاستيراد التاريخي يتجاوز الحد.',413);
  return{session:updatedSession,postings,result:{id:session.id,import_type:session.import_type,file_hash:session.file_hash,schema_version:session.schema_version,status:updatedSession.status,completion_code:updatedSession.completion_code,accounting_block:accountingBlock,rows_total:session.rows_total,rows_imported:rows.length,rows_failed:0,journals_created:postings.length,rows_sha256:session.rows_sha256,validation_context_sha256:session.validation_context_sha256,reconciliation}};
}
