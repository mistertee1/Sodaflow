import type { Firestore } from 'firebase-admin/firestore';
import type { Document, Store, Transaction } from '../src/domain/store';
import { MemoryStore } from '../src/domain/store';
import { FirestoreStore } from './firestoreStore';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resilient server store:
 * Seamlessly uses Cloud Firestore when server credentials are valid.
 * Automatically and reliably falls back to local file persistence if
 * Firebase Admin lacks remote Firestore credentials or permissions,
 * ensuring new Google accounts and cloud organizations never fail with 503.
 */
export class ResilientStore implements Store {
  readonly authority = 'server' as const;
  private firestoreStore: FirestoreStore;
  private fallbackStore: MemoryStore;
  private useFallback = false;
  private storeFilePath: string;

  constructor(db: Firestore) {
    this.firestoreStore = new FirestoreStore(db);
    this.storeFilePath = path.resolve('.data', 'sudaflow_server_store.json');
    let seed: Record<string, Document> = {};
    try {
      if (fs.existsSync(this.storeFilePath)) {
        seed = JSON.parse(fs.readFileSync(this.storeFilePath, 'utf8'));
      }
    } catch (err) {
      console.warn('ResilientStore: starting with empty seed store:', err);
    }
    this.fallbackStore = new MemoryStore(seed, data => {
      try {
        fs.mkdirSync(path.dirname(this.storeFilePath), { recursive: true });
        fs.writeFileSync(this.storeFilePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        console.error('ResilientStore: file persist error:', e);
      }
    });
  }

  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    if (this.useFallback) {
      return this.fallbackStore.transaction(work);
    }
    try {
      return await this.firestoreStore.transaction(work);
    } catch (error: any) {
      const code = String(error?.code || '').toLowerCase();
      const message = String(error?.message || '').toLowerCase();
      const isAccessDenied =
        code === '7' ||
        code === 'permission_denied' ||
        code === 'unauthenticated' ||
        code === '16' ||
        code === 'app/invalid-credential' ||
        message.includes('missing or insufficient permissions') ||
        message.includes('permission denied') ||
        message.includes('could not load the default credentials');

      if (isAccessDenied) {
        if (!this.useFallback) {
          console.warn('ResilientStore: Firestore remote access unavailable (using server file persistence fallback)');
          this.useFallback = true;
        }
        return this.fallbackStore.transaction(work);
      }
      throw error;
    }
  }
}
