import { sendEmailVerification } from 'firebase/auth';
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { OrgRole, OrgMember, OrgInvitation } from '../types';
import {
  Users,
  UserPlus,
  Shield,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Copy,
  Check,
  Building,
  RefreshCw,
  AlertTriangle,
  UserX,
  UserCheck,
  PlusCircle,
} from 'lucide-react';
import {
  getOrgInvitations,
  revokeOrgInvitation,
  acceptOrgInvitation,
} from '../services/organizationService';

export const TeamManagementSection: React.FC = () => {
  const {
    currentUser,
    currentOrg,
    subscription,
    userOrgs = [],
    userRole,
    memberStatus,
    platformControlsEnabled,
    orgMembers = [],
    switchOrganization,
    createNewOrg,
    inviteMember,
    updateMemberRole,
    removeMember,
    suspendMember,
    reactivateMember,
    isActionAllowed,
  } = useApp();

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('Cashier');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Invitations list state
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Join invitation state
  const [joinOrgId, setJoinOrgId] = useState('');
  const [joinInvId, setJoinInvId] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Create new org state
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [createOrgLoading, setCreateOrgLoading] = useState(false);
  const [createOrgError, setCreateOrgError] = useState<string | null>(null);

  // Load invitations when org changes
  const loadInvitations = async () => {
    if (!currentOrg || !isActionAllowed('members:invite')) return;
    setLoadingInvitations(true);
    try {
      const invs = await getOrgInvitations(currentOrg.id);
      setInvitations(invs);
    } catch (err: any) {
      console.warn('Notice loading invitations:', err);
    } finally {
      setLoadingInvitations(false);
    }
  };

  useEffect(() => {
    loadInvitations();
  }, [currentOrg?.id]);

  if (!currentUser) {
    return (
      <div className="bg-sf-raised p-4 rounded-xl border border-sf-border text-center space-y-2">
        <Users className="w-8 h-8 text-sf-muted mx-auto" />
        <p className="text-xs text-sf-text font-medium">ميزة الفرق والمؤسسات المتعددة متاحة للمستخدمين المسجلين سحابياً</p>
        <p className="text-xs text-sf-muted">سجّل دخولك لحساب Google للبدء في دعوة موظفيك ومحاسبيك وإدارة الصلاحيات.</p>
      </div>
    );
  }

  const canManageMembers = isActionAllowed('members:update_role');
  const canInvite = isActionAllowed('members:invite');
  const reservedUsers = new Set([...orgMembers.map(member => member.uid), currentOrg?.owner_uid]).size + invitations.filter(invitation => invitation.status === 'pending' && Date.parse(invitation.expires_at) > Date.now()).length;
  const seatsFull = platformControlsEnabled && reservedUsers >= subscription.max_members;

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteError('يرجى إدخال بريد إلكتروني صالح');
      return;
    }
    setInviteLoading(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await inviteMember(inviteEmail.trim().toLowerCase(), inviteRole);
      setInviteSuccess(`تم إنشاء دعوة بنجاح للبريد ${inviteEmail} بدور ${inviteRole}`);
      setInviteEmail('');
      await loadInvitations();
    } catch (err: any) {
      setInviteError(err.message || 'حدث خطأ أثناء إرسال الدعوة');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRevokeInvitation = async (invId: string) => {
    if (!currentOrg) return;
    if (!window.confirm('هل أنت متأكد من إلغاء هذه الدعوة؟')) return;
    try {
      await revokeOrgInvitation(currentOrg.id, invId, currentUser.uid, currentUser.email || '');
      await loadInvitations();
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء إلغاء الدعوة');
    }
  };

  const handleJoinInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinOrgId.trim() || !joinInvId.trim()) {
      setJoinError('يرجى كتابة معرّف المؤسسة ومعرّف الدعوة');
      return;
    }
    setJoinLoading(true);
    setJoinError(null);
    setJoinSuccess(null);
    try {
      await currentUser.reload();
      await currentUser.getIdToken(true);
      await acceptOrgInvitation(
        joinOrgId.trim(),
        joinInvId.trim(),
        currentUser.uid,
        currentUser.email || '',
        currentUser.displayName || ''
      );
      setJoinSuccess('تم قبول الدعوة والانضمام للمؤسسة بنجاح! جاري التبديل...');
      await switchOrganization(joinOrgId.trim());
      setJoinOrgId('');
      setJoinInvId('');
    } catch (err: any) {
      setJoinError(err.message || 'تعذر قبول الدعوة. تأكد من صحة الرمز وعدم انتهاء صلاحيته.');
    } finally {
      setJoinLoading(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setCreateOrgLoading(true);
    setCreateOrgError(null);
    try {
      await createNewOrg(newOrgName.trim());
      setNewOrgName('');
      setShowCreateOrg(false);
    } catch (err: any) {
      setCreateOrgError(err.message || 'حدث خطأ أثناء إنشاء المؤسسة');
    } finally {
      setCreateOrgLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const getRoleBadgeColor = (role: OrgRole) => {
    switch (role) {
      case 'Owner':
        return 'bg-sf-warning-bg/20 text-sf-warning border-sf-warning/40';
      case 'Admin':
        return 'bg-sf-action/20 text-sf-action border-sf-action/40';
      case 'Accountant':
        return 'bg-sf-info-bg/20 text-sf-info border-sf-info/40';
      case 'Sales':
        return 'bg-sf-neutral-bg text-sf-neutral border-sf-neutral';
      case 'Cashier':
        return 'bg-sf-neutral-bg text-sf-neutral border-sf-neutral';
      default:
        return 'bg-sf-neutral-bg text-sf-text border-sf-border/40';
    }
  };

  return (
    <div className="bg-sf-raised p-4 rounded-xl border border-sf-border space-y-4 text-right">
      {/* Header & Current Org Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-sf-border">
        <div>
          <h3 className="font-semibold text-xs text-sf-text flex items-center gap-2">
            <Building className="w-4 h-4 text-sf-action" />
            <span>إدارة المؤسسة وفريق العمل (SaaS Multi-Tenant)</span>
          </h3>
          <p className="text-xs text-sf-muted mt-1">
            مؤسستك الحالية:{' '}
            <strong className="text-sf-text">{currentOrg?.name || currentOrg?.id || 'المؤسسة الافتراضية'}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Role badge */}
          <span className={`text-xs px-3 py-1 rounded-md border font-semibold ${getRoleBadgeColor(userRole)}`}>
            دورك: {userRole}
          </span>

          {/* Member Status badge */}
          <span
            className={`text-xs px-3 py-1 rounded-md border font-semibold flex items-center gap-1 ${
              memberStatus !== 'suspended'
                ? 'bg-sf-action/20 text-sf-action border-sf-action/40'
                : 'bg-sf-danger-bg/20 text-sf-danger border-sf-danger/40 animate-pulse'
            }`}
          >
            {memberStatus === 'unknown' ? <span>جاري التحقق من العضوية</span> : memberStatus === 'active' ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-sf-action" />
                <span>حسابك: نشط</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3.5 h-3.5 text-sf-danger" />
                <span>حسابك: معلق</span>
              </>
            )}
          </span>

          {/* Switch Org dropdown */}
          {(userOrgs || []).length > 1 && (
            <select
              value={currentOrg?.id}
              onChange={(e) => switchOrganization(e.target.value)}
              className="bg-sf-raised border border-sf-border text-xs text-sf-text px-3 py-1 rounded-lg focus:outline-none focus:border-sf-action"
            >
              {(userOrgs || []).map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name || org.id}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setShowCreateOrg(!showCreateOrg)}
            className="px-3 py-1 bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border rounded-lg text-xs flex items-center gap-1 transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5 text-sf-action" />
            <span>مؤسسة جديدة</span>
          </button>
        </div>
      </div>

      {/* Suspended Alert if current user is suspended */}
      {memberStatus === 'suspended' && (
        <div className="p-3 bg-sf-danger-bg/60 border border-sf-danger/80 rounded-xl text-xs text-sf-danger flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-sf-danger shrink-0 mt-1" />
          <div>
            <strong className="block text-sf-danger">تنبيه أمني: عضويتك في هذه المؤسسة معلقة</strong>
            <p className="text-xs text-sf-danger/80 mt-1">
              تم تجميد حسابك من قِبل مالك أو مدير المؤسسة. تقتصر صلاحياتك على المشاهدة فقط حتى يتم إلغاء التجميد.
            </p>
          </div>
        </div>
      )}

      {/* Create Org Form Modal / Collapse */}
      {showCreateOrg && (
        <form onSubmit={handleCreateOrg} className="p-3 bg-sf-raised rounded-xl border border-sf-border space-y-2">
          <div className="text-xs font-semibold text-sf-text flex items-center gap-2">
            <Building className="w-3.5 h-3.5 text-sf-action" />
            <span>إنشاء مؤسسة أو فرع تجاري مستقل جديد</span>
          </div>
          <p className="text-xs text-sf-muted">
            سيتم إنشاء قاعدة بيانات معزولة ومستقلة تماماً للمؤسسة الجديدة وتعيينك كمالك (Owner) لها.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="اسم المؤسسة أو الفرع الجديد..."
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              required
              className="flex-1 bg-sf-surface border border-sf-border text-xs text-sf-text px-3 py-2 rounded-lg focus:outline-none focus:border-sf-action"
            />
            <button
              type="submit"
              disabled={createOrgLoading}
              className="px-3 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs rounded-lg transition-colors disabled:opacity-50"
            >
              {createOrgLoading ? 'جاري الإنشاء...' : 'إنشاء'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateOrg(false)}
              className="px-3 py-2 text-xs text-sf-muted hover:text-sf-text"
            >
              إلغاء
            </button>
          </div>
          {createOrgError && <p className="text-xs text-sf-danger">{createOrgError}</p>}
        </form>
      )}

      {/* Section 1: Members Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-xs text-sf-text flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-sf-action" />
            <span>أعضاء فريق المؤسسة ({orgMembers.length})</span>
          </h4>
          <span className="text-xs text-sf-muted">حسابات نشطة ومعلقة مع صلاحيات خادم صارمة</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-sf-border">
          <table className="w-full text-xs text-right">
            <thead className="bg-sf-raised text-sf-muted text-xs border-b border-sf-border">
              <tr>
                <th className="py-2 px-3 font-semibold">العضو</th>
                <th className="py-2 px-3 font-semibold">البريد الإلكتروني</th>
                <th className="py-2 px-3 font-semibold">الدور الصلاحي</th>
                <th className="py-2 px-3 font-semibold">الحالة</th>
                <th className="py-2 px-3 font-semibold text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sf-border">
              {(orgMembers || []).map((member) => {
                const isSelf = member.uid === currentUser?.uid;
                const isOwner = member.role === 'Owner';
                const isMemberSuspended = member.status === 'suspended';

                return (
                  <tr key={member.uid} className="hover:bg-sf-raised transition-colors">
                    <td className="py-3 px-3 text-sf-text font-medium">
                      <div className="flex items-center gap-2">
                        <span>{member.display_name || 'موظف'}</span>
                        {isSelf && (
                          <span className="text-xs px-2 py-1 rounded bg-sf-action/20 text-sf-action">
                            (أنت)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-sf-muted font-mono text-xs">{member.email}</td>
                    <td className="py-3 px-3">
                      {canManageMembers && !isOwner && !isSelf ? (
                        <select
                          value={member.role}
                          onChange={(e) => updateMemberRole(member.uid, e.target.value as OrgRole)}
                          className="bg-sf-raised border border-sf-border text-sf-text text-xs px-2 py-1 rounded focus:outline-none focus:border-sf-action"
                        >
                          <option value="Admin">مدير (Admin)</option>
                          <option value="Accountant">محاسب (Accountant)</option>
                          <option value="Sales">مبيعات (Sales)</option>
                          <option value="Cashier">كاشير (Cashier)</option>
                          <option value="Viewer">مشاهد فقط (Viewer)</option>
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-1 rounded border font-semibold ${getRoleBadgeColor(member.role)}`}>
                          {member.role}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-semibold border flex items-center gap-1 w-fit ${
                          isMemberSuspended
                            ? 'bg-sf-danger-bg/20 text-sf-danger border-sf-danger/40'
                            : 'bg-sf-action/20 text-sf-action border-sf-action/40'
                        }`}
                      >
                        {isMemberSuspended ? 'معلق (Suspended)' : 'نشط (Active)'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {canManageMembers && !isOwner && !isSelf ? (
                        <div className="flex items-center justify-center gap-2">
                          {isMemberSuspended ? (
                            <button
                              type="button"
                              onClick={() => reactivateMember(member.uid)}
                              title="إلغاء التجميد وإعادة التفعيل"
                              className="px-2 py-1 bg-sf-selected/60 hover:bg-sf-selected/80 text-sf-action border border-sf-action/60 rounded text-xs flex items-center gap-1 transition-colors"
                            >
                              <UserCheck className="w-3 h-3 text-sf-action" />
                              <span>تفعيل</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => suspendMember(member.uid)}
                              title="تجميد حساب العضو ومنع وصوله للمؤسسة"
                              className="px-2 py-1 bg-sf-warning-bg/60 hover:bg-sf-warning-bg/80 text-sf-warning border border-sf-warning/60 rounded text-xs flex items-center gap-1 transition-colors"
                            >
                              <UserX className="w-3 h-3 text-sf-warning" />
                              <span>تجميد</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`هل أنت متأكد من إزالة ${member.email} من المؤسسة؟`)) {
                                removeMember(member.uid);
                              }
                            }}
                            title="إزالة من المؤسسة"
                            className="p-1 text-sf-danger hover:text-sf-danger hover:bg-sf-danger-bg/40 rounded border border-transparent hover:border-sf-danger/40 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-sf-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Invite Member (دعوة عضو جديد) */}
      {canInvite && (
        <form onSubmit={handleSendInvite} className="p-3 bg-sf-raised rounded-xl border border-sf-border space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-xs text-sf-text flex items-center gap-2">
              <UserPlus className="w-3.5 h-3.5 text-sf-action" />
              <span>دعوة موظف أو محاسب للانضمام للمؤسسة</span>
            </h4>
            <span className="text-xs text-sf-muted">{platformControlsEnabled ? `${reservedUsers} / ${subscription.max_members} مقعد محجوز · الدعوات القائمة تحجز مقاعد · المجانية: المالك وموظف واحد` : `${reservedUsers} مقعد محجوز · عدد الأعضاء غير محدود حالياً`}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <input
                type="email"
                placeholder="البريد الإلكتروني للعضو المدعو..."
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="w-full bg-sf-surface border border-sf-border text-xs text-sf-text px-3 py-2 rounded-lg focus:outline-none focus:border-sf-action font-mono"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                className="flex-1 bg-sf-surface border border-sf-border text-xs text-sf-text px-3 py-2 rounded-lg focus:outline-none focus:border-sf-action"
              >
                <option value="Admin">مدير (Admin)</option>
                <option value="Accountant">محاسب (Accountant)</option>
                <option value="Sales">مبيعات (Sales)</option>
                <option value="Cashier">كاشير (Cashier)</option>
                <option value="Viewer">مشاهد (Viewer)</option>
              </select>
              <button
                type="submit"
                disabled={inviteLoading || seatsFull}
                className="px-4 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                {inviteLoading ? 'جاري الإرسال...' : 'إرسال الدعوة'}
              </button>
            </div>
          </div>

          {inviteSuccess && (
            <div className="p-3 bg-sf-selected/40 border border-sf-action/50 rounded-lg text-xs text-sf-action flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-sf-action shrink-0" />
              <span>{inviteSuccess}</span>
            </div>
          )}

          {inviteError && (
            <div className="p-3 bg-sf-danger-bg/40 border border-sf-danger/50 rounded-lg text-xs text-sf-danger">
              {inviteError}
            </div>
          )}
        </form>
      )}

      {/* Section 3: Invitations List (سجل الدعوات) */}
      {canInvite && invitations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-xs text-sf-text flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-sf-warning" />
              <span>سجل دعوات المؤسسة</span>
            </h4>
            <button
              type="button"
              onClick={loadInvitations}
              disabled={loadingInvitations}
              className="text-xs text-sf-muted hover:text-sf-text flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${loadingInvitations ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
          </div>

          <div className="space-y-2">
            {(invitations || []).map((inv) => {
              const isPending = inv.status === 'pending';
              const isExpired = new Date(inv.expires_at) < new Date();

              return (
                <div
                  key={inv.id}
                  className="p-3 rounded-lg bg-sf-raised border border-sf-border flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sf-text text-xs">{inv.email}</span>
                      <span className={`text-xs px-2 py-1 rounded border font-semibold ${getRoleBadgeColor(inv.role)}`}>
                        {inv.role}
                      </span>
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-semibold ${
                          inv.status === 'accepted'
                            ? 'bg-sf-action/20 text-sf-action'
                            : inv.status === 'revoked'
                            ? 'bg-sf-neutral-bg text-sf-muted'
                            : isExpired
                            ? 'bg-sf-danger-bg/20 text-sf-danger'
                            : 'bg-sf-warning-bg/20 text-sf-warning'
                        }`}
                      >
                        {inv.status === 'accepted'
                          ? 'مقبولة'
                          : inv.status === 'revoked'
                          ? 'ملغاة'
                          : isExpired
                          ? 'منتهية الصلاحية'
                          : 'في الانتظار'}
                      </span>
                    </div>
                    <div className="text-xs text-sf-muted mt-1 flex items-center gap-2">
                      <span>الرمز: <span className="font-mono text-sf-muted">{inv.id}</span></span>
                      <span>•</span>
                      <span>
                        الصلاحية: {new Date(inv.expires_at).toLocaleDateString('ar-EG')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(inv.id, inv.id)}
                      className="px-2 py-1 bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border rounded text-xs flex items-center gap-1 transition-colors"
                      title="نسخ معرّف الدعوة لإرساله للموظف"
                    >
                      {copiedId === inv.id ? (
                        <>
                          <Check className="w-3 h-3 text-sf-action" />
                          <span className="text-sf-action">تم النسخ</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-sf-muted" />
                          <span>نسخ الرمز</span>
                        </>
                      )}
                    </button>

                    {isPending && !isExpired && (
                      <button
                        type="button"
                        onClick={() => handleRevokeInvitation(inv.id)}
                        className="px-2 py-1 bg-sf-danger-bg/40 hover:bg-sf-danger-bg/60 text-sf-danger border border-sf-danger/60 rounded text-xs transition-colors"
                      >
                        إلغاء الدعوة
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 4: Join Another Organization (قبول دعوة انضمام لمؤسسة أخرى) */}
      <div className="p-3 bg-sf-raised rounded-xl border border-sf-border space-y-2">
        <h4 className="font-semibold text-xs text-sf-text flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-sf-info" />
          <span>هل استلمت دعوة انضمام لمؤسسة أخرى؟</span>
        </h4>
        <p className="text-xs text-sf-muted">
          أدخل معرّف المؤسسة ومعرّف الدعوة الذي زوّدك به مدير أو مالك المؤسسة للانضمام إليها مباشرة:
        </p>

        {!currentUser.emailVerified && <div className="mb-3 p-3 bg-sf-info-bg text-sf-info rounded-lg text-xs">
          <p>قبول الدعوات يتطلب تأكيد بريدك الإلكتروني.</p>
          <button type="button" className="underline mt-1" onClick={async () => {
            try { await sendEmailVerification(currentUser); setJoinSuccess('أُرسل رابط التأكيد. افتحه ثم أعد قبول الدعوة.'); }
            catch (error) { setJoinError(error instanceof Error ? error.message : 'تعذر إرسال رابط التأكيد.'); }
          }}>إرسال رابط تأكيد البريد</button>
        </div>}
        <form onSubmit={handleJoinInvitation} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <input
            type="text"
            placeholder="معرّف المؤسسة (orgId)..."
            value={joinOrgId}
            onChange={(e) => setJoinOrgId(e.target.value)}
            required
            className="bg-sf-surface border border-sf-border text-xs text-sf-text px-3 py-2 rounded-lg focus:outline-none focus:border-sf-info font-mono"
          />
          <input
            type="text"
            placeholder="معرّف الدعوة (inv-...)..."
            value={joinInvId}
            onChange={(e) => setJoinInvId(e.target.value)}
            required
            className="bg-sf-surface border border-sf-border text-xs text-sf-text px-3 py-2 rounded-lg focus:outline-none focus:border-sf-info font-mono"
          />
          <button
            type="submit"
            disabled={joinLoading}
            className="px-3 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs rounded-lg transition-colors disabled:opacity-50"
          >
            {joinLoading ? 'جاري التحقق والانضمام...' : 'قبول الدعوة والانضمام'}
          </button>
        </form>

        {joinSuccess && (
          <div className="p-3 bg-sf-selected/40 border border-sf-action/50 rounded-lg text-xs text-sf-action">
            {joinSuccess}
          </div>
        )}

        {joinError && (
          <div className="p-3 bg-sf-danger-bg/40 border border-sf-danger/50 rounded-lg text-xs text-sf-danger">
            {joinError}
          </div>
        )}
      </div>
    </div>
  );
};
