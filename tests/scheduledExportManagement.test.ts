import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApi } from '../server/api';
import { ScheduledExportManagement, scheduledExportDueKey } from '../src/domain/scheduledExportManagement';
import { MemoryStore, type Store, type Document } from '../src/domain/store';
import { defaultPlatformPlans } from '../src/lib/plans';
import { scheduledExportsFixture, scheduleInput } from './helpers/scheduledExports';

const failure = (status: number) => (error: any) => error.status === status;
async function fixture() { const memory = new MemoryStore(), f = await scheduledExportsFixture(memory); return { ...f, memory }; }
const schedules = (rows: Record<string, Document>) => Object.entries(rows).filter(([path]) => path.includes('/export_schedules/'));
const audits = (rows: Record<string, Document>) => Object.entries(rows).filter(([path, row]) => path.includes('/audit_logs/') && String(row.action).startsWith('exportSchedule.')).map(([, row]) => row);

test('Cloud schedule creation atomically saves metadata, private due index, audit and shared receipt without changing any financial source', async () => {
  const f = await fixture(), before = f.memory.dump(), result = await f.create(), after = f.memory.dump(), p = result.schedule;
  assert.equal(result.execution_enabled, false); assert.equal(p.revision, 1); assert.equal(p.created_by, f.owner.uid); assert.equal(p.next_run_at, '2026-10-24T07:00:00.000Z');
  assert.equal(after[`scheduled_export_due/${scheduledExportDueKey(f.org.id, p.id)}`].policy_revision, 1);
  assert.equal(after[`${f.root}/meta/export_schedule_control`].count, 1);
  assert.equal(after[`${f.root}/idempotency/schedule-create`].response.schedule.id, p.id); assert.equal(audits(after).length, 1); assert.equal(audits(after)[0].event_type, 'EXPORT_SCHEDULE_CREATED');
  for (const [path, value] of Object.entries(before)) assert.deepEqual(after[path], value, path);
  assert.equal((await f.service.list(f.org.id, f.owner)).schedules.length, 1); assert.deepEqual((await f.service.list(f.org.id, f.owner)).schedules[0], p);
});

test('Concurrent repeats commit one policy, rate increment and audit; different payload/actor or operation namespace cannot reuse its receipt', async () => {
  const f = await fixture(), results = await Promise.all(Array.from({ length: 6 }, () => f.create()));
  for (const result of results) assert.deepEqual(result, results[0]);
  const rows = f.memory.dump(); assert.equal(schedules(rows).length, 1); assert.equal(audits(rows).length, 1); assert.equal(rows[`${f.root}/rate_limits/scheduled-export-${f.owner.uid}`].count, 1); assert.equal(f.lookups.length, 6);
  await assert.rejects(f.create('schedule-create', f.owner.uid, scheduleInput({ name: 'تغيير الطلب' })), failure(409));
  await assert.rejects(f.create('schedule-create', 'Accountant'), failure(409));
  await f.mutate(`${f.root}/idempotency/colliding`, { action: 'customer.create', actor_uid: f.owner.uid, fingerprint: 'x', response: {} });
  await assert.rejects(f.create('colliding'), failure(409)); assert.equal(schedules(f.memory.dump()).length, 1);
});

test('Optimistic updates race to one winner and keep policy, due revision and immutable creator consistent', async () => {
  const f = await fixture(), first = await f.create('accountant-create', 'Accountant'), p = first.schedule;
  const [a, b] = await Promise.allSettled([f.update(p.id, 1, { time: '11:00' }, 'update-a', 'Accountant'), f.update(p.id, 1, { time: '12:00' }, 'update-b')]);
  assert.equal([a, b].filter(row => row.status === 'fulfilled').length, 1); assert.equal([a, b].filter(row => row.status === 'rejected' && row.reason.status === 409).length, 1);
  const current = f.memory.dump()[`${f.root}/export_schedules/${p.id}`]; assert.equal(current.revision, 2); assert.equal(current.created_by, 'Accountant');
  const due = f.memory.dump()[`scheduled_export_due/${scheduledExportDueKey(f.org.id, p.id)}`]; assert.equal(due.policy_revision, 2); assert.equal(due.next_run_at, current.next_run_at); assert.equal(audits(f.memory.dump()).length, 2);
});

test('Repeated update returns the current revision once; stale create/update receipts cannot resurrect an old active policy', async () => {
  const f = await fixture(), { schedule: p } = await f.create(), first = await f.update(p.id, 1, { active: false });
  assert.deepEqual(await f.update(p.id, 1, { active: false }), first); assert.equal(audits(f.memory.dump()).length, 2);
  await assert.rejects(f.create(), failure(409));
  await f.update(p.id, 2, { time: '11:00' }, 'later');
  await assert.rejects(f.update(p.id, 1, { active: false }), failure(409));
  assert.equal(f.memory.dump()[`${f.root}/export_schedules/${p.id}`].active, false);
});

