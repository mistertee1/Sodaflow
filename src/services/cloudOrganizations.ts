import { readFirebaseOrganizations } from './firebaseOrganizations';
import { auth, db } from '../lib/firebase';
import type { Organization } from '../types';
import { BusinessError } from '../domain/validation';
import { api } from './businessApi';

/** Discover existing companies through the same authenticated SDK used for financial synchronization. */
export async function cloudOrganizations(): Promise<Organization[]> {
  const user = auth.currentUser;
  const isGoogle = user?.providerData?.some(p => p.providerId === 'google.com');
  if (!user || (!user.emailVerified && !isGoogle)) throw new BusinessError('تسجيل الدخول ببريد مؤكد مطلوب.', 401);
  const checkSession = () => { if (auth.currentUser?.uid !== user.uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401); };
  try {
    // Existing tenants must not wait for an unavailable Admin API before using Firestore.
    const testLookup = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? (window as any).__SUDANFLOW_FIREBASE_SYNC_TEST__?.organizations : undefined;
    const organizations = testLookup ? await testLookup() : await readFirebaseOrganizations(db, user.uid);
    checkSession();
    if (!Array.isArray(organizations)) throw new BusinessError('استجابة المؤسسات غير صالحة.', 503, 'invalid_response');
    if (organizations.length) return organizations;
  } catch (error) {
    const code = (error as { code?: string })?.code || '';
    if (!['permission-denied', 'firestore/permission-denied', 'unavailable', 'failed-precondition'].includes(code)) {
      console.warn('readFirebaseOrganizations notice:', code);
    }
  }
  checkSession();
  // The API finds legacy companies without index entries and provisions new accounts.
  // Keep these privileged tasks on the server instead of copying the legacy blanket-write rules.
  const organizations = await api<Organization[]>('/organizations');
  checkSession();
  if (!Array.isArray(organizations)) throw new BusinessError('استجابة المؤسسات غير صالحة.', 503, 'invalid_response');
  return organizations;
}
