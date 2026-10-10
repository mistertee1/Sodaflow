import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { BusinessError } from '../domain/validation';
import { reauthenticateCurrentOwner, type OwnerAuthMethod } from '../domain/ownerReauthentication';
export type { OwnerAuthMethod } from '../domain/ownerReauthentication';
export function ownerAuthMethods(user: User): OwnerAuthMethod[] {
  return (['password', 'google.com'] as const).filter(method => user.providerData.some(provider => provider.providerId === method));
}
// Reauthenticate the current identity. Refreshing an ID token alone is never proof of recent authentication.
export async function reauthenticateOwner(method: OwnerAuthMethod, password = '', expectedUid = auth.currentUser?.uid || ''): Promise<void> {
  try {
    const captured = auth.currentUser;
    await reauthenticateCurrentOwner({
      currentIdentity: () => auth.currentUser ? { uid:auth.currentUser.uid, email:auth.currentUser.email, emailVerified:auth.currentUser.emailVerified, providers:auth.currentUser.providerData.map(row=>row.providerId) } : null,
      password: async (_uid,email,secret) => { if (!captured) throw new BusinessError('الجلسة غير متاحة.',401); await reauthenticateWithCredential(captured,EmailAuthProvider.credential(email,secret)); },
      google: async (_uid,email) => { if (!captured) throw new BusinessError('الجلسة غير متاحة.',401); const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account',...(email?{login_hint:email}:{})});await reauthenticateWithPopup(captured,provider); },
      refreshToken: async () => { if (!captured) throw new BusinessError('الجلسة غير متاحة.',401); await captured.getIdToken(true); },
    }, expectedUid, method, password);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    const code = (error as { code?: string }).code;
    const messages: Record<string, string> = {
      'auth/invalid-credential': 'بيانات التحقق غير صحيحة.', 'auth/wrong-password': 'كلمة المرور غير صحيحة.',
      'auth/user-mismatch': 'اختر نفس حساب المالك المسجل حالياً.', 'auth/popup-closed-by-user': 'أغلقت نافذة التحقق؛ لم تنفذ العملية.',
      'auth/popup-blocked': 'اسمح بنافذة Google ثم أعد التحقق.', 'auth/cancelled-popup-request': 'أعد المحاولة من نافذة تحقق واحدة.',
      'auth/too-many-requests': 'محاولات كثيرة؛ انتظر ثم أعد التحقق.', 'auth/network-request-failed': 'تعذر الاتصال للتحقق؛ أعد المحاولة.',
    };
    throw new BusinessError(messages[code || ''] || 'تعذر التحقق من هوية المالك؛ أعد المحاولة.', 401);
  }
}
