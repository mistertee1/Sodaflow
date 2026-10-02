import type { Actor } from '../src/domain/operations';
import { membership } from '../src/domain/operations';
import type { Store } from '../src/domain/store';
import { ensure, identifier, text, validateSettings } from '../src/domain/validation';
import { createDefaultSubscription } from '../src/lib/plans';
import { DEFAULT_ORGANIZATION_COUNTERS, type MerchantSettings } from '../src/types';
import { getDefaultChartOfAccounts } from '../src/services/accountingService';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { resolveSubscription } from './subscriptions';
import { getPlanConfig } from '../src/lib/plans';
import type { Document } from '../src/domain/store';
import type { OrgSubscription } from '../src/types';

export class Organizations {
  constructor(private store: Store, private subscriptionPolicy: (saved: Document | undefined, orgId: string) => OrgSubscription = resolveSubscription) {}
  list(actor: Actor) {
    return this.store.transaction(async tx => {
      const index = await tx.list(`user_organizations/${identifier(actor.uid)}/orgs`);
      const owned = await tx.find('organizations', 'owner_uid', actor.uid);
      const ids = new Set([...index.map(i => i.org_id), ...owned.map(o => o.id)]);
      const orgs = [];
      for (const id of ids) {
        const org = await tx.get(`organizations/${identifier(id)}`), member = await tx.get(`organizations/${id}/members/${actor.uid}`);
        if (org?.status === 'active' && (org.owner_uid === actor.uid || member?.status === 'active')) orgs.push(org);
      }
      return orgs;
    });
  }
  async create(actor: Actor, name: string, input: Partial<MerchantSettings>, operationId: string, initial = false) {
    ensure(actor.emailVerified, 'أكّد بريدك الإلكتروني قبل إنشاء المؤسسة.', 403);
    const id = initial ? `org-${identifier(actor.uid)}` : `org-${identifier(operationId)}`;
    return this.store.transaction(async tx => {
      const previous = await tx.get(`organizations/${id}`);
      if (previous) { ensure(previous.owner_uid === actor.uid, 'المؤسسة موجودة لمالك آخر.', 409); return previous; }
      const now = new Date().toISOString();
      const usagePath = `user_organizations/${actor.uid}/meta/creation`, usage = await tx.get(usagePath);
      ensure(!usage || usage.day !== now.slice(0, 10) || usage.count < 5, 'تم بلوغ حد إنشاء المؤسسات اليومي.', 429);
      const settings = validateSettings({ ...INITIAL_SETTINGS, ...input, business_name: text(name, 200, true), logo_url: input.logo_url || '' });
      const org = { id, name: settings.business_name, display_name: settings.business_name, base_currency: settings.primary_currency, secondary_currency: settings.secondary_currency, timezone: settings.timezone || 'Africa/Khartoum', fiscal_year: settings.fiscal_year || now.slice(0, 4), status: 'active', owner_uid: actor.uid, schema_version: 3, settings, created_at: now, updated_at: now };
      const member = { uid: actor.uid, org_id: id, email: actor.email, display_name: actor.name || name, role: 'Owner', status: 'active', joined_at: now };
      tx.set(`organizations/${id}`, org); tx.set(`organizations/${id}/members/${actor.uid}`, member);
      tx.set(`user_organizations/${actor.uid}/orgs/${id}`, { org_id: id, role: 'Owner', joined_at: now });
      tx.set(`organizations/${id}/meta/counters`, { ...DEFAULT_ORGANIZATION_COUNTERS, updated_at: now });
      tx.set(`organizations/${id}/meta/subscription`, createDefaultSubscription(id));
      for (const account of getDefaultChartOfAccounts(id)) tx.set(`organizations/${id}/accounts/${account.code}`, account);
      tx.set(`organizations/${id}/audit_logs/org-created`, { id: 'org-created', org_id: id, actor_uid: actor.uid, actor_email: actor.email, action: 'org.create', entity_id: id, created_at: now });
      tx.set(usagePath, { day: now.slice(0, 10), count: usage?.day === now.slice(0, 10) ? usage.count + 1 : 1 });
      return org;
    });
  }
  async accept(actor: Actor, orgId: string, invitationId: string) {
    identifier(orgId); identifier(invitationId);
    ensure(actor.emailVerified && actor.email, 'أكّد بريدك الإلكتروني قبل قبول الدعوة.', 403);
    return this.store.transaction(async tx => {
      const root = `organizations/${orgId}`, org = await tx.get(root), invite = await tx.get(`${root}/invitations/${invitationId}`), old = await tx.get(`${root}/members/${actor.uid}`);
      ensure(org?.status === 'active' && invite, 'الدعوة غير متاحة.', 404);
      ensure((invite.recipient_email || invite.email).toLowerCase() === actor.email.toLowerCase(), 'الدعوة مخصصة لبريد آخر.', 403);
      if (invite.status === 'accepted' && invite.accepted_by === actor.uid && old?.status === 'active') return old;
      ensure(invite.status === 'pending' && new Date(invite.expires_at).getTime() > Date.now(), 'الدعوة مستخدمة أو منتهية الصلاحية.', 409);
      ensure(!old, 'العضوية موجودة؛ يُعدّل دورها عبر الإدارة.', 409);
      const subscription = this.subscriptionPolicy(await tx.get(`${root}/meta/subscription`), orgId);
      ensure((await tx.list(`${root}/members`)).length < getPlanConfig(subscription.plan).max_members, 'تم بلوغ حد أعضاء الباقة.');
      ensure(['Admin', 'Accountant', 'Sales', 'Cashier', 'Viewer'].includes(invite.role), 'دور الدعوة غير صالح.');
      const inviter = await membership(tx, orgId, { uid: invite.inviter_uid, email: '', emailVerified: true });
      ensure(inviter.role === 'Owner' || inviter.role === 'Admin' && invite.role !== 'Admin', 'صلاحية مُصدر الدعوة لم تعد متاحة.', 403);
      const now = new Date().toISOString();
      const member = { uid: actor.uid, org_id: orgId, email: actor.email, display_name: actor.name || actor.email.split('@')[0], role: invite.role, status: 'active', joined_at: now, invitation_id: invitationId, invited_by: invite.invited_by };
      tx.set(`${root}/members/${actor.uid}`, member); tx.set(`${root}/invitations/${invitationId}`, { ...invite, status: 'accepted', accepted_by: actor.uid, accepted_at: now });
      tx.set(`user_organizations/${actor.uid}/orgs/${orgId}`, { org_id: orgId, role: invite.role, joined_at: now });
      tx.set(`${root}/audit_logs/accept-${invitationId}`, { id: `accept-${invitationId}`, org_id: orgId, actor_uid: actor.uid, actor_email: actor.email, action: 'invitation.accept', entity_id: actor.uid, created_at: now });
      return member;
    });
  }
}
