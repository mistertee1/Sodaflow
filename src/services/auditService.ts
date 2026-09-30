import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AuditLogEntry } from '../types';

/**
 * Audit Logging Service
 * Records append-only, tenant-isolated audit logs for all critical changes.
 */
export const logAuditEvent = async (
  orgId: string,
  actorUid: string,
  actorEmail: string,
  action: string,
  entityType: AuditLogEntry['entity_type'],
  entityId: string,
  details?: string,
  previousState?: any,
  newState?: any,
  operationId?: string
): Promise<AuditLogEntry> => {
  const logId = 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const now = new Date().toISOString();

  const entry: AuditLogEntry = {
    id: logId,
    org_id: orgId,
    actor_uid: actorUid,
    actor_email: actorEmail || 'system@hesabak.app',
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    previous_state: previousState ? JSON.parse(JSON.stringify(previousState)) : undefined,
    new_state: newState ? JSON.parse(JSON.stringify(newState)) : undefined,
    created_at: now,
    operation_id: operationId,
  };

  try {
    if (orgId && orgId !== 'local-guest-org') {
      const logRef = doc(db, 'organizations', orgId, 'audit_logs', logId);
      await setDoc(logRef, entry);
    }
  } catch (err) {
    console.warn('Could not write audit log to Firestore:', err);
  }

  // Also maintain local cached logs for the active organization
  try {
    const key = `hisabuk_audit_logs_${orgId}`;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const updated = [entry, ...existing].slice(0, 200); // keep last 200 locally
    localStorage.setItem(key, JSON.stringify(updated));
  } catch (e) {
    console.warn('LocalStorage audit error:', e);
  }

  return entry;
};
