import test from 'node:test';
import assert from 'node:assert/strict';
import { activateExclusiveAdmin, previewExclusiveAdmin, type BootstrapAuth, type BootstrapUser } from '../server/platformAdminBootstrap';
import { PlatformBilling } from '../server/platformBilling';
import { MemoryStore, type Document } from '../src/domain/store';
import { BusinessError } from '../src/domain/validation';

function fixture() {
  const user: BootstrapUser = { uid: 'designated-admin', email: 'selected@example.test', emailVerified: true, disabled: false, customClaims: { preserved: 'value', superAdmin: false } };
  const legacy: BootstrapUser = { uid: 'legacy-admin', email: 'legacy@example.test', emailVerified: true, disabled: false, customClaims: { superAdmin: true } };
  const users = new Map([user, legacy].map(item => [item.uid, structuredClone(item)]));
  let claimsFail = false, persistFail = false, claimsCalls = 0;
  const auth: BootstrapAuth = {
    getUserByEmail: async email => { const found = [...users.values()].find(item => item.email?.toLowerCase() === email); if (!found) throw new Error('auth/user-not-found'); return structuredClone(found); },
    getUser: async uid => { const found = users.get(uid); if (!found) throw new Error('auth/user-not-found'); return structuredClone(found); },
    setCustomUserClaims: async (uid, claims) => { claimsCalls++; if (claimsFail) throw new Error('auth/insufficient-permission'); users.get(uid)!.customClaims = structuredClone(claims); },
  };
  const store = new MemoryStore({
    'platformAccess/superAdmin': { mode: 'exclusive', active: true, uid: legacy.uid, email: legacy.email, revision: 2 },
    [`platformAdmins/${legacy.uid}`]: { uid: legacy.uid, email: legacy.email, active: true, role: 'super_admin' },
    'organizations/synthetic/invoices/history': { id: 'history', total: 35, marker: 'financial data remains unchanged' },
    'organizations/synthetic/meta/usage': { lifetimeInvoiceCount: 100 },
  }, () => { if (persistFail) throw new Error('transaction commit unavailable'); });
  const target = { email: user.email!, uid: user.uid }, platform = new PlatformBilling(store);
  const actor = (uid = user.uid) => { const value = users.get(uid)!; return { uid, email: value.email!, emailVerified: value.emailVerified, superAdmin: value.customClaims?.superAdmin === true }; };
  return { user, legacy, users, auth, store, target, platform, actor, claimsCalls: () => claimsCalls,
    failClaims: (value: boolean) => { claimsFail = value; }, failPersistence: (value: boolean) => { persistFail = value; } };
}
const forbidden = (error: unknown) => error instanceof BusinessError && error.status === 403;

test('technical preview resolves the exact verified email/UID without claims or database changes', async () => {
  const f = fixture(), before = f.store.dump(), claims = structuredClone(f.users);
  const preview = await previewExclusiveAdmin(f.store, f.auth, { email: 'SELECTED@example.test' });
  assert.equal(preview.uid, f.user.uid); assert.equal(preview.email, f.user.email); assert.equal(preview.verified, true);
  assert.match(preview.reviewHash, /^[a-f0-9]{64}$/); assert.deepEqual(preview.revokeUids, [f.legacy.uid]);
  assert.deepEqual(f.store.dump(), before); assert.deepEqual(f.users, claims); assert.equal(f.claimsCalls(), 0);
});

test('bootstrap rejects disabled or unverified accounts, invalid email and an email/UID mismatch without mutation', async () => {
  for (const changes of [{ emailVerified: false }, { disabled: true }]) {
    const f = fixture(), before = f.store.dump(); Object.assign(f.users.get(f.user.uid)!, changes);
    await assert.rejects(previewExclusiveAdmin(f.store, f.auth, f.target));
    assert.deepEqual(f.store.dump(), before); assert.equal(f.claimsCalls(), 0);
  }
  const f = fixture(), before = f.store.dump();
  for (const target of [{ email: '' }, { email: 'selected@example.test', uid: 'wrong-uid' }, { email: 'selected+alias@example.test' }]) await assert.rejects(previewExclusiveAdmin(f.store, f.auth, target));
  assert.deepEqual(f.store.dump(), before); assert.equal(f.claimsCalls(), 0);
});

