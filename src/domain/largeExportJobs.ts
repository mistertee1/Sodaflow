import type { Document } from './store';
import { ensure, identifier, dateOnly } from './validation';

export type LargeExportKind = 'company' | 'accounting';
export type LargeExportJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface LargeExportJobContext {
  orgId: string;
  actorUid: string;
  actorRole: string;
  ownerUid: string;
  operationId: string;
  now: Date;
}

const allowedKeys = (value: Document, keys: string[]) => ensure(Object.keys(value).every(key => keys.includes(key)), 'حقول مهمة التصدير غير صالحة أو محمية.');

export function requestLargeExportJob(data: Document, activeJobs: Document[], context: LargeExportJobContext): Document {
  allowedKeys(data, ['kind', 'format', 'period', 'preset_id']);
  const kind = String(data.kind || '') as LargeExportKind;
  ensure(kind === 'company' || kind === 'accounting', 'نوع مهمة التصدير غير صالح.');
  ensure(kind !== 'company' || context.actorRole === 'Owner' && context.ownerUid === context.actorUid, 'مهمة تصدير الشركة الكاملة متاحة لمالك المؤسسة الفعلي فقط.', 403);
  ensure(data.format === undefined || data.format === (kind === 'company' ? 'json' : 'xlsx'), 'صيغة مهمة التصدير غير صالحة.');
  ensure(activeJobs.filter(job => ['queued', 'running'].includes(job.status)).length < 3, 'توجد ثلاث مهام تصدير نشطة؛ انتظر اكتمال إحداها.', 429);
  const period = (data.period || {}) as { start?: string; end?: string };
  if (period.start) dateOnly(period.start);
  if (period.end) dateOnly(period.end);
  ensure(!period.start || !period.end || period.start <= period.end, 'فترة مهمة التصدير غير صالحة.');
  ensure(kind === 'accounting' || !period.start && !period.end, 'الفترة مسموحة لمهمة دفتر المحاسب فقط.');
  const presetId = data.preset_id === undefined ? '' : identifier(String(data.preset_id));
  const createdAt = context.now.toISOString();
  return {
    id: `export-job-${identifier(context.operationId)}`,
    org_id: context.orgId,
    kind,
    format: kind === 'company' ? 'json' : 'xlsx',
    status: 'queued' satisfies LargeExportJobStatus,
    progress: 0,
    attempt: 1,
    max_attempts: 3,
    requested_by: context.actorUid,
    ...(period.start || period.end ? { period } : {}),
    ...(presetId ? { preset_id: presetId } : {}),
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: null,
    failure: null,
    artifact: null,
  };
}

export function cancelLargeExportJob(job: Document, context: LargeExportJobContext): Document {
  ensure(job.org_id === context.orgId, 'مهمة التصدير من مؤسسة أخرى.', 409);
  ensure(context.actorRole === 'Owner' || job.requested_by === context.actorUid, 'إلغاء المهمة متاح لمنشئها أو المالك.', 403);
  ensure(['queued', 'running'].includes(job.status), 'لا يمكن إلغاء مهمة التصدير في حالتها الحالية.', 409);
  return { ...job, status: 'cancelled' satisfies LargeExportJobStatus, progress: Number(job.progress || 0), cancelled_by: context.actorUid, cancelled_at: context.now.toISOString(), updated_at: context.now.toISOString(), artifact: null, expires_at: null };
}

export function retryLargeExportJob(job: Document, context: LargeExportJobContext): Document {
  ensure(job.org_id === context.orgId, 'مهمة التصدير من مؤسسة أخرى.', 409);
  ensure(context.actorRole === 'Owner' || job.requested_by === context.actorUid, 'إعادة المحاولة متاحة لمنشئها أو المالك.', 403);
  ensure(job.status === 'failed', 'إعادة المحاولة متاحة للمهمة الفاشلة فقط.', 409);
  const attempt = Number(job.attempt || 1);
  ensure(Number.isSafeInteger(attempt) && attempt < Number(job.max_attempts || 3), 'استنفدت مهمة التصدير محاولاتها.', 409);
  return { ...job, status: 'queued' satisfies LargeExportJobStatus, progress: 0, attempt: attempt + 1, failure: null, artifact: null, expires_at: null, retried_by: context.actorUid, updated_at: context.now.toISOString() };
}

