import { readFile, writeFile, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { platformFixture, servePlatform } from './helpers/platform';
import { Operations, type Actor } from '../src/domain/operations';
import { MemoryStore, type Document } from '../src/domain/store';
import { Organizations } from '../server/organizations';
import { PlatformBilling } from '../server/platformBilling';
import { OperationIntents } from '../server/operationIntents';
import type { OrgRole } from '../src/types';

const roles: OrgRole[] = ['Owner', 'Admin', 'Accountant', 'Sales', 'Cashier', 'Viewer'];
async function fixture() {
  const f = await platformFixture(), root = `organizations/${f.org.id}`;
  const actors = Object.fromEntries(roles.map(role => [role, role === 'Owner' ? f.owner : { uid: `paused-${role}`, email: `${role}@example.test`, emailVerified: true }])) as Record<OrgRole, Actor>;
  await f.store.transaction(async tx => {
    tx.set(root, { ...await tx.get(root), status: 'suspended', planId: 'missing-plan', subscriptionStatus: 'expired', subscriptionEnd: '2020-01-01T00:00:00Z' });
    tx.set(`${root}/meta/usage`, { lifetimeInvoiceCount: 100 });
    tx.set(`${root}/meta/counters`, { ...await tx.get(`${root}/meta/counters`), invoice_count: 100, lifetime_invoice_count: 100 });
    for (const role of roles.filter(role => role !== 'Owner')) {
      const actor = actors[role];
      tx.set(`${root}/members/${actor.uid}`, { uid: actor.uid, org_id: f.org.id, email: actor.email, role, status: 'suspended' });
      tx.set(`user_organizations/${actor.uid}/orgs/${f.org.id}`, { org_id: f.org.id, role });
    }
  });
  const operations = new Operations(f.store, undefined, undefined, undefined, false);
  const run = (actor: Actor, action: string, data: Document, operationId: string = crypto.randomUUID()) => operations.execute(f.org.id, actor, { action, data, operationId });
  return { ...f, root, actors, operations, run };
}
const customer = (name = 'عميل اصطناعي') => ({ name, phone: '', preferred_currency: 'SDG', balance_sdg: 0, balance_usd: 0 });
const denied = (error: unknown) => (error as { status?: number }).status === 403;

test('paused controls give every assigned role full tenant access without changing roles or billing', async () => {
  const f = await fixture(), original = f.store.dump();
  for (const role of roles) {
    const actor = f.actors[role];
    await f.run(actor, 'customer.create', customer(role));
    await f.run(actor, 'settings.update', { updates: { phone: role } });
    const snapshot = await f.operations.snapshot(f.org.id, actor, true);
    assert.equal(snapshot.platform_controls_enabled, false); assert.equal(snapshot.role, role);
    for (const feature of ['accounting', 'inventory_tracking', 'multi_currency', 'audit_trail', 'advanced_reports']) assert.equal(snapshot.subscription.features[feature], true);
    assert.equal(snapshot.subscription.max_members, 999999);
    assert.ok(snapshot.collections.accounts.length > 0); assert.ok(snapshot.collections.audit_logs.length > 0);
    assert.equal(snapshot.org.status, 'suspended'); assert.equal(snapshot.org.subscriptionStatus, 'expired');
    assert.deepEqual(f.store.dump()[`${f.root}/members/${actor.uid}`], original[`${f.root}/members/${actor.uid}`]);
  }
  const current = f.store.dump()[f.root];
  for (const field of ['owner_uid', 'planId', 'subscriptionStatus', 'subscriptionStart', 'subscriptionEnd', 'billingRevision', 'status']) assert.deepEqual(current[field], original[f.root][field]);
  assert.deepEqual(f.store.dump()[`${f.root}/meta/subscription`], original[`${f.root}/meta/subscription`]);
  const audit = Object.values(f.store.dump()).find(row => row.action === 'customer.create' && row.actor_uid === f.actors.Viewer.uid)!;
  assert.equal(audit.actor_role, 'Viewer'); assert.equal(audit.effective_actor_role, 'Owner'); assert.equal(audit.platform_controls_enabled, false);
});

test('invoice 101 works while expired/suspended and keeps lifetime usage and idempotency', async () => {
  const f = await fixture(), actor = f.actors.Viewer;
  const c = (await f.run(actor, 'customer.create', customer())).result;
  const p = (await f.run(actor, 'product.create', { name: 'خدمة', unit: 'خدمة', price_sdg: 100, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: false })).result;
  const input = { customer_id: c.id, issue_date: new Date().toISOString().slice(0, 10), currency_mode: 'single_usd', exchange_rate_used: 2000, discount_type: 'fixed', discount_value: 0, items: [{ product_id: p.id, description: p.name, unit: p.unit, quantity: 1, unit_price: 1, currency: 'USD', tax_rate: 0, discount_percent: 0 }] };
  const first = await f.run(actor, 'invoice.create', input, 'invoice-101');
  assert.deepEqual(await f.run(actor, 'invoice.create', input, 'invoice-101'), first);
  assert.equal(f.store.dump()[`${f.root}/meta/usage`].lifetimeInvoiceCount, 101);
  assert.equal((await f.operations.snapshot(f.org.id, actor)).collections.invoices.length, 1);
  await assert.rejects(f.run(actor, 'invoice.create', { ...input, items: [{ ...input.items[0], quantity: -1 }] }), /غير سالب/);
  assert.equal((await f.operations.snapshot(f.org.id, actor)).collections.invoices.length, 1);
});

test('paused invitations exceed Free seats but still verify recipient, expiry and actual inviter membership', async () => {
  const f = await fixture(), actor = f.actors.Viewer;
  const invite = (await f.run(actor, 'invitation.create', { email: 'new@example.test', role: 'Admin' }, 'invite-unlimited')).result;
  const orgs = new Organizations(f.store, undefined, undefined, false), recipient: Actor = { uid: 'new-member', email: 'new@example.test', emailVerified: true };
  await assert.rejects(orgs.accept({ ...recipient, email: 'wrong@example.test' }, f.org.id, invite.id), denied);
  const member = await orgs.accept(recipient, f.org.id, invite.id); assert.equal(member.role, 'Admin');
  assert.equal((await orgs.list(actor))[0].id, f.org.id);
  assert.equal((await orgs.list(recipient))[0].id, f.org.id);
});

test('pause never grants anonymous, unverified, foreign, removed or forged Owner tenant membership', async () => {
  const f = await fixture();
  const outsider: Actor = { uid: 'outside', email: 'outside@example.test', emailVerified: true, superAdmin: true };
  await f.store.transaction(async tx => {
    tx.set(`user_organizations/${outsider.uid}/orgs/${f.org.id}`, { org_id: f.org.id, role: 'Owner' });
    tx.set(`${f.root}/members/forged`, { uid: 'forged', role: 'Owner', status: 'active' });
    tx.set(`${f.root}/members/removed`, { uid: 'removed', role: 'Admin', status: 'removed' });
  });
  const before = f.store.dump();
  for (const actor of [outsider, { ...outsider, uid: 'forged' }, { ...outsider, uid: 'removed' }, { ...f.actors.Viewer, emailVerified: false }]) {
    await assert.rejects(f.operations.snapshot(f.org.id, actor), denied);
    await assert.rejects(f.run(actor, 'customer.create', { ...customer(), platform_controls_enabled: false }), denied);
  }
  assert.deepEqual(f.store.dump(), before);
});

test('HTTP commercial endpoints and retry intents are disabled even for the designated administrator', async () => {
  const f = await fixture(), before = f.store.dump(), backend = await servePlatform(f, { admin: f.admin, viewer: f.actors.Viewer });
  try {
    assert.deepEqual(await (await backend.request('/platform-controls', 'admin')).json(), { enabled: false });
    for (const path of ['/super-admin/session', '/super-admin/overview', '/super-admin/companies', '/super-admin/companies/foreign', '/super-admin/plans', '/super-admin/events', '/super-admin/requests']) {
      const response = await backend.request(path, 'admin'); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'platform_controls_paused');
    }
    for (const path of [`/super-admin/companies/${f.org.id}/subscription`, '/super-admin/plans/Free']) {
      const response = await backend.request(path, 'admin', { operationId: 'must-not-write' }); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'platform_controls_paused');
    }
    const response = await backend.request(`/organizations/${f.org.id}/snapshot`, 'viewer'); assert.equal(response.status, 200); assert.equal((await response.json()).platform_controls_enabled, false);
    assert.deepEqual(await (await backend.request('/plans', 'admin')).json(), []);
    await assert.rejects(new PlatformBilling(f.store, undefined, false).assertAdmin(f.admin), (error: any) => error.code === 'platform_controls_paused');
    await assert.rejects(new OperationIntents(f.store, undefined, false).begin(f.admin, { fingerprint: 'a'.repeat(64) }), denied);
    await assert.rejects(f.run(f.owner, 'subscription.request', { plan: 'Business' }), (error: any) => error.code === 'platform_controls_paused');
    assert.deepEqual(f.store.dump(), before);
    const intent = await new OperationIntents(f.store, undefined, false).begin(f.actors.Viewer, { organizationId: f.org.id, fingerprint: 'b'.repeat(64) }); assert.ok(intent.operationId);
  } finally { await backend.close(); }
});

