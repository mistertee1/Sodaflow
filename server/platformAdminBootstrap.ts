import { createHash, randomUUID } from 'node:crypto';
import { canonical } from '../src/domain/operations';
import type { Document, Store, Transaction } from '../src/domain/store';
import { BusinessError, ensure, identifier } from '../src/domain/validation';
import { exclusiveAdminPolicyMatches, PLATFORM_ADMIN_ACCESS_PATH, platformAdminEmail } from './platformAdminAccess';

export interface BootstrapUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  disabled: boolean;
  customClaims?: Document;
}
export interface BootstrapAuth {
  getUserByEmail(email: string): Promise<BootstrapUser>;
  getUser(uid: string): Promise<BootstrapUser>;
  setCustomUserClaims(uid: string, claims: Document): Promise<void>;
}
export interface ExclusiveAdminTarget { email: string; uid?: string; }

function validateUser(user: BootstrapUser, target: ExclusiveAdminTarget) {
  ensure(user.emailVerified === true && user.disabled === false, 'The selected account must be enabled and its email verified.');
  ensure(platformAdminEmail(user.email) === platformAdminEmail(target.email), 'The account email changed or does not match the selected mailbox.', 409);
  identifier(user.uid);
  ensure(!target.uid || identifier(target.uid) === user.uid, 'The supplied UID does not belong to the selected email.', 409);
  return { uid: user.uid, email: platformAdminEmail(user.email) };
}

async function bindingState(tx: Transaction, target: { uid: string; email: string }) {
  const policy = await tx.get(PLATFORM_ADMIN_ACCESS_PATH);
  const registry = await tx.get(`platformAdmins/${target.uid}`);
  const all = await tx.list('platformAdmins');
  ensure(all.length <= 400, 'Review a large administrator registry separately before an atomic activation.');
  const revoked = all.filter(item => item.active === true).map(item => ({
    uid: identifier(item.uid || item.id), value: item,
  })).filter(item => item.uid !== target.uid).sort((a, b) => a.uid.localeCompare(b.uid));
  const reviewHash = createHash('sha256').update(canonical({ target, policy: policy || null, registry: registry || null, revoked })).digest('hex');
  const changesRequired = !exclusiveAdminPolicyMatches(policy, target)
    || registry?.active !== true || registry.role !== 'super_admin'
    || registry.email !== target.email || revoked.length > 0;
  return { policy, registry, revoked, reviewHash, changesRequired };
}

/** No user creation, password change, email verification bypass or financial migration. */
export async function previewExclusiveAdmin(store: Store, auth: BootstrapAuth, input: ExclusiveAdminTarget) {
  const email = platformAdminEmail(input.email);
  const target = validateUser(await auth.getUserByEmail(email), { ...input, email });
  const state = await store.transaction(tx => bindingState(tx, target));
  return { ...target, verified: true, reviewHash: state.reviewHash, changesRequired: state.changesRequired,
    previousPolicy: state.policy || null, revokeUids: state.revoked.map(item => item.uid) };
}

export async function activateExclusiveAdmin(store: Store, auth: BootstrapAuth, input: ExclusiveAdminTarget & { reviewHash: string; operator: string }) {
  ensure(/^[a-f0-9]{64}$/.test(input.reviewHash), 'Run the read-only preview and supply its exact review hash.');
  const email = platformAdminEmail(input.email);
  const target = validateUser(await auth.getUserByEmail(email), { ...input, email });
  const now = new Date().toISOString(), eventId = `exclusive-admin-${randomUUID()}`;
  const result = await store.transaction(async tx => {
    const state = await bindingState(tx, target);
    ensure(state.reviewHash === input.reviewHash, 'Administrator state changed since preview. Review the new preview before activation.', 409);
    if (!state.changesRequired) return { policyRevision: state.policy!.revision, policyChanged: false };
    const policy = { mode: 'exclusive', active: true, ...target, revision: (Number(state.policy?.revision) || 0) + 1,
      createdAt: state.policy?.createdAt || now, updatedAt: now };
    const registry = { ...state.registry, ...target, active: true, role: 'super_admin', createdAt: state.registry?.createdAt || now, updatedAt: now };
    tx.set(PLATFORM_ADMIN_ACCESS_PATH, policy);
    tx.set(`platformAdmins/${target.uid}`, registry);
    for (const item of state.revoked) tx.set(`platformAdmins/${item.uid}`, { ...item.value, uid: item.uid, active: false, updatedAt: now, disabledReason: 'exclusive_admin_policy' });
    tx.set(`subscriptionEvents/${eventId}`, { id: eventId, organizationId: null, action: 'platform_admin.exclusive_bootstrap',
      previousValue: { policy: state.policy || null, target: state.registry || null, revoked: state.revoked },
      newValue: { policy, target: registry, revokedUids: state.revoked.map(item => item.uid) },
      performedBy: input.operator, createdAt: now, reason: 'Explicit verified account selected for exclusive platform access',
      method: 'bootstrap', operationId: eventId });
    return { policyRevision: policy.revision, policyChanged: true };
  });
  // Registry, exclusive binding and revocations commit first. A claims failure grants no
  // additional access. A fresh preview can resume it without another policy/audit write.
  try {
    const current = await auth.getUser(target.uid);
    validateUser(current, target);
    if (current.customClaims?.superAdmin !== true) {
      await auth.setCustomUserClaims(target.uid, { ...current.customClaims, superAdmin: true });
    }
    const confirmed = await auth.getUser(target.uid);
    validateUser(confirmed, target);
    ensure(confirmed.customClaims?.superAdmin === true, 'The administrator claim could not be confirmed.');
  } catch {
    throw new BusinessError('Exclusive policy committed; administrator claim not confirmed. Re-run the read-only preview before retrying.', 503, 'super_admin_claims_pending');
  }
  return { ...target, ...result, claimConfirmed: true };
}
