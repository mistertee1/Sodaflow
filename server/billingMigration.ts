import { createHash } from 'node:crypto';
import type { Document, Store, Transaction } from '../src/domain/store';
import type { Organization } from '../src/types';
import type { LegacySubscriptionPolicy } from '../src/domain/subscriptions';
import { loadSubscription, subscriptionStatus } from '../src/domain/subscriptions';
import { defaultPlatformPlans } from '../src/lib/plans';
import { ensure, identifier } from '../src/domain/validation';
import { resolveSubscription } from './subscriptions';

export interface BillingMigrationOptions {
  apply: boolean;
  operator: string;
  now?: Date;
  legacyPolicy?: LegacySubscriptionPolicy;
}
export interface InvoiceHistoryEvidence {
  invoiceCount: number;
  numberCount: number;
  invoiceEvents: number;
  firstInvoiceAt?: string;
}
const validCount = (value: unknown) => {
  const count = value ?? 0;
  ensure(Number.isSafeInteger(count) && Number(count) >= 0, 'Invoice usage requires review: expected a non-negative safe integer.');
  return Number(count);
};
const billingValue = (org: Document, lifetimeInvoiceCount: number) => ({ planId: org.planId ?? null, subscriptionStatus: org.subscriptionStatus ?? null, subscriptionStart: org.subscriptionStart ?? null, subscriptionEnd: org.subscriptionEnd ?? null, billingRevision: org.billingRevision ?? 0, lifetimeInvoiceCount });

/** Technical migration only. The CLI defaults to preview; it is not a tenant API. */
export async function initializeBillingPlans(store: Store, options: BillingMigrationOptions) {
  const now = (options.now || new Date()).toISOString();
  return store.transaction(async tx => {
    const saved = await tx.list('plans');
    const missing = defaultPlatformPlans(now).filter(plan => !saved.some(item => item.id === plan.id));
    if (options.apply) for (const plan of missing) {
      tx.set(`plans/${plan.id}`, plan);
      tx.set(`subscriptionEvents/initialize-${plan.id}`, { id: `initialize-${plan.id}`, organizationId: null, action: 'plan.initialize', previousValue: null, newValue: plan, performedBy: options.operator, createdAt: now, reason: 'Initialize missing plan definition', method: 'migration', operationId: `initialize-${plan.id}` });
    }
    return missing.map(plan => plan.id);
  });
}

