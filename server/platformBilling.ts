import { createHash } from 'node:crypto';
import { FieldPath, Filter, type Firestore, type Query } from 'firebase-admin/firestore';
import type { Actor } from '../src/domain/operations';
import { canonical } from '../src/domain/operations';
import type { Document, Store, Transaction } from '../src/domain/store';
import { BusinessError, ensure, identifier, money, text } from '../src/domain/validation';
import { loadSubscription } from '../src/domain/subscriptions';
import { defaultPlatformPlans } from '../src/lib/plans';
import type { Organization, PlatformPlan, SubscriptionEvent, SubscriptionStatus } from '../src/types';
import { resolveSubscription } from './subscriptions';

const dayMs = 86400000;
const states: SubscriptionStatus[] = ['trial', 'active', 'suspended', 'expired', 'cancelled'];
const billingFields = ['planId', 'subscriptionStatus', 'subscriptionStart', 'subscriptionEnd', 'renewalAt', 'maxUsers', 'maxBranches', 'maxWarehouses', 'subscriptionMetadata', 'billingRevision', 'status'];
const projection = (org: Document) => Object.fromEntries(billingFields.map(key => [key, org[key] ?? null]));
const integer = (value: unknown, min: number, max: number) => { ensure(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, 'الحد أو المدة خارج النطاق المسموح.'); return Number(value); };
const normalizeName = (name: string) => name.normalize('NFKC').trim().toLowerCase();

export function validatePlatformPlan(input: Document, id: string, old?: PlatformPlan): PlatformPlan {
  ensure(input && typeof input === 'object' && input.limits && input.features, 'بيانات الباقة ناقصة.');
  const limits = input.limits;
  ensure(['lifetime', 'month'].includes(limits.invoicePeriod), 'نوع حصة الفواتير غير صالح.');
  ensure(['USD', 'SDG', 'KWD'].includes(input.currency), 'عملة تسعير الباقة غير مدعومة.');
  ensure(typeof input.active === 'boolean', 'حالة الباقة غير صالحة.');
  const price = money(input.price, 2), durationDays = integer(input.durationDays, 0, 3650);
  ensure(id === 'Free' || durationDays > 0, 'الباقات المدفوعة تحتاج مدة اشتراك.');
  ensure(id !== 'Free' || price === 0, 'الباقة Free مجانية.');
  ensure(id !== 'Free' || durationDays === 0 && limits.maxUsers === 2 && limits.maxInvoices === 100 && limits.invoicePeriod === 'lifetime', 'الباقة المجانية: 100 فاتورة إجمالاً، المالك وموظف واحد، وبدون مدة انتهاء تلقائية.');
  const features: Record<string, boolean> = {};
  const keys = Object.keys(input.features);
  ensure(keys.length <= 40, 'عدد الميزات كبير جداً.');
  for (const key of keys) { ensure(/^[a-z][a-z0-9_]{0,63}$/.test(key) && typeof input.features[key] === 'boolean', 'إعداد الميزة غير صالح.'); features[key] = input.features[key]; }
  for (const key of ['advanced_reports', 'multi_currency', 'inventory_tracking', 'audit_trail', 'branches', 'accounting', 'warehouses']) ensure(typeof features[key] === 'boolean', `الميزة ${key} مطلوبة.`);
  const now = new Date().toISOString();
  return { id: identifier(id), name: text(input.name, 120, true), description: text(input.description || '', 1000), price, currency: input.currency, durationDays,
    limits: { maxUsers: integer(limits.maxUsers, 1, 999999), maxBranches: integer(limits.maxBranches, 1, 999999), maxWarehouses: integer(limits.maxWarehouses, 1, 999999), maxInvoices: integer(limits.maxInvoices, 1, 999999), invoicePeriod: limits.invoicePeriod, maxCustomers: integer(limits.maxCustomers, 1, 999999), maxProducts: integer(limits.maxProducts, 1, 999999) },
    features, active: input.active, revision: (old?.revision || 0) + 1, createdAt: old?.createdAt || now, updatedAt: now };
}

