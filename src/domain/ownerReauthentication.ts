import { BusinessError } from './validation';
export type OwnerAuthMethod = 'password' | 'google.com';
export interface ReauthenticationIdentity { uid: string; email: string | null; emailVerified: boolean; providers: string[]; }
export interface ReauthenticationPort {
  currentIdentity: () => ReauthenticationIdentity | null;
  password: (uid: string, email: string, password: string) => Promise<void>;
  google: (uid: string, email: string | null) => Promise<void>;
  refreshToken: (uid: string) => Promise<void>;
}
// Client orchestration never invents or sends auth_time. The API verifies the Firebase claim independently.
export async function reauthenticateCurrentOwner(port: ReauthenticationPort, expectedUid: string, method: OwnerAuthMethod, password = '') {
  const identity = port.currentIdentity();
  const same = () => { if (port.currentIdentity()?.uid !== expectedUid) throw new BusinessError('تغير الحساب أثناء التحقق؛ أعد فتح العملية.', 409); };
  same();
  if (!identity || !identity.emailVerified || !['password','google.com'].includes(method) || !identity.providers.includes(method)) throw new BusinessError('طريقة التحقق غير متاحة للحساب الحالي.', 403);
  if (method === 'password') {
    if (!identity.email || !password) throw new BusinessError('أدخل كلمة مرور الحساب الحالي.');
    await port.password(expectedUid, identity.email, password);
  } else await port.google(expectedUid, identity.email);
  same(); await port.refreshToken(expectedUid); same();
}
