export type Document = Record<string, any>;
export interface Transaction {
  get(path: string): Promise<Document | undefined>;
  list(path: string, options?: { limit?: number; orderBy?: string }): Promise<Document[]>;
  find(path: string, field: string, value: unknown): Promise<Document[]>;
  set(path: string, value: Document): void;
  delete(path: string): void;
}
export interface Store { readonly authority?: 'server' | 'browser' | 'local'; transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>; }
export interface Change { path: string; value: Document | null; }
export function clean<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

/** Transactional in-memory fixture for deterministic tests; production uses Firestore. */
export class MemoryStore implements Store {
  readonly authority = 'local' as const;
  private documents: Record<string, Document>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(seed: Record<string, Document> = {}, private persist?: (data: Record<string, Document>) => void) { this.documents = clean(seed); }
  dump() { return clean(this.documents); }
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const draft = clean(this.documents);
      const result = await work({
        get: async path => draft[path] ? clean(draft[path]) : undefined,
        list: async (path,options) => {const rows=Object.entries(draft).filter(([key]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).split('/').length === 1).map(([, data]) => clean(data));if(options?.orderBy)rows.sort((a,b)=>String(a[options.orderBy!]??'').localeCompare(String(b[options.orderBy!]??'')));return options?.limit?rows.slice(0,options.limit):rows;},
        find: async (path, field, value) => Object.entries(draft).filter(([key, data]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).split('/').length === 1 && data[field] === value).map(([, data]) => clean(data)),
        set: (path, data) => { draft[path] = clean(data); },
        delete: path => { delete draft[path]; },
      });
      // A storage/quota failure rolls back the operation; the UI cannot report an unsaved success.
      this.persist?.(draft);
      this.documents = draft;
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

