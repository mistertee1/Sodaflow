import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { spawnSync } from 'node:child_process';
import { MemoryStore, type Store, type Document } from '../src/domain/store';
import { ScheduledExportDispatcher } from '../server/scheduledExportDispatch';
import { createApi } from '../server/api';
import { scheduledDispatchFixture } from './helpers/scheduledDispatch';
import { defaultPlatformPlans } from '../src/lib/plans';

const select = (records: Record<string, Document>, part: string) => Object.entries(records).filter(([path]) => path.includes(part)).map(([, value]) => value);
async function fixture() { const memory = new MemoryStore(), f = await scheduledDispatchFixture(memory); return { ...f, memory }; }

test('A due schedule atomically creates one correctly scoped job, receipt, queue item and audit; its real workbook preserves both financial books', async () => {
  const f = await fixture(), p = await f.schedule('policy', 'Accountant', { retention_hours: 1 }), before = f.memory.dump(); f.setNow('2026-10-24T07:01:00Z');
  const result = await f.dispatch(p.id); assert.equal(result.status, 'queued'); assert.match(result.job_id!, /^scheduled-[a-f0-9]{64}$/);
  const after = f.memory.dump(), job = after[`${f.root}/accounting_export_jobs/${result.job_id}`];
  assert.equal(job.requested_by, 'Accountant'); assert.equal(job.kind, 'accounting'); assert.equal(job.format, 'xls'); assert.equal(job.policy_revision, 1); assert.equal(job.scheduled_for, '2026-10-24T07:00:00.000Z');
  assert.deepEqual(job.period, { start: '2026-10-23', end: '2026-10-23' }); assert.equal(after[f.duePath(p.id)].next_run_at, '2026-10-25T07:00:00.000Z');
  assert.equal(select(after, '/export_schedule_occurrences/').length, 1); assert.equal(after[`large_export_queue/${f.org.id}.${job.id}`].job_id, job.id);
  for (const [path, row] of Object.entries(before)) if (path !== `${f.root}/export_schedules/${p.id}` && path !== f.duePath(p.id)) assert.deepEqual(after[path], row, path);
  const done = await f.worker.runNext(); assert.equal(done?.status, 'completed'); assert.equal(done?.expires_at, '2026-10-24T08:01:00.000Z');
  const content = new TextDecoder().decode(f.artifacts.files.get(done!.artifact.path)!.bytes); assert.match(content, />100<\/Data>/); assert.match(content, />0\.05<\/Data>/);
  assert.equal((await f.download(done!)).expires_at, '2026-10-24T07:06:00.000Z');
  const sourcePath = Object.keys(before).find(path => path.includes('/journal_entries/')); assert.ok(sourcePath);
  assert.deepEqual(f.memory.dump()[sourcePath], before[sourcePath]);
});

test('Concurrent dispatches of the same local slot create one job and one dispatch audit', async () => {
  const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z');
  const values = await Promise.all(Array.from({ length: 8 }, () => f.dispatch(p.id))); assert.equal(values.filter(row => row.status === 'queued').length, 1);
  assert.equal(select(f.memory.dump(), '/accounting_export_jobs/').length, 1); assert.equal(select(f.memory.dump(), '/export_schedule_occurrences/').length, 1);
  assert.equal(Object.values(f.memory.dump()).filter(row => row.event_type === 'EXPORT_SCHEDULE_QUEUED').length, 1);
});

test('A replayed due cursor never regenerates a completed file or requeues its deterministic occurrence', async () => {
  const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z');
  const first = await f.dispatch(p.id), done = await f.worker.runNext(); assert.equal(done?.status, 'completed');
  await f.mutate(`${f.root}/export_schedules/${p.id}`, { next_run_at: p.next_run_at }); await f.mutate(f.duePath(p.id), { next_run_at: p.next_run_at });
  const replay = await f.dispatch(p.id); assert.equal(replay.status, 'already_dispatched'); assert.equal(replay.job_id, first.job_id); assert.equal(await f.worker.runNext(), null);
  assert.equal(select(f.memory.dump(), '/accounting_export_jobs/').length, 1); assert.equal(f.artifacts.files.size, 1);
});

test('A missing job behind an occurrence receipt fails closed instead of silently issuing a second file', async () => {
  const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z'); const one = await f.dispatch(p.id);
  await f.store.transaction(tx => { tx.delete(`${f.root}/accounting_export_jobs/${one.job_id}`); return Promise.resolve(); });
  await f.mutate(`${f.root}/export_schedules/${p.id}`, { next_run_at: p.next_run_at }); await f.mutate(f.duePath(p.id), { next_run_at: p.next_run_at });
  const before = f.memory.dump(); await assert.rejects(f.dispatch(p.id), (error: any) => error.status === 409); assert.deepEqual(f.memory.dump(), before);
});

