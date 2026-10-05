import config from '../../firebase-applet-config.json';
export interface SnapshotCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type CacheableSnapshot = {
  schema_version: number;
  org: { id: string };
};

export interface SnapshotCacheEntry<T> {
  snapshot: T;
  savedAt: Date;
}

const CACHE_VERSION = 1;
const CACHE_PREFIX = `sudaflow_cloud_snapshot_v2_${config.projectId}_${config.firestoreDatabaseId || '(default)'}`;
const MAX_CACHE_CHARS = 3_500_000;

const cacheKey = (uid: string, orgId: string) =>
  `${CACHE_PREFIX}_${encodeURIComponent(uid)}_${encodeURIComponent(orgId)}`;

const forget = (storage: SnapshotCacheStorage, key: string) => {
  try { storage.removeItem(key); } catch { /* Best-effort cache cleanup only. */ }
};

export function readSnapshotCache<T extends CacheableSnapshot>(
  storage: SnapshotCacheStorage,
  uid: string,
  orgId: string,
): SnapshotCacheEntry<T> | null {
  const key = cacheKey(uid, orgId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as {
      version?: number;
      uid?: string;
      orgId?: string;
      savedAt?: string;
      snapshot?: T;
    };
    const savedAt = envelope.savedAt ? new Date(envelope.savedAt) : null;
    if (
      envelope.version !== CACHE_VERSION
      || envelope.uid !== uid
      || envelope.orgId !== orgId
      || !savedAt
      || !Number.isFinite(savedAt.getTime())
      || !envelope.snapshot
      || envelope.snapshot.schema_version !== 3
      || envelope.snapshot.org?.id !== orgId
    ) {
      forget(storage, key);
      return null;
    }
    return { snapshot: envelope.snapshot, savedAt };
  } catch {
    forget(storage, key);
    return null;
  }
}

export function writeSnapshotCache<T extends CacheableSnapshot>(
  storage: SnapshotCacheStorage,
  uid: string,
  orgId: string,
  snapshot: T,
  savedAt = new Date(),
): boolean {
  if (!uid || !orgId || snapshot.schema_version !== 3 || snapshot.org?.id !== orgId) return false;
  const key = cacheKey(uid, orgId);
  try {
    const payload = JSON.stringify({
      version: CACHE_VERSION,
      uid,
      orgId,
      savedAt: savedAt.toISOString(),
      snapshot,
    });
    if (payload.length > MAX_CACHE_CHARS) {
      forget(storage, key);
      return false;
    }
    storage.setItem(key, payload);
    return true;
  } catch {
    return false;
  }
}
