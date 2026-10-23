import type { Actor } from '../src/domain/operations';
import type { Document, Transaction } from '../src/domain/store';
import { BusinessError, ensure, identifier } from '../src/domain/validation';
import { serverEnv } from './env';

export const PLATFORM_ADMIN_ACCESS_PATH = 'platformAccess/superAdmin';

/** Exact mailbox binding; dots, plus aliases and providers are not interchangeable. */
export function platformAdminEmail(value: unknown): string {
  ensure(typeof value === 'string' && value.length <= 254, 'An exact administrator email is required.');
  const email = value.trim().toLowerCase();
  ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'The administrator email is invalid.');
  return email;
}

export function exclusiveAdminPolicyMatches(policy: Document | undefined, actor: Pick<Actor, 'uid' | 'email'>): boolean {
  return policy?.active === true && policy.mode === 'exclusive'
    && policy.uid === actor.uid && typeof policy.email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(policy.email)
    && policy.email === policy.email.toLowerCase()
    && typeof actor.email === 'string' && actor.email.toLowerCase() === policy.email;
}

/** Read inside every commercial transaction so a policy change invalidates an open editor. */
export async function assertExclusivePlatformAdmin(tx: Transaction, actor: Actor) {
  const policy = await tx.get(PLATFORM_ADMIN_ACCESS_PATH);
  if (!exclusiveAdminPolicyMatches(policy, actor)) {
    throw new BusinessError('الدخول لإدارة المنصة محصور في حساب الإدارة المعتمد.', 403, 'exclusive_super_admin_required');
  }
  const configured = serverEnv('SUPER_ADMIN_EMAIL');
  if (configured !== undefined && platformAdminEmail(configured) !== policy!.email) {
    throw new BusinessError('حساب الإدارة لا يطابق إعداد الخادم المعتمد.', 403, 'exclusive_super_admin_required');
  }
  const registry = await tx.get(`platformAdmins/${identifier(actor.uid)}`);
  ensure(registry?.active === true && registry.role === 'super_admin', 'صلاحية إدارة المنصة غير فعّالة لهذا الحساب.', 403);
}
