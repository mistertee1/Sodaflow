import 'dotenv/config';
import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { adminServices } from '../server/admin';
import { FirestoreStore } from '../server/firestoreStore';
import { resolveSubscription } from '../server/subscriptions';
import { defaultPlatformPlans } from '../src/lib/plans';
import { loadSubscription, subscriptionStatus } from '../src/domain/subscriptions';
import { ensure } from '../src/domain/validation';
import type { Organization } from '../src/types';

const apply = process.argv.includes('--apply'), { db } = adminServices(), store = new FirestoreStore(db);
const operator = process.env.GITHUB_ACTOR || 'technical-migration';
const now = new Date().toISOString();
// Initialize defaults only when missing; never overwrite a commercial administrator's edits.
await store.transaction(async tx => {
  const saved = await tx.list('plans');
  for (const plan of defaultPlatformPlans(now)) if (!saved.some(item => item.id === plan.id)) {
    if (apply) {
      tx.set(`plans/${plan.id}`, plan);
      tx.set(`subscriptionEvents/initialize-${plan.id}`, { id: `initialize-${plan.id}`, organizationId: null, action: 'plan.initialize', previousValue: null, newValue: plan, performedBy: operator, createdAt: now, reason: 'Initialize missing plan definition', method: 'migration', operationId: `initialize-${plan.id}` });
    }
  }
});
let query = db.collection('organizations').orderBy(FieldPath.documentId()).limit(100), migrated = 0, unchanged = 0, blocked = 0;
for (;;) {
  const page = await query.get();
  for (const document of page.docs) {
    try {
      const root = document.ref.path;
      const count = async (path: string) => (await db.collection(path).count().get()).data().count;
      const [invoiceCount, numberCount, invoiceEvents] = await Promise.all([count(`${root}/invoices`), count(`${root}/invoice_numbers`), db.collection(`${root}/audit_logs`).where('action', '==', 'invoice.create').count().get().then(snapshot => snapshot.data().count)]);
      const outcome = await store.transaction(async tx => {
        const org = await tx.get(root) as Organization; ensure(org, 'Organization disappeared during migration.');
        const saved = await tx.get(`${root}/meta/subscription`), usage = await tx.get(`${root}/meta/usage`), counters = await tx.get(`${root}/meta/counters`);
        if (org.planId && org.subscriptionStatus && org.subscriptionEndMillis !== undefined && org.searchName && usage) return 'unchanged';
        const legacy = resolveSubscription(saved, document.id);
        // An unverifiable paid claim needs review; never invent a paid term or silently downgrade it.
        ensure(org.planId || !saved?.plan || saved.plan === 'Free' || legacy.plan === saved.plan, 'Unverified legacy paid subscription: supply the original billing verification secret or review the contract.');
        const subscription = await loadSubscription(tx, document.id, org, new Date(), resolveSubscription);
        const status = subscriptionStatus(org.subscriptionStatus || legacy.status);
        const start = org.subscriptionStart || saved?.updated_at || org.created_at || now;
        ensure(Number.isFinite(Date.parse(start)), 'Subscription start requires review.');
        const trial = status === 'trial';
        const end = org.subscriptionEnd ?? (trial ? new Date(Date.parse(start) + 7 * 86400000).toISOString() : null);
        ensure(end === null || Number.isFinite(Date.parse(end)), 'Subscription end requires review.');
        const plan = subscription.plan_definition!;
        const lifetime = Math.max(usage?.lifetimeInvoiceCount || 0, counters?.lifetime_invoice_count || 0, counters?.invoice_count || 0, invoiceCount, numberCount, invoiceEvents);
        const next = { ...org, planId: org.planId || legacy.plan, subscriptionStatus: end && Date.parse(end) <= Date.now() && ['active', 'trial'].includes(status) ? 'expired' : status,
          subscriptionStart: start, subscriptionEnd: end, subscriptionEndMillis: end ? Date.parse(end) : null, renewalAt: org.renewalAt || end,
          billingRevision: (org.billingRevision || 0) + 1, maxUsers: plan.limits.maxUsers, maxBranches: plan.limits.maxBranches, maxWarehouses: plan.limits.maxWarehouses,
          searchName: org.name.normalize('NFKC').trim().toLowerCase(), updated_at: now,
          subscriptionMetadata: { ...org.subscriptionMetadata, method: 'migration', legacyNonExpiring: Boolean(org.subscriptionMetadata?.legacyNonExpiring || !org.planId && !end && legacy.plan !== 'Free'), trialUsed: Boolean(trial || org.subscriptionMetadata?.trialUsed), migratedAt: now } };
        const eventId = 'migrate-' + createHash('sha256').update(`${document.id}:${next.billingRevision}`).digest('hex');
        const old = { planId: org.planId || null, subscriptionStatus: org.subscriptionStatus || null, subscriptionEnd: org.subscriptionEnd || null, billingRevision: org.billingRevision || 0 };
        const previousTrial = trial ? await tx.get(`billingTrialClaims/${org.owner_uid}`) : undefined;
        if (apply) {
          tx.set(root, next);
          tx.set(`${root}/meta/usage`, { ...usage, lifetimeInvoiceCount: lifetime, firstActualUseAt: usage?.firstActualUseAt || (lifetime ? org.created_at : null), updatedAt: now });
          tx.set(`${root}/meta/counters`, { ...counters, lifetime_invoice_count: lifetime, revision: (counters?.revision || 0) + 1, updated_at: now });
          tx.set(`subscriptionEvents/${eventId}`, { id: eventId, organizationId: document.id, action: 'subscription.migrate', previousValue: old, newValue: { planId: next.planId, subscriptionStatus: next.subscriptionStatus, subscriptionEnd: end, billingRevision: next.billingRevision, lifetimeInvoiceCount: lifetime }, performedBy: operator, createdAt: now, reason: 'Preserve existing contract, Owner, records and invoice usage', method: 'migration', operationId: eventId });
          if (trial && !previousTrial) tx.set(`billingTrialClaims/${org.owner_uid}`, { ownerUid: org.owner_uid, organizationId: document.id, startedAt: start, endedAt: end, activatedBy: operator });
          const request = await tx.get(`${root}/meta/subscription_request`);
          if (request?.status === 'pending' && request.operationId) tx.set(`subscriptionRequests/${document.id}`, { ...request, id: document.id, organizationId: document.id, organizationName: org.name });
        }
        return 'migrated';
      });
      if (outcome === 'unchanged') unchanged++; else migrated++;
    } catch (error) { blocked++; console.error(JSON.stringify({ organizationId: document.id, error: error instanceof Error ? error.message : 'Migration failed' })); }
  }
  if (page.size < 100) break;
  query = query.startAfter(page.docs.at(-1)!);
}
console.log(JSON.stringify({ apply, migrated, unchanged, blocked }));
if (blocked) process.exitCode = 2;
