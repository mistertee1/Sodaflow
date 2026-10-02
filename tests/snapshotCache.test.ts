import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshotCache, writeSnapshotCache, type SnapshotCacheStorage } from '../src/services/snapshotCache';

class TestStorage implements SnapshotCacheStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const snapshot = (orgId = 'org-a') => ({
  schema_version: 3,
  org: { id: orgId },
  counters: { revision: 7 },
  collections: { invoices: [{ id: 'inv-1' }] },
});

test('cloud snapshot cache is isolated by user and organization', () => {
  const storage = new TestStorage();
  assert.equal(writeSnapshotCache(storage, 'user-a', 'org-a', snapshot(), new Date('2026-10-02T12:00:00Z')), true);
  assert.equal(readSnapshotCache(storage, 'user-b', 'org-a'), null);
  assert.equal(readSnapshotCache(storage, 'user-a', 'org-b'), null);
  const cached = readSnapshotCache(storage, 'user-a', 'org-a');
  assert.equal(cached?.snapshot.org.id, 'org-a');
  assert.equal(cached?.snapshot.counters.revision, 7);
  assert.equal(cached?.savedAt.toISOString(), '2026-10-02T12:00:00.000Z');
});

test('cloud snapshot cache rejects malformed, mismatched, and old-schema snapshots', () => {
  const storage = new TestStorage();
  assert.equal(writeSnapshotCache(storage, 'user-a', 'org-a', { ...snapshot(), schema_version: 2 }), false);
  assert.equal(writeSnapshotCache(storage, 'user-a', 'org-a', snapshot('org-b')), false);

  storage.values.set('sudaflow_cloud_snapshot_v1_user-a_org-a', '{bad json');
  assert.equal(readSnapshotCache(storage, 'user-a', 'org-a'), null);
});

test('cache failures never turn a confirmed server operation into a client failure', () => {
  const storage: SnapshotCacheStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => {},
  };
  assert.equal(writeSnapshotCache(storage, 'user-a', 'org-a', snapshot()), false);
});