test('Pause deletes the due item and resume computes a future slot without catch-up or changing financial data', async () => {
  const f = await fixture(), { schedule: p } = await f.create(), due = `scheduled_export_due/${scheduledExportDueKey(f.org.id, p.id)}`;
  const paused = await f.update(p.id, 1, { active: false }); assert.equal(paused.schedule.next_run_at, null); assert.equal(f.memory.dump()[due], undefined);
  f.setNow('2026-10-28T12:00:00Z'); const resumed = await f.update(p.id, 2, { active: true }, 'resume'); assert.equal(resumed.schedule.next_run_at, '2026-10-29T07:00:00.000Z');
  assert.equal(f.memory.dump()[due].policy_revision, 3); assert.deepEqual(audits(f.memory.dump()).map(row => row.event_type), ['EXPORT_SCHEDULE_CREATED', 'EXPORT_SCHEDULE_PAUSED', 'EXPORT_SCHEDULE_RESUMED']);
  await assert.rejects(f.update(p.id, 3, { active: true }, 'no-op'), failure(409));
});

test('JSON cadence/end-date clearing and protected metadata validation apply through the management service', async () => {
  const f = await fixture(), { schedule: p } = await f.create('weekly', f.owner.uid, scheduleInput({ cadence: 'weekly', weekday: 1, end_date: '2026-12-31' }));
  const changed = await f.update(p.id, 1, { cadence: 'daily', weekday: null, end_date: null }); assert.equal(changed.schedule.weekday, undefined); assert.equal(changed.schedule.end_date, undefined);
  const before = f.memory.dump();
  for (const updates of [{ next_run_at: '2026-10-24T06:00:00Z' }, { revision: 100 }, { created_by: 'Admin' }, { org_id: 'other' }, { kind: 'company', period_kind: 'full' }]) await assert.rejects(f.update(p.id, 2, updates, 'protected'));
  await assert.rejects(f.service.create(f.org.id, f.owner, { operationId: 'injected', input: scheduleInput(), access: { role: 'Owner' } }), failure(400));
  await assert.rejects(f.create('nested', f.owner.uid, scheduleInput({ name: { nested: { secret: 'not-a-policy-field' } } })), failure(400));
  await assert.rejects(f.service.update(f.org.id, f.owner, p.id, { operationId: 'nested-revision', expected_revision: { nested: true }, updates: { active: false } }), failure(400));
  assert.deepEqual(f.memory.dump(), before);
});

test('Actual financial roles and active membership are required even while ordinary platform controls are paused', async () => {
  const f = await fixture();
  for (const role of ['Viewer', 'Sales', 'Cashier', 'ForgedOwner']) {
    await assert.rejects(f.create(`denied-${role}`, role), failure(403)); await assert.rejects(f.service.list(f.org.id, f.actor(role)), failure(403));
  }
  await f.mutate(`${f.root}/members/Accountant`, { status: 'suspended' }); await assert.rejects(f.create('suspended', 'Accountant'), failure(403));
  assert.equal(schedules(f.memory.dump()).length, 0); assert.equal(audits(f.memory.dump()).length, 0);
});

test('Creator scoping, actual Owner management and company-only ownership are enforced without leaking another accountant policy', async () => {
  const f = await fixture(), a = await f.create('one', 'Accountant'), b = await f.create('two', 'OtherAccountant');
  await f.create('company', f.owner.uid, scheduleInput({ kind: 'company', period_kind: 'full' }));
  assert.equal((await f.service.list(f.org.id, f.owner)).schedules.length, 3); assert.deepEqual((await f.service.list(f.org.id, f.actor('Accountant'))).schedules.map(row => row.id), [a.schedule.id]);
  assert.equal((await f.service.list(f.org.id, f.actor('Admin'))).schedules.length, 0);
  await assert.rejects(f.update(a.schedule.id, 1, { time: '11:00' }, 'other-edit', 'OtherAccountant'), failure(403));
  const ownerEdit = await f.update(a.schedule.id, 1, { time: '11:00' }, 'owner-edit'); assert.equal(ownerEdit.schedule.created_by, 'Accountant'); assert.equal(ownerEdit.schedule.updated_by, f.owner.uid);
  for (const role of ['Admin', 'Accountant']) await assert.rejects(f.create(`company-${role}`, role, scheduleInput({ kind: 'company', period_kind: 'full' })), failure(403));
  await assert.rejects(f.service.update('foreign', f.owner, b.schedule.id, { operationId: 'cross-org', expected_revision: 1, updates: { active: false } }), failure(403));
});

