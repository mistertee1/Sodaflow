import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, type Store, type Document } from '../src/domain/store';
import { LargeExportWorker, exportUploadIntentId, type LargeExportContent } from '../src/domain/largeExportWorker';
import { liveExportFixture } from './helpers/liveExports';
import { ServerLargeExportBuilder } from '../server/largeExportWorker';

const uploads = (records: Record<string, Document>) => Object.entries(records).filter(([path]) => path.startsWith('large_export_uploads/')).map(([, value]) => value);
async function fixture(store?: Store) { const memory = new MemoryStore(), f = await liveExportFixture(store || memory, 'upload-recovery'); return { ...f, memory }; }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test('Upload intent is durable before PUT and disappears atomically with successful publication', async () => {
  const f = await fixture(), job = await f.queue(); let seen = false;
  f.artifacts.onPut = async () => { const records = uploads(f.memory.dump()); assert.equal(records.length, 1); assert.equal(records[0].state, 'uploading'); assert.equal(records[0].job_id, job.id); assert.equal(f.memory.dump()[`${f.root}/accounting_export_jobs/${job.id}`].status, 'running'); seen = true; };
  const done = await f.worker.runNext(); assert.equal(seen, true); assert.equal(done?.status, 'completed'); assert.equal(uploads(f.memory.dump()).length, 0); assert.equal(f.artifacts.files.size, 1);
});

test('A partially committed PUT with an unknown response retains a cleanup marker that sweeps any late-arriving private object', async () => {
  const f = await fixture(), job = await f.queue(); const original = f.artifacts.put.bind(f.artifacts); let path = '', content!: LargeExportContent;
  f.artifacts.put = async (key, value) => { path = key; content = value; await original(key, value); throw Error('secret ambiguous PUT response'); };
  const failed = await f.worker.runNext(); assert.equal(failed?.status, 'failed'); assert.equal(failed?.artifact, null); assert.equal(f.artifacts.files.size, 0);
  const marker = uploads(f.memory.dump())[0]; assert.equal(marker.state, 'cleaning'); assert.equal(marker.put_acknowledged, false); assert.doesNotMatch(JSON.stringify(marker), /secret/);
  f.artifacts.files.set(path, content); f.setNow('2026-10-24T06:16:00Z'); assert.equal((await f.worker.cleanupNext())?.status, 'swept'); assert.equal(f.artifacts.files.size, 0);
  assert.equal(uploads(f.memory.dump()).length, 1); await assert.rejects(f.download(job)); assert.equal(f.artifacts.signed.length, 0);
});

test('Failed delete keeps a private, retryable cloud cleanup record and removes it after an acknowledged PUT is cleaned', async () => {
  const f = await fixture(), job = await f.queue(); f.artifacts.onPut = () => f.mutate(`${f.root}/members/Accountant`, { role: 'Viewer' });
  const remove = f.artifacts.delete.bind(f.artifacts); let unavailable = true;
  f.artifacts.delete = async path => { if (unavailable) throw Error('secret synthetic bucket unavailable'); await remove(path); };
  const result = await f.worker.runNext(); assert.equal(result?.status, 'failed'); assert.equal(f.artifacts.files.size, 1);
  const marker = uploads(f.memory.dump())[0]; assert.equal(marker.last_failure.code, 'export_cleanup_unavailable'); assert.equal(marker.put_acknowledged, true); assert.doesNotMatch(JSON.stringify(marker), /secret|bucket/);
  await assert.rejects(f.download(job)); unavailable = false; f.setNow('2026-10-24T06:02:00Z'); assert.equal((await f.worker.cleanupNext())?.status, 'swept');
  assert.equal(f.artifacts.files.size, 0); assert.equal(uploads(f.memory.dump()).length, 0);
});