test('recent reauthentication and locked accounting dates remain required for full-access members', async () => {
  const f = await fixture(), actor = f.actors.Viewer;
  await f.store.transaction(async tx => tx.set(f.root, { ...await tx.get(f.root), settings: { ...f.org.settings, period_lock_date: '2026-01-01' } }));
  const before = f.store.dump();
  const input = { updates: { period_lock_date: '' }, reason: 'مراجعة مصرح بها' };
  await assert.rejects(f.run(actor, 'settings.update', input), /حديث|تحقق/);
  assert.deepEqual(f.store.dump(), before);
  await f.run({ ...actor, authTime: Math.floor(Date.now() / 1000) }, 'settings.update', input);
  assert.equal(f.store.dump()[f.root].settings.period_lock_date, '');
});

test('reenabling strict services restores role and quota checks without rewriting memberships or usage', async () => {
  const f = await fixture();
  await f.store.transaction(async tx => {
    tx.set(f.root, { ...await tx.get(f.root), status: 'active', planId: 'Free', subscriptionStatus: 'active', subscriptionEnd: null });
    const path = `${f.root}/members/${f.actors.Viewer.uid}`; tx.set(path, { ...await tx.get(path), status: 'active' });
  });
  await f.run(f.actors.Viewer, 'customer.create', customer());
  const original = f.store.dump(), strict = new Operations(f.store);
  await assert.rejects(strict.execute(f.org.id, f.actors.Viewer, { action: 'customer.create', data: customer(), operationId: 'strict-viewer' }), denied);
  const snapshot = await strict.snapshot(f.org.id, f.owner); assert.equal(snapshot.platform_controls_enabled, true); assert.equal(snapshot.subscription.max_invoices_total, 100); assert.equal(snapshot.counters.lifetime_invoice_count, 100);
  assert.deepEqual(f.store.dump(), original);
});

