import test from 'node:test';
import assert from 'node:assert/strict';
import { platformFixture, servePlatform } from './helpers/platform';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { BusinessError } from '../src/domain/validation';
import type { Actor } from '../src/domain/operations';

const forbidden = (error: unknown) => error instanceof BusinessError && error.status === 403;

test('organization service refuses unverified creation, existing-org retries and listing without any state change', async () => {
  const f = await platformFixture(), before = f.store.dump();
  const unverified = { ...f.owner, emailVerified: false };
  await assert.rejects(f.organizations.create(unverified, 'شركة', INITIAL_SETTINGS, 'initial', true), forbidden);
  await assert.rejects(f.organizations.create({ ...unverified, uid: 'new-user' }, 'شركة', INITIAL_SETTINGS, 'new', true), forbidden);
  await assert.rejects(async () => f.organizations.list(unverified), forbidden);
  assert.deepEqual(f.store.dump(), before);
});

test('verified signup has exactly one Owner, Free lifetime 100 invoices and one additional seat; payload cannot grant privileges', async () => {
  const f = await platformFixture();
  const user: Actor = { uid: 'new-user', email: 'new@example.test', emailVerified: true };
  const input = { ...INITIAL_SETTINGS, planId: 'Enterprise', subscriptionEnd: '2099-01-01', owner_uid: f.admin.uid, superAdmin: true };
  const org = await f.organizations.create(user, 'شركة جديدة', input, 'initial', true);
  const snapshot = await f.operations.snapshot(org.id, user);
  assert.equal(org.owner_uid, user.uid);
  assert.equal(snapshot.role, 'Owner');
  assert.equal(snapshot.collections.members.filter(member => member.role === 'Owner').length, 1);
  assert.equal(snapshot.subscription.plan_id, 'Free');
  assert.equal(snapshot.subscription.invoice_period, 'lifetime');
  assert.equal(snapshot.subscription.max_invoices_total, 100);
  assert.equal(snapshot.subscription.max_members, 2);
  assert.equal(snapshot.counters.lifetime_invoice_count, 0);
  assert.equal(f.store.dump()[`organizations/${org.id}/meta/usage`].firstActualUseAt, null);
  assert.equal(f.store.dump()[`platformAdmins/${user.uid}`], undefined);
});

test('tenant operations require a verified identity independently of the HTTP middleware', async () => {
  const f = await platformFixture(), before = f.store.dump(), actor = { ...f.owner, emailVerified: false };
  await assert.rejects(f.operations.snapshot(f.org.id, actor), forbidden);
  await assert.rejects(f.operations.execute(f.org.id, actor, { action: 'customer.create', operationId: 'unverified', data: { name: 'عميل' } }), forbidden);
  assert.deepEqual(f.store.dump(), before);
});

test('Super Admin requires a boolean claim, a verified email and an active correctly scoped registry record', async () => {
  const f = await platformFixture();
  await f.platform.assertAdmin(f.admin);
  for (const actor of [f.owner, { ...f.admin, superAdmin: false }, { ...f.admin, superAdmin: 'true' } as unknown as Actor, { ...f.admin, emailVerified: false }]) {
    await assert.rejects(f.platform.assertAdmin(actor), forbidden);
  }
  await f.store.transaction(async tx => tx.set(`platformAdmins/${f.owner.uid}`, { active: true, role: 'super_admin' }));
  await assert.rejects(f.platform.assertAdmin(f.owner), forbidden);
  for (const record of [{ active: false, role: 'super_admin' }, { active: true, role: 'Admin' }]) {
    await f.store.transaction(async tx => tx.set(`platformAdmins/${f.admin.uid}`, record));
    await assert.rejects(f.platform.assertAdmin(f.admin), forbidden);
  }
  await f.store.transaction(async tx => tx.delete(`platformAdmins/${f.admin.uid}`));
  await assert.rejects(f.platform.assertAdmin(f.admin), forbidden);
});