test('Every list, write and cached retry resolves the live Auth account; disabled, removed, unverified or mismatched accounts confer no access', async () => {
  const f = await fixture(); await f.create(); const before = f.memory.dump(), original = f.accounts.get(f.owner.uid)!;
  for (const account of [undefined, { ...original, disabled: true }, { ...original, emailVerified: false }, { ...original, uid: 'different' }]) {
    if (account) f.accounts.set(f.owner.uid, account); else f.accounts.delete(f.owner.uid);
    await assert.rejects(f.create(), failure(403)); await assert.rejects(f.service.list(f.org.id, f.owner), failure(403));
  }
  f.accounts.set(f.owner.uid, original); await assert.rejects(f.service.list(f.org.id, { ...f.owner, emailVerified: false }), failure(403)); assert.deepEqual(f.memory.dump(), before);
});

test('Live organization, V2, subscription and canonical feature revocation gate retries without changing their receipt or due item', async () => {
  const f = await fixture(); await f.create(); const original = f.memory.dump()[f.root], before = f.memory.dump();
  for (const updates of [{ status: 'suspended' }, { accounting_version: 1 }, { subscriptionStatus: 'expired' }, { subscriptionEnd: '2026-10-24' }, { planId: 'Free' }]) {
    await f.mutate(f.root, updates); await assert.rejects(f.create()); if (updates.planId === 'Free') assert.deepEqual((await f.service.list(f.org.id, f.owner)).schedules, []); else await assert.rejects(f.service.list(f.org.id, f.owner)); await f.store.transaction(async tx => tx.set(f.root, original));
  }
  const plan = defaultPlatformPlans().find(row => row.id === 'Enterprise')!;
  for (const feature of ['accounting', 'advanced_reports']) {
    await f.store.transaction(async tx => tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, [feature]: false } })); await assert.rejects(f.create(), failure(403));
  }
  await f.store.transaction(async tx => tx.delete('plans/Enterprise')); assert.deepEqual(f.memory.dump(), before);
});

test('List omits no-longer-authorized auditor policies while company schedules remain usable to the real Owner without advanced reports', async () => {
  const f = await fixture(); await f.create('auditor', f.owner.uid, scheduleInput({ kind: 'auditor' })); await f.create('company', f.owner.uid, scheduleInput({ kind: 'company', period_kind: 'full' }));
  const plan = defaultPlatformPlans().find(row => row.id === 'Enterprise')!;
  await f.store.transaction(async tx => tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, audit_trail: false } }));
  assert.deepEqual((await f.service.list(f.org.id, f.owner)).schedules.map(row => row.kind), ['company']);
  await f.store.transaction(async tx => tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, advanced_reports: false } })); assert.deepEqual((await f.service.list(f.org.id, f.owner)).schedules.map(row => row.kind), ['company']);
});

test('Browser/local authority and unavailable account lookup never acknowledge or persist a cloud policy', async () => {
  const f = await fixture(), before = f.memory.dump();
  for (const authority of ['browser', 'local'] as const) {
    const store: Store = { authority, transaction: work => f.store.transaction(work) }, service = new ScheduledExportManagement(store, f.lookup, undefined, f.now);
    await assert.rejects(service.create(f.org.id, f.owner, { operationId: 'untrusted', input: scheduleInput() }), failure(403)); await assert.rejects(service.list(f.org.id, f.owner), failure(403));
  }
  const service = new ScheduledExportManagement(f.server, async () => { throw Error('Synthetic Auth infrastructure unavailable'); }, undefined, f.now, f.verifySecurity);
  await assert.rejects(service.create(f.org.id, f.owner, { operationId: 'no-auth', input: scheduleInput() }), /Synthetic Auth infrastructure/); assert.deepEqual(f.memory.dump(), before);
});

test('Failed cloud commit rolls back the policy, due index, audit, rate count and receipt; its retry commits exactly once', async () => {
  let fail = false; const memory = new MemoryStore({}, () => { if (fail) { fail = false; throw Error('Synthetic commit failure'); } });
  const f = await scheduledExportsFixture(memory), before = memory.dump(); fail = true; await assert.rejects(f.create(), /Synthetic commit/); assert.deepEqual(memory.dump(), before);
  const result = await f.create(); assert.deepEqual(await f.create(), result); assert.equal(audits(memory.dump()).length, 1);
});

