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
    userOrgs = [],
    userRole,
    memberStatus,
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
    if (!currentOrg || currentOrg.id === 'local-guest-org') return;
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
      <div className="bg-[#16161f] p-4 rounded-xl border border-[#22222d] text-center space-y-2">
        <Users className="w-8 h-8 text-slate-500 mx-auto" />
        <p className="text-xs text-white font-medium">ميزة الفرق والمؤسسات المتعددة متاحة للمستخدمين المسجلين سحابياً</p>
        <p className="text-[11px] text-slate-400">سجّل دخولك لحساب Google للبدء في دعوة موظفيك ومحاسبيك وإدارة الصلاحيات.</p>
      </div>
    );
  }

  const canManageMembers = isActionAllowed('members:update_role') || userRole === 'Owner' || userRole === 'Admin';
  const canInvite = isActionAllowed('members:invite') || userRole === 'Owner' || userRole === 'Admin';

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
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'Admin':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'Accountant':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'Sales':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'Cashier':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    }
  };

  return (
    <div className="bg-[#121216] p-4 rounded-xl border border-[#1e1e24] space-y-4 text-right">
      {/* Header & Current Org Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1e1e24]">
        <div>
          <h3 className="font-bold text-xs text-white flex items-center gap-1.5">
            <Building className="w-4 h-4 text-emerald-400" />
            <span>إدارة المؤسسة وفريق العمل (SaaS Multi-Tenant)</span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            مؤسستك الحالية:{' '}
            <strong className="text-white">{currentOrg?.name || currentOrg?.id || 'المؤسسة الافتراضية'}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Role badge */}
          <span className={`text-[11px] px-2.5 py-1 rounded-md border font-bold ${getRoleBadgeColor(userRole)}`}>
            دورك: {userRole}
          </span>

          {/* Member Status badge */}
          <span
            className={`text-[11px] px-2.5 py-1 rounded-md border font-bold flex items-center gap-1 ${
              memberStatus === 'active'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
            }`}
          >
            {memberStatus === 'active' ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>حسابك: نشط</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>حسابك: معلق</span>
              </>
            )}
          </span>

          {/* Switch Org dropdown */}
          {(userOrgs || []).length > 1 && (
            <select
              value={currentOrg?.id}
              onChange={(e) => switchOrganization(e.target.value)}
              className="bg-[#1a1a24] border border-[#2a2a38] text-xs text-white px-2.5 py-1 rounded-lg focus:outline-none focus:border-emerald-500"
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
            className="px-2.5 py-1 bg-[#1a1a24] hover:bg-[#252535] text-slate-200 border border-[#2d2d3e] rounded-lg text-xs flex items-center gap-1 transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>مؤسسة جديدة</span>
          </button>
        </div>
      </div>

      {/* Suspended Alert if current user is suspended */}
      {memberStatus === 'suspended' && (
        <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <strong className="block text-rose-300">تنبيه أمني: عضويتك في هذه المؤسسة معلقة</strong>
            <p className="text-[11px] text-rose-300/80 mt-0.5">
              تم تجميد حسابك من قِبل مالك أو مدير المؤسسة. تقتصر صلاحياتك على المشاهدة فقط حتى يتم إلغاء التجميد.
            </p>
          </div>
        </div>
      )}

      {/* Create Org Form Modal / Collapse */}
      {showCreateOrg && (
        <form onSubmit={handleCreateOrg} className="p-3 bg-[#161622] rounded-xl border border-[#262638] space-y-2">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <Building className="w-3.5 h-3.5 text-emerald-400" />
            <span>إنشاء مؤسسة أو فرع تجاري مستقل جديد</span>
          </div>
          <p className="text-[11px] text-slate-400">
            سيتم إنشاء قاعدة بيانات معزولة ومستقلة تماماً للمؤسسة الجديدة وتعيينك كمالك (Owner) لها.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="اسم المؤسسة أو الفرع الجديد..."
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              required
              className="flex-1 bg-[#0f0f15] border border-[#29293a] text-xs text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={createOrgLoading}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
            >
              {createOrgLoading ? 'جاري الإنشاء...' : 'إنشاء'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateOrg(false)}
              className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-white"
            >
              إلغاء
            </button>
          </div>
          {createOrgError && <p className="text-[11px] text-rose-400">{createOrgError}</p>}
        </form>
      )}

      {/* Section 1: Members Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-emerald-400" />
            <span>أعضاء فريق المؤسسة ({orgMembers.length})</span>
          </h4>
          <span className="text-[10px] text-slate-500">حسابات نشطة ومعلقة مع صلاحيات خادم صارمة</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-[#1e1e28]">
          <table className="w-full text-xs text-right">
            <thead className="bg-[#161620] text-slate-400 text-[11px] border-b border-[#1e1e28]">
              <tr>
                <th className="py-2 px-3 font-semibold">العضو</th>
                <th className="py-2 px-3 font-semibold">البريد الإلكتروني</th>
                <th className="py-2 px-3 font-semibold">الدور الصلاحي</th>
                <th className="py-2 px-3 font-semibold">الحالة</th>
                <th className="py-2 px-3 font-semibold text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e28]">
              {(orgMembers || []).map((member) => {
                const isSelf = member.uid === currentUser?.uid;
                const isOwner = member.role === 'Owner';
                const isMemberSuspended = member.status === 'suspended';

                return (
                  <tr key={member.uid} className="hover:bg-[#151520] transition-colors">
                    <td className="py-2.5 px-3 text-white font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{member.display_name || 'موظف'}</span>
                        {isSelf && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                            (أنت)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">{member.email}</td>
                    <td className="py-2.5 px-3">
                      {canManageMembers && !isOwner && !isSelf ? (
                        <select
                          value={member.role}
                          onChange={(e) => updateMemberRole(member.uid, e.target.value as OrgRole)}
                          className="bg-[#1a1a24] border border-[#2a2a3a] text-slate-200 text-xs px-2 py-1 rounded focus:outline-none focus:border-emerald-500"
                        >
                          <option value="Admin">مدير (Admin)</option>
                          <option value="Accountant">محاسب (Accountant)</option>
                          <option value="Sales">مبيعات (Sales)</option>
                          <option value="Cashier">كاشير (Cashier)</option>
                          <option value="Viewer">مشاهد فقط (Viewer)</option>
                        </select>
                      ) : (
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${getRoleBadgeColor(member.role)}`}>
                          {member.role}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold border flex items-center gap-1 w-fit ${
                          isMemberSuspended
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        }`}
                      >
                        {isMemberSuspended ? 'معلق (Suspended)' : 'نشط (Active)'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {canManageMembers && !isOwner && !isSelf ? (
                        <div className="flex items-center justify-center gap-1.5">
                          {isMemberSuspended ? (
                            <button
                              type="button"
                              onClick={() => reactivateMember(member.uid)}
                              title="إلغاء التجميد وإعادة التفعيل"
                              className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/60 rounded text-[11px] flex items-center gap-1 transition-colors"
                            >
                              <UserCheck className="w-3 h-3 text-emerald-400" />
                              <span>تفعيل</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => suspendMember(member.uid)}
                              title="تجميد حساب العضو ومنع وصوله للمؤسسة"
                              className="px-2 py-1 bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-800/60 rounded text-[11px] flex items-center gap-1 transition-colors"
                            >
                              <UserX className="w-3 h-3 text-amber-400" />
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
                            className="p-1 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded border border-transparent hover:border-rose-800/40 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-500">—</span>
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
        <form onSubmit={handleSendInvite} className="p-3 bg-[#161622] rounded-xl border border-[#222232] space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>دعوة موظف أو محاسب للانضمام للمؤسسة</span>
            </h4>
            <span className="text-[10px] text-slate-400">صلاحية الدعوة 7 أيام مع تحقق خادمي</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <input
                type="email"
                placeholder="البريد الإلكتروني للعضو المدعو..."
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="w-full bg-[#0d0d12] border border-[#262636] text-xs text-white px-3 py-2 rounded-lg focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                className="flex-1 bg-[#0d0d12] border border-[#262636] text-xs text-white px-2.5 py-2 rounded-lg focus:outline-none focus:border-emerald-500"
              >
                <option value="Admin">مدير (Admin)</option>
                <option value="Accountant">محاسب (Accountant)</option>
                <option value="Sales">مبيعات (Sales)</option>
                <option value="Cashier">كاشير (Cashier)</option>
                <option value="Viewer">مشاهد (Viewer)</option>
              </select>
              <button
                type="submit"
                disabled={inviteLoading}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                {inviteLoading ? 'جاري الإرسال...' : 'إرسال الدعوة'}
              </button>
            </div>
          </div>

          {inviteSuccess && (
            <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-[11px] text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{inviteSuccess}</span>
            </div>
          )}

          {inviteError && (
            <div className="p-2.5 bg-rose-950/40 border border-rose-800/50 rounded-lg text-[11px] text-rose-300">
              {inviteError}
            </div>
          )}
        </form>
      )}

      {/* Section 3: Invitations List (سجل الدعوات) */}
      {canInvite && invitations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-xs text-slate-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>سجل دعوات المؤسسة</span>
            </h4>
            <button
              type="button"
              onClick={loadInvitations}
              disabled={loadingInvitations}
              className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${loadingInvitations ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
          </div>

          <div className="space-y-1.5">
            {(invitations || []).map((inv) => {
              const isPending = inv.status === 'pending';
              const isExpired = new Date(inv.expires_at) < new Date();

              return (
                <div
                  key={inv.id}
                  className="p-2.5 rounded-lg bg-[#14141c] border border-[#20202c] flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-white text-[11px]">{inv.email}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${getRoleBadgeColor(inv.role)}`}>
                        {inv.role}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                          inv.status === 'accepted'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : inv.status === 'revoked'
                            ? 'bg-slate-500/20 text-slate-400'
                            : isExpired
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-amber-500/20 text-amber-400'
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
                    <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>الرمز: <span className="font-mono text-slate-400">{inv.id}</span></span>
                      <span>•</span>
                      <span>
                        الصلاحية: {new Date(inv.expires_at).toLocaleDateString('ar-EG')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(inv.id, inv.id)}
                      className="px-2 py-1 bg-[#1c1c28] hover:bg-[#252535] text-slate-300 border border-[#2e2e40] rounded text-[10px] flex items-center gap-1 transition-colors"
                      title="نسخ معرّف الدعوة لإرساله للموظف"
                    >
                      {copiedId === inv.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">تم النسخ</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-slate-400" />
                          <span>نسخ الرمز</span>
                        </>
                      )}
                    </button>

                    {isPending && !isExpired && (
                      <button
                        type="button"
                        onClick={() => handleRevokeInvitation(inv.id)}
                        className="px-2 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded text-[10px] transition-colors"
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
      <div className="p-3 bg-[#151520] rounded-xl border border-[#212130] space-y-2">
        <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-blue-400" />
          <span>هل استلمت دعوة انضمام لمؤسسة أخرى؟</span>
        </h4>
        <p className="text-[11px] text-slate-400">
          أدخل معرّف المؤسسة ومعرّف الدعوة الذي زوّدك به مدير أو مالك المؤسسة للانضمام إليها مباشرة:
        </p>

        <form onSubmit={handleJoinInvitation} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <input
            type="text"
            placeholder="معرّف المؤسسة (orgId)..."
            value={joinOrgId}
            onChange={(e) => setJoinOrgId(e.target.value)}
            required
            className="bg-[#0e0e14] border border-[#262636] text-xs text-white px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
          />
          <input
            type="text"
            placeholder="معرّف الدعوة (inv-...)..."
            value={joinInvId}
            onChange={(e) => setJoinInvId(e.target.value)}
            required
            className="bg-[#0e0e14] border border-[#262636] text-xs text-white px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
          />
          <button
            type="submit"
            disabled={joinLoading}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
          >
            {joinLoading ? 'جاري التحقق والانضمام...' : 'قبول الدعوة والانضمام'}
          </button>
        </form>

        {joinSuccess && (
          <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-[11px] text-emerald-300">
            {joinSuccess}
          </div>
        )}

        {joinError && (
          <div className="p-2.5 bg-rose-950/40 border border-rose-800/50 rounded-lg text-[11px] text-rose-300">
            {joinError}
          </div>
        )}
      </div>
    </div>
  );
};