test('Owner cannot access platform sections or activate a plan using forged body roles and claims', async () => {
  const f = await platformFixture(), http = await servePlatform(f), before = f.store.dump();
  try {
    for (const path of ['/session', '/overview', '/companies', `/companies/${f.org.id}`, '/plans', '/events', '/requests']) {
      const response = await http.request('/super-admin' + path, 'owner');
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).code, 'super_admin_required');
    }
    const response = await http.request(`/super-admin/companies/${f.org.id}/subscription`, 'owner', {
      action: 'change_plan', operationId: 'forged-role', expectedRevision: f.org.billingRevision,
      reason: 'forged client role', superAdmin: true, role: 'super_admin', performedBy: f.admin.uid,
      payload: { planId: 'Enterprise' },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(f.store.dump(), before);
  } finally { await http.close(); }
});

test('platform session is server-authorized and registry revocation blocks the next commercial mutation', async () => {
  const f = await platformFixture(), http = await servePlatform(f);
  try {
    const session = await http.request('/super-admin/session', 'admin');
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { uid: f.admin.uid, email: f.admin.email, role: 'super_admin' });
    await f.store.transaction(async tx => tx.set(`platformAdmins/${f.admin.uid}`, { active: false, role: 'super_admin' }));
    const before = f.store.dump();
    const response = await http.request(`/super-admin/companies/${f.org.id}/subscription`, 'admin', {
      action: 'extend', operationId: 'revoked-admin', reason: 'should fail', expectedRevision: f.org.billingRevision, payload: { days: 30 },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(f.store.dump(), before);
  } finally { await http.close(); }
});

test('unverified API identities cannot provision companies or enter Super Admin', async () => {
  const f = await platformFixture(), before = f.store.dump();
  const http = await servePlatform(f, { owner: { ...f.owner, emailVerified: false }, admin: { ...f.admin, emailVerified: false } });
  try {
    const create = await http.request('/organizations', 'owner', { initial: false, operationId: 'unverified-http', name: 'forged', settings: INITIAL_SETTINGS });
    assert.equal(create.status, 403);
    assert.equal((await create.json()).code, 'email_not_verified');
    const session = await http.request('/super-admin/session', 'admin');
    assert.equal(session.status, 403);
    assert.deepEqual(f.store.dump(), before);
  } finally { await http.close(); }
});

test('company Admin cannot become platform Admin or change the canonical company Owner', async () => {
  const f = await platformFixture();
  const employee = { uid: 'company-admin', email: 'employee@example.test', emailVerified: true };
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/members/${employee.uid}`, { uid: employee.uid, org_id: f.org.id, role: 'Admin', status: 'active' }));
  const http = await servePlatform(f, { employee }), before = f.store.dump();
  try {
    assert.equal((await http.request('/super-admin/session', 'employee')).status, 403);
    await assert.rejects(f.operations.execute(f.org.id, employee, { action: 'member.update', operationId: 'take-owner', data: { uid: f.owner.uid, role: 'Viewer' } }));
    assert.deepEqual(f.store.dump(), before);
  } finally { await http.close(); }
});

test('commercial Super Admin can read company summary but cannot read or write tenant financial data', async () => {
  const f = await platformFixture();
  await f.operations.execute(f.org.id, f.owner, { action: 'customer.create', operationId: 'private-customer', data: { name: 'PRIVATE-CUSTOMER-SENTINEL' } });
  const http = await servePlatform(f), before = f.store.dump();
  try {
    const summary = await http.request(`/super-admin/companies/${f.org.id}`, 'admin');
    assert.equal(summary.status, 200);
    assert.equal((await summary.text()).includes('PRIVATE-CUSTOMER-SENTINEL'), false);
    assert.equal((await http.request(`/organizations/${f.org.id}/snapshot`, 'admin')).status, 403);
    const write = await http.request(`/organizations/${f.org.id}/operations`, 'admin', { action: 'customer.create', operationId: 'platform-tenant-write', data: { name: 'unauthorized' } });
    assert.equal(write.status, 403);
    assert.deepEqual(f.store.dump(), before);
  } finally { await http.close(); }
});
