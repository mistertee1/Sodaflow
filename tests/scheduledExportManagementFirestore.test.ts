import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { ResilientStore } from '../server/resilientStore';
import { scheduledExportDueKey } from '../src/domain/scheduledExportManagement';
import { scheduledExportsFixture, scheduleInput } from './helpers/scheduledExports';

let app: App, env: RulesTestEnvironment, store: ResilientStore;
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Schedule tests write only to demo-sudaflow Emulator');
  env = await initializeTestEnvironment({ projectId: 'demo-sudaflow', firestore: { host: '127.0.0.1', port: 8091, rules: readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: 'demo-sudaflow' }, 'scheduled-export-management'); store = new ResilientStore(getFirestore(app));
});
after(async () => { if (env) await env.cleanup(); if (app) await deleteApp(app); });

test('Firestore schedule policy, due item, receipt and audit commit once; direct SDK policy/queue/receipt access remains denied', async () => {
  const f = await scheduledExportsFixture(store, 'emulator-schedule-create'), db = getFirestore(app);
  const before = await f.operations.snapshot(f.org.id, f.owner, true), first = await f.create(), again = await f.create(); assert.deepEqual(again, first);
  const p = first.schedule, duePath = `scheduled_export_due/${scheduledExportDueKey(f.org.id, p.id)}`;
  const due = (await db.doc(duePath).get()).data()!; assert.equal(due.policy_revision, 1); assert.equal(due.next_run_at, p.next_run_at);
  assert.equal((await db.collection(`${f.root}/export_schedules`).get()).size, 1);
  assert.equal((await db.collection(`${f.root}/audit_logs`).where('action', '==', 'exportSchedule.create').get()).size, 1);
  assert.equal((await db.doc(`${f.root}/idempotency/schedule-create`).get()).data()!.response.schedule.id, p.id);
  const after = await f.operations.snapshot(f.org.id, f.owner, true);
  for (const [name, rows] of Object.entries(before.collections)) if (name !== 'audit_logs') assert.deepEqual(after.collections[name], rows, name);
  const identities = [env.unauthenticatedContext(), env.authenticatedContext(f.owner.uid, { email: f.owner.email, email_verified: true }), env.authenticatedContext('Accountant', { email_verified: true }), env.authenticatedContext('outside', { email_verified: true, superAdmin: true })];
  for (const identity of identities) {
    const client = identity.firestore();
    for (const path of [`${f.root}/export_schedules/${p.id}`, duePath, `${f.root}/idempotency/schedule-create`, `${f.root}/meta/export_schedule_control`]) {
      await assertFails(getDoc(doc(client, path))); await assertFails(setDoc(doc(client, path), { active: true, revision: 99 }));
    }
    await assertFails(getDocs(collection(client, `${f.root}/export_schedules`)));
    await assertFails(setDoc(doc(client, `${f.root}/audit_logs/forged-schedule`), { action: 'exportSchedule.create' }));
  }
});

test('Firestore concurrent edits have one revision winner and atomically pause/resume the matching due index', async () => {
  const f = await scheduledExportsFixture(store, 'emulator-schedule-race'), db = getFirestore(app), { schedule: p } = await f.create('accountant-policy', 'Accountant');
  const results = await Promise.allSettled([f.update(p.id, 1, { active: false }, 'pause-a', 'Accountant'), f.update(p.id, 1, { time: '11:00' }, 'edit-b')]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(results.filter(row => row.status === 'rejected' && row.reason.status === 409).length, 1);
  let current = (await db.doc(`${f.root}/export_schedules/${p.id}`).get()).data()!; assert.equal(current.revision, 2); assert.equal(current.created_by, 'Accountant');
  if (current.active) { await f.update(p.id, 2, { active: false }, 'pause-final'); current = (await db.doc(`${f.root}/export_schedules/${p.id}`).get()).data()!; }
  const duePath = `scheduled_export_due/${scheduledExportDueKey(f.org.id, p.id)}`; assert.equal((await db.doc(duePath).get()).exists, false);
  f.setNow('2026-10-28T12:00:00Z'); const resumed = await f.update(p.id, current.revision, { active: true }, 'resume-final');
  assert.equal(resumed.schedule.next_run_at, current.time === '11:00' ? '2026-10-29T08:00:00.000Z' : '2026-10-29T07:00:00.000Z');
  assert.equal((await db.doc(duePath).get()).data()!.policy_revision, resumed.schedule.revision);
  await assert.rejects(f.create('accountant-policy', 'Accountant'), (error: any) => error.status === 409);
});

test('Firestore policy creation respects the limit under racing requests instead of committing a twenty-first schedule', async () => {
  const f = await scheduledExportsFixture(store, 'emulator-schedule-limit'), db = getFirestore(app);
  for (let i = 0; i < 19; i++) await f.create(`existing-${i}`, f.owner.uid, scheduleInput({ active: false }));
  const results = await Promise.allSettled([f.create('last-a', f.owner.uid, scheduleInput({ active: false })), f.create('last-b', 'Accountant', scheduleInput({ active: false }))]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(results.filter(row => row.status === 'rejected' && row.reason.status === 409).length, 1);
  assert.equal((await db.collection(`${f.root}/export_schedules`).get()).size, 20); assert.equal((await db.collection(`${f.root}/audit_logs`).where('action', '==', 'exportSchedule.create').get()).size, 20);
  assert.equal((await db.doc(`${f.root}/meta/export_schedule_control`).get()).data()!.count, 20);
});

test('Firestore cached schedule requests recheck actual membership, live Auth, organization, subscription and features with no financial writes', async () => {
  const f = await scheduledExportsFixture(store, 'emulator-schedule-access'), db = getFirestore(app); await f.create('accountant', 'Accountant');
  const original = (await db.doc(f.root).get()).data()!;
  await db.doc(`${f.root}/members/Accountant`).update({ role: 'Viewer' }); await assert.rejects(f.create('accountant', 'Accountant'), (error: any) => error.status === 403);
  await db.doc(`${f.root}/members/Accountant`).update({ role: 'Accountant', status: 'suspended' }); await assert.rejects(f.service.list(f.org.id, f.actor('Accountant')), (error: any) => error.status === 403);
  await db.doc(`${f.root}/members/Accountant`).update({ status: 'active' }); f.accounts.set('Accountant', { uid: 'Accountant', emailVerified: true, disabled: true }); await assert.rejects(f.create('accountant', 'Accountant'), (error: any) => error.status === 403);
  f.accounts.set('Accountant', { uid: 'Accountant', emailVerified: true, disabled: false });
  for (const updates of [{ status: 'suspended' }, { subscriptionEnd: '2026-10-24T06:00:00.000Z' }, { planId: 'Free' }]) {
    await db.doc(f.root).set({ ...original, ...updates }); await assert.rejects(f.create('accountant', 'Accountant'), (error: any) => error.status === 403);
  }
  await db.doc(f.root).set(original); assert.equal((await f.create('accountant', 'Accountant')).schedule.revision, 1);
  assert.equal((await db.collection(`${f.root}/export_schedules`).get()).size, 1); assert.equal((await db.collection(`${f.root}/journal_entries`).get()).size, 0);
});