test('a failed cloud commit remains an error and cannot create a successful local transaction in pause mode', async () => {
  const f = await fixture(), before = f.store.dump(), failed = new MemoryStore(before, () => { throw Error('synthetic cloud failure'); });
  const operations = new Operations(failed, undefined, undefined, undefined, false);
  await assert.rejects(operations.execute(f.org.id, f.actors.Viewer, { action: 'customer.create', data: customer(), operationId: 'failed-cloud' }), /synthetic cloud failure/);
  assert.deepEqual(failed.dump(), before);
});


test('source toggle restores both policy layers and their fingerprint exactly, and rejects drift', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sudaflow-policy-toggle-'));
  try {
    for (const path of ['scripts', 'server', 'src/config']) await mkdir(join(directory, path), { recursive: true });
    for (const path of ['scripts/platform-controls.mjs', 'scripts/accounting-rules-hash.mjs', 'src/config/platform-controls.json', 'firestore.rules', 'server/accountingRulesHash.ts']) await copyFile(path, join(directory, path));
    execFileSync(process.execPath, ['scripts/platform-controls.mjs', '--enable'], { cwd: directory });
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'src/config/platform-controls.json'), 'utf8')), { enabled: true });
    assert.match(await readFile(join(directory, 'firestore.rules'), 'utf8'), /function platformControlsEnabled\(\) \{ return true; \}/);
    execFileSync(process.execPath, ['scripts/accounting-rules-hash.mjs', '--check'], { cwd: directory });
    execFileSync(process.execPath, ['scripts/platform-controls.mjs', '--pause'], { cwd: directory });
    for (const path of ['firestore.rules', 'server/accountingRulesHash.ts', 'src/config/platform-controls.json']) assert.equal(await readFile(join(directory, path), 'utf8'), await readFile(path, 'utf8'));
    await writeFile(join(directory, 'src/config/platform-controls.json'), JSON.stringify({ enabled: true }));
    assert.throws(() => execFileSync(process.execPath, ['scripts/accounting-rules-hash.mjs', '--check'], { cwd: directory, stdio: 'pipe' }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