test('exclusive activation atomically records the policy, revokes other registries, preserves claims and leaves financial data intact', async () => {
  const f = fixture(), before = f.store.dump(), preview = await previewExclusiveAdmin(f.store, f.auth, f.target);
  const result = await activateExclusiveAdmin(f.store, f.auth, { ...f.target, reviewHash: preview.reviewHash, operator: 'synthetic-operator' });
  assert.equal(result.claimConfirmed, true); assert.equal(result.policyRevision, 3);
  assert.deepEqual(f.users.get(f.user.uid)!.customClaims, { preserved: 'value', superAdmin: true });
  await f.platform.assertAdmin(f.actor()); await assert.rejects(f.platform.assertAdmin(f.actor(f.legacy.uid)), forbidden);
  const state = f.store.dump(); assert.equal(state[`platformAdmins/${f.legacy.uid}`].active, false);
  for (const [path, value] of Object.entries(before).filter(([path]) => path.startsWith('organizations/'))) assert.deepEqual(state[path], value);
  const events = Object.values(state).filter(item => item.action === 'platform_admin.exclusive_bootstrap');
  assert.equal(events.length, 1); assert.equal(events[0].performedBy, 'synthetic-operator');
  assert.equal(events[0].previousValue.policy.uid, f.legacy.uid); assert.equal(events[0].newValue.policy.uid, f.user.uid);
  assert.deepEqual(events[0].newValue.revokedUids, [f.legacy.uid]);
});

test('a stale review hash cannot activate an account or change claims after a concurrent policy edit', async () => {
  const f = fixture(), preview = await previewExclusiveAdmin(f.store, f.auth, f.target);
  await f.store.transaction(async tx => tx.set('platformAccess/superAdmin', { ...f.store.dump()['platformAccess/superAdmin'], active: false }));
  const before = f.store.dump();
  await assert.rejects(activateExclusiveAdmin(f.store, f.auth, { ...f.target, reviewHash: preview.reviewHash, operator: 'test' }), (error: unknown) => error instanceof BusinessError && error.status === 409);
  assert.deepEqual(f.store.dump(), before); assert.equal(f.claimsCalls(), 0);
});

test('database commit failure leaves claims and administrator authority unchanged', async () => {
  const f = fixture(), preview = await previewExclusiveAdmin(f.store, f.auth, f.target), before = f.store.dump();
  f.failPersistence(true);
  await assert.rejects(activateExclusiveAdmin(f.store, f.auth, { ...f.target, reviewHash: preview.reviewHash, operator: 'test' }), /commit unavailable/);
  assert.deepEqual(f.store.dump(), before); assert.equal(f.claimsCalls(), 0); assert.equal(f.actor().superAdmin, false);
});

test('failed claims activation remains closed and a fresh preview resumes without duplicate policy or audit changes', async () => {
  const f = fixture(), preview = await previewExclusiveAdmin(f.store, f.auth, f.target); f.failClaims(true);
  await assert.rejects(activateExclusiveAdmin(f.store, f.auth, { ...f.target, reviewHash: preview.reviewHash, operator: 'test' }), (error: unknown) => error instanceof BusinessError && error.code === 'super_admin_claims_pending');
  await assert.rejects(f.platform.assertAdmin(f.actor()), forbidden); await assert.rejects(f.platform.assertAdmin(f.actor(f.legacy.uid)), forbidden);
  const before = f.store.dump(); f.failClaims(false);
  const next = await previewExclusiveAdmin(f.store, f.auth, f.target); assert.equal(next.changesRequired, false);
  await activateExclusiveAdmin(f.store, f.auth, { ...f.target, reviewHash: next.reviewHash, operator: 'test' });
  await f.platform.assertAdmin(f.actor()); assert.deepEqual(f.store.dump(), before);
  assert.equal(Object.values(before).filter(item => item.action === 'platform_admin.exclusive_bootstrap').length, 1);
});

test('two reviewed concurrent activations admit only one account and never grant the losing identity claims', async () => {
  const f = fixture(), alternative = { ...f.user, uid: 'alternative-admin', email: 'alternative@example.test' }; f.users.set(alternative.uid, alternative);
  const a = await previewExclusiveAdmin(f.store, f.auth, f.target), b = await previewExclusiveAdmin(f.store, f.auth, { email: alternative.email });
  const results = await Promise.allSettled([a, b].map(p => activateExclusiveAdmin(f.store, f.auth, { email: p.email, uid: p.uid, reviewHash: p.reviewHash, operator: 'test' })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected' && item.reason.status === 409).length, 1);
  const winner = f.store.dump()['platformAccess/superAdmin'].uid;
  await f.platform.assertAdmin(f.actor(winner));
  const loser = winner === f.user.uid ? alternative.uid : f.user.uid;
  assert.equal(f.actor(loser).superAdmin, false); await assert.rejects(f.platform.assertAdmin(f.actor(loser)), forbidden);
});

test('a deleted and recreated mailbox with a new UID cannot inherit a previously reviewed activation', async () => {
  const f = fixture(), preview = await previewExclusiveAdmin(f.store, f.auth, { email: f.target.email });
  f.users.delete(f.user.uid); f.users.set('recreated-user', { ...f.user, uid: 'recreated-user' });
  const before = f.store.dump();
  await assert.rejects(activateExclusiveAdmin(f.store, f.auth, { email: f.target.email, reviewHash: preview.reviewHash, operator: 'test' }), (error: unknown) => error instanceof BusinessError && error.status === 409);
  assert.deepEqual(f.store.dump(), before); assert.equal(f.claimsCalls(), 0);
});
