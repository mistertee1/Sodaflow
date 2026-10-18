import type { Document } from './store';
import { ensure, identifier } from './validation';
import { masterImportModule, type MasterImportModule } from './masterImport';

export type LargeImportJobStatus = 'queued'|'running'|'failed'|'cancelled'|'awaiting_commit'|'completed';
export interface LargeImportContext { orgId:string; actorUid:string; actorRole:string; operationId:string; now:Date; }

const allowed=(value:Document,keys:string[])=>ensure(Object.keys(value).every(key=>keys.includes(key)),'حقول مهمة الاستيراد غير صالحة أو محمية.');

export function requestLargeImportJob(data:Document,session:Document,staging:Document,active:Document[],context:LargeImportContext){
  allowed(data,['session_id','reviewed','duplicate_policy']);
  const sessionId=identifier(data.session_id),module=masterImportModule(session.import_type) as MasterImportModule;
  ensure(session.id===sessionId&&session.org_id===context.orgId&&staging.session_id===sessionId&&staging.org_id===context.orgId,'جلسة الاستيراد أو بياناتها المؤقتة غير متطابقة.',409);
  ensure(session.status==='previewed','جلسة الاستيراد ليست جاهزة للمراجعة.',409);
  ensure(data.reviewed===true,'يجب تأكيد مراجعة المعاينة قبل إنشاء المهمة.');
  const policy=String(data.duplicate_policy||'skip');ensure(['skip','update'].includes(policy),'سياسة التكرار غير صالحة.');
  const fileHash=String(session.file_hash||''),schemaVersion=Number(session.schema_version);
  ensure(/^[a-f0-9]{64}$/i.test(fileHash)&&Number.isSafeInteger(schemaVersion)&&schemaVersion>0,'بصمة الملف أو إصدار المخطط غير صالح.',409);
  const totals=session.totals||{},rows=Number(totals.rows),errors=Number(totals.errors||0);
  ensure(Number.isSafeInteger(rows)&&rows>0&&rows<=12000,'عدد صفوف مهمة الاستيراد يجب أن يكون بين 1 و12000.');
  ensure(errors===0,'لا يمكن جدولة ملف يحتوي أخطاء حاجبة.',409);
  ensure(Array.isArray(staging.rows)&&staging.rows.length===rows,'عدد صفوف المعاينة لا يطابق الجلسة.',409);
  ensure(!active.some(job=>job.session_id===sessionId&&job.file_hash===fileHash&&Number(job.schema_version)===schemaVersion&&!['failed','cancelled'].includes(job.status)),'سبق جدولة جلسة الاستيراد نفسها بهذا الملف وإصدار المخطط.',409);
  ensure(active.filter(job=>['queued','running','awaiting_commit'].includes(job.status)).length<2,'توجد مهمتا استيراد نشطتان؛ انتظر اكتمال إحداهما.',429);
  const createdAt=context.now.toISOString();
  return{id:`import-job-${identifier(context.operationId)}`,org_id:context.orgId,session_id:sessionId,module,file_hash:fileHash,schema_version:schemaVersion,idempotency_key:`${sessionId}:${fileHash}:${schemaVersion}`,duplicate_policy:policy,status:'queued' satisfies LargeImportJobStatus,stage:'validation',progress:0,processed_rows:0,total_rows:rows,valid_rows:Number(totals.valid||0),failed_rows:0,attempt:1,max_attempts:3,requested_by:context.actorUid,reviewed_by:context.actorUid,reviewed_at:createdAt,created_at:createdAt,updated_at:createdAt,failure:null};
}

export function cancelLargeImportJob(job:Document,context:LargeImportContext){
  ensure(job.org_id===context.orgId,'مهمة الاستيراد من مؤسسة أخرى.',409);
  ensure(context.actorRole==='Owner'||job.requested_by===context.actorUid,'إلغاء المهمة متاح لمنشئها أو المالك.',403);
  ensure(['queued','running','awaiting_commit'].includes(job.status),'لا يمكن إلغاء مهمة الاستيراد في حالتها الحالية.',409);
  const at=context.now.toISOString();return{...job,status:'cancelled' satisfies LargeImportJobStatus,cancelled_by:context.actorUid,cancelled_at:at,updated_at:at};
}

export function retryLargeImportJob(job:Document,context:LargeImportContext){
  ensure(job.org_id===context.orgId,'مهمة الاستيراد من مؤسسة أخرى.',409);
  ensure(context.actorRole==='Owner'||job.requested_by===context.actorUid,'إعادة المحاولة متاحة لمنشئها أو المالك.',403);
  ensure(job.status==='failed','إعادة المحاولة متاحة للمهمة الفاشلة فقط.',409);
  const attempt=Number(job.attempt||1);ensure(Number.isSafeInteger(attempt)&&attempt<Number(job.max_attempts||3),'استنفدت مهمة الاستيراد محاولاتها.',409);
  const at=context.now.toISOString();return{...job,status:'queued' satisfies LargeImportJobStatus,stage:'validation',progress:0,processed_rows:0,failed_rows:0,attempt:attempt+1,failure:null,retried_by:context.actorUid,updated_at:at};
}
