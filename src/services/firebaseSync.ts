import type { Operations, OperationResult } from '../domain/operations';
import { api, sendCommand } from './businessApi';
export { watchFirebaseRevision } from './revisionWatch';

// Keep realtime revision notifications and the confirmed snapshot cache. All tenant reads
// and financial writes use the same authenticated API and authoritative live entitlements.
// Tenant writes stay on the authenticated API, where subscription checks and counters
// are committed atomically. Revision notifications use the Firestore SDK.
export function firebaseSnapshot(orgId: string, backup = false) {
  return api<Awaited<ReturnType<Operations['snapshot']>>>(`/organizations/${encodeURIComponent(orgId)}/${backup ? 'backup' : 'snapshot'}`);
}
export function firebaseCommand(orgId: string, action: string, data: Record<string, unknown>, suggestedId?: string): Promise<OperationResult> {
  return sendCommand(orgId, action, data, suggestedId);
}
