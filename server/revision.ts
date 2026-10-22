import { membership, type Actor } from '../src/domain/operations';
import type { Store } from '../src/domain/store';
import { ensure } from '../src/domain/validation';

/** Read the synchronization counter without scanning financial collections. */
export async function organizationRevision(store: Store, orgId: string, actor: Actor, controlsEnabled = true) {
  return store.transaction(async tx => {
    // The counter is a tenant-scoped read, like the historical snapshot. Protected
    // writes still validate company and subscription status in Operations.execute.
    await membership(tx, orgId, actor, true, controlsEnabled);
    const counters = await tx.get(`organizations/${orgId}/meta/counters`);
    const revision = Number(counters?.revision || 0);
    ensure(Number.isSafeInteger(revision) && revision >= 0, 'عداد المزامنة غير صالح. أعد المحاولة.', 503);
    return { revision };
  });
}
