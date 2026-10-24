import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ResilientStore } from '../server/resilientStore';
import { liveExportFixture } from './helpers/liveExports';
import { scheduleInput } from './helpers/scheduledExports';

let app: App, env: RulesTestEnvironment, store: ResilientStore;
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Export tests write only to demo-sudaflow Emulator');
  env = await initializeTestEnvironment({ projectId: 'demo-sudaflow', firestore: { host: '127.0.0.1', port: 8091, rules: readFileSync('firestore.rules', 'utf8') } });
  // Sequential permission suites deliberately leave malformed plan documents.
  await env.clearFirestore();
  app = initializeApp({ projectId: 'demo-sudaflow' }, 'live-export-authorization');
  store = new ResilientStore(getFirestore(app));
});
after(async () => { if (env) await env.cleanup(); if (app) await deleteApp(app); });

test('Firestore worker publishes the exact authorized artifact, preserves financial sources and denies direct SDK job/queue/manifest access', async () => {
  const f = await liveExportFixture(store, 'emulator-live-export'), db = getFirestore(app), job = await f.queue();
  const before = await f.operations.snapshot(f.org.id, f.owner, true), completed = await f.worker.runNext();
  assert.equal(completed?.status, 'completed');
  const content = f.artifacts.files.get(completed!.artifact.path)!;
  assert.equal(completed!.artifact.sha256, createHash('sha256').update(content.bytes).digest('hex'));
  assert.match(Buffer.from(content.bytes).toString(), /ss:Type="Number">100</);
  assert.match(Buffer.from(content.bytes).toString(), /ss:Type="Number">0.05</);
  const after = await f.operations.snapshot(f.org.id, f.owner, true);
  for (const [name, rows] of Object.entries(before.collections)) if (!['audit_logs', 'accounting_export_jobs'].includes(name)) assert.deepEqual(after.collections[name], rows, name);
  assert.equal((await db.collection(`${f.root}/audit_logs`).where('event_type', '==', 'DATA_EXPORT_COMPLETED').get()).size, 1);
  assert.equal((await db.doc(`large_export_queue/${f.org.id}.${job.id}`).get()).exists, false);
  assert.equal((await db.doc(`large_export_expiry/${f.org.id}.${job.id}`).get()).data()!.expires_at, completed!.expires_at);
  const identities = [env.unauthenticatedContext(), env.authenticatedContext(f.owner.uid, { email_verified: true }), env.authenticatedContext('Accountant', { email_verified: true }), env.authenticatedContext('outside', { email_verified: true, superAdmin: true })];
  for (const identity of identities) for (const path of [`${f.root}/accounting_export_jobs/${job.id}`, `large_export_queue/${f.org.id}.${job.id}`, `large_export_expiry/${f.org.id}.${job.id}`]) {
    await assertFails(getDoc(doc(identity.firestore(), path)));
    await assertFails(setDoc(doc(identity.firestore(), path), { status: 'completed', artifact: { path: 'foreign' } }));
  }
  assert.equal((await f.download(job)).expires_at, '2026-10-24T06:05:00.000Z');
  await db.doc(`${f.root}/members/Accountant`).update({ role: 'Viewer' });
  await assert.rejects(f.download(job)); await assert.rejects(f.download(job, f.owner.uid));
  assert.equal(f.artifacts.signed.length, 1);
});

test('Firestore entitlement revocation during upload cannot commit a completed job or expiry item', async () => {
  const f = await liveExportFixture(store, 'emulator-live-revoke'), db = getFirestore(app), job = await f.queue();
  const journal = (await db.doc(`${f.root}/journal_entries/jv-export-source`).get()).data();
  f.artifacts.onPut = async () => { await db.doc(f.root).update({ subscriptionEnd: '2020-01-01' }); };
  const result = await f.worker.runNext(); assert.equal(result?.status, 'failed'); assert.equal(result?.artifact, null);
  assert.equal(f.artifacts.files.size, 0); assert.equal(f.artifacts.deleted.length, 1);
  assert.equal((await db.doc(`large_export_expiry/${f.org.id}.${job.id}`).get()).exists, false);
  assert.equal((await db.collection(`${f.root}/audit_logs`).where('event_type', '==', 'DATA_EXPORT_COMPLETED').get()).size, 0);
  assert.deepEqual((await db.doc(`${f.root}/journal_entries/jv-export-source`).get()).data(), journal);
  await assert.rejects(f.download(job)); assert.equal(f.artifacts.signed.length, 0);
});

test('Firestore linked policy pause during upload is enforced by final publication and deletes the private object', async () => {
  const f = await liveExportFixture(store, 'emulator-live-policy'), { schedule } = await f.create('policy-before-upload', 'Accountant', scheduleInput({ retention_hours: 1 })), job = await f.queue();
  f.setNow(schedule.next_run_at!);
  await f.mutate(`${f.root}/accounting_export_jobs/${job.id}`, { schedule_id: schedule.id, policy_revision: schedule.revision, scheduled_for: schedule.next_run_at });
  f.artifacts.onPut = async () => { await f.update(schedule.id, schedule.revision, { active: false }, 'pause-upload-policy'); };
  assert.equal((await f.worker.runNext())?.status, 'failed');
  assert.equal(f.artifacts.files.size, 0); assert.equal(f.artifacts.deleted.length, 1);
  assert.equal((await f.service.list(f.org.id, f.owner)).execution_enabled, false);
  assert.equal((await getFirestore(app).doc(`large_export_expiry/${f.org.id}.${job.id}`).get()).exists, false);
});

test('Firestore completed download rechecks real Auth before signing a retained manifest', async () => {
  const f = await liveExportFixture(store, 'emulator-live-auth'), job = await f.queue();
  assert.equal((await f.worker.runNext())?.status, 'completed');
  f.accounts.set('Accountant', { ...f.accounts.get('Accountant')!, disabled: true });
  await assert.rejects(f.download(job)); await assert.rejects(f.download(job, f.owner.uid));
  assert.equal(f.artifacts.signed.length, 0);
  assert.equal((await getFirestore(app).doc(`${f.root}/accounting_export_jobs/${job.id}`).get()).data()!.status, 'completed');
});