test('An uncertain successful publication preserves its announced bytes and completion audit instead of deleting the file', async () => {
  const memory = new MemoryStore(); let loseAck = false;
  const store: Store = { authority: 'server', transaction: async work => {
    let published = false;
    const result = await memory.transaction(tx => work({ ...tx, set: (path, value) => { if (path.includes('/accounting_export_jobs/') && value.status === 'completed') published = true; tx.set(path, value); } }));
    if (published && loseAck) { loseAck = false; throw Error('Synthetic successful commit lost its response'); } return result;
  } };
  const f = await liveExportFixture(store, 'unknown-publication'), job = await f.queue(); loseAck = true;
  const done = await f.worker.runNext(); assert.equal(done?.status, 'completed'); assert.equal(f.artifacts.files.size, 1); assert.equal(f.artifacts.deleted.length, 0);
  assert.equal(uploads(memory.dump()).length, 0); assert.equal(Object.values(memory.dump()).filter(row => row.event_type === 'DATA_EXPORT_COMPLETED').length, 1);
  assert.equal((await f.download(job)).expires_at, '2026-10-24T06:05:00.000Z');
});

test('A claim that expires during PUT cannot publish and remains eligible for one bounded recovery attempt', async () => {
  const f = await fixture(), job = await f.queue(); f.artifacts.onPut = async () => { f.artifacts.onPut = undefined; f.setNow('2026-10-24T06:16:00Z'); };
  assert.equal(await f.worker.runNext(), null); assert.equal(f.artifacts.files.size, 0); assert.equal(uploads(f.memory.dump()).length, 0);
  const current = f.memory.dump()[`${f.root}/accounting_export_jobs/${job.id}`]; assert.equal(current.status, 'running'); assert.equal(current.attempt, 1);
  const recovered = await f.worker.runNext(); assert.equal(recovered?.status, 'completed'); assert.equal(recovered?.attempt, 2); assert.equal(f.artifacts.files.size, 1);
});

test('A slow old builder cannot upload or overwrite a newer recovered attempt', async () => {
  const f = await fixture(), job = await f.queue(), began = deferred(), release = deferred();
  const builder = { build: async (value: Document) => { const bytes = await f.builder.build(value); began.resolve(); await release.promise; return bytes; }, authorizePublication: f.builder.authorizePublication.bind(f.builder) };
  const old = new LargeExportWorker(f.server, f.artifacts, builder, f.now, () => 'old-builder'); const waiting = old.runNext(); await began.promise;
  f.setNow('2026-10-24T06:16:00Z'); const current = await f.worker.runNext(); assert.equal(current?.status, 'completed'); assert.equal(current?.attempt, 2);
  release.resolve(); assert.equal(await waiting, null); assert.equal(f.artifacts.files.size, 1); assert.equal(f.artifacts.deleted.length, 0);
  assert.equal(f.memory.dump()[`${f.root}/accounting_export_jobs/${job.id}`].artifact.path, current!.artifact.path);
});

test('Attempt fencing also protects a running recovery if an internal claim identifier is accidentally reused', async () => {
  const f = await fixture(), job = await f.queue(), oldBegan = deferred(), oldRelease = deferred(), newBegan = deferred(), newRelease = deferred();
  const slow = (began: ReturnType<typeof deferred>, release: ReturnType<typeof deferred>) => ({ build: async (value: Document) => { const result = await f.builder.build(value); began.resolve(); await release.promise; return result; }, authorizePublication: f.builder.authorizePublication.bind(f.builder) });
  const old = new LargeExportWorker(f.server, f.artifacts, slow(oldBegan, oldRelease), f.now, () => 'reused-claim'), first = old.runNext(); await oldBegan.promise;
  f.setNow('2026-10-24T06:16:00Z'); const recovered = new LargeExportWorker(f.server, f.artifacts, slow(newBegan, newRelease), f.now, () => 'reused-claim'), second = recovered.runNext(); await newBegan.promise;
  try { oldRelease.resolve(); assert.equal(await first, null); const running = f.memory.dump()[`${f.root}/accounting_export_jobs/${job.id}`]; assert.equal(running.status, 'running'); assert.equal(running.attempt, 2); }
  finally { oldRelease.resolve(); newRelease.resolve(); }
  assert.equal((await second)?.status, 'completed'); assert.equal(f.artifacts.files.size, 1);
});

