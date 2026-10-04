import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
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
    const index = await getDocsFromServer(collection(db, `user_organizations/${user.uid}/orgs`));
    const ids = new Set([`org-${user.uid}`, ...index.docs.map(record => record.data().org_id).filter(id => typeof id === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(id))]);
    const results = await Promise.allSettled([...ids].map(async id => {
      const org = await getDocFromServer(doc(db, `organizations/${id}`));
      if (!org.exists()) return null;
      const data = { ...org.data(), id: org.id } as Organization;
      if (data.owner_uid === user.uid) return data;
      const member = await getDocFromServer(doc(db, `organizations/${id}/members/${user.uid}`));
      return member.exists() && member.data().status === 'active' ? data : null;
    }));
    if (auth.currentUser?.uid !== user.uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401);
    const organizations: Organization[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) organizations.push(result.value);
      // A missing deterministic initial company can be denied by rules. Do not hide
      // network/database failures as an empty company list and start a new company.
      else if (result.status === 'rejected' && !['permission-denied', 'firestore/permission-denied'].includes(result.reason?.code)) throw result.reason;
    }
    if (!organizations.length) throw error;
    return organizations;
  }
}
