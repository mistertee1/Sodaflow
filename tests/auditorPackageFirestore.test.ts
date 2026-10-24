import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { ResilientStore } from '../server/resilientStore';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import { historicalRecoveryFixture } from './helpers/historicalRecovery';
let app: App, env: RulesTestEnvironment, store: ResilientStore;
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Auditor tests write only to demo-sudaflow Emulator');
  env = await initializeTestEnvironment({ projectId: 'demo-sudaflow', firestore: { host: '127.0.0.1', port: 8091, rules: readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: 'demo-sudaflow' }, 'auditor-package'); store = new ResilientStore(getFirestore(app));
});
after(async () => { if (env) await env.cleanup(); if (app) await deleteApp(app); });

test('Firestore auditor export records one hashed artifact audit, preserves every financial source and denies SDK/role replay', async () => {
  const f = await historicalRecoveryFixture(store, 'auditor-emulator', async () => verifyAccountingRulesSource([{ content: readFileSync('firestore.rules', 'utf8') }]));
  await f.commit(); const before = await f.ops.snapshot(f.org.id, f.owner, true), actor = { ...f.owner, uid: 'Accountant' };
  const command = { action: 'auditorExport.create', operationId: 'auditor-emulator', data: { period: { start: '2026-01-01', end: '2026-01-31' } } };
  const first = await f.ops.execute(f.org.id, actor, command), again = await f.ops.execute(f.org.id, actor, command); assert.deepEqual(again, first);
  assert.equal(first.result.findings_count, 0); assert.equal(first.result.format, 'xlsx'); assert.match(first.result.sha256, /^[a-f0-9]{64}$/);
  const after = await f.ops.snapshot(f.org.id, f.owner, true);
  for (const [collection, rows] of Object.entries(before.collections)) if (collection !== 'audit_logs') assert.deepEqual(after.collections[collection], rows, collection);
  const audits = after.collections.audit_logs.filter(row => row.action === 'auditorExport.create'); assert.equal(audits.length, 1); assert.equal(audits[0].export_metadata.sha256, first.result.sha256);
  const client = env.authenticatedContext(actor.uid, { email: actor.email, email_verified: true }).firestore(); await assertFails(getDoc(doc(client, `${f.root}/idempotency/auditor-emulator`)));
  await getFirestore(app).doc(`${f.root}/members/Accountant`).update({ role: 'Viewer' });
  await assert.rejects(f.ops.execute(f.org.id, actor, command), (error: any) => error.status === 403);
  assert.equal((await getFirestore(app).collection(`${f.root}/audit_logs`).where('action', '==', 'auditorExport.create').get()).size, 1);
});
