import { collection, doc, getDocFromServer, getDocsFromServer, type Firestore } from 'firebase/firestore';
import type { Organization } from '../types';
import { identifier } from '../domain/validation';

const isPermissionDenied = (error: unknown) => ['permission-denied', 'firestore/permission-denied'].includes((error as { code?: string })?.code || '');

/** Every tenant document is read from the server under the signed-in user's rules. */
export async function readFirebaseOrganizations(db: Firestore, userId: string): Promise<Organization[]> {
  const uid = identifier(userId);
  const ids = new Set<string>([`org-${uid}`]);
  try {
    const index = await getDocsFromServer(collection(db, `user_organizations/${uid}/orgs`));
    for (const row of index.docs) ids.add(identifier(row.data().org_id || row.id));
  } catch (error) {
    // An older rules deployment may deny the index. The initial owner's document
    // is still checked by Firestore rules, never by the ID prefix alone.
    if (!isPermissionDenied(error)) throw error;
  }
  const orgs: Organization[] = [];
  for (const id of ids) {
    try {
      const row = await getDocFromServer(doc(db, `organizations/${id}`));
      if (row.exists() && row.data().status === 'active') orgs.push({ ...row.data(), id } as Organization);
    } catch (error) {
      // Stale index entries for revoked memberships do not hide other valid tenants.
      if (!isPermissionDenied(error)) throw error;
    }
  }
  return orgs;
}
