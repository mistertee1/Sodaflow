import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Document } from '../src/domain/store';
import { createDefaultSubscription, getPlanConfig, PLAN_TIERS } from '../src/lib/plans';
import type { OrgSubscription } from '../src/types';
import { ensure } from '../src/domain/validation';
import { serverEnv } from './env';
function signature(data: Document, secret: string) {
  return createHmac('sha256', secret).update(JSON.stringify([data.org_id, data.plan, data.status, data.updated_at])).digest('hex');
}
export function signSubscription(data: OrgSubscription, secret: string) {
  ensure(secret.length >= 32, 'BILLING_SIGNING_SECRET must contain at least 32 characters.');
  return { ...data, billing_signature: signature(data, secret) };
}
export function resolveSubscription(saved: Document | undefined, orgId: string): OrgSubscription {
  const secret = serverEnv('BILLING_SIGNING_SECRET');
  if (!saved || !secret || secret.length < 32 || saved.org_id !== orgId || !Object.hasOwn(PLAN_TIERS, saved.plan) || !['active', 'trialing', 'past_due', 'canceled'].includes(saved.status) || typeof saved.billing_signature !== 'string' || !/^[a-f0-9]{64}$/.test(saved.billing_signature)) return createDefaultSubscription(orgId);
  const expected = signature(saved, secret);
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(saved.billing_signature, 'hex'))) return createDefaultSubscription(orgId);
  const tier = getPlanConfig(saved.plan);
  return { ...createDefaultSubscription(orgId), ...tier, plan: tier.name, status: saved.status, updated_at: saved.updated_at };
}
