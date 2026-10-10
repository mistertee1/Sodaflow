import type { Firestore } from 'firebase-admin/firestore';
import type { Store, Transaction } from '../src/domain/store';
import { FirestoreStore } from './firestoreStore';

/**
 * Cloud Firestore is the only authority for authenticated server transactions.
 * Credential/permission failures fail the request; the caller retries remotely
 * with the same operation ID after access recovers. Replaying into a local file
 * would split organizations, quotas, subscriptions and financial books.
 *
 * Preserve the existing entry point. Existing .data files are neither read nor
 * removed; recovery of their contents requires a reviewed import. Offline guest
 * sessions still use MemoryStore through the guest service.
 */
export class ResilientStore implements Store {
  readonly authority = 'server' as const;
  private readonly firestoreStore: FirestoreStore;

  constructor(db: Firestore) {
    this.firestoreStore = new FirestoreStore(db);
  }

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.firestoreStore.transaction(work);
  }
}