test('A slow old PUT survives cleanup fencing safely: only the old object is deleted after a new claim publishes', async () => {
  const f = await fixture(), job = await f.queue(), began = deferred(), release = deferred(), put = f.artifacts.put.bind(f.artifacts);
  f.artifacts.put = async (path, content) => { await put(path, content); if (path.includes('/attempt-1/')) { began.resolve(); await release.promise; } };
  const old = new LargeExportWorker(f.server, f.artifacts, f.builder, f.now, () => 'old-put'), waiting = old.runNext(); await began.promise;
  f.setNow('2026-10-24T06:16:00Z'); assert.equal((await f.worker.cleanupNext())?.status, 'swept'); assert.equal(f.artifacts.files.size, 0);
  const done = await f.worker.runNext(); assert.equal(done?.status, 'completed'); assert.equal(done?.attempt, 2);
  release.resolve(); assert.equal(await waiting, null); assert.equal(f.artifacts.files.size, 1); assert.ok(f.artifacts.files.has(done!.artifact.path));
  assert.equal(uploads(f.memory.dump()).length, 0); assert.ok(f.artifacts.deleted.every(path => path.includes('/attempt-1/')));
  assert.equal(f.memory.dump()[`${f.root}/accounting_export_jobs/${job.id}`].status, 'completed');
});

test('An abandoned upload marker is swept repeatedly without deleting the recovered job artifact', async () => {
  const f = await fixture(), job = await f.queue(), filename = 'abandoned.xls', path = `organizations/${f.org.id}/exports/${job.id}/attempt-1/${filename}`, id = exportUploadIntentId(path);
  await f.mutate(`${f.root}/accounting_export_jobs/${job.id}`, { status: 'running', worker_claim: 'dead-worker', started_at: '2026-10-24T06:00:00.000Z' });
  await f.mutate(`large_export_uploads/${id}`, { id, org_id: f.org.id, job_id: job.id, collection: 'accounting_export_jobs', attempt: 1, worker_claim: 'dead-worker', filename, artifact_path: path, state: 'uploading', cleanup_after: '2026-10-24T06:15:00.000Z', cleanup_attempts: 0 });
  f.artifacts.files.set(path, { bytes: new Uint8Array([1]), filename, mimeType: 'application/vnd.ms-excel', recordCount: 1 }); f.setNow('2026-10-24T06:16:00Z');
  assert.equal((await f.worker.cleanupNext())?.status, 'swept'); assert.equal(f.artifacts.files.size, 0); assert.equal(uploads(f.memory.dump()).length, 1);
  const done = await f.worker.runNext(); assert.equal(done?.attempt, 2); f.setNow('2026-10-24T06:32:00Z'); await f.worker.cleanupNext();
  assert.equal(f.artifacts.files.size, 1); assert.ok(f.artifacts.files.has(done!.artifact.path)); assert.ok(f.artifacts.deleted.every(value => value === path));
});

test('A cleanup marker left next to an announced artifact is removed without deleting that artifact', async () => {
  const f = await fixture(); await f.queue(); const done = (await f.worker.runNext())!, a = done.artifact, id = exportUploadIntentId(a.path);
  await f.mutate(`large_export_uploads/${id}`, { id, org_id: f.org.id, job_id: done.id, collection: 'accounting_export_jobs', attempt: 1, worker_claim: 'old', filename: a.filename, artifact_path: a.path, state: 'uploading', cleanup_after: f.now().toISOString(), cleanup_attempts: 0 });
  assert.equal((await f.worker.cleanupNext())?.status, 'preserved'); assert.equal(f.artifacts.files.size, 1); assert.equal(f.artifacts.deleted.length, 0); assert.equal(uploads(f.memory.dump()).length, 0);
});

test('Cancellation during generation prevents upload entirely and leaves no orphan marker', async () => {
  const f = await fixture(), job = await f.queue();
  const builder = { build: async (value: Document) => { const result = await f.builder.build(value); await f.operations.execute(f.org.id, f.owner, { action: 'largeExport.cancel', operationId: 'cancel-before-put', data: { id: job.id } }); return result; }, authorizePublication: f.builder.authorizePublication.bind(f.builder) };
  assert.equal(await new LargeExportWorker(f.server, f.artifacts, builder, f.now).runNext(), null); assert.equal(f.artifacts.files.size, 0); assert.equal(f.artifacts.deleted.length, 0); assert.equal(uploads(f.memory.dump()).length, 0);
});

test('A fresh job held by another worker does not starve the next queued export', async () => {
  const f = await fixture(), first = await f.queue('busy'), second = await f.queue('available');
  await f.mutate(`${f.root}/accounting_export_jobs/${first.id}`, { status: 'running', worker_claim: 'other-worker', started_at: f.now().toISOString() });
  const done = await f.worker.runNext(); assert.equal(done?.id, second.id); assert.equal(done?.status, 'completed'); assert.equal(f.memory.dump()[`${f.root}/accounting_export_jobs/${first.id}`].worker_claim, 'other-worker');
});

