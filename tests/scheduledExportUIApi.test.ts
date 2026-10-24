import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { MemoryStore, type Document } from '../src/domain/store';
import { defaultPlatformPlans } from '../src/lib/plans';
import { ScheduledExportManagement } from '../src/domain/scheduledExportManagement';
import { createApi } from '../server/api';
import { liveExportFixture } from './helpers/liveExports';

const job = (orgId: string, id: string, uid = 'Accountant', minute = 0, kind = 'accounting') => ({ id, org_id: orgId, requested_by: uid, kind, status: 'queued', progress: 0, created_at: new Date(Date.UTC(2026, 9, 23, 0, minute)).toISOString(), updated_at: '2026-10-24T06:00:00.000Z' });
test('Schedule kinds use actual financial roles and live features, including while ordinary commercial controls are paused', async () => {
  const f = await liveExportFixture();
  assert.deepEqual((await f.service.list(f.org.id, f.owner)).allowed_kinds, ['accounting', 'auditor', 'company']);
  for (const uid of ['Accountant', 'Admin']) assert.deepEqual((await f.service.list(f.org.id, f.actor(uid))).allowed_kinds, ['accounting', 'auditor']);
  for (const uid of ['Viewer', 'Sales', 'Cashier', 'ForgedOwner']) await assert.rejects(f.service.list(f.org.id, f.actor(uid)), (e: any) => e.status === 403);
  const plan = defaultPlatformPlans().find(p => p.id === 'Enterprise')!;
  await f.store.transaction(async tx => tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, advanced_reports: false } }));
  assert.deepEqual((await f.service.list(f.org.id, f.owner)).allowed_kinds, ['company']);
  await assert.rejects(f.service.list(f.org.id, f.actor('Accountant')), (e: any) => e.status === 403);
});
test('History applies creator and kind filters before the newest-100 limit, rather than reversing a stale window', async () => {
  const f = await liveExportFixture();
  await f.store.transaction(async tx => {
    for (let i = 0; i < 160; i++) tx.set(`${f.root}/accounting_export_jobs/own-${i}`, job(f.org.id, `own-${i}`, 'Accountant', i));
    for (let i = 0; i < 110; i++) tx.set(`${f.root}/accounting_export_jobs/other-${i}`, job(f.org.id, `other-${i}`, 'OtherAccountant', 200 + i));
    for (let i = 0; i < 110; i++) tx.set(`${f.root}/accounting_export_jobs/auditor-${i}`, job(f.org.id, `auditor-${i}`, 'Accountant', 400 + i, 'auditor'));
    const plan = defaultPlatformPlans().find(p => p.id === 'Enterprise')!;
    tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, audit_trail: false } });
  });
  const history = await f.service.history(f.org.id, f.actor('Accountant'));
  assert.equal(history.limit, 100); assert.equal(history.jobs.length, 100);
  assert.equal(history.jobs[0].id, 'own-159'); assert.equal(history.jobs.at(-1)!.id, 'own-60');
  assert.ok(history.jobs.every(row => row.requested_by === 'Accountant' && row.kind === 'accounting'));
});
test('Owner history merges the newest permitted company, auditor and accountant jobs with a single final limit', async () => {
  const f = await liveExportFixture();
  await f.store.transaction(async tx => {
    for (let i = 0; i < 100; i++) for (const [kind, offset] of [['accounting', 0], ['auditor', 100], ['company', 200]] as const) {
      const id = kind + '-' + i, value = job(f.org.id, id, kind === 'company' ? f.owner.uid : 'Accountant', offset + i, kind);
      tx.set(`${f.root}/${kind === 'company' ? 'company_export_jobs' : 'accounting_export_jobs'}/${id}`, value);
    }
  });
  const result = await f.service.history(f.org.id, f.owner);
  assert.equal(result.jobs.length, 100); assert.equal(result.jobs[0].id, 'company-99'); assert.equal(result.jobs.at(-1)!.id, 'company-0');
});
test('History returns only metadata, without private path, URL, claim, raw error, source rows or financial writes', async () => {
  const memory = new MemoryStore(), f = await liveExportFixture(memory), queued = await f.queue(); await f.worker.runNext();
  const path = `${f.root}/accounting_export_jobs/${queued.id}`;
  await f.mutate(path, { worker_claim: 'secret-claim', failure: { message: 'secret-provider-error' }, secret: 'secret-source', period: { secret: 'secret-period' } });
  const before = memory.dump(), result = await f.service.history(f.org.id, f.actor('Accountant')), row = result.jobs[0];
  assert.equal(row.download_available, true); assert.ok(row.filename?.endsWith('.xls')); assert.ok(row.byte_size! > 0);
  assert.equal(row.collection, 'accounting_export_jobs'); assert.equal(row.origin, 'manual');
  assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(!JSON.stringify(result).includes('/exports/'));
  const keys = ['id', 'org_id', 'collection', 'kind', 'requested_by', 'origin', 'status', 'created_at', 'updated_at', 'progress', 'download_available', 'expires_at', 'filename', 'byte_size'];
  assert.ok(Object.keys(row).every(key => keys.includes(key))); assert.deepEqual(memory.dump(), before); assert.equal(f.artifacts.signed.length, 0);
});
test('Expired and malformed artifact hints never expose a URL, and live creator revocation is still enforced by download', async () => {
  const f = await liveExportFixture(), queued = await f.queue(); await f.worker.runNext();
  await f.mutate(`${f.root}/accounting_export_jobs/${queued.id}`, { expires_at: '2020-01-01T00:00:00Z' });
  assert.equal((await f.service.history(f.org.id, f.actor('Accountant'))).jobs[0].download_available, false);
  await f.mutate(`${f.root}/members/Accountant`, { role: 'Viewer' }); await assert.rejects(f.download(queued, f.owner.uid)); assert.equal(f.artifacts.signed.length, 0);
});
test('History and policies fail closed after real account, organization, subscription or membership access changes', async () => {
  for (const change of ['account', 'organization', 'subscription', 'membership']) {
    const f = await liveExportFixture(); await f.queue();
    if (change === 'account') f.accounts.set('Accountant', { uid: 'Accountant', disabled: true, emailVerified: true });
    if (change === 'organization') await f.mutate(f.root, { status: 'suspended' });
    if (change === 'subscription') await f.mutate(f.root, { subscriptionEnd: '2020-01-01' });
    if (change === 'membership') await f.mutate(`${f.root}/members/Accountant`, { status: 'suspended' });
    await assert.rejects(f.service.history(f.org.id, f.actor('Accountant'))); await assert.rejects(f.service.list(f.org.id, f.actor('Accountant')));
  }
});
test('History rejects foreign embedded tenant identity and inaccessible organization without changing stored evidence', async () => {
  const memory = new MemoryStore(), f = await liveExportFixture(memory);
  await f.mutate(`${f.root}/accounting_export_jobs/foreign`, job('other-org', 'foreign'));
  const before = memory.dump(); await assert.rejects(f.service.history(f.org.id, f.actor('Accountant')), (e: any) => e.status === 409);
  await assert.rejects(f.service.history('other-org', f.owner), (e: any) => e.status === 403); assert.deepEqual(memory.dump(), before);
});
test('History requires verified server Rules and authority before reading export metadata', async () => {
  const f = await liveExportFixture();
  await assert.rejects(new ScheduledExportManagement(f.store, f.lookup, undefined, f.now, f.verifySecurity).history(f.org.id, f.owner), (e: any) => e.status === 403);
  await assert.rejects(new ScheduledExportManagement(f.server, f.lookup, undefined, f.now).history(f.org.id, f.owner), (e: any) => e.status === 503);
});
test('Descending MemoryStore queries preserve ascending defaults and filter before slicing', async () => {
  const memory = new MemoryStore({ 'rows/a': { id: 'a', created_at: '01', uid: 'one' }, 'rows/b': { id: 'b', created_at: '02', uid: 'two' }, 'rows/c': { id: 'c', created_at: '03', uid: 'one' } });
  assert.deepEqual((await memory.transaction(tx => tx.list('rows', { orderBy: 'created_at' }))).map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual((await memory.transaction(tx => tx.list('rows', { orderBy: 'created_at', direction: 'desc', limit: 1, where: [{ field: 'uid', value: 'one' }] }))).map(r => r.id), ['c']);
});
test('History query indexes are versioned for review without deploying Firebase configuration', () => {
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;
  for (const fields of [['kind', 'created_at'], ['requested_by', 'kind', 'created_at']]) assert.ok(indexes.some((row: Document) => row.collectionGroup === 'accounting_export_jobs' && JSON.stringify(row.fields.map((f: Document) => f.fieldPath)) === JSON.stringify(fields) && row.fields.at(-1).order === 'DESCENDING'));
});
test('Actual history HTTP route is no-store, rejects caller-controlled filters and rechecks access before returning metadata', async () => {
  const f = await liveExportFixture(); await f.queue();
  const app = express(); app.use(express.json()); app.use('/api', createApi({ operations: f.operations, scheduledExports: f.service, exportWorker: f.worker, exportAuthorization: f.options, verify: async uid => f.actor(uid) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); const { port } = server.address() as { port: number };
  const url = `http://127.0.0.1:${port}/api/organizations/${f.org.id}/export-job-history`;
  try {
    const ok = await fetch(url, { headers: { Authorization: 'Bearer Accountant' } }); assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.equal((await ok.json()).jobs.length, 1);
    const filter = await fetch(url + '?requested_by=OtherAccountant', { headers: { Authorization: 'Bearer Accountant' } }); assert.equal(filter.status, 400); assert.equal(filter.headers.get('cache-control'), 'no-store');
    await f.mutate(`${f.root}/members/Accountant`, { role: 'Viewer' }); const denied = await fetch(url, { headers: { Authorization: 'Bearer Accountant' } }); assert.equal(denied.status, 403); assert.equal(denied.headers.get('cache-control'), 'no-store'); assert.ok(!(await denied.text()).includes('jobs'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
