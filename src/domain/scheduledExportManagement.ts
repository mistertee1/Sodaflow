import { createHash } from 'node:crypto';
import { canonical, membership, type Actor } from './operations';
import type { Document, Store, Transaction } from './store';
import { BusinessError, ensure, identifier } from './validation';
import { loadSubscription, type LegacySubscriptionPolicy } from './subscriptions';
import { createDefaultSubscription } from '../lib/plans';
import {
  assertScheduledExportAccess, createExportSchedule, updateExportSchedule,
  type ExportSchedule, type ScheduledExportAccess,
} from './scheduledExportPolicy';

export interface ScheduledAccountIdentity { uid: string; emailVerified: boolean; disabled: boolean; }
/** A trusted Firebase Admin lookup; no caller-provided identity or access flags. */
export type ScheduledAccountLookup = (uid: string) => Promise<ScheduledAccountIdentity | undefined>;
export interface ExportScheduleList {
  org_id: string; generated_at: string; schedules: ExportSchedule[]; execution_enabled: false;
}
export const MAX_EXPORT_SCHEDULES = 20;
export const scheduledExportDueKey = (orgId: string, scheduleId: string) =>
  createHash('sha256').update(canonical({ org_id: identifier(orgId), schedule_id: identifier(scheduleId) })).digest('hex');

function request(value: unknown, keys: string[]): Document {
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)), 'حقول إدارة جدول التصدير غير صالحة أو محمية.');
  return value as Document;
}
function operationId(value: unknown) {
  const id = identifier(value); ensure(id.length <= 64, 'معرّف العملية طويل جداً.'); return id;
}
function flatFields(value: unknown): Document {
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 12
    && Object.values(value).every(field => field === null || field === undefined || typeof field === 'boolean'
      || typeof field === 'number' && Number.isFinite(field) || typeof field === 'string' && field.length <= 120), 'قيم حقول جدول التصدير غير صالحة.');
  return value as Document;
}
const policyPath = (orgId: string, id: string) => `organizations/${identifier(orgId)}/export_schedules/${identifier(id)}`;

/** Cloud policy management only. Saving a due index never executes an export. */
export class ScheduledExportManagement {
  constructor(
    private store: Store,
    private lookupAccount: ScheduledAccountLookup,
    private subscriptionPolicy: LegacySubscriptionPolicy = (_saved, id) => createDefaultSubscription(id),
    private now: () => Date = () => new Date(),
    private verifySecurity?: () => Promise<void>,
  ) {}

  private async account(actor: Actor) {
    ensure(this.store.authority === 'server', 'إدارة جداول التصدير تتطلب خدمة الخادم السحابية.', 403);
    identifier(actor.uid);
    ensure(actor.emailVerified === true, 'أكّد بريدك الإلكتروني قبل إدارة جداول التصدير.', 403);
    if (!this.verifySecurity) throw new BusinessError('التحقق من قواعد حماية جداول التصدير غير مهيأ.', 503, 'accounting_rules_not_verified');
    await this.verifySecurity();
    const account = await this.lookupAccount(actor.uid);
    ensure(account && account.uid === actor.uid && account.disabled === false && account.emailVerified === true, 'حساب التصدير غير متاح أو غير مؤكد.', 403);
    return account;
  }

  private async access(tx: Transaction, orgId: string, actor: Actor, account: ScheduledAccountIdentity, now: Date): Promise<ScheduledExportAccess> {
    // Always use the actual stored role and canonical entitlements here. The
    // platform pause's request-scoped Owner elevation is not an export grant.
    const { org, role } = await membership(tx, orgId, actor);
    const subscription = await loadSubscription(tx, orgId, org, now, this.subscriptionPolicy);
    return {
      authority: 'server', orgId, ownerUid: org.owner_uid, uid: actor.uid, role,
      emailVerified: account.emailVerified && actor.emailVerified,
      activeMember: true, accountEnabled: !account.disabled, organizationActive: org.status === 'active',
      accountingVersion: Number(org.accounting_version), subscriptionStatus: subscription.effective_status || subscription.status,
      subscriptionEnd: subscription.subscription_end ?? null, features: subscription.features, now,
    };
  }

  async list(orgId: string, actor: Actor): Promise<ExportScheduleList> {
    identifier(orgId); const account = await this.account(actor);
    return this.store.transaction(async tx => {
      const now = this.now(), access = await this.access(tx, orgId, actor, account, now);
      assertScheduledExportAccess(access.role === 'Owner' ? 'company' : 'accounting', access);
      const records = await tx.list(`organizations/${orgId}/export_schedules`, { limit: MAX_EXPORT_SCHEDULES + 1 });
      ensure(records.length <= MAX_EXPORT_SCHEDULES, 'عدد جداول التصدير يتجاوز الحد المسموح؛ راجع الدعم.', 409);
      const schedules: ExportSchedule[] = [];
      for (const row of records) {
        ensure(row.org_id === orgId && row.schema_version === 1, 'دليل مؤسسة جدول التصدير غير صالح.', 409);
        if (row.created_by !== actor.uid && access.role !== 'Owner') continue;
        try { assertScheduledExportAccess(row.kind, access); }
        catch (error) { if (error instanceof BusinessError && error.status === 403) continue; throw error; }
        schedules.push(row as ExportSchedule);
      }
      schedules.sort((a, b) => a.id.localeCompare(b.id));
      return { org_id: orgId, generated_at: now.toISOString(), schedules, execution_enabled: false };
    });
  }