test('Disabled Auth skips a slot without loading financial sources; renewal of access only permits the next local day', async () => {
  const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z'); f.accounts.set('Accountant', { uid: 'Accountant', emailVerified: true, disabled: true });
  const before = f.memory.dump(), skipped = await f.dispatch(p.id); assert.equal(skipped.status, 'skipped'); assert.equal(skipped.job_id, undefined);
  assert.equal(select(f.memory.dump(), '/accounting_export_jobs/').length, 0); assert.equal(f.artifacts.files.size, 0);
  const receipt = select(f.memory.dump(), '/export_schedule_occurrences/')[0]; assert.equal(receipt.reason.code, 'export_access_unavailable');
  for (const [path, value] of Object.entries(before)) if (path.includes('/journal_entries/') || path.includes('/accounts/')) assert.deepEqual(f.memory.dump()[path], value);
  f.accounts.set('Accountant', { uid: 'Accountant', emailVerified: true, disabled: false }); f.setNow('2026-10-25T07:01:00Z');
  const next = await f.dispatch(p.id); assert.equal(next.status, 'queued'); assert.notEqual(next.occurrence_id, skipped.occurrence_id);
  assert.deepEqual(f.memory.dump()[`${f.root}/accounting_export_jobs/${next.job_id}`].period, { start: '2026-10-24', end: '2026-10-24' });
});

test('Fresh membership, organization, subscription, feature and V2 revocation skip due slots without financial jobs', async () => {
  for (const revoked of ['role', 'member', 'organization', 'subscription', 'feature', 'v2']) {
    const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z');
    if (revoked === 'role') await f.mutate(`${f.root}/members/Accountant`, { role: 'Viewer' });
    if (revoked === 'member') await f.mutate(`${f.root}/members/Accountant`, { status: 'suspended' });
    if (revoked === 'organization') await f.mutate(f.root, { status: 'suspended' });
    if (revoked === 'subscription') await f.mutate(f.root, { subscriptionEnd: '2026-10-24T07:00:00.000Z' });
    if (revoked === 'v2') await f.mutate(f.root, { accounting_version: 1 });
    if (revoked === 'feature') { const plan = defaultPlatformPlans().find(row => row.id === 'Enterprise')!; await f.mutate('plans/Enterprise', { ...plan, features: { ...plan.features, advanced_reports: false } }); }
    assert.equal((await f.dispatch(p.id)).status, 'skipped', revoked); assert.equal(select(f.memory.dump(), '/accounting_export_jobs/').length, 0, revoked);
  }
});

test('Transient Auth and Rules failures leave the due cursor, receipt and financial data unchanged for retry', async () => {
  const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z'); const before = f.memory.dump();
  for (const change of [{ lookupAccount: async () => { throw Error('secret synthetic Auth failure'); } }, { verifySecurity: async () => { throw Error('secret synthetic Rules failure'); } }]) {
    const dispatcher = new ScheduledExportDispatcher(f.server, { ...f.options, ...change });
    await assert.rejects(dispatcher.dispatch(f.org.id, p.id), (error: any) => error.status === 503 && !error.message.includes('secret'));
    assert.deepEqual(f.memory.dump(), before);
  }
});

test('Editing or pausing a policy while Auth is looked up prevents the old due snapshot from dispatching', async () => {
  for (const updates of [{ active: false }, { time: '11:00' }]) {
    const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z'); let changed = false;
    const dispatcher = new ScheduledExportDispatcher(f.server, { ...f.options, lookupAccount: async uid => { if (!changed) { changed = true; await f.update(p.id, 1, updates); } return f.lookup(uid); } });
    assert.equal((await dispatcher.dispatch(f.org.id, p.id)).status, 'stale'); assert.equal(select(f.memory.dump(), '/accounting_export_jobs/').length, 0);
    assert.equal(f.memory.dump()[`${f.root}/export_schedules/${p.id}`].revision, 2);
  }
});

test('Capacity preserves its due slot until a manual job finishes, and concurrent distinct schedules share the three-job bound', async () => {
  const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z');
  for (let i = 0; i < 3; i++) await f.queue(`manual-${i}`);
  assert.equal((await f.dispatch(p.id)).status, 'capacity'); assert.equal(f.memory.dump()[f.duePath(p.id)].next_run_at, p.next_run_at); assert.equal(select(f.memory.dump(), '/export_schedule_occurrences/').length, 0);
  assert.equal((await f.worker.runNext())?.status, 'completed'); assert.equal((await f.dispatch(p.id)).status, 'queued');
  const other = await fixture(), policies = []; for (let i = 0; i < 5; i++) policies.push(await other.schedule(`capacity-${i}`, i % 2 ? 'OtherAccountant' : 'Accountant'));
  other.setNow('2026-10-24T07:01:00Z'); const results = await Promise.all(policies.map(policy => other.dispatch(policy.id)));
  assert.equal(results.filter(row => row.status === 'queued').length, 3); assert.equal(results.filter(row => row.status === 'capacity').length, 2);
});