test('A storage delete failure on expiry leaves its expiry work durable and forbids downloads until the retry deletes it', async () => {
  const f = await fixture(), job = await f.queue(); await f.worker.runNext(); f.setNow('2026-10-25T06:00:01Z');
  const remove = f.artifacts.delete.bind(f.artifacts); let fail = true; f.artifacts.delete = async path => { if (fail) throw Error('Synthetic expiry storage failure'); await remove(path); };
  await assert.rejects(f.worker.expireNext(), /Synthetic expiry/); assert.equal(f.artifacts.files.size, 1); assert.ok(f.memory.dump()[`large_export_expiry/${f.org.id}.${job.id}`]); await assert.rejects(f.download(job));
  fail = false; assert.equal((await f.worker.expireNext())?.status, 'expired'); assert.equal(f.artifacts.files.size, 0); assert.equal(f.memory.dump()[`large_export_expiry/${f.org.id}.${job.id}`], undefined);
});

test('Forged cleanup paths cannot delete a foreign tenant object', async () => {
  const f = await fixture(), job = await f.queue(), path = 'organizations/foreign/exports/foreign-job/attempt-1/file.xls', id = exportUploadIntentId(path);
  f.artifacts.files.set(path, { bytes: new Uint8Array([1]), filename: 'file.xls', mimeType: 'application/vnd.ms-excel', recordCount: 1 });
  await f.mutate(`large_export_uploads/${id}`, { id, org_id: f.org.id, job_id: job.id, collection: 'accounting_export_jobs', attempt: 1, worker_claim: 'forged', filename: 'file.xls', artifact_path: path, state: 'uploading', cleanup_after: f.now().toISOString(), cleanup_attempts: 0 });
  await assert.rejects(f.worker.cleanupNext(), (error: any) => error.status === 409); assert.ok(f.artifacts.files.has(path)); assert.equal(f.artifacts.deleted.length, 0);
});

test('Cleanup verifies deployed protection independently of the revoked user and fails closed when Rules cannot be confirmed', async () => {
  const f = await fixture(); await f.queue(); const put = f.artifacts.put.bind(f.artifacts);
  f.artifacts.put = async (path, value) => { await put(path, value); throw Error('Synthetic unknown PUT'); }; await f.worker.runNext();
  const marker = uploads(f.memory.dump())[0]; f.artifacts.files.set(marker.artifact_path, { bytes: new Uint8Array([1]), filename: marker.filename, mimeType: 'application/vnd.ms-excel', recordCount: 1 }); f.setNow('2026-10-24T06:16:00Z');
  const builder = new ServerLargeExportBuilder(f.operations, { ...f.options, verifySecurity: async () => { throw Error('secret unverified Rules'); } }), guarded = new LargeExportWorker(f.server, f.artifacts, builder, f.now);
  await assert.rejects(guarded.cleanupNext(), (error: any) => error.status === 503 && !error.message.includes('secret')); assert.equal(f.artifacts.files.size, 1); assert.equal(uploads(f.memory.dump()).length, 1);
  f.accounts.delete('Accountant'); await f.worker.cleanupNext(); assert.equal(f.artifacts.files.size, 0);
});

test('Expiry cleanup cannot delete an object in another tenant through a forged completed manifest', async () => {
  const f = await fixture(), job = await f.queue(), done = (await f.worker.runNext())!, foreign = 'organizations/foreign/exports/foreign-job/attempt-1/file.xls';
  f.artifacts.files.set(foreign, { bytes: new Uint8Array([9]), filename: 'file.xls', mimeType: 'application/vnd.ms-excel', recordCount: 1 });
  await f.mutate(`${f.root}/accounting_export_jobs/${job.id}`, { artifact: { ...done.artifact, path: foreign } }); f.setNow('2026-10-25T06:00:01Z');
  await assert.rejects(f.worker.expireNext(), (error: any) => error.status === 409); assert.ok(f.artifacts.files.has(foreign)); assert.equal(f.artifacts.deleted.length, 0);
});
