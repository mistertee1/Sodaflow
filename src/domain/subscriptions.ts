import type { Organization, OrgSubscription, SubscriptionStatus, PlatformPlan } from '../types';
import { createDefaultSubscription, defaultPlatformPlans, isUnlimited } from '../lib/plans';
import type { Document, Transaction } from './store';
import { BusinessError } from './validation';

export type LegacySubscriptionPolicy = (saved: Document | undefined, orgId: string) => OrgSubscription;
export const subscriptionStatus = (status: string): SubscriptionStatus => status === 'trialing' ? 'trial' : status === 'past_due' ? 'expired' : status === 'canceled' ? 'cancelled' : ['trial', 'active', 'suspended', 'expired', 'cancelled'].includes(status) ? status as SubscriptionStatus : 'expired';

export async function loadSubscription(tx: Transaction, orgId: string, org: Organization, now: Date, legacyPolicy: LegacySubscriptionPolicy = (_saved, id) => createDefaultSubscription(id), controlsEnabled = true): Promise<OrgSubscription> {
  // Effective access only: canonical billing documents and usage remain untouched.
  if (!controlsEnabled) {
    const full = defaultPlatformPlans(now.toISOString()).find(plan => plan.id === 'Enterprise')!;
    const legacy = createDefaultSubscription(orgId), unlimited = Number.MAX_SAFE_INTEGER;
    return { ...legacy, plan: org.planId || legacy.plan, plan_id: org.planId || legacy.plan,
      status: 'active', effective_status: 'active', subscription_end: null, renewal_at: null,
      max_members: unlimited, max_branches: unlimited, max_warehouses: unlimited,
      max_invoices_per_month: unlimited, max_invoices_total: unlimited,
      max_customers: unlimited, max_products: unlimited, features: { ...full.features } as OrgSubscription['features'] };
  }
  const saved = await tx.get(`organizations/${orgId}/meta/subscription`);
  const legacy = legacyPolicy(saved, orgId);
  const planId = org.planId || legacy.plan;
  const defaults = defaultPlatformPlans(org.created_at || now.toISOString());
  const plan = (await tx.get(`plans/${planId}`) || defaults.find(p => p.id === planId)) as PlatformPlan | undefined;
  if (!plan) throw new BusinessError('إعداد الباقة غير متاح. تواصل مع إدارة المنصة.', 503, 'plan_unavailable');
  const start = org.subscriptionStart || legacy.created_at || org.created_at || now.toISOString();
  const end = org.planId ? org.subscriptionEnd ?? null : null;
  let status = subscriptionStatus(org.subscriptionStatus || legacy.status);
  if (['active', 'trial'].includes(status) && end !== null && (!Number.isFinite(Date.parse(end)) || Date.parse(end) <= now.getTime())) status = 'expired';
  if (status === 'trial' && !end) status = 'expired';
  // Only Free and explicitly reviewed legacy contracts may be non-expiring.
  if (org.planId && planId !== 'Free' && !end && org.subscriptionMetadata?.legacyNonExpiring !== true) status = 'expired';
  return { ...legacy, plan: planId, plan_id: planId, plan_definition: plan, status, effective_status: status,
    subscription_start: start, subscription_end: end, renewal_at: org.renewalAt ?? end, billing_revision: org.billingRevision || 0,
    max_members: plan.limits.maxUsers, max_branches: plan.limits.maxBranches, max_warehouses: plan.limits.maxWarehouses,
    max_invoices_per_month: plan.limits.invoicePeriod === 'month' ? plan.limits.maxInvoices : 999999,
    max_invoices_total: plan.limits.invoicePeriod === 'lifetime' ? plan.limits.maxInvoices : 999999,
    invoice_period: plan.limits.invoicePeriod, max_customers: plan.limits.maxCustomers, max_products: plan.limits.maxProducts,
    features: { ...plan.features } as OrgSubscription['features'] };
}

export function assertSubscriptionActive(subscription: OrgSubscription) {
  const status = subscription.effective_status || subscriptionStatus(subscription.status);
  if (!['active', 'trial'].includes(status)) throw new BusinessError(status === 'expired' ? 'انتهى الاشتراك. يمكنك قراءة السجلات وطلب التجديد؛ العمليات المحمية متوقفة.' : 'الاشتراك متوقف. تواصل مع إدارة المنصة لإعادة التفعيل.', 403, `subscription_${status}`);
}

export function assertFeature(subscription: OrgSubscription, feature: string) {
  if (subscription.features[feature] !== true) throw new BusinessError('هذه الميزة غير متاحة في الباقة الحالية.', 403, 'feature_unavailable');
}

export function invoiceQuotaReached(subscription: OrgSubscription, lifetime: number, monthly: number) {
  return !isUnlimited(subscription.max_invoices_total ?? 999999) && lifetime >= (subscription.max_invoices_total ?? 999999)
    || !isUnlimited(subscription.max_invoices_per_month) && monthly >= subscription.max_invoices_per_month;
}
