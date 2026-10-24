import type { Document, Store, Transaction } from '../src/domain/store';
import { BusinessError, ensure, identifier } from '../src/domain/validation';
import { scheduledExportDueKey } from '../src/domain/scheduledExportManagement';
import type { ScheduledAccountIdentity } from '../src/domain/scheduledExportManagement';
import { nextScheduledExportRun, scheduledExportOccurrence, type ExportSchedule } from '../src/domain/scheduledExportPolicy';
import { merchantDay } from '../src/domain/operationalReports';
import { largeImportValueSha256, sameLargeImportRecord } from '../src/domain/largeImportEvidence';
import { LiveExportAuthorization, type ExportAuthorizationOptions } from './exportAuthorization';
import { verifyDeployedAccountingRules } from './accountingSecurity';
import { adminServices } from './admin';
import { FirestoreStore } from './firestoreStore';

export interface ScheduledDispatchResult {
  status: 'queued' | 'skipped' | 'already_dispatched' | 'capacity' | 'stale';
  org_id: string; schedule_id: string; job_id?: string; occurrence_id?: string;
}
const blocked = (error: unknown) => error instanceof BusinessError && [403, 409, 410].includes(error.status);
const jobCollection = (kind: string) => kind === 'company' ? 'company_export_jobs' : 'accounting_export_jobs';
const scopeKeys = ['id', 'org_id', 'kind', 'format', 'requested_by', 'period', 'schedule_id', 'policy_revision', 'scheduled_for', 'occurrence_id', 'local_date'];
const scope = (job: Document) => Object.fromEntries(scopeKeys.map(key => [key, job[key]]));

/** Internal cloud dispatcher. There is no browser/API route or implicit timer. */
export class ScheduledExportDispatcher {
  private authorization: LiveExportAuthorization;
  constructor(private store: Store, private options: ExportAuthorizationOptions = {}) {
    this.authorization = new LiveExportAuthorization(store, options);
  }
  private async ready() {
    ensure(this.store.authority === 'server', 'صرف جداول التصدير يتطلب خدمة الخادم.', 403);
    try { await (this.options.verifySecurity || verifyDeployedAccountingRules)(); }
    catch (error) { if (error instanceof BusinessError) throw error; throw new BusinessError('تعذر تأكيد حماية صرف التصدير.', 503, 'accounting_rules_not_verified'); }
  }
  private async candidate(tx: Transaction, orgId: string, scheduleId: string) {
    const id = scheduledExportDueKey(orgId, scheduleId), due = await tx.get(`scheduled_export_due/${id}`);
    if (!due) return undefined;
    ensure(due.id === id && due.org_id === orgId && due.schedule_id === scheduleId, 'نطاق فهرس التصدير غير مطابق.', 409);
    const policy = await tx.get(`organizations/${orgId}/export_schedules/${scheduleId}`) as ExportSchedule | undefined;
    if (!policy || !policy.active || !await tx.get(`organizations/${orgId}`)) { tx.delete(`scheduled_export_due/${id}`); return undefined; }
    if (policy.revision !== due.policy_revision || policy.next_run_at !== due.next_run_at) return undefined;
    ensure(policy.id === scheduleId && policy.org_id === orgId && policy.schema_version === 1, 'نطاق سياسة التصدير غير مطابق.', 409);
    identifier(policy.created_by);
    const at = new Date(due.next_run_at);
    ensure(Number.isFinite(at.getTime()) && at.toISOString() === due.next_run_at
      && nextScheduledExportRun(policy, new Date(at.getTime() - 1)) === due.next_run_at, 'موعد فهرس التصدير لا يطابق السياسة.', 409);
    if (at > this.authorization.now()) return undefined;
    return { due, policy };
  }
  private advance(tx: Transaction, orgId: string, policy: ExportSchedule, next: string | null, outcome: string, occurrence: string, at: string) {
    const id = scheduledExportDueKey(orgId, policy.id);
    tx.set(`organizations/${orgId}/export_schedules/${policy.id}`, { ...policy, next_run_at: next, last_dispatch_at: at, last_dispatch_outcome: outcome, last_occurrence_id: occurrence });
    if (next) tx.set(`scheduled_export_due/${id}`, { id, org_id: orgId, schedule_id: policy.id, policy_revision: policy.revision, next_run_at: next, updated_at: at });
    else tx.delete(`scheduled_export_due/${id}`);
  }

