import React, { useRef, useState } from 'react';
import { Dialog } from '../Dialog';
import { useApp } from '../../context/AppContext';
import { ownerAuthMethods, type OwnerAuthMethod } from '../../services/ownerReauthentication';
export function OwnerReauthenticationDialog({ onClose, onConfirm, purpose }: { purpose?: { title: string; description: string; reasonLabel: string; confirmation: string; submit: string; initialReason?: string }; onClose: () => void; onConfirm: (reason: string, organizationId: string) => Promise<void> }) {
  const copy = purpose || { title: 'تحقق المالك وإعادة الفتح', description: 'إعادة الفتح تسمح بحركات جديدة في الفترة. يسجل النظام السبب وهوية المالك والحالة السابقة.', reasonLabel: 'سبب إعادة الفتح', confirmation: 'تأكيد هوية المالك', submit: 'التحقق وإعادة الفتح' };
  const { currentUser, currentOrg, confirmOwnerReauthentication } = useApp();
  const methods = currentUser ? ownerAuthMethods(currentUser) : [];
  const [method, setMethod] = useState<OwnerAuthMethod>(methods[0] || 'password');
  const [reason, setReason] = useState(purpose?.initialReason || ''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false), scope = useRef({ org: currentOrg?.id, uid: currentUser?.uid });
  const current = useRef(scope.current); current.current = { org: currentOrg?.id, uid: currentUser?.uid };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (submitting.current || !reason.trim()) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (!currentUser) throw new Error('سجّل الدخول إلى حساب المالك للتحقق من هويتك.');
      if (current.current.org !== scope.current.org || current.current.uid !== scope.current.uid) throw new Error('تغيرت المؤسسة أو الجلسة؛ أعد فتح العملية.');
      const organizationId = await confirmOwnerReauthentication(method, password);
      setPassword('');
      if (organizationId !== scope.current.org || current.current.org !== scope.current.org || current.current.uid !== scope.current.uid) throw new Error('تغيرت المؤسسة أو الجلسة؛ أعد فتح العملية.');
      await onConfirm(reason.trim(), organizationId); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تنفيذ العملية.'); }
    finally { setPassword(''); submitting.current = false; setBusy(false); }
  };
  return <Dialog label={copy.title} onClose={() => { if (!submitting.current) onClose(); }} className="fixed inset-0 z-50 flex items-center justify-center bg-sf-ink/60 p-4">
    <form onSubmit={submit} className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-sf-surface border border-sf-border rounded-xl p-5 space-y-4 text-sm text-sf-text">
      <h3 className="font-semibold text-lg">{copy.title}</h3>
      <p className="text-sf-muted">{copy.description}</p>
      <label className="block">{copy.reasonLabel}<textarea aria-label={copy.reasonLabel} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} required disabled={busy} className="w-full mt-1 p-2 rounded border border-sf-border bg-sf-raised" /></label>
      {currentUser ? <>
        <p className="break-all" dir="ltr">{currentUser.email}</p>
        {methods.length > 1 && <label className="block">طريقة التحقق<select aria-label="طريقة التحقق" value={method} onChange={e => { setMethod(e.target.value as OwnerAuthMethod); setPassword(''); }} disabled={busy} className="w-full p-2 bg-sf-raised border border-sf-border rounded">{methods.map(m => <option key={m} value={m}>{m === 'password' ? 'كلمة المرور' : 'Google'}</option>)}</select></label>}
        {!methods.length ? <p role="alert">هذا الحساب لا يملك طريقة تحقق مدعومة؛ اربط البريد أو Google من إعدادات الحساب.</p> : method === 'password' ? <label className="block">كلمة مرور الحساب<input aria-label="كلمة مرور الحساب" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} className="w-full mt-1 p-2 bg-sf-raised border border-sf-border rounded" /></label> : <p>سيطلب Google تأكيد نفس الحساب قبل إرسال العملية.</p>}
      </> : <p role="alert">سجّل الدخول إلى حساب المالك للتحقق من هويتك.</p>}
      {error && <p role="alert" className="text-sf-danger">{error}</p>}
      <div className="flex gap-2"><button type="submit" disabled={busy || !reason.trim() || !currentUser || !methods.length || (method === 'password' && !password)} className="p-3 rounded bg-sf-action text-white disabled:opacity-50">{busy ? 'جارٍ التحقق والتنفيذ…' : copy.submit}</button><button type="button" onClick={onClose} disabled={busy} className="p-3 border border-sf-border rounded">إلغاء</button></div>
    </form>
  </Dialog>;
}
