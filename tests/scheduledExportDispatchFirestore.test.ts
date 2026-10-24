import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ResilientStore } from '../server/resilientStore';
import type { Store } from '../src/domain/store';
import { LargeExportWorker } from '../src/domain/largeExportWorker';
import { scheduledDispatchFixture } from './helpers/scheduledDispatch';

let app: App, env: RulesTestEnvironment, store: ResilientStore;
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Scheduled dispatch writes only to demo-sudaflow Emulator');
  env = await initializeTestEnvironment({ projectId: 'demo-sudaflow', firestore: { host: '127.0.0.1', port: 8091, rules: readFileSync('firestore.rules', 'utf8') } });
  await env.clearFirestore(); app = initializeApp({ projectId: 'demo-sudaflow' }, 'scheduled-export-dispatch'); store = new ResilientStore(getFirestore(app));
});
after(async () => { if (env) await env.cleanup(); if (app) await deleteApp(app); });
beforeEach(async () => { await env.clearFirestore(); });

test('Firestore concurrently dispatches one local slot, produces its real workbook and keeps receipts/control/upload markers private', async () => {
  const f = await scheduledDispatchFixture(store, 'dispatch-emulator-once'), p = await f.schedule(), db = getFirestore(app);
  const source = await db.collection(`${f.root}/journal_entries`).get(); f.setNow('2026-10-24T07:01:00Z');
  const results = await Promise.all([f.dispatch(p.id), f.dispatch(p.id)]); assert.equal(results.filter(value => value.status === 'queued').length, 1);
  const job = results.find(value => value.status === 'queued')!, receiptPath = `${f.root}/export_schedule_occurrences/${job.occurrence_id}`;
  assert.equal((await db.collection(`${f.root}/accounting_export_jobs`).get()).size, 1); assert.equal((await db.collection(`${f.root}/export_schedule_occurrences`).get()).size, 1);
  const done = await f.worker.runNext(); assert.equal(done?.status, 'completed');
  const xml = new TextDecoder().decode(f.artifacts.files.get(done!.artifact.path)!.bytes); assert.match(xml, />100<\/Data>/); assert.match(xml, />0\.05<\/Data>/);
  assert.deepEqual((await db.collection(`${f.root}/journal_entries`).get()).docs.map(value => value.data()), source.docs.map(value => value.data()));
  assert.equal((await db.doc(f.duePath(p.id)).get()).data()!.next_run_at, '2026-10-25T07:00:00.000Z');
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext(f.owner.uid, { email_verified: true }), env.authenticatedContext('Accountant', { email_verified: true }), env.authenticatedContext('outside', { email_verified: true, superAdmin: true })]) {
    for (const path of [receiptPath, `${f.root}/meta/export_schedule_dispatch`, `${f.root}/accounting_export_jobs/${job.job_id}`, 'large_export_uploads/' + 'a'.repeat(64)]) {
      const ref = doc(context.firestore(), path); await assertFails(getDoc(ref)); await assertFails(setDoc(ref, { status: 'completed', org_id: f.org.id }));
    }
  }
});

test('Firestore scheduled dispatch and a manual request race for the final active slot without exceeding three jobs', async () => {
  const f = await scheduledDispatchFixture(store, 'dispatch-emulator-bound'), p = await f.schedule(), db = getFirestore(app);
  await f.queue('manual-one'); await f.queue('manual-two'); f.setNow('2026-10-24T07:01:00Z');
  const results = await Promise.allSettled([f.dispatch(p.id), f.queue('manual-three')]);
  const rows = (await db.collection(`${f.root}/accounting_export_jobs`).get()).docs.map(value => value.data()); assert.equal(rows.filter(value => ['queued', 'running'].includes(value.status)).length, 3);
  assert.ok(results.every(value => value.status === 'fulfilled' || value.reason.status === 429));
  const scheduled = results[0]; assert.ok(scheduled.status === 'fulfilled' && ['queued', 'capacity'].includes(scheduled.value.status));
  if (scheduled.value.status === 'capacity') assert.equal((await db.doc(f.duePath(p.id)).get()).data()!.next_run_at, p.next_run_at);
});

