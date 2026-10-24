import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, doc } from 'firebase/firestore';
import { ResilientStore } from '../server/resilientStore';
import { liveExportFixture } from './helpers/liveExports';

let app: App, env: RulesTestEnvironment, store: ResilientStore;
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'History tests write only to demo-sudaflow Emulator');
  env = await initializeTestEnvironment({ projectId: 'demo-sudaflow', firestore: { host: '127.0.0.1', port: 8091, rules: readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: 'demo-sudaflow' }, 'scheduled-export-history'); store = new ResilientStore(getFirestore(app));
});
beforeEach(async () => env.clearFirestore());
after(async () => { if (env) await env.cleanup(); if (app) await deleteApp(app); });

test('Firestore history filters creator before descending pagination and preserves ascending defaults and financial sources', async () => {
  const f = await liveExportFixture(store, 'history-pagination'), db = getFirestore(app);
  await store.transaction(async tx => {
    for (let i = 0; i < 160; i++) for (const uid of ['Accountant', 'OtherAccountant']) {
      const id = uid + '-' + i, at = new Date(Date.UTC(2026, 9, 23, 0, i + (uid === 'OtherAccountant' ? 200 : 0))).toISOString();
      tx.set(`${f.root}/accounting_export_jobs/${id}`, { id, org_id: f.org.id, kind: 'accounting', requested_by: uid, status: 'queued', created_at: at, updated_at: at });
    }
  });
  const journal = (await db.doc(`${f.root}/journal_entries/jv-export-source`).get()).data();
  const history = await f.service.history(f.org.id, f.actor('Accountant'));
  assert.equal(history.jobs.length, 100); assert.equal(history.jobs[0].id, 'Accountant-159'); assert.equal(history.jobs.at(-1)!.id, 'Accountant-60');
  const first = await store.transaction(tx => tx.list(`${f.root}/accounting_export_jobs`, { orderBy: 'created_at', limit: 1 })); assert.equal(first[0].id, 'Accountant-0');
  assert.deepEqual((await db.doc(`${f.root}/journal_entries/jv-export-source`).get()).data(), journal);
  assert.equal((await db.collection(`${f.root}/audit_logs`).where('action', '==', 'exportHistory.read').get()).size, 0);
});
test('Firestore history whitelists real completed manifests while direct SDK metadata stays private even for owner', async () => {
  const f = await liveExportFixture(store, 'history-manifest'), queued = await f.queue(); await f.worker.runNext();
  const result = await f.service.history(f.org.id, f.actor('Accountant'));
  assert.equal(result.jobs[0].download_available, true); assert.ok(result.jobs[0].filename?.endsWith('.xls'));
  assert.ok(!JSON.stringify(result).includes('/exports/')); assert.ok(!JSON.stringify(result).includes('worker_claim')); assert.ok(!JSON.stringify(result).includes('sha256'));
  for (const identity of [env.unauthenticatedContext(), env.authenticatedContext(f.owner.uid, { email_verified: true }), env.authenticatedContext('Accountant', { email_verified: true }), env.authenticatedContext('outside', { email_verified: true, superAdmin: true })]) await assertFails(getDoc(doc(identity.firestore(), `${f.root}/accounting_export_jobs/${queued.id}`)));
  assert.equal(f.artifacts.signed.length, 0);
});
test('Firestore history and allowed kinds recheck live role, Auth and plan before exposing a previously listed job', async () => {
  const f = await liveExportFixture(store, 'history-revocation'); await f.queue();
  assert.deepEqual((await f.service.list(f.org.id, f.actor('Accountant'))).allowed_kinds, ['accounting', 'auditor']);
  await getFirestore(app).doc(`${f.root}/members/Accountant`).update({ role: 'Viewer' });
  await assert.rejects(f.service.history(f.org.id, f.actor('Accountant')), (e: any) => e.status === 403);
  await getFirestore(app).doc(`${f.root}/members/Accountant`).update({ role: 'Accountant' });
  f.accounts.set('Accountant', { uid: 'Accountant', emailVerified: true, disabled: true }); await assert.rejects(f.service.history(f.org.id, f.actor('Accountant')));
  f.accounts.set('Accountant', { uid: 'Accountant', emailVerified: true, disabled: false });
  await getFirestore(app).doc(f.root).update({ subscriptionEnd: '2020-01-01' }); await assert.rejects(f.service.history(f.org.id, f.actor('Accountant')));
});
