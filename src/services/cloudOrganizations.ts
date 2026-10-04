import { readFirebaseOrganizations } from './firebaseOrganizations';
import { auth, db } from '../lib/firebase';
import type { Organization } from '../types';
import { BusinessError } from '../domain/validation';
import { api } from './businessApi';

/** Read-only recovery for existing companies when the operations server loses Firestore access. */
export async function cloudOrganizations(): Promise<Organization[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) throw new BusinessError('تسجيل الدخول ببريد مؤكد مطلوب.', 401);
  try { const organizations = await api<Organization[]>('/organizations'); if (!Array.isArray(organizations)) throw new BusinessError('استجابة المؤسسات غير صالحة.', 503, 'invalid_response'); return organizations; }
  catch (error) {
    if (!(error instanceof BusinessError) || error.status < 500) throw error;
    // The Firebase Web SDK still enforces the signed-in user's production Security Rules.
    // This recovery does not create companies, grant roles, or write subscription/financial data.
    const testLookup = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? (window as any).__SUDANFLOW_FIREBASE_SYNC_TEST__?.organizations : undefined;
    const organizations = testLookup ? await testLookup() : await readFirebaseOrganizations(db, user.uid);
    if (auth.currentUser?.uid !== user.uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401);
    if (!organizations.length) throw error;
    return organizations;
  }
}
