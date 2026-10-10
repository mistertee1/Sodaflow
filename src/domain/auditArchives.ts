import type { Document } from './store';
import { dateOnly, ensure, identifier, text } from './validation';
const canonical = (value: unknown): string => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' : value && typeof value==='object' ? '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}' : JSON.stringify(value);
async function digest(value: unknown) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join(''); }
function evidence(row: Document) {
  ensure(row && typeof row==='object' && !Array.isArray(row) && row.source_event && typeof row.source_event==='object' && !Array.isArray(row.source_event),'بنية أرشيف التدقيق غير صالحة.');
  identifier(row.id);identifier(row.source_organization_id);identifier(row.source_event?.id);identifier(row.source_event?.actor_uid);text(row.source_event?.action,200,true);dateOnly(row.source_event?.created_at);
  ensure(row.source_event.org_id===row.source_organization_id,'مؤسسة حدث التدقيق المستورد مختلفة.');
  ensure(/^[a-f0-9]{64}$/.test(row.source_hash),'بصمة أرشيف التدقيق ناقصة.');
  ensure(new TextEncoder().encode(JSON.stringify(row)).length<=650000,'حدث التدقيق أكبر من حد الأرشفة الذرية.',413);
}
export async function verifyAuditArchives(rows: Document[]) {
  ensure(Array.isArray(rows),'قائمة أرشيف التدقيق غير صالحة.');const ids=new Set<string>();
  for(const row of rows) {evidence(row);ensure(!ids.has(row.id),'أرشيف التدقيق مكرر.');ids.add(row.id);ensure(row.id==='aa-'+await digest([row.source_organization_id,row.source_event.id]) && row.source_hash===await digest(row.source_event),'بصمة أرشيف التدقيق لا تطابق الحدث الأصلي.',409);}
}
/** Source history is provenance, never a destination membership grant or an active local event. */
export async function restoreAuditArchives(backup: Document, organizationId: string, actor: string, operationId: string, iso: string) {
  const existing=backup.collections.audit_archives || [];await verifyAuditArchives(existing);
  const events=backup.collections.audit_logs || [];ensure(Array.isArray(events),'سجل تدقيق النسخة غير صالح.');
  ensure((backup.counters?.audit_archive_count ?? 0)===existing.length,'أرشيف التدقيق ناقص أو عداده مختلف.',409);
  if(backup.audit_schema_version!==undefined || backup.counters?.audit_event_count!==undefined) {ensure(backup.audit_schema_version===1 && Number.isSafeInteger(backup.counters?.audit_event_count) && backup.counters.audit_event_count===events.length,'أحداث تدقيق النسخة ناقصة أو إصدارها غير صالح.',409);}

  const rows=new Map<string,Document>();
  for(const row of existing){ensure(row.org_id===backup.org?.id,'أرشيف التدقيق يتبع مؤسسة أخرى.',403);rows.set(row.id,{...row,org_id:organizationId});}
  for(const event of events) {
    ensure(event && typeof event==='object' && !Array.isArray(event),'حدث التدقيق المستورد غير صالح.');
    const source=identifier(backup.org?.id);ensure(event.org_id===source,'حدث تدقيق النسخة يتبع مؤسسة أخرى.',403);
    const id='aa-'+await digest([source,identifier(event.id)]),sourceHash=await digest(event);
    const row={id,org_id:organizationId,source_organization_id:source,source_event:event,source_hash:sourceHash,imported_by:actor,imported_at:iso,import_operation_id:operationId,schema_version:1};evidence(row);
    const old=rows.get(id);ensure(!old || old.source_hash===sourceHash,'أدلة تدقيق متعارضة لنفس المصدر.',409);if(!old)rows.set(id,row);
  }
  return [...rows.values()];
}
export function reconcileAuditArchives(rows: Document[]) {const findings:{code:string;collection:string;id:string;message:string}[]=[];for(const row of rows)try{evidence(row);}catch(e){findings.push({code:'invalid_record',collection:'audit_archives',id:row.id||'',message:e instanceof Error?e.message:'أرشيف التدقيق غير صالح'});}return findings;}
