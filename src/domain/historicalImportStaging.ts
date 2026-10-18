import type { Document } from './store';
import { ensure, text } from './validation';
import { validateHistoricalImport, type HistoricalImportContext, type HistoricalImportRow } from './historicalImport';
import { largeImportStagingSha256 } from './largeImportEvidence';

export interface HistoricalImportStageInput {
  file_name:string;
  file_hash:string;
  schema_version:number;
  rows:HistoricalImportRow[];
}

export interface HistoricalImportStageContext {
  orgId:string;
  actorUid:string;
  operationId:string;
  createdAt:string;
  validation:HistoricalImportContext;
  previousSessions:Document[];
}

export function assertHistoricalImportStagePayload(value:unknown):asserts value is HistoricalImportStageInput {
  ensure(Boolean(value)&&typeof value==='object'&&!Array.isArray(value),'بيانات الاستيراد التاريخي غير صالحة.');
  const input=value as HistoricalImportStageInput;
  ensure(Object.keys(input).every(key=>['file_name','file_hash','schema_version','rows'].includes(key)),'حقول الاستيراد التاريخي غير صالحة أو محمية.');
  ensure(Array.isArray(input.rows),'صفوف الاستيراد التاريخي مطلوبة.');
}

export async function buildHistoricalImportStage(input:HistoricalImportStageInput,context:HistoricalImportStageContext){
  assertHistoricalImportStagePayload(input);
  const filename=text(input.file_name,180,true);
  ensure(/\.(xlsx|csv)$/i.test(filename),'ملف الاستيراد التاريخي يجب أن يكون XLSX أو CSV.');
  ensure(/^[a-f0-9]{64}$/i.test(input.file_hash),'بصمة ملف الاستيراد التاريخي غير صالحة.');
  ensure(input.schema_version===1,'إصدار مخطط الاستيراد التاريخي غير مدعوم.');
  ensure(context.validation.orgId===context.orgId,'سياق الاستيراد التاريخي من مؤسسة أخرى.',409);
  ensure(context.previousSessions.every(session=>session.org_id===context.orgId),'سجل جلسات الاستيراد التاريخي يحتوي مؤسسة أخرى.',409);
  const validationBasis={
    orgId:context.validation.orgId,
    ...(context.validation.periodLockDate?{periodLockDate:context.validation.periodLockDate}:{}),
    periods:[...(context.validation.periods||[])].sort((left,right)=>left.start_date.localeCompare(right.start_date)),
    accounts:[...new Set(context.validation.accounts.map(value=>value.trim()))].sort(),
    branches:[...new Set(context.validation.branches)].sort(),
    currencies:[...new Set(context.validation.currencies)].sort(),
    dimensions:[...new Set(context.validation.dimensions||[])].sort(),
    existingReferences:[...new Set((context.validation.existingReferences||[]).map(value=>value.trim().toLowerCase()))].sort(),
  } satisfies HistoricalImportContext;
  const validation=validateHistoricalImport(input.rows,validationBasis);
  ensure(validation.can_stage,'ملف الاستيراد التاريخي يحتوي أخطاء حاجبة ولا يمكن نقله إلى staging.',409);
  const rows=input.rows.map(row=>structuredClone(row)) as unknown as Document[];
  const rowsSha256=await largeImportStagingSha256(rows);
  const contextSha256=await largeImportStagingSha256([validationBasis as unknown as Document]);
  const kinds=[...new Set(input.rows.map(row=>row.kind))].sort();
  const importType=kinds.length===1?`historical_${kinds[0]}`:'legacy_migration';
  const id=`historical-import-${context.operationId}`;
  const fileDuplicate=context.previousSessions.some(session=>session.file_hash===input.file_hash&&session.schema_version===input.schema_version);
  const status=validation.accounting_block?'staged_accounting_block':'staged';
  const session={
    id,org_id:context.orgId,schema_version:input.schema_version,file_name:filename,file_hash:input.file_hash,import_type:importType,
    kinds,created_by:context.actorUid,created_at:context.createdAt,rows_total:input.rows.length,rows_valid:input.rows.length,
    rows_failed:0,rows_imported:0,rows_skipped:0,status,file_duplicate:fileDuplicate,rows_sha256:rowsSha256,
    validation_context_sha256:contextSha256,accounting_block:validation.accounting_block,validation:{...validation,blocking_issues:[]},
  };
  const staging={id,org_id:context.orgId,session_id:id,schema_version:input.schema_version,rows,rows_sha256:rowsSha256,validation_basis:validationBasis,validation_context_sha256:contextSha256,created_at:context.createdAt};
  ensure(new TextEncoder().encode(JSON.stringify(staging)).length<=620000,'حجم staging التاريخي يتجاوز الحد؛ قسّم الملف إلى دفعات أصغر.',413);
  return{session,staging,result:{...session,file_duplicate_warning:fileDuplicate?'سبق تجهيز ملف بالبصمة والإصدار نفسيهما؛ راجع جلسات الاستيراد السابقة.':''}};
}