test('Policy and rate bounds are transactional while successful retries remain available at the limit', async () => {
  const f = await fixture(); for (let i = 0; i < 20; i++) await f.create(`bounded-${i}`, f.owner.uid, scheduleInput({ active: false }));
  await assert.rejects(f.create('over-limit'), failure(409)); assert.equal((await f.create('bounded-0', f.owner.uid, scheduleInput({ active: false }))).schedule.id, 'schedule-bounded-0'); assert.equal(schedules(f.memory.dump()).length, 20);
  const p = f.memory.dump()[`${f.root}/export_schedules/schedule-bounded-0`]; await f.mutate(`${f.root}/rate_limits/scheduled-export-${f.owner.uid}`, { minute: f.now().toISOString().slice(0, 16), count: 120 });
  const before = f.memory.dump(); await assert.rejects(f.update(p.id, 1, { name: 'تجاوز الحد' }, 'over-rate'), failure(429)); assert.deepEqual(f.memory.dump(), before);
});

test('Length-delimited due hashing isolates dotted tenant/schedule combinations that collide under concatenation', () => {
  assert.equal('a.schedule-b' + '.' + 'schedule-c', 'a' + '.' + 'schedule-b.schedule-c');
  assert.notEqual(scheduledExportDueKey('a.schedule-b', 'schedule-c'), scheduledExportDueKey('a', 'schedule-b.schedule-c'));
});

test('A mismatched schedule registry fails closed and cannot be used to bypass the organization count', async () => {
  const f = await fixture(); await f.create(); await f.mutate(`${f.root}/meta/export_schedule_control`, { count: 0 });
  const before = f.memory.dump(); await assert.rejects(f.create('registry-mismatch'), failure(409)); assert.deepEqual(f.memory.dump(), before);
});

test('Missing or changed Rules verification blocks reads, writes and cached retries before acknowledging a schedule', async () => {
  const f = await fixture(); await f.create(); const before = f.memory.dump();
  const missing = new ScheduledExportManagement(f.server, f.lookup, undefined, f.now);
  await assert.rejects(missing.list(f.org.id, f.owner), (error: any) => error.status === 503 && error.code === 'accounting_rules_not_verified');
  const mismatch = new ScheduledExportManagement(f.server, f.lookup, undefined, f.now, async () => { throw Object.assign(Error('Rules mismatch'), { status: 503 }); });
  await assert.rejects(mismatch.create(f.org.id, f.owner, { operationId: 'schedule-create', input: scheduleInput() }), failure(503));
  assert.deepEqual(f.memory.dump(), before);
});

test('Actual API routes return no-store confirmed policies, reject anonymous/unverified/forged access and recheck Auth on retries', async () => {
  const f = await fixture(), app = express(); app.use(express.json());
  app.use('/api', createApi({ operations: f.operations, scheduledExports: f.service, verify: async token => token === 'unverified' ? { ...f.owner, emailVerified: false } : f.actor(token === 'owner' ? f.owner.uid : token) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/organizations/${f.org.id}/export-schedules`;
  const call = (path = '', token = 'owner', body?: unknown) => fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...token ? { Authorization: `Bearer ${token}` } : {}, 'Content-Type': 'application/json' }, ...body === undefined ? {} : { body: JSON.stringify(body) } });
  try {
    for (const [token, status] of [['', 401], ['unverified', 403], ['Sales', 403], ['ForgedOwner', 403]] as const) { const denied = await call('', token); assert.equal(denied.status, status); assert.equal(denied.headers.get('cache-control'), 'no-store'); }
    const body = { operationId: 'http-create', input: scheduleInput() }, response = await call('', 'owner', body); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const created = await response.json(); assert.equal(created.execution_enabled, false); assert.equal(created.schedule.created_by, f.owner.uid); assert.deepEqual(await (await call('', 'owner', body)).json(), created);
    assert.equal((await call('?authority=server', 'owner')).status, 400); assert.equal((await call('', 'owner', { ...body, access: { role: 'Owner' } })).status, 400);
    const id = created.schedule.id, paused = await call(`/${id}`, 'owner', { operationId: 'http-pause', expected_revision: 1, updates: { active: false } }); assert.equal(paused.status, 200); assert.equal((await paused.json()).schedule.active, false);
    assert.equal((await call(`/${id}`, 'owner', { operationId: 'http-stale', expected_revision: 1, updates: { active: true } })).status, 409);
    f.accounts.set(f.owner.uid, { uid: f.owner.uid, disabled: true, emailVerified: true }); assert.equal((await call('', 'owner', body)).status, 403); assert.equal((await call('', 'owner')).status, 403);
    assert.equal(audits(f.memory.dump()).length, 2);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