  async create(orgId: string, actor: Actor, value: unknown) {
    const data = request(value, ['operationId', 'input']);
    return this.save(orgId, actor, operationId(data.operationId), 'create', flatFields(data.input));
  }

  async update(orgId: string, actor: Actor, id: string, value: unknown) {
    identifier(id);
    const data = request(value, ['operationId', 'expected_revision', 'updates']);
    ensure(Number.isSafeInteger(data.expected_revision) && data.expected_revision >= 1, 'إصدار جدول التصدير مطلوب.');
    return this.save(orgId, actor, operationId(data.operationId), 'update', { id, expected_revision: data.expected_revision, updates: flatFields(data.updates) });
  }

  private async save(orgId: string, actor: Actor, id: string, action: 'create' | 'update', input: unknown): Promise<{ org_id: string; schedule: ExportSchedule; execution_enabled: false }> {
    identifier(orgId);
    const account = await this.account(actor), command = `exportSchedule.${action}`;
    const fingerprint = createHash('sha256').update(canonical({ action: command, orgId, uid: actor.uid, input })).digest('hex');
    return this.store.transaction(async tx => {
      const now = this.now(), at = now.toISOString(), root = `organizations/${orgId}`, access = await this.access(tx, orgId, actor, account, now);
      const prior = action === 'update' ? await tx.get(policyPath(orgId, (input as Document).id)) as ExportSchedule | undefined : undefined;
      if (action === 'update') ensure(prior && prior.org_id === orgId, 'جدول التصدير غير موجود.', 404);
      // Check live access and ownership before any idempotent response. A
      // receipt cannot expose a policy after membership or subscription changes.
      if (prior) {
        assertScheduledExportAccess(prior.kind, access);
        ensure(prior.created_by === actor.uid || access.role === 'Owner', 'تعديل الجدول متاح لمنشئه أو المالك الفعلي.', 403);
      }
      const candidate = action === 'create' ? createExportSchedule(input, access, id) : undefined;
      const receiptPath = `${root}/idempotency/${id}`, receipt = await tx.get(receiptPath);
      if (receipt) {
        ensure(receipt.action === command && receipt.actor_uid === actor.uid && receipt.fingerprint === fingerprint, 'معرّف العملية مستخدم لطلب مختلف.', 409);
        const saved = receipt.response?.schedule, current = prior || (saved && await tx.get(policyPath(orgId, saved.id)));
        ensure(saved && current && current.org_id === orgId && current.id === saved.id && current.created_by === saved.created_by
          && current.kind === saved.kind && current.revision === saved.revision, 'تغير الجدول بعد الطلب المحفوظ؛ حدّث البيانات.', 409);
        return { org_id: orgId, schedule: current as ExportSchedule, execution_enabled: false };
      }
      const schedule = candidate || updateExportSchedule(prior!, input, access);
      const registryPath = `${root}/meta/export_schedule_control`;
      if (action === 'create') {
        ensure(!await tx.get(policyPath(orgId, schedule.id)), 'معرّف جدول التصدير مستخدم.', 409);
        const existing = await tx.list(`${root}/export_schedules`, { limit: MAX_EXPORT_SCHEDULES });
        ensure(existing.length < MAX_EXPORT_SCHEDULES, `الحد الأقصى ${MAX_EXPORT_SCHEDULES} جدولاً للمؤسسة.`, 409);
        const registry = await tx.get(registryPath);
        ensure(!registry || registry.org_id === orgId && registry.schema_version === 1 && registry.count === existing.length, 'عدد جداول التصدير لا يطابق سجلها الخادمي.', 409);
        // The common organization registry also serializes different creators,
        // rather than relying on per-user rate records to protect the bound.
        tx.set(registryPath, { schema_version: 1, org_id: orgId, count: existing.length + 1, updated_at: at });
      }
      const ratePath = `${root}/rate_limits/scheduled-export-${actor.uid}`, rate = await tx.get(ratePath), minute = at.slice(0, 16);
      ensure(rate?.minute !== minute || rate.count < 120, 'طلبات جداول كثيرة؛ حاول بعد دقيقة.', 429);
      const duePath = `scheduled_export_due/${scheduledExportDueKey(orgId, schedule.id)}`;
      const auditId = `audit-${id}`, eventType = action === 'create' ? 'EXPORT_SCHEDULE_CREATED' : prior!.active && !schedule.active ? 'EXPORT_SCHEDULE_PAUSED' : !prior!.active && schedule.active ? 'EXPORT_SCHEDULE_RESUMED' : 'EXPORT_SCHEDULE_UPDATED';
      const response = { org_id: orgId, schedule, execution_enabled: false as const };
      tx.set(policyPath(orgId, schedule.id), schedule);
      if (schedule.active && schedule.next_run_at) tx.set(duePath, { id: scheduledExportDueKey(orgId, schedule.id), org_id: orgId, schedule_id: schedule.id, policy_revision: schedule.revision, next_run_at: schedule.next_run_at, updated_at: at });
      else tx.delete(duePath);
      tx.set(ratePath, { uid: actor.uid, minute, count: rate?.minute === minute ? rate.count + 1 : 1 });
      tx.set(`${root}/audit_logs/${auditId}`, { id: auditId, org_id: orgId, action: command, event_type: eventType, actor_uid: actor.uid, entity_type: 'export_schedule', entity_id: schedule.id, operation_id: id, created_at: at, previous_value: prior || null, new_value: schedule });
      tx.set(receiptPath, { action: command, actor_uid: actor.uid, fingerprint, response, created_at: at });
      return response;
    });
  }
}
