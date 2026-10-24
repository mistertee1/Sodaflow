import type { Document, Store, Transaction } from '../src/domain/store';
import { membership, type Actor } from '../src/domain/operations';
import { loadSubscription, type LegacySubscriptionPolicy } from '../src/domain/subscriptions';
import { assertScheduledExportAccess, nextScheduledExportRun, scheduledDownloadExpiry, type ExportSchedule, type ScheduledExportAccess, type ScheduledExportKind } from '../src/domain/scheduledExportPolicy';
import type { ScheduledAccountIdentity, ScheduledAccountLookup } from '../src/domain/scheduledExportManagement';
import { merchantDay } from '../src/domain/operationalReports';
import { BusinessError, ensure, identifier } from '../src/domain/validation';
import { firebaseScheduledAccountLookup } from './scheduledExports';
import { verifyDeployedAccountingRules } from './accountingSecurity';
import { resolveSubscription } from './subscriptions';

export interface ExportAuthorizationOptions {
  lookupAccount?: ScheduledAccountLookup;
  verifySecurity?: () => Promise<void>;
  subscriptionPolicy?: LegacySubscriptionPolicy;
  now?: () => Date;
}

/** Trusted Auth plus transactional entitlement reads, never client-supplied access flags. */
export class LiveExportAuthorization {
  readonly now: () => Date;
  readonly subscriptionPolicy: LegacySubscriptionPolicy;
  private lookup: ScheduledAccountLookup;
  private verify: () => Promise<void>;
  constructor(private store: Store, options: ExportAuthorizationOptions = {}) {
    this.now = options.now || (() => new Date());
    this.lookup = options.lookupAccount || firebaseScheduledAccountLookup;
    this.verify = options.verifySecurity || verifyDeployedAccountingRules;
    this.subscriptionPolicy = options.subscriptionPolicy || resolveSubscription;
  }
  async identity(uid: string): Promise<ScheduledAccountIdentity> {
    ensure(this.store.authority === 'server', 'التصدير المحمي يتطلب خدمة الخادم.', 403);
    identifier(uid);
    try { await this.verify(); }
    catch (error) { if (error instanceof BusinessError) throw error; throw new BusinessError('تعذر تأكيد حماية خدمة التصدير.', 503, 'accounting_rules_not_verified'); }
    let identity: ScheduledAccountIdentity | undefined;
    try { identity = await this.lookup(uid); }
    catch { throw new BusinessError('تعذر تأكيد حالة حساب التصدير حالياً.', 503, 'export_identity_unavailable'); }
    ensure(identity?.uid === uid && identity.disabled === false && identity.emailVerified === true, 'حساب التصدير لم يعد نشطاً أو مؤكداً.', 403);
    return identity;
  }
  async access(tx: Transaction, orgId: string, kind: ScheduledExportKind, identity: ScheduledAccountIdentity) {
    identifier(orgId);
    const actor: Actor = { uid: identity.uid, email: 'export-worker@sudaflow.internal', emailVerified: identity.emailVerified };
    const { org, role } = await membership(tx, orgId, actor);
    const now = this.now(), subscription = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
    const access: ScheduledExportAccess = { authority: 'server', orgId, ownerUid: org.owner_uid, uid: actor.uid, role, emailVerified: identity.emailVerified, accountEnabled: !identity.disabled, activeMember: true, organizationActive: org.status === 'active', accountingVersion: Number(org.accounting_version), subscriptionStatus: subscription.effective_status || subscription.status, subscriptionEnd: subscription.subscription_end ?? null, features: subscription.features, now };
    assertScheduledExportAccess(kind, access);
    return { org, role, actor, access };
  }
  async job(tx: Transaction, job: Document, identity: ScheduledAccountIdentity) {
    ensure(job && ['company', 'accounting', 'auditor'].includes(job.kind), 'نوع ملف التصدير غير صالح.', 409);
    identifier(job.id); identifier(job.org_id); identifier(job.requested_by);
    ensure(job.requested_by === identity.uid, 'منشئ مهمة التصدير غير مطابق.', 403);
    const current = await this.access(tx, job.org_id, job.kind, identity);
    let policy: ExportSchedule | undefined;
    if (job.schedule_id !== undefined) {
      policy = await tx.get(`organizations/${job.org_id}/export_schedules/${identifier(job.schedule_id)}`) as ExportSchedule | undefined;
      ensure(policy && policy.org_id === job.org_id && policy.id === job.schedule_id && policy.created_by === job.requested_by && policy.kind === job.kind && policy.revision === job.policy_revision && policy.active === true, 'سياسة التصدير أو إصدارها لم يعد متاحاً.', 403);
      ensure(!policy.end_date || merchantDay(current.access.now, policy.timezone) <= policy.end_date, 'انتهت فترة جدول التصدير.', 410);
      const due=new Date(job.scheduled_for);
      ensure(Number.isFinite(due.getTime())&&due.toISOString()===job.scheduled_for&&due<=current.access.now&&nextScheduledExportRun(policy,new Date(due.getTime()-1))===job.scheduled_for,'موعد الملف المجدول لا يطابق السياسة الحالية.',409);
    }
    return { ...current, policy };
  }
  async download(tx: Transaction, orgId: string, collection: string, jobId: string, job: Document | undefined, creator: ScheduledAccountIdentity, requester: ScheduledAccountIdentity) {
    ensure(job && job.id === jobId && job.org_id === orgId && job.status === 'completed' && job.artifact, 'ملف التصدير غير متاح.', 404);
    ensure(collection === (job.kind === 'company' ? 'company_export_jobs' : 'accounting_export_jobs'), 'نوع الملف لا يطابق مجموعته.', 409);
    const original = await this.job(tx, job, creator), actor = await this.access(tx, orgId, job.kind, requester);
    ensure(requester.uid === job.requested_by || actor.role === 'Owner' && actor.org.owner_uid === requester.uid, 'الملف متاح لمنشئه أو المالك الفعلي.', 403);
    const a = job.artifact;
    ensure(Number.isSafeInteger(job.attempt) && job.attempt >= 1 && typeof a.filename === 'string' && /^[A-Za-z0-9._-]+$/.test(a.filename) && a.path === `organizations/${orgId}/exports/${jobId}/attempt-${job.attempt}/${a.filename}` && /^[a-f0-9]{64}$/.test(a.sha256) && Number.isSafeInteger(a.byte_size) && a.byte_size > 0 && a.byte_size <= 25000000, 'دليل ملف التصدير غير مطابق.', 409);
    let expires: string;
    if (original.policy) expires = scheduledDownloadExpiry(original.policy, { org_id: orgId, schedule_id: job.schedule_id, policy_revision: job.policy_revision, requested_by: job.requested_by, completed_at: job.completed_at, expires_at: job.expires_at }, actor.access);
    else {
      const completed = Date.parse(job.completed_at), end = Date.parse(job.expires_at), now = this.now().getTime();
      ensure(Number.isFinite(completed) && Number.isFinite(end) && new Date(completed).toISOString()===job.completed_at && new Date(end).toISOString()===job.expires_at && end === completed + 86400000 && completed <= now, 'دليل انتهاء ملف التصدير غير صالح.', 409);
      ensure(end > now, 'انتهت صلاحية ملف التصدير.', 410);
      expires = new Date(Math.min(end, now + 300000)).toISOString();
    }
    return { role: actor.role, expires_at: expires };
  }
}