/** All commercial mutations use one transaction with immutable events and an idempotency record. */
export class PlatformBilling {
  constructor(private store: Store, private db?: Firestore) {}
  async assertAdmin(actor: Actor, tx?: Transaction) {
    ensure(actor.emailVerified === true, 'أكّد بريدك الإلكتروني قبل إدارة المنصة.', 403);
    if (actor.superAdmin !== true) throw new BusinessError('هذا الحساب لا يملك صلاحية إدارة المنصة.', 403, 'super_admin_required');
    const read = async (transaction: Transaction) => {
      const admin = await transaction.get(`platformAdmins/${identifier(actor.uid)}`);
      ensure(admin?.active === true && admin.role === 'super_admin', 'صلاحية إدارة المنصة غير فعّالة لهذا الحساب.', 403);
    };
    if (tx) await read(tx); else await this.store.transaction(read);
  }
  async plans(actor: Actor): Promise<PlatformPlan[]> {
    await this.assertAdmin(actor);
    return this.catalog();
  }
  async catalog(): Promise<PlatformPlan[]> {
    return this.store.transaction(async tx => {
      const saved = await tx.list('plans') as PlatformPlan[];
      return [...saved, ...defaultPlatformPlans().filter(plan => !saved.some(record => record.id === plan.id))];
    });
  }
  async overview(actor: Actor) {
    await this.assertAdmin(actor);
    const plans = await this.catalog(), now = new Date().toISOString(), soon = new Date(Date.now() + 7 * dayMs).toISOString();
    if (!this.db) {
      const companies = await this.store.transaction(tx => tx.list('organizations'));
      const effective: Document[] = companies.map(company => ({ ...company, effective: company.subscriptionEnd && company.subscriptionEnd <= now && ['active', 'trial'].includes(company.subscriptionStatus) ? 'expired' : company.subscriptionStatus || 'active' }));
      return { total: companies.length, active: effective.filter(company => company.status === 'active' && ['active', 'trial'].includes(company.effective)).length, trial: effective.filter(company => company.effective === 'trial').length, expired: effective.filter(company => company.effective === 'expired').length, expiringSoon: effective.filter(company => ['active', 'trial'].includes(company.effective) && company.subscriptionEnd && company.subscriptionEnd > now && company.subscriptionEnd <= soon).length, distribution: plans.map(plan => ({ planId: plan.id, name: plan.name, count: companies.filter(company => (company.planId || 'Free') === plan.id).length })), needsMigration: companies.filter(company => !company.planId).length };
    }
    const orgs = this.db.collection('organizations');
    const count = async (query: Query) => (await query.count().get()).data().count;
    const current = Filter.and(Filter.where('subscriptionStatus', 'in', ['active', 'trial']), Filter.or(Filter.where('subscriptionEnd', '==', null), Filter.where('subscriptionEnd', '>', now)));
    const expired = Filter.or(Filter.where('subscriptionStatus', '==', 'expired'), Filter.and(Filter.where('subscriptionStatus', 'in', ['active', 'trial']), Filter.where('subscriptionEnd', '<=', now), Filter.where('subscriptionEnd', '>=', '0000-01-01T00:00:00.000Z')));
    const [total, active, trial, expiredCount, expiringSoon, distribution] = await Promise.all([
      count(orgs), count(orgs.where(Filter.and(Filter.where('status', '==', 'active'), current))),
      count(orgs.where('subscriptionStatus', '==', 'trial').where('subscriptionEnd', '>', now)), count(orgs.where(expired)),
      count(orgs.where('subscriptionStatus', 'in', ['active', 'trial']).where('subscriptionEnd', '>', now).where('subscriptionEnd', '<=', soon)),
      Promise.all(plans.map(async plan => ({ planId: plan.id, name: plan.name, count: await count(orgs.where('planId', '==', plan.id)) }))),
    ]);
    return { total, active, trial, expired: expiredCount, expiringSoon, distribution, needsMigration: Math.max(0, total - distribution.reduce((sum, item) => sum + item.count, 0)) };
  }
  async companies(actor: Actor, params: Record<string, unknown>) {
    await this.assertAdmin(actor);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 30));
    const search = normalizeName(text(String(params.q || ''), 120));
    const state = text(String(params.subscriptionStatus || ''), 30), companyStatus = text(String(params.companyStatus || ''), 30);
    ensure(!state || states.includes(state as SubscriptionStatus), 'تصفية الاشتراك غير صالحة.');
    ensure(!companyStatus || ['active', 'suspended', 'archived'].includes(companyStatus), 'تصفية الشركة غير صالحة.');
    const planId = params.planId ? identifier(params.planId) : '';
    let rows: Document[], nextCursor: string | null = null;
    if (this.db) {
      let query: Query = this.db.collection('organizations');
      if (planId) query = query.where('planId', '==', planId);
      if (companyStatus) query = query.where('status', '==', companyStatus);
      if (state === 'expired') query = query.where(Filter.or(Filter.where('subscriptionStatus', '==', 'expired'), Filter.and(Filter.where('subscriptionStatus', 'in', ['active', 'trial']), Filter.where('subscriptionEnd', '<=', new Date().toISOString()), Filter.where('subscriptionEnd', '>=', '0000-01-01T00:00:00.000Z'))));
      else if (state) {
        query = query.where('subscriptionStatus', '==', state);
        if (['active', 'trial'].includes(state)) query = query.where(Filter.or(Filter.where('subscriptionEnd', '==', null), Filter.where('subscriptionEnd', '>', new Date().toISOString())));
      }
      if (search) query = query.where('searchName', '>=', search).where('searchName', '<=', search + '\uf8ff').orderBy('searchName');
      if (['expired', 'active', 'trial'].includes(state)) query = query.orderBy('subscriptionEnd');
      query = query.orderBy(FieldPath.documentId());
      if (params.cursor) {
        const cursor = identifier(params.cursor), previous = await this.db.doc(`organizations/${cursor}`).get();
        ensure(previous.exists, 'مؤشر الصفحة غير متاح. ابدأ من الصفحة الأولى.'); query = query.startAfter(previous);
      }
      const page = await query.limit(limit + 1).get();
      rows = page.docs.slice(0, limit).map(doc => ({ ...doc.data(), id: doc.id }));
      if (page.size > limit) nextCursor = page.docs[limit - 1].id;
    } else {
      rows = await this.store.transaction(tx => tx.list('organizations'));
      const now = new Date().toISOString();
      rows = rows.filter(org => {
        const effective = org.subscriptionEnd && org.subscriptionEnd <= now && ['active', 'trial'].includes(org.subscriptionStatus) ? 'expired' : org.subscriptionStatus || 'active';
        return (!search || normalizeName(org.name).startsWith(search)) && (!planId || org.planId === planId) && (!state || effective === state) && (!companyStatus || org.status === companyStatus);
      }).sort((a, b) => a.id.localeCompare(b.id));
      if (params.cursor) rows = rows.filter(org => org.id > String(params.cursor));
      if (rows.length > limit) nextCursor = rows[limit - 1].id; rows = rows.slice(0, limit);
    }
    const result = await Promise.all(rows.map(org => this.company(actor, org.id)));
    return { items: result, nextCursor };
  }
  async company(actor: Actor, orgId: string) {
    identifier(orgId); await this.assertAdmin(actor);
    return this.store.transaction(async tx => {
      const org = await tx.get(`organizations/${orgId}`) as Organization | undefined;
      ensure(org, 'الشركة غير موجودة.', 404);
      const subscription = await loadSubscription(tx, orgId, org, new Date(), resolveSubscription);
      const members = await tx.list(`organizations/${orgId}/members`), branches = await tx.list(`organizations/${orgId}/branches`), warehouses = await tx.list(`organizations/${orgId}/warehouses`);
      const usage = await tx.get(`organizations/${orgId}/meta/usage`), counters = await tx.get(`organizations/${orgId}/meta/counters`), request = await tx.get(`subscriptionRequests/${orgId}`);
      return { id: orgId, name: org.name, ownerUid: org.owner_uid, companyStatus: org.status, createdAt: org.created_at, updatedAt: org.updated_at, subscription,
        userCount: new Set([...members.map(member => member.uid), org.owner_uid]).size, branchCount: Math.max(1, branches.filter(branch => branch.active !== false).length), warehouseCount: warehouses.filter(warehouse => warehouse.active !== false).length,
        lifetimeInvoiceCount: Math.max(usage?.lifetimeInvoiceCount || 0, counters?.lifetime_invoice_count || 0, counters?.invoice_count || 0), metadata: org.subscriptionMetadata || {}, billingRevision: org.billingRevision || 0, pendingRequest: request?.status === 'pending' ? request : null };
    });
  }
  private mutate(actor: Actor, body: Document, action: string, orgId: string | null, work: (tx: Transaction) => Promise<{ previous: Document | null; next: Document; result: Document }>) {
    identifier(actor.uid); const operationId = identifier(body.operationId), reason = text(body.reason, 1000, true);
    const method = text(body.method || 'manual', 50, true); ensure(['manual', 'bank_transfer', 'cash', 'migration', 'payment_gateway'].includes(method), 'طريقة التفعيل غير صالحة.');
    const key = createHash('sha256').update(`${actor.uid}:${operationId}`).digest('hex');
    const fingerprint = createHash('sha256').update(canonical({ body, action, orgId })).digest('hex');
    return this.store.transaction(async tx => {
      await this.assertAdmin(actor, tx);
      const path = `platformOperations/${key}`, old = await tx.get(path);
      if (old) { ensure(old.fingerprint === fingerprint, 'معرّف العملية مستخدم لتعديل مختلف.', 409); return old.result; }
      const ratePath = `platformRateLimits/${actor.uid}`, rate = await tx.get(ratePath), minute = new Date().toISOString().slice(0, 16);
      ensure(rate?.minute !== minute || rate.count < 60, 'طلبات إدارية كثيرة. حاول بعد دقيقة.', 429);
      const update = await work(tx);
      const event: SubscriptionEvent = { id: `event-${key}`, organizationId: orgId, action, previousValue: update.previous, newValue: update.next, performedBy: actor.uid, performedByEmail: actor.email, createdAt: new Date().toISOString(), reason, method, operationId };
      tx.set(`subscriptionEvents/${event.id}`, event);
      tx.set(path, { fingerprint, result: update.result, actorUid: actor.uid, createdAt: event.createdAt });
      tx.set(ratePath, { minute, count: rate?.minute === minute ? rate.count + 1 : 1 });
      return update.result;
    });
  }
  updatePlan(actor: Actor, id: string, body: Document) {
    identifier(id);
    return this.mutate(actor, body, 'plan.save', null, async tx => {
      const old = (await tx.get(`plans/${id}`) || defaultPlatformPlans().find(plan => plan.id === id)) as PlatformPlan | undefined;
      ensure(Number(body.expectedRevision) === (old?.revision || 0), 'الباقة تغيّرت. حدّث البيانات قبل الحفظ.', 409);
      const plan = validatePlatformPlan(body.plan, id, old);
      tx.set(`plans/${id}`, plan);
      return { previous: old || null, next: plan, result: plan };
    });
  }
  updateSubscription(actor: Actor, orgId: string, body: Document) {
    identifier(orgId); const action = text(body.action, 40, true);
    ensure(['set_status', 'change_plan', 'extend', 'renew', 'company_status', 'reject_request'].includes(action), 'عملية الاشتراك غير مدعومة.');
    return this.mutate(actor, body, `subscription.${action}`, orgId, async tx => {
      const root = `organizations/${orgId}`, org = await tx.get(root) as Organization | undefined;
      ensure(org, 'الشركة غير موجودة.', 404);
      ensure(Number(body.expectedRevision) === (org.billingRevision || 0), 'اشتراك الشركة تغيّر. حدّث البيانات قبل الحفظ.', 409);
      const current = await loadSubscription(tx, orgId, org, new Date(), resolveSubscription);
      const now = new Date(), payload = body.payload || {};
      const next: Organization = { ...org, planId: current.plan_id, subscriptionStatus: current.effective_status,
        subscriptionStart: current.subscription_start, subscriptionEnd: current.subscription_end ?? null, renewalAt: current.renewal_at ?? null,
        billingRevision: (org.billingRevision || 0) + 1, searchName: normalizeName(org.name), updated_at: now.toISOString() };
      let plan = current.plan_definition!;
      if (action === 'change_plan') {
        const id = identifier(payload.planId); plan = (await tx.get(`plans/${id}`) || defaultPlatformPlans().find(item => item.id === id)) as PlatformPlan;
        ensure(plan?.active, 'الباقة غير موجودة أو غير متاحة للتفعيل.'); next.planId = id;
      }
      if (action === 'change_plan' || action === 'renew') {
        ensure(plan.active, 'الباقة معطلة للتفعيل أو التجديد. اختر باقة فعّالة.');
        const days = payload.days === undefined ? plan.durationDays : integer(payload.days, 1, 3650);
        next.subscriptionStart = now.toISOString(); next.subscriptionEnd = days ? new Date(now.getTime() + days * dayMs).toISOString() : null; next.subscriptionStatus = 'active';
      } else if (action === 'extend') {
        ensure(current.effective_status !== 'trial', 'الفترة التجريبية 7 أيام لمرة واحدة؛ فعّل اشتراكاً بدلاً من تمديدها.');
        const days = integer(payload.days, 1, 3650), base = Math.max(now.getTime(), Date.parse(next.subscriptionEnd || '') || 0);
        next.subscriptionEnd = new Date(base + days * dayMs).toISOString();
        if (next.subscriptionStatus === 'expired') next.subscriptionStatus = 'active';
      } else if (action === 'set_status') {
        ensure(states.includes(payload.status), 'حالة الاشتراك غير صالحة.'); next.subscriptionStatus = payload.status;
        if (payload.status === 'trial') {
          const claimed = await tx.get(`billingTrialClaims/${identifier(org.owner_uid)}`);
          const owned = await tx.find('organizations', 'owner_uid', org.owner_uid);
          ensure(!owned.some(company => company.subscriptionMetadata?.trialUsed === true || company.subscriptionStatus === 'trial'), 'مالك الشركة استخدم التجربة من قبل.', 409);
          ensure(!claimed, 'مالك الشركة استخدم التجربة من قبل؛ التجربة 7 أيام لمرة واحدة.', 409);
          ensure(org.subscriptionMetadata?.trialUsed !== true && current.effective_status !== 'trial', 'هذه الشركة استخدمت الفترة التجريبية من قبل.', 409);
          next.subscriptionStart = now.toISOString(); next.subscriptionEnd = new Date(now.getTime() + 7 * dayMs).toISOString();
          next.subscriptionMetadata = { ...org.subscriptionMetadata, trialUsed: true, trialStartedAt: now.toISOString(), trialEndedAt: next.subscriptionEnd };
          tx.set(`billingTrialClaims/${org.owner_uid}`, { ownerUid: org.owner_uid, organizationId: orgId, startedAt: next.subscriptionStart, endedAt: next.subscriptionEnd, activatedBy: actor.uid });
        } else if (payload.end) { ensure(typeof payload.end === 'string' && Number.isFinite(Date.parse(payload.end)) && Date.parse(payload.end) <= now.getTime() + 3650 * dayMs, 'تاريخ نهاية الاشتراك غير صالح أو يتجاوز 10 سنوات.'); next.subscriptionEnd = new Date(payload.end).toISOString(); }
        if (['active', 'trial'].includes(payload.status)) ensure(payload.status === 'active' && next.planId === 'Free' && !next.subscriptionEnd || next.subscriptionEnd && Date.parse(next.subscriptionEnd) > now.getTime(), 'التفعيل يحتاج تاريخ نهاية مستقبلي؛ جدّد أو مدّد الاشتراك أولاً.');
      } else if (action === 'company_status') {
        ensure(['active', 'suspended', 'archived'].includes(payload.status), 'حالة الشركة غير صالحة.'); next.status = payload.status;
      }
      next.renewalAt = next.subscriptionEnd;
      if (payload.requestOperationId || action === 'reject_request') {
        const request = await tx.get(`subscriptionRequests/${orgId}`);
        ensure(request?.status === 'pending' && request.operationId === payload.requestOperationId, 'طلب الترقية تغيّر. حدّث البيانات قبل معالجته.', 409);
        ensure(action === 'reject_request' || action === 'change_plan' && request.requested_plan === next.planId, 'الباقة لا تطابق طلب الترقية.');
        const resolved = { ...request, status: action === 'reject_request' ? 'rejected' : 'fulfilled', resolvedAt: now.toISOString(), resolvedBy: actor.uid, reason: body.reason };
        tx.set(`subscriptionRequests/${orgId}`, resolved); tx.set(`${root}/meta/subscription_request`, resolved);
      }
      next.subscriptionEndMillis = next.subscriptionEnd ? Date.parse(next.subscriptionEnd) : null;
      next.maxUsers = plan.limits.maxUsers; next.maxBranches = plan.limits.maxBranches; next.maxWarehouses = plan.limits.maxWarehouses;
      next.subscriptionMetadata = { ...(next.subscriptionMetadata || org.subscriptionMetadata), legacyNonExpiring: Boolean(org.subscriptionMetadata?.legacyNonExpiring && !['renew', 'change_plan', 'extend', 'set_status'].includes(action)), method: body.method || 'manual', lastAction: action, updatedBy: actor.uid, updatedAt: now.toISOString(), providerReference: text(payload.providerReference || '', 200) };
      tx.set(root, next);
      // The read projection is compatibility data. Entitlements always reread the canonical root and live plan.
      const projected = { ...current, plan: next.planId, plan_id: next.planId, plan_definition: plan, status: next.subscriptionStatus, effective_status: next.subscriptionStatus, subscription_start: next.subscriptionStart, subscription_end: next.subscriptionEnd, renewal_at: next.renewalAt, billing_revision: next.billingRevision, max_members: plan.limits.maxUsers, max_branches: plan.limits.maxBranches, max_warehouses: plan.limits.maxWarehouses, max_invoices_total: plan.limits.invoicePeriod === 'lifetime' ? plan.limits.maxInvoices : 999999, max_invoices_per_month: plan.limits.invoicePeriod === 'month' ? plan.limits.maxInvoices : 999999, invoice_period: plan.limits.invoicePeriod, max_customers: plan.limits.maxCustomers, max_products: plan.limits.maxProducts, features: { ...plan.features } };
      tx.set(`${root}/meta/subscription`, projected);
      return { previous: projection(org), next: projection(next), result: { organizationId: orgId, billingRevision: next.billingRevision, subscription: projected } };
    });
  }
  async requests(actor: Actor, params: Record<string, unknown>) {
    await this.assertAdmin(actor);
    if (!this.db) return { items: (await this.store.transaction(tx => tx.list('subscriptionRequests'))).filter(request => request.status === 'pending'), nextCursor: null };
    let query: Query = this.db.collection('subscriptionRequests').where('status', '==', 'pending').orderBy('created_at', 'desc').orderBy(FieldPath.documentId());
    if (params.cursor) { const previous = await this.db.doc(`subscriptionRequests/${identifier(params.cursor)}`).get(); ensure(previous.exists, 'مؤشر صفحة الطلبات غير صالح.'); query = query.startAfter(previous); }
    const page = await query.limit(51).get();
    return { items: page.docs.slice(0, 50).map(doc => doc.data()), nextCursor: page.size > 50 ? page.docs[49].id : null };
  }
  async events(actor: Actor, params: Record<string, unknown>) {
    await this.assertAdmin(actor);
    const orgId = params.organizationId ? identifier(params.organizationId) : '', limit = 50;
    if (this.db) {
      let query: Query = this.db.collection('subscriptionEvents');
      if (orgId) query = query.where('organizationId', '==', orgId);
      query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId());
      if (params.cursor) { const previous = await this.db.doc(`subscriptionEvents/${identifier(params.cursor)}`).get(); ensure(previous.exists, 'مؤشر سجل العمليات غير صالح.'); query = query.startAfter(previous); }
      const page = await query.limit(limit + 1).get();
      return { items: page.docs.slice(0, limit).map(doc => doc.data()), nextCursor: page.size > limit ? page.docs[limit - 1].id : null };
    }
    const events = await this.store.transaction(tx => tx.list('subscriptionEvents'));
    return { items: events.filter(event => !orgId || event.organizationId === orgId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit), nextCursor: null };
  }
}
