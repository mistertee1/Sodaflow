import type { Organization, OrgMember, OrgInvitation, OrgRole, MerchantSettings } from '../types';
import { api, operationId } from './businessApi';
import { firebaseCommand, firebaseSnapshot } from './firebaseSync';
import { BusinessError } from '../domain/validation';

export const getUserOrganizations = (_userId: string): Promise<Organization[]> => api('/organizations');
export const getOrganizationMembers = async (orgId: string): Promise<OrgMember[]> => orgId === 'local-guest-org' ? [] : (await firebaseSnapshot(orgId)).collections.members as OrgMember[];
export const getOrgInvitations = async (orgId: string): Promise<OrgInvitation[]> => orgId === 'local-guest-org' ? [] : (await firebaseSnapshot(orgId)).collections.invitations as OrgInvitation[];
export const createOrgInvitation = async (orgId: string, email: string, role: OrgRole, _actorUid: string, _actorEmail: string): Promise<OrgInvitation> => (await firebaseCommand(orgId, 'invitation.create', { email, role })).result as OrgInvitation;
export const revokeOrgInvitation = async (orgId: string, id: string, _actorUid: string, _actorEmail: string) => { await firebaseCommand(orgId, 'invitation.revoke', { id }); };
export const acceptOrgInvitation = (orgId: string, id: string, _uid: string, _email: string, _displayName: string): Promise<OrgMember> => api(`/organizations/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(id)}/accept`, { method: 'POST', body: '{}' });
export const setOrganizationMember = async (orgId: string, member: OrgMember, _uid: string, _email: string) => { await firebaseCommand(orgId, 'member.update', { uid: member.uid, role: member.role, status: member.status }); };
export const removeOrganizationMember = async (orgId: string, uid: string, _actorUid: string, _actorEmail: string) => { await firebaseCommand(orgId, 'member.remove', { uid }); };
export const suspendOrganizationMember = async (orgId: string, uid: string, _actorUid: string, _actorEmail: string) => { await firebaseCommand(orgId, 'member.update', { uid, status: 'suspended' }); };
export const reactivateOrganizationMember = async (orgId: string, uid: string, _actorUid: string, _actorEmail: string) => { await firebaseCommand(orgId, 'member.update', { uid, status: 'active' }); };
export const createOrganization = (_uid: string, _email: string, name: string, settings: MerchantSettings): Promise<Organization> => api('/organizations', { method: 'POST', body: JSON.stringify({ name, settings, operationId: operationId(), initial: false }) });
export const migrateUserToOrganization = async (): Promise<never> => { throw new BusinessError('الترحيل القديم يحتاج إجراء خادم موثّق. البيانات الأصلية لن تُستبدل من الواجهة.'); };
