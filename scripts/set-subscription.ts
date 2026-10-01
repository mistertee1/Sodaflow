import 'dotenv/config';
import { adminServices } from '../server/admin';
import { signSubscription } from '../server/subscriptions';
import { createDefaultSubscription, getPlanConfig, PLAN_TIERS } from '../src/lib/plans';
import { identifier, ensure } from '../src/domain/validation';
import type { SubscriptionPlan } from '../src/types';
const [orgInput, planInput] = process.argv.slice(2);
const orgId = identifier(orgInput);
ensure(Object.hasOwn(PLAN_TIERS, planInput), 'Usage: node --import tsx scripts/set-subscription.ts ORG_ID PLAN');
const now = new Date().toISOString(), tier = getPlanConfig(planInput as SubscriptionPlan);
const data = signSubscription({ ...createDefaultSubscription(orgId), ...tier, plan: tier.name, updated_at: now }, process.env.BILLING_SIGNING_SECRET || '');
const { db } = adminServices();
await db.runTransaction(async tx => {
  const ref = db.doc(`organizations/${orgId}`); ensure((await tx.get(ref)).exists, 'Organization does not exist.');
  tx.set(db.doc(`organizations/${orgId}/meta/subscription`), data);
  tx.set(db.doc(`organizations/${orgId}/audit_logs/billing-${crypto.randomUUID()}`), { org_id: orgId, action: 'subscription.verified', actor_uid: 'billing-operator', plan: tier.name, created_at: now });
});
console.log('Verified subscription stored.');
