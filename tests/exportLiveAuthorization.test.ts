import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { MemoryStore, type Store } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { defaultPlatformPlans } from '../src/lib/plans';
import { ServerLargeExportBuilder } from '../server/largeExportWorker';
import { liveExportFixture } from './helpers/liveExports';
import { scheduleInput } from './helpers/scheduledExports';
import { createApi } from '../server/api';

test('Live builder exports actual authorized accounting numbers without mutating financial sources', async () => {
  const memory = new MemoryStore(), f = await liveExportFixture(memory), job = await f.queue(), before = memory.dump();
  const content = await f.builder.build(job); assert.equal(content.recordCount, 1); assert.match(Buffer.from(content.bytes).toString(), /ss:Type="Number">100</); assert.match(Buffer.from(content.bytes).toString(), /ss:Type="Number">0.05</);
  assert.deepEqual(memory.dump(), before); assert.ok(f.lookups.includes('Accountant'));
});
test('An expired queued accounting export fails instead of treating a permission-filtered snapshot as an empty successful workbook', async () => {
  const f = await liveExportFixture(), job = await f.queue(); await f.mutate(f.root, { subscriptionEnd: '2020-01-01' });
  await assert.rejects(f.builder.build(job), (error: any) => error.status === 403);
  const failed = await f.worker.runNext(); assert.equal(failed?.status, 'failed'); assert.equal(failed?.artifact, null); assert.equal(f.artifacts.files.size, 0); assert.equal(f.artifacts.signed.length, 0);
});
test('Live builder rejects deleted, disabled, unverified and mismatched real Auth users', async () => {
  const f = await liveExportFixture(), job = await f.queue(), original = f.accounts.get('Accountant')!;
  for (const identity of [undefined, { ...original, disabled: true }, { ...original, emailVerified: false }, { ...original, uid: 'other' }]) {
    if (identity) f.accounts.set('Accountant', identity); else f.accounts.delete('Accountant');
    await assert.rejects(f.builder.build(job), (error: any) => error.status === 403);
  }
  assert.equal(f.artifacts.files.size, 0);
});
test('Membership, organization, actual financial role and V2 are checked before source generation even with paused commercial controls', async () => {
  const memory = new MemoryStore(), f = await liveExportFixture(memory), job = await f.queue(), org = memory.dump()[f.root], memberPath = `${f.root}/members/Accountant`, member = memory.dump()[memberPath];
  for (const updates of [{ role: 'Viewer' }, { role: 'Sales' }, { role: 'Owner' }, { status: 'suspended' }]) { await f.mutate(memberPath, updates); await assert.rejects(f.builder.build(job)); await memory.transaction(async tx => tx.set(memberPath, member)); }
  for (const updates of [{ status: 'suspended' }, { accounting_version: 1 }]) { await f.mutate(f.root, updates); await assert.rejects(f.builder.build(job)); await memory.transaction(async tx => tx.set(f.root, org)); }
  await f.mutate(memberPath, { role: 'Viewer' }); const paused = new ServerLargeExportBuilder(new Operations(f.server, f.now, undefined, f.verifySecurity, false), f.options); await assert.rejects(paused.build(job));
});
test('Live catalog feature revocation blocks accounting and auditor generation independently of an old queued request', async () => {
  const f = await liveExportFixture(), job = await f.queue(), plan = defaultPlatformPlans().find(row => row.id === 'Enterprise')!;
  for (const [feature, kind] of [['accounting', 'accounting'], ['advanced_reports', 'accounting'], ['audit_trail', 'auditor']] as const) {
    await f.store.transaction(async tx => tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, [feature]: false } }));
    await assert.rejects(f.builder.build({ ...job, kind }), (error: any) => error.status === 403);
  }
});
test('Revocation during private upload prevents publication and deletes the unannounced object', async () => {
  const memory = new MemoryStore(), f = await liveExportFixture(memory), job = await f.queue();
  f.artifacts.onPut = async () => f.mutate(f.root, { subscriptionEnd: '2020-01-01' });
  const result = await f.worker.runNext(); assert.equal(result?.status, 'failed'); assert.equal(result?.artifact, null); assert.equal(f.artifacts.files.size, 0); assert.equal(f.artifacts.deleted.length, 1);
  assert.equal(Object.values(memory.dump()).filter(row => row.event_type === 'DATA_EXPORT_COMPLETED').length, 0); assert.ok(!JSON.stringify(result?.failure).includes('subscriptionEnd'));
  assert.equal(memory.dump()[`${f.root}/journal_entries/jv-export-source`]?.lines[0].debit_sdg, 100); assert.equal(job.kind, 'accounting');
});
test('Auth status is checked again at publication, not cached from source generation', async () => {
  const f = await liveExportFixture(); await f.queue();
  f.artifacts.onPut = async () => { f.accounts.set('Accountant', { ...f.accounts.get('Accountant')!, disabled: true }); };
  const result = await f.worker.runNext(); assert.equal(result?.status, 'failed'); assert.equal(f.artifacts.files.size, 0); assert.equal(f.artifacts.deleted.length, 1);
});
test('A changed job scope during upload cannot publish an artifact built for the previous request', async () => {
  const f = await liveExportFixture(), job = await f.queue();
  f.artifacts.onPut = async () => f.mutate(`${f.root}/accounting_export_jobs/${job.id}`, { period: { end: '2025-01-01' } });
  assert.equal((await f.worker.runNext())?.status, 'failed'); assert.equal(f.artifacts.files.size, 0);
});
test('Auth or Rules service failures fail closed with sanitized errors and no artifact', async () => {
  const f = await liveExportFixture(), job = await f.queue();
  const rules = new ServerLargeExportBuilder(f.operations, { ...f.options, verifySecurity: async () => { throw Error('secret rules credential'); } });
  await assert.rejects(rules.build(job), (error: any) => error.status === 503 && !error.message.includes('secret'));
  const auth = new ServerLargeExportBuilder(f.operations, { ...f.options, lookupAccount: async () => { throw Error('secret Auth endpoint'); } });
  await assert.rejects(auth.build(job), (error: any) => error.status === 503 && !error.message.includes('secret'));
  for (const authority of ['local', 'browser'] as const) {
    const store: Store = { authority, transaction: work => f.store.transaction(work) };
    await assert.rejects(new ServerLargeExportBuilder(new Operations(store), f.options).build(job), /خدمة الخادم/);
  }
});
test('Successful private artifacts have bounded authorized URLs and are removed on expiry', async () => {
  const f = await liveExportFixture(), job = await f.queue(), done = await f.worker.runNext(); assert.equal(done?.status, 'completed');
  assert.match((await f.download(job)).url, /^https:\/\/private-export\.invalid/); assert.equal(f.artifacts.signed.at(-1)!.expires, '2026-10-24T06:05:00.000Z');
  f.setNow('2026-10-25T05:59:00Z'); assert.equal((await f.download(job)).expires_at, '2026-10-25T06:00:00.000Z');
  const signed = f.artifacts.signed.length; f.setNow('2026-10-25T06:00:00Z'); await assert.rejects(f.download(job), (error: any) => error.status === 410); assert.equal(f.artifacts.signed.length, signed);
  await f.worker.expireNext(); assert.equal(f.artifacts.files.size, 0);
});
test('Downloads require the live creator and requester grants; another accountant and a forged owner cannot obtain a URL', async () => {
  const f = await liveExportFixture(), job = await f.queue(); await f.worker.runNext();
  for (const uid of ['OtherAccountant', 'Viewer', 'ForgedOwner']) await assert.rejects(f.download(job, uid));
  assert.equal(f.artifacts.signed.length, 0); await f.download(job, f.owner.uid); assert.equal(f.artifacts.signed.length, 1);
  await f.mutate(`${f.root}/members/Accountant`, { role: 'Viewer' }); await assert.rejects(f.download(job)); await assert.rejects(f.download(job, f.owner.uid)); assert.equal(f.artifacts.signed.length, 1);
});
test('Download checks current Auth, subscription and features before signing a stored completed manifest', async () => {
  const memory = new MemoryStore(), f = await liveExportFixture(memory), job = await f.queue(); await f.worker.runNext();
  const account = f.accounts.get('Accountant')!; f.accounts.set('Accountant', { ...account, disabled: true }); await assert.rejects(f.download(job)); f.accounts.set('Accountant', account);
  const org = memory.dump()[f.root]; await f.mutate(f.root, { subscriptionEnd: '2020-01-01' }); await assert.rejects(f.download(job)); await memory.transaction(async tx => tx.set(f.root, org));
  const plan = defaultPlatformPlans().find(row => row.id === 'Enterprise')!; await f.store.transaction(async tx => tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, advanced_reports: false } })); await assert.rejects(f.download(job)); assert.equal(f.artifacts.signed.length, 0);
});
test('Cross-tenant paths, wrong manifest identity or extended retention cannot be signed', async () => {
  const memory = new MemoryStore(), f = await liveExportFixture(memory), job = await f.queue(); await f.worker.runNext(); const path = `${f.root}/accounting_export_jobs/${job.id}`, original = memory.dump()[path];
  for (const updates of [{ artifact: { ...original.artifact, path: 'organizations/foreign/exports/private.xls' } }, { artifact: { ...original.artifact, sha256: 'not-a-hash' } }, { expires_at: '2026-10-25T07:00:00.000Z' }, { id: 'another-job' }, { kind: 'company' }]) {
    await f.mutate(path, updates); await assert.rejects(f.download(job)); await memory.transaction(async tx => tx.set(path, original));
  }
  assert.equal(f.artifacts.signed.length, 0);
});
test('Company generation requires the actual owner; accountant generation rejects foreign source documents', async () => {
  const f = await liveExportFixture(), company = await f.queue('company-job', f.owner.uid, 'company'), content = await f.builder.build(company), snapshot = JSON.parse(Buffer.from(content.bytes).toString());
  assert.equal(snapshot.org.id, f.org.id); assert.equal(snapshot.collections.journal_entries.length, 1);
  await assert.rejects(f.builder.build({ ...company, requested_by: 'Accountant' }), (error: any) => error.status === 403);
  const accounting = await f.queue('foreign-source'); await f.mutate(`${f.root}/bank_reconciliations/foreign`, { id: 'foreign', org_id: 'other-org' }); await assert.rejects(f.builder.build(accounting), /مؤسسة أخرى/);
});
test('Linked policy retention and live revision govern publication and download without enabling a scheduler', async () => {
  const f = await liveExportFixture(), { schedule } = await f.create('linked-policy', 'Accountant', scheduleInput({ retention_hours: 1 })), job = await f.queue();
  f.setNow(schedule.next_run_at!); await f.mutate(`${f.root}/accounting_export_jobs/${job.id}`, { schedule_id: schedule.id, policy_revision: schedule.revision, scheduled_for: schedule.next_run_at });
  const done = await f.worker.runNext(); assert.equal(done?.status, 'completed'); assert.equal(done?.expires_at, '2026-10-24T08:00:00.000Z'); await f.download(job);
  await f.update(schedule.id, schedule.revision, { active: false }, 'pause-linked', 'Accountant'); await assert.rejects(f.download(job));
  assert.equal((await f.service.list(f.org.id, f.owner)).execution_enabled, false);
});
test('Pausing a linked schedule during upload prevents announcement of the already generated bytes', async () => {
  const f = await liveExportFixture(), { schedule } = await f.create('pause-policy', 'Accountant'), job = await f.queue(); f.setNow(schedule.next_run_at!);
  await f.mutate(`${f.root}/accounting_export_jobs/${job.id}`, { schedule_id: schedule.id, policy_revision: schedule.revision, scheduled_for: schedule.next_run_at });
  f.artifacts.onPut = async () => { await f.update(schedule.id, schedule.revision, { active: false }, 'pause-during-upload'); };
  assert.equal((await f.worker.runNext())?.status, 'failed'); assert.equal(f.artifacts.files.size, 0);
});
test('The actual HTTP download route is no-store and cannot bypass current creator authorization', async () => {
  const f = await liveExportFixture(), job = await f.queue(); await f.worker.runNext(); const app = express(); app.use(express.json()); app.use('/api', createApi({ operations: f.operations, verify: async token => f.actor(token), exportWorker: f.worker, exportAuthorization: f.options }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); const { port } = server.address() as { port: number }, url = `http://127.0.0.1:${port}/api/organizations/${f.org.id}/export-jobs/accounting_export_jobs/${job.id}/download`;
  try {
    const first = await fetch(url, { headers: { Authorization: 'Bearer Accountant' } }); assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'no-store'); assert.match((await first.json()).url, /private-export\.invalid/);
    await f.mutate(`${f.root}/members/Accountant`, { role: 'Viewer' }); const denied = await fetch(url, { headers: { Authorization: 'Bearer Accountant' } }); assert.equal(denied.status, 403); assert.equal(denied.headers.get('cache-control'), 'no-store'); assert.ok(!(await denied.text()).includes('private-export.invalid'));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
