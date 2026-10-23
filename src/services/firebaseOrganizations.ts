import { collection, doc, getDocFromServer, getDocsFromServer, type Firestore } from 'firebase/firestore';
import type { Organization } from '../types';
import { identifier } from '../domain/validation';

/** Read-only discovery under the signed-in user's rules; index roles grant no rights. */
export async function readFirebaseOrganizations(db: Firestore, userId: string): Promise<Organization[]> {
  const uid = identifier(userId);
  const index = await getDocsFromServer(collection(db, `user_organizations/${uid}/orgs`));
  const ids = new Set([`org-${uid}`, ...index.docs.map(record => record.data().org_id).filter(id => typeof id === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(id))]);
  const results = await Promise.allSettled([...ids].map(async id => {
    const org = await getDocFromServer(doc(db, `organizations/${id}`));
    if (!org.exists()) return null;
    const data = { ...org.data(), id: org.id } as Organization;
    if (data.owner_uid === uid) return data;
    const member = await getDocFromServer(doc(db, `organizations/${id}/members/${uid}`));
    return member.exists() && ['active', 'suspended'].includes(member.data().status) ? data : null;
  }));
  const organizations: Organization[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) organizations.push(result.value);
    // Denied or deleted index entries do not hide other valid tenants. Transport
    // errors must still fail, so an outage cannot become empty-company provisioning.
    else if (result.status === 'rejected' && !['permission-denied', 'firestore/permission-denied'].includes(result.reason?.code)) throw result.reason;
  }
  return organizations;
}
