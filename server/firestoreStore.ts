import type { Firestore } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import type { Document, Store, Transaction } from '../src/domain/store';
import { clean } from '../src/domain/store';
import { ensure } from '../src/domain/validation';

export class FirestoreStore implements Store {
  readonly authority = 'server' as const;
  constructor(private db: Firestore) {}
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async native => {
      const writes = new Map<string, Document | null>();
      const list = async (path: string, field?: string, value?: unknown, options?: {limit?:number;orderBy?:string}) => {
        const records: Document[] = [];
        const pageLimit=Math.min(options?.limit||1000,1000);let query = this.db.collection(path).orderBy(options?.orderBy||FieldPath.documentId()).limit(pageLimit);
        if (field) query = query.where(field, '==', value);
        for (;;) {
          const page = await native.get(query);
          records.push(...page.docs.map(d => ({ ...d.data(), ...(d.data().id || d.data().code ? {} : { id: d.id }) })));
          if (page.size < pageLimit||options?.limit&&records.length>=options.limit) break;
          query = query.startAfter(page.docs.at(-1)!);
        }
        return records;
      };
      const result = await work({
        get: async path => { const doc = await native.get(this.db.doc(path)); return doc.exists ? doc.data() : undefined; },
        list: (path,options) => list(path,undefined,undefined,options), find: (path, field, value) => list(path, field, value),
        set: (path, data) => { writes.set(path, clean(data)); }, delete: path => { writes.set(path, null); },
      });
      ensure(writes.size <= 450, 'عدد سجلات العملية يتجاوز الحد الذري المسموح.');
      for (const [path, data] of writes) { if (data === null) native.delete(this.db.doc(path)); else native.set(this.db.doc(path), data); }
      return result;
    });
  }
}