test('Firestore dispatch commit failure preserves cursor and source; retry writes one job and later access revocation skips the next slot', async () => {
  let fail = false;
  const failing: Store = { authority: 'server', transaction: work => store.transaction(async tx => {
    let queued = false; const value = await work({ ...tx, set: (path, data) => { if (path.includes('/accounting_export_jobs/') && data.status === 'queued') queued = true; tx.set(path, data); } });
    if (fail && queued) { fail = false; throw Error('Synthetic dispatch write failure'); } return value;
  }) };
  const f = await scheduledDispatchFixture(failing, 'dispatch-emulator-rollback'), p = await f.schedule(), db = getFirestore(app); f.setNow('2026-10-24T07:01:00Z'); fail = true;
  await assert.rejects(f.dispatch(p.id), /Synthetic dispatch/); assert.equal((await db.doc(f.duePath(p.id)).get()).data()!.next_run_at, p.next_run_at);
  assert.equal((await db.collection(`${f.root}/accounting_export_jobs`).get()).size, 0); assert.equal((await db.collection(`${f.root}/export_schedule_occurrences`).get()).size, 0);
  assert.equal((await f.dispatch(p.id)).status, 'queued'); await db.doc(`${f.root}/members/Accountant`).update({ role: 'Viewer' }); f.setNow('2026-10-25T07:01:00Z');
  assert.equal((await f.dispatch(p.id)).status, 'skipped'); assert.equal((await db.collection(`${f.root}/accounting_export_jobs`).get()).size, 1);
  assert.equal((await db.collection(`${f.root}/journal_entries`).get()).size, 1);
});

test('Firestore keeps failed private deletion durable and retries it without announcing a completed or downloadable artifact', async () => {
  const f = await scheduledDispatchFixture(store, 'dispatch-emulator-cleanup'), p = await f.schedule(), db = getFirestore(app); f.setNow('2026-10-24T07:01:00Z'); const queued = await f.dispatch(p.id);
  const remove = f.artifacts.delete.bind(f.artifacts); let fail = true;
  f.artifacts.delete = async path => { if (fail) throw Error('Synthetic delete unavailable'); await remove(path); };
  f.artifacts.onPut = async () => { await f.update(p.id, 1, { active: false }, 'pause-upload'); };
  const failed = await f.worker.runNext(); assert.equal(failed?.status, 'failed'); assert.equal(failed?.artifact, null); assert.equal(f.artifacts.files.size, 1);
  const records = (await db.collection('large_export_uploads').get()).docs.filter(value => value.data().org_id === f.org.id); assert.equal(records.length, 1); assert.equal(records[0].data().last_failure.code, 'export_cleanup_unavailable');
  await assert.rejects(f.download(failed!)); fail = false; f.setNow('2026-10-24T07:03:00Z'); await f.worker.cleanupNext(); assert.equal(f.artifacts.files.size, 0);
  assert.equal((await db.doc(records[0].ref.path).get()).exists, false); assert.equal((await db.doc(`${f.root}/accounting_export_jobs/${queued.job_id}`).get()).data()!.status, 'failed');
});

test('Firestore fencing lets a recovered worker publish while cleanup removes only the late old PUT', async () => {
  const f = await scheduledDispatchFixture(store, 'dispatch-emulator-fence'), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z'); await f.dispatch(p.id);
  let began!: () => void, release!: () => void; const started = new Promise<void>(resolve => { began = resolve; }), held = new Promise<void>(resolve => { release = resolve; }), put = f.artifacts.put.bind(f.artifacts);
  f.artifacts.put = async (path, content) => { await put(path, content); if (path.includes('/attempt-1/')) { began(); await held; } };
  const oldWorker = new LargeExportWorker(f.server, f.artifacts, f.builder, f.now, () => 'emulator-old-worker'), old = oldWorker.runNext(); await started;
  let done;
  try { f.setNow('2026-10-24T07:17:00Z'); await f.worker.cleanupNext(); done = await f.worker.runNext(); assert.equal(done?.status, 'completed'); assert.equal(done?.attempt, 2); }
  finally { release(); }
  assert.equal(await old, null); assert.equal(f.artifacts.files.size, 1); assert.ok(f.artifacts.files.has(done!.artifact.path));
  const db = getFirestore(app); assert.equal((await db.collection('large_export_uploads').get()).docs.filter(value => value.data().org_id === f.org.id).length, 0);
  assert.equal((await db.collection(`${f.root}/audit_logs`).where('event_type', '==', 'DATA_EXPORT_COMPLETED').get()).size, 1);
});