  async dispatch(orgId: string, scheduleId: string): Promise<ScheduledDispatchResult> {
    identifier(orgId); identifier(scheduleId); await this.ready();
    const result = (status: ScheduledDispatchResult['status'], values: Partial<ScheduledDispatchResult> = {}): ScheduledDispatchResult => ({ status, org_id: orgId, schedule_id: scheduleId, ...values });
    const seed = await this.store.transaction(tx => this.candidate(tx, orgId, scheduleId));
    if (!seed) return result('stale');
    let identity: ScheduledAccountIdentity | undefined;
    try { identity = await this.authorization.identity(seed.policy.created_by); }
    catch (error) { if (!blocked(error)) throw error; }
    return this.store.transaction(async tx => {
      const current = await this.candidate(tx, orgId, scheduleId);
      if (!current || !sameLargeImportRecord(current, seed)) return result('stale');
      const { policy, due } = current, root = `organizations/${orgId}`, now = this.authorization.now(), at = now.toISOString();
      let allowed = false, occurrence: Awaited<ReturnType<typeof scheduledExportOccurrence>> | undefined;
      if (identity) {
        try {
          const grant = await this.authorization.access(tx, orgId, policy.kind, identity);
          occurrence = await scheduledExportOccurrence(policy, due.next_run_at, grant.access); allowed = true;
        } catch (error) { if (!blocked(error)) throw error; }
      }
      const localDate = merchantDay(new Date(due.next_run_at), policy.timezone);
      const token = occurrence?.operation_id || await largeImportValueSha256({ org_id: orgId, schedule_id: scheduleId, revision: policy.revision, local_date: localDate });
      const occurrenceId = `scheduled-${token}`, receiptPath = `${root}/export_schedule_occurrences/${occurrenceId}`, receipt = await tx.get(receiptPath);
      const next = nextScheduledExportRun(policy, now);
      if (receipt) {
        ensure(receipt.id === occurrenceId && receipt.org_id === orgId && receipt.schedule_id === scheduleId && receipt.policy_revision === policy.revision
          && receipt.requested_by === policy.created_by && receipt.scheduled_for === due.next_run_at, 'إيصال استحقاق التصدير غير مطابق.', 409);
        if (receipt.job_id) {
          const oldJob = await tx.get(`${root}/${jobCollection(policy.kind)}/${receipt.job_id}`);
          ensure(oldJob && receipt.job_scope && sameLargeImportRecord(scope(oldJob), receipt.job_scope), 'دليل مهمة الاستحقاق محفوظ دون مهمة مطابقة؛ راجع الدعم.', 409);
        }
        this.advance(tx, orgId, policy, next, receipt.status, occurrenceId, at);
        return result('already_dispatched', { occurrence_id: occurrenceId, ...(receipt.job_id ? { job_id: receipt.job_id } : {}) });
      }
      if (allowed) {
        const active = (await Promise.all(['accounting_export_jobs', 'company_export_jobs'].flatMap(name => ['queued', 'running'].map(status => tx.find(`${root}/${name}`, 'status', status))))).flat();
        ensure(active.every(job => job.org_id === orgId), 'نطاق مهمة نشطة غير مطابق.', 409);
        if (active.length >= 3) return result('capacity');
      }
      // A shared organization document serializes schedules owned by different
      // users. No financial counters, source records or balances are rewritten.
      const controlPath = `${root}/meta/export_schedule_dispatch`, control = await tx.get(controlPath);
      ensure(!control || control.org_id === orgId && Number.isSafeInteger(control.revision) && control.revision >= 1 && control.revision < Number.MAX_SAFE_INTEGER, 'سجل صرف المؤسسة غير صالح.', 409);
      const auditId = `audit-${occurrenceId}-dispatch`, auditPath = `${root}/audit_logs/${auditId}`;
      ensure(!await tx.get(auditPath), 'الاستحقاق مرتبط بسجل تدقيق قديم دون إيصال مطابق.', 409);
      let job: Document | undefined;
      if (allowed && occurrence) {
        const collection = jobCollection(policy.kind), jobPath = `${root}/${collection}/${occurrenceId}`;
        ensure(!await tx.get(jobPath), 'معرّف مهمة الاستحقاق مستخدم دون إيصال مطابق.', 409);
        job = { id: occurrenceId, org_id: orgId, kind: policy.kind, format: policy.kind === 'company' ? 'json' : policy.kind === 'auditor' ? 'xlsx' : 'xls', status: 'queued', progress: 0, attempt: 1, max_attempts: 3,
          requested_by: policy.created_by, period: occurrence.period, schedule_id: scheduleId, policy_revision: policy.revision, scheduled_for: due.next_run_at, local_date: localDate, occurrence_id: token,
          created_at: at, updated_at: at, expires_at: null, failure: null, artifact: null };
        tx.set(jobPath, job);
        tx.set(`large_export_queue/${orgId}.${occurrenceId}`, { id: `${orgId}.${occurrenceId}`, org_id: orgId, job_id: occurrenceId, collection, created_at: at });
      }
      const outcome = job ? 'queued' : 'skipped';
      tx.set(receiptPath, { id: occurrenceId, org_id: orgId, schedule_id: scheduleId, policy_revision: policy.revision, requested_by: policy.created_by, scheduled_for: due.next_run_at, local_date: localDate, status: outcome,
        ...(job ? { job_id: job.id, job_scope: scope(job) } : { reason: { code: 'export_access_unavailable', message: 'لم يتوفر حق التصدير الحالي عند استحقاق الجدول.' } }), next_run_at: next, created_at: at });
      tx.set(controlPath, { org_id: orgId, revision: (control?.revision || 0) + 1, updated_at: at });
      tx.set(auditPath, { id: auditId, org_id: orgId, event_type: job ? 'EXPORT_SCHEDULE_QUEUED' : 'EXPORT_SCHEDULE_SKIPPED', actor_uid: 'system:scheduled-export', entity_type: 'export_schedule', entity_id: scheduleId, created_at: at,
        export_metadata: { export_type: policy.kind, schedule_id: scheduleId, policy_revision: policy.revision, scheduled_for: due.next_run_at, occurrence_id: token, status: outcome, ...(job ? { job_id: job.id, period: job.period } : {}) } });
      this.advance(tx, orgId, policy, next, outcome, occurrenceId, at);
      return result(job ? 'queued' : 'skipped', { occurrence_id: occurrenceId, ...(job ? { job_id: job.id } : {}) });
    });
  }

  async dispatchNext(): Promise<ScheduledDispatchResult | null> {
    await this.ready();
    const due = await this.store.transaction(tx => tx.list('scheduled_export_due', { limit: 25, orderBy: 'next_run_at' }));
    for (const item of due) {
      if (Date.parse(item.next_run_at) > this.authorization.now().getTime()) continue;
      const value = await this.dispatch(identifier(item.org_id), identifier(item.schedule_id));
      if (!['stale', 'capacity'].includes(value.status)) return value;
    }
    return null;
  }
}

export const firebaseScheduledExportDispatcher = () => new ScheduledExportDispatcher(new FirestoreStore(adminServices().db));
