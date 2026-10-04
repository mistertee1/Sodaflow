import { membership, type Actor } from '../src/domain/operations';
import type { Store } from '../src/domain/store';
import { ensure } from '../src/domain/validation';

/** Read the synchronization counter without scanning financial collections. */
export async function organizationRevision(store: Store, orgId: string, actor: Actor) {
  return store.transaction(async tx => {
    await membership(tx, orgId, actor);
    const counters = await tx.get(`organizations/${orgId}/meta/counters`);
    const revision = Number(counters?.revision || 0);
    ensure(Number.isSafeInteger(revision) && revision >= 0, 'عداد المزامنة غير صالح. أعد المحاولة.', 503);
    return { revision };
  });
}
