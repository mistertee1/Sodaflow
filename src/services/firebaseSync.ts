import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Operations, OperationResult } from '../domain/operations';
import { api, sendCommand } from './businessApi';

// Keep realtime revision notifications and the confirmed snapshot cache. All tenant reads
// and financial writes use the same authenticated API and authoritative live entitlements.
// Firestore SDK writes cannot enforce cross-document invoice quotas safely and are denied.
export function firebaseSnapshot(orgId: string, backup = false) {
  return api<Awaited<ReturnType<Operations['snapshot']>>>(`/organizations/${encodeURIComponent(orgId)}/${backup ? 'backup' : 'snapshot'}`);
}
export function firebaseCommand(orgId: string, action: string, data: Record<string, unknown>, suggestedId?: string): Promise<OperationResult> {
  return sendCommand(orgId, action, data, suggestedId);
}
export function watchFirebaseRevision(orgId: string, onRevision: (revision: number) => void, onError?: (error: unknown) => void) {
  return onSnapshot(doc(db, `organizations/${orgId}/meta/counters`), snapshot => onRevision(Number(snapshot.data()?.revision || 0)), error => onError?.(error));
}
