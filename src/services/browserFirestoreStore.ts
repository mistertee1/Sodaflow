import type { Firestore } from 'firebase/firestore';
import {
  collection,
  doc,
  documentId,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  runTransaction,
  startAfter,
} from 'firebase/firestore';
import type { Document, Store, Transaction } from '../domain/store';
import { clean } from '../domain/store';
import { ensure } from '../domain/validation';

/**
 * Browser Firestore adapter.
 *
 * Document reads that protect counters, stock, balances and idempotency are native
 * Firestore transaction reads and therefore participate in conflict retries.
 *
 * The Web SDK does not support collection queries through Transaction.get().
 * Collection scans are fetched directly from Firestore before buffered writes are
 * applied. Business-critical mutable documents are still re-read transactionally.
 */
export class BrowserFirestoreStore implements Store {
  readonly authority = 'browser' as const;
  constructor(private db: Firestore) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return runTransaction(this.db, async native => {
      const writes = new Map<string, Document | null>();

      const list = async (path: string, field?: string, value?: unknown) => {
        const records: Document[] = [];
        let cursor: any = null;
        for (;;) {
          const base = collection(this.db, path);
          const q = cursor
            ? query(base, orderBy(documentId()), startAfter(cursor), limit(1000))
            : query(base, orderBy(documentId()), limit(1000));
          const page = await getDocsFromServer(q);
          for (const row of page.docs) {
            const data = row.data() as Document;
            if (field && data[field] !== value) continue;
            records.push({ ...data, ...(data.id || data.code || data.uid ? {} : { id: row.id }) });
          }
          if (page.size < 1000) break;
          cursor = page.docs.at(-1);
          if (!cursor) break;
        }
        return records;
      };

      const result = await work({
        get: async path => {
          const snap = await native.get(doc(this.db, path));
          return snap.exists() ? clean(snap.data() as Document) : undefined;
        },
        list: path => list(path),
        find: (path, field, value) => list(path, field, value),
        set: (path, data) => { writes.set(path, clean(data)); },
        delete: path => { writes.set(path, null); },
      });

      ensure(writes.size <= 450, 'عدد سجلات العملية يتجاوز الحد الذري المسموح.');
      for (const [path, data] of writes) {
        const ref = doc(this.db, path);
        if (data === null) native.delete(ref);
        else native.set(ref, data);
      }
      return result;
    }, { maxAttempts: 5 });
  }
}