test('Company and auditor scheduled types feed the existing real builders with the correct source scope and owner', async () => {
  for (const kind of ['company', 'auditor']) {
    const f = await fixture(), p = await f.schedule('typed', kind === 'company' ? f.owner.uid : 'Accountant', { kind, period_kind: kind === 'company' ? 'full' : 'previous_day' }); f.setNow('2026-10-24T07:01:00Z');
    const result = await f.dispatch(p.id), collection = kind === 'company' ? 'company_export_jobs' : 'accounting_export_jobs', job = f.memory.dump()[`${f.root}/${collection}/${result.job_id}`];
    assert.equal(job.format, kind === 'company' ? 'json' : 'xlsx'); const done = await f.worker.runNext(); assert.equal(done?.status, 'completed');
    const bytes = f.artifacts.files.get(done!.artifact.path)!.bytes;
    if (kind === 'company') { const backup = JSON.parse(new TextDecoder().decode(bytes)); assert.equal(backup.org.id, f.org.id); assert.equal(backup.collections.journal_entries.length, 1); }
    else assert.equal(Buffer.from(bytes).subarray(0, 2).toString(), 'PK');
  }
});

test('Late dispatches create one original-period occurrence, skip missed days, and never dispatch a second DST wall-clock occurrence', async () => {
  const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-28T12:00:00Z'); const result = await f.dispatch(p.id);
  assert.deepEqual(f.memory.dump()[`${f.root}/accounting_export_jobs/${result.job_id}`].period, { start: '2026-10-23', end: '2026-10-23' });
  assert.equal(f.memory.dump()[f.duePath(p.id)].next_run_at, '2026-10-29T07:00:00.000Z'); assert.equal(await f.dispatcher.dispatchNext(), null);
  const dst = await fixture(), fold = await dst.schedule('fold', 'Accountant', { timezone: 'America/New_York', time: '01:30', start_date: '2026-11-01' });
  dst.setNow('2026-11-01T05:31:00Z'); assert.equal((await dst.dispatch(fold.id)).status, 'queued'); dst.setNow('2026-11-01T06:31:00Z'); assert.equal(await dst.dispatcher.dispatchNext(), null);
  assert.equal(select(dst.memory.dump(), '/accounting_export_jobs/').length, 1);
});

test('Ended policies skip their last missed slot and remove the due index without generating a financial file', async () => {
  const f = await fixture(), p = await f.schedule('ending', 'Accountant', { end_date: '2026-10-24' }); f.setNow('2026-10-25T08:00:00Z');
  assert.equal((await f.dispatch(p.id)).status, 'skipped'); assert.equal(f.memory.dump()[f.duePath(p.id)], undefined); assert.equal(f.memory.dump()[`${f.root}/export_schedules/${p.id}`].next_run_at, null);
});

test('Foreign due metadata and local/browser authority cannot create or expose a scheduled job', async () => {
  const f = await fixture(), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z'); await f.mutate(f.duePath(p.id), { org_id: 'foreign' }); const before = f.memory.dump();
  await assert.rejects(f.dispatch(p.id), (error: any) => error.status === 409); assert.deepEqual(f.memory.dump(), before);
  for (const authority of ['browser', 'local'] as const) { const store: Store = { authority, transaction: work => f.store.transaction(work) }; await assert.rejects(new ScheduledExportDispatcher(store, f.options).dispatch(f.org.id, p.id), (error: any) => error.status === 403); }
});

test('A failed dispatch commit rolls back the job, receipt, due cursor and audit, then retries once', async () => {
  let fail = false; const memory = new MemoryStore({}, records => { if (fail && Object.keys(records).some(path => path.includes('/export_schedule_occurrences/'))) { fail = false; throw Error('Synthetic dispatch commit unavailable'); } });
  const f = await scheduledDispatchFixture(memory), p = await f.schedule(); f.setNow('2026-10-24T07:01:00Z'); const before = memory.dump(); fail = true;
  await assert.rejects(f.dispatch(p.id), /Synthetic dispatch/); assert.deepEqual(memory.dump(), before); assert.equal((await f.dispatch(p.id)).status, 'queued'); assert.equal(select(memory.dump(), '/export_schedule_occurrences/').length, 1);
});

test('The once runner defaults to disabled without initializing Firebase or requiring credentials', () => {
  for (const explicit of [false, true]) {
    const env = { ...process.env }; if (explicit) env.SCHEDULED_EXPORTS_ENABLED = 'false'; else delete env.SCHEDULED_EXPORTS_ENABLED;
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/scheduledExportDispatchRunner.ts'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout.trim()), { status: 'disabled', execution_enabled: false });
  }
});

test('No public dispatch endpoint lets an authenticated owner bypass the internal worker', async () => {
  const f = await fixture(), p = await f.schedule(), app = express(); app.use(express.json()); app.use('/api', createApi({ operations: f.operations, scheduledExports: f.service, verify: async () => f.owner }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try { const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/organizations/${f.org.id}/export-schedules/${p.id}/dispatch`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.status, 404); assert.equal(select(f.memory.dump(), '/accounting_export_jobs/').length, 0); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