export async function migrateBillingOrganization(tx: Transaction, orgId: string, evidence: InvoiceHistoryEvidence, options: BillingMigrationOptions): Promise<'migrated' | 'unchanged'> {
  identifier(orgId);
  const now = options.now || new Date(), iso = now.toISOString(), root = `organizations/${orgId}`;
  const org = await tx.get(root) as Organization | undefined;
  ensure(org, 'Organization disappeared during migration.');
  const saved = await tx.get(`${root}/meta/subscription`), usage = await tx.get(`${root}/meta/usage`), counters = await tx.get(`${root}/meta/counters`);
  const policy = options.legacyPolicy || resolveSubscription, legacy = policy(saved, orgId);
  // Never convert an unverifiable legacy paid claim into Free or invent its term.
  ensure(org.planId || !saved?.plan || saved.plan === 'Free' || legacy.plan === saved.plan, 'Unverified legacy paid subscription: supply the original billing verification secret or review the contract.');
  const lifetime = Math.max(...[usage?.lifetimeInvoiceCount, counters?.lifetime_invoice_count, counters?.invoice_count, evidence.invoiceCount, evidence.numberCount, evidence.invoiceEvents].map(validCount));
  const subscription = await loadSubscription(tx, orgId, org, now, policy), plan = subscription.plan_definition!;
  const status = subscriptionStatus(org.subscriptionStatus || legacy.status), start = org.subscriptionStart || saved?.updated_at || org.created_at || iso;
  ensure(Number.isFinite(Date.parse(start)), 'Subscription start requires review.');
  const trial = status === 'trial';
  const end = org.subscriptionEnd ?? (trial ? new Date(Date.parse(start) + 7 * 86400000).toISOString() : null);
  ensure(end === null || Number.isFinite(Date.parse(end)), 'Subscription end requires review.');
  const legacyNonExpiring = Boolean(org.subscriptionMetadata?.legacyNonExpiring || !org.planId && !end && legacy.plan !== 'Free');
  const planId = org.planId || legacy.plan;
  ensure(!['active', 'trial'].includes(status) || planId === 'Free' || end || legacyNonExpiring, 'An active paid subscription without an expiry requires contract review.');
  const endMillis = end ? Date.parse(end) : null;
  const request = await tx.get(`${root}/meta/subscription_request`);
  const pending = request?.status === 'pending' && typeof request.operationId === 'string' ? request : null;
  const centralRequest = pending ? await tx.get(`subscriptionRequests/${orgId}`) : undefined;
  const previousTrial = trial ? await tx.get(`billingTrialClaims/${identifier(org.owner_uid)}`) : undefined;
  const complete = Boolean(org.planId && org.subscriptionStatus && org.subscriptionEndMillis === endMillis && org.searchName && usage
    && validCount(usage.lifetimeInvoiceCount) >= lifetime && validCount(counters?.lifetime_invoice_count) >= lifetime
    && (!pending || centralRequest?.operationId === pending.operationId) && (!trial || previousTrial));
  if (complete) return 'unchanged';
  const next: Organization = { ...org, planId, subscriptionStatus: end && endMillis! <= now.getTime() && ['active', 'trial'].includes(status) ? 'expired' : status,
    subscriptionStart: start, subscriptionEnd: end, subscriptionEndMillis: endMillis, renewalAt: org.renewalAt || end,
    billingRevision: validCount(org.billingRevision) + 1, maxUsers: plan.limits.maxUsers, maxBranches: plan.limits.maxBranches, maxWarehouses: plan.limits.maxWarehouses,
    searchName: org.name.normalize('NFKC').trim().toLowerCase(), updated_at: iso,
    subscriptionMetadata: { ...org.subscriptionMetadata, method: org.subscriptionMetadata?.method || 'migration', legacyNonExpiring, trialUsed: Boolean(trial || org.subscriptionMetadata?.trialUsed), migratedAt: iso } };
  const projected = await loadSubscription(tx, orgId, next, now, policy);
  const eventId = 'migrate-' + createHash('sha256').update(`${orgId}:${next.billingRevision}`).digest('hex');
  if (options.apply) {
    tx.set(root, next);
    tx.set(`${root}/meta/subscription`, projected);
    const firstInvoiceAt = evidence.firstInvoiceAt && Number.isFinite(Date.parse(evidence.firstInvoiceAt)) ? new Date(evidence.firstInvoiceAt).toISOString() : null;
    tx.set(`${root}/meta/usage`, { ...usage, lifetimeInvoiceCount: lifetime, firstActualUseAt: usage?.firstActualUseAt || (lifetime ? firstInvoiceAt : null), updatedAt: iso });
    tx.set(`${root}/meta/counters`, { ...counters, lifetime_invoice_count: lifetime, revision: validCount(counters?.revision) + 1, updated_at: iso });
    tx.set(`subscriptionEvents/${eventId}`, { id: eventId, organizationId: orgId, action: 'subscription.migrate', previousValue: billingValue(org, validCount(usage?.lifetimeInvoiceCount)), newValue: billingValue(next, lifetime), performedBy: options.operator, createdAt: iso, reason: 'Preserve existing contract, Owner, records and invoice usage', method: 'migration', operationId: eventId });
    if (trial && !previousTrial) tx.set(`billingTrialClaims/${org.owner_uid}`, { ownerUid: org.owner_uid, organizationId: orgId, startedAt: start, endedAt: end, activatedBy: options.operator });
    if (pending && centralRequest?.operationId !== pending.operationId) tx.set(`subscriptionRequests/${orgId}`, { ...pending, id: orgId, organizationId: orgId, organizationName: org.name });
  }
  return 'migrated';
}
