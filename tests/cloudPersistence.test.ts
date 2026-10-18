import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OperationIntents } from '../server/operationIntents';
import { platformFixture, servePlatform } from './helpers/platform';

const fingerprint = 'a'.repeat(64);
const retryMetadata = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([path]) => !path.startsWith('platformOperationIntents/') && !path.includes('/operationIntents/')));

test('uncertain retry IDs survive a new service instance and concurrent requests in the cloud', async () => {
  const f = await platformFixture(), input = { organizationId: f.org.id, fingerprint };
  const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => new OperationIntents(f.store).begin(f.owner, { ...input, operationId: `proposed-${i}` })));
  assert.equal(new Set(ids.map(row => row.operationId)).size, 1);
  assert.equal((await new OperationIntents(f.store).begin(f.owner, input)).operationId, ids[0].operationId);
  const rows = Object.entries(f.store.dump()).filter(([path]) => path.includes('/operationIntents/') && !path.includes('/rate-'));
  assert.equal(rows.length, 1); assert.deepEqual(Object.keys(rows[0][1]).sort(), ['createdAt', 'fingerprint', 'operationId', 'uid']);
});

test('cloud retry acknowledgement permits the next identical intent and an old response cannot erase it', async () => {
  const f = await platformFixture(), service = new OperationIntents(f.store), input = { organizationId: f.org.id, fingerprint };
  const first = await service.begin(f.owner, { ...input, operationId: 'first' });
  await service.acknowledge(f.owner, { ...input, ...first });
  const next = await service.begin(f.owner, { ...input, operationId: 'next' }); assert.equal(next.operationId, 'next');
  assert.equal((await service.acknowledge(f.owner, { ...input, ...first })).acknowledged, false);
  assert.equal((await new OperationIntents(f.store).begin(f.owner, input)).operationId, 'next');
});

test('cloud retry IDs are isolated by user, organization and exclusive platform authority', async () => {
  const f = await platformFixture(), other = { ...f.owner, uid: 'another-owner', email: 'another@example.test' };
  const org = await f.organizations.create(other, 'شركة ثانية', {}, 'second', true);
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/members/${other.uid}`, { uid: other.uid, role: 'Admin', status: 'active' }));
  const service = new OperationIntents(f.store);
  const ids = await Promise.all([
    service.begin(f.owner, { organizationId: f.org.id, fingerprint }),
    service.begin(other, { organizationId: f.org.id, fingerprint }),
    service.begin(other, { organizationId: org.id, fingerprint }),
    service.begin(f.admin, { fingerprint }),
  ]);
  assert.equal(new Set(ids.map(row => row.operationId)).size, 4);
  const before = f.store.dump();
  for (const [actor, input] of [[f.owner, { fingerprint }], [f.owner, { organizationId: org.id, fingerprint }], [{ ...f.owner, emailVerified: false }, { organizationId: f.org.id, fingerprint }]] as const) {
    await assert.rejects(service.begin(actor, input), (e: any) => e.status === 403);
    await assert.rejects(service.acknowledge(actor, { ...input, operationId: ids[0].operationId }), (e: any) => e.status === 403);
  }
  assert.deepEqual(f.store.dump(), before);
});

test('an expired subscription cannot use a cloud retry intent to bypass the protected operation', async () => {
  const f = await platformFixture();
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}`, { ...await tx.get(`organizations/${f.org.id}`), planId: 'Professional', subscriptionEnd: '2000-01-01T00:00:00Z' }));
  const before = retryMetadata(f.store.dump()), intent = await new OperationIntents(f.store).begin(f.owner, { organizationId: f.org.id, fingerprint });
  await assert.rejects(f.operations.execute(f.org.id, f.owner, { action: 'customer.create', operationId: intent.operationId, data: { name: 'يجب رفض الحفظ' } }), (e: any) => e.code === 'subscription_expired');
  assert.deepEqual(retryMetadata(f.store.dump()), before);
});

test('exclusive administrator revocation rejects retry metadata reads and writes atomically', async () => {
  const f = await platformFixture(), service = new OperationIntents(f.store), intent = await service.begin(f.admin, { fingerprint });
  await f.store.transaction(async tx => tx.set('platformAccess/superAdmin', { uid: f.admin.uid, email: f.admin.email, active: false, mode: 'exclusive' }));
  const before = f.store.dump();
  await assert.rejects(service.begin(f.admin, { fingerprint }), (e: any) => e.status === 403);
  await assert.rejects(service.acknowledge(f.admin, { fingerprint, ...intent }), (e: any) => e.status === 403);
  assert.deepEqual(f.store.dump(), before);
});

test('tenant records, backups, platform decisions and auth errors prohibit HTTP caching', async () => {
  const fixture = await platformFixture(), server = await servePlatform(fixture);
  try {
    for (const [path, token, status] of [
      ['/organizations', 'owner', 200], [`/organizations/${fixture.org.id}/snapshot`, 'owner', 200],
      [`/organizations/${fixture.org.id}/backup`, 'owner', 200], ['/super-admin/session', 'admin', 200],
      ['/super-admin/session', 'owner', 403], ['/organizations', 'invalid', 401],
    ] as const) {
      const response = await server.request(path, token); assert.equal(response.status, status, path);
      assert.equal(response.headers.get('cache-control'), 'no-store', path); await response.text();
    }
    const first = await (await server.request('/operation-intents', 'owner', { organizationId: fixture.org.id, fingerprint })).json();
    const retried = await (await server.request('/operation-intents', 'owner', { organizationId: fixture.org.id, fingerprint })).json();
    assert.deepEqual(retried, first);
    assert.equal((await server.request('/operation-intents', 'owner', { fingerprint })).status, 403);
  } finally { await server.close(); }
});

test('malformed cloud retry requests and read-only members cannot create metadata', async () => {
  const f = await platformFixture(), service = new OperationIntents(f.store), before = f.store.dump();
  for (const input of [null, [], {}, { fingerprint: 'invalid' }, { fingerprint, organizationId: '../other' }, { fingerprint, operationId: 'x'.repeat(65) }, { fingerprint, price: 0 }]) {
    await assert.rejects(async () => service.begin(f.owner, input as any), (e: any) => e.status === 400);
    assert.deepEqual(f.store.dump(), before);
  }
  const viewer = { ...f.owner, uid: 'cloud-viewer' };
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/members/${viewer.uid}`, { uid: viewer.uid, role: 'Viewer', status: 'active' }));
  const after = f.store.dump();
  await assert.rejects(service.begin(viewer, { organizationId: f.org.id, fingerprint }), (e: any) => e.status === 403);
  assert.deepEqual(f.store.dump(), after);
});

test('cloud retry creation is bounded per actor while an already pending ID remains safely retryable', async () => {
  const f = await platformFixture(), service = new OperationIntents(f.store, () => new Date('2026-10-18T12:00:00Z'));
  const input = (n: number) => ({ organizationId: f.org.id, fingerprint: n.toString(16).padStart(64, '0') });
  for (let n = 0; n < 120; n++) await service.begin(f.owner, input(n));
  const before = f.store.dump();
  await assert.rejects(service.begin(f.owner, input(120)), (e: any) => e.status === 429);
  await service.begin(f.owner, input(0)); assert.deepEqual(f.store.dump(), before);
});
