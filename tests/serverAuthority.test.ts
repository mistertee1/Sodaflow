import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { MemoryStore, type Document } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { PlatformBilling } from '../server/platformBilling';
import { createApi } from '../server/api';
import { ResilientStore } from '../server/resilientStore';
import { INITIAL_SETTINGS } from '../src/data/initialData';

// Buffered remote transaction double: commit may fail after its callback.
// Domain quota/expiry behavior also runs on real Firestore in the emulator.
function remote(seed: Record<string, Document> = {}) {
  const persisted = new MemoryStore(seed);
  let failure: unknown, afterWork = false, calls = 0;
  type Ref = { path: string };
  type Native = { get(ref: Ref): Promise<{ exists: boolean; data(): Document | undefined }>; set(ref: Ref, data: Document): void; delete(ref: Ref): void };
  const db = {
    doc: (p: string): Ref => ({ path: p }),
    runTransaction: async <T>(work: (tx: Native) => Promise<T>): Promise<T> => {
      calls++;
      if (failure && !afterWork) throw failure;
      return persisted.transaction(async tx => {
        const result = await work({
          get: async ref => { const data = await tx.get(ref.path); return { exists: data !== undefined, data: () => data }; },
          set: (ref, data) => tx.set(ref.path, data), delete: ref => tx.delete(ref.path),
        });
        if (failure) throw failure;
        return result;
      });
    },
  } as unknown as Firestore;
  return { db, persisted, calls: () => calls, fail: (error?: unknown, atCommit = false) => { failure = error; afterWork = atCommit; } };
}
async function isolated(work: (file: string) => Promise<void>) {
  const cwd = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudaflow-authority-'));
  process.chdir(dir);
  try { await work(path.join(dir, '.data', 'sudaflow_server_store.json')); }
  finally { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
}
const owner: Actor = { uid: 'authority-owner', email: 'owner@example.test', emailVerified: true };
const admin: Actor = { uid: 'authority-admin', email: 'admin@example.test', emailVerified: true, superAdmin: true };

for (const [code, message] of [
  [7, 'permission denied'], ['permission_denied', 'Missing or insufficient permissions'],
  [16, 'unauthenticated'], ['unauthenticated', 'unauthenticated'],
  ['app/invalid-credential', 'invalid credential'], ['unknown', 'Could not load the default credentials'],
]) test(`server authority never acknowledges a local write for ${code}: ${message}`, async () => isolated(async file => {
  const r = remote(), store = new ResilientStore(r.db), error = Object.assign(new Error(String(message)), { code });
  r.fail(error);
  await assert.rejects(new Organizations(store).create(owner, 'شركة اصطناعية', INITIAL_SETTINGS, 'register', true), e => e === error);
  assert.equal(r.calls(), 1); assert.deepEqual(r.persisted.dump(), {}); assert.equal(fs.existsSync(file), false);
}));

test('a failed cloud commit rolls back and the same registration retries remotely once', async () => isolated(async file => {
  const r = remote(), store = new ResilientStore(r.db), organizations = new Organizations(store);
  const denied = Object.assign(new Error('permission denied at commit'), { code: 7 }); r.fail(denied, true);
  await assert.rejects(organizations.create(owner, 'شركة اصطناعية', INITIAL_SETTINGS, 'retry-register', true), e => e === denied);
  assert.deepEqual(r.persisted.dump(), {}); assert.equal(fs.existsSync(file), false);
  r.fail(); const first = await organizations.create(owner, 'شركة اصطناعية', INITIAL_SETTINGS, 'retry-register', true);
  const state = r.persisted.dump();
  assert.deepEqual(await organizations.create(owner, 'شركة اصطناعية', INITIAL_SETTINGS, 'retry-register', true), { ...first, subscriptionEndMillis: null });
  assert.deepEqual(r.persisted.dump(), state); assert.equal(r.calls(), 3);
  assert.equal(Object.keys(state).filter(p => p.startsWith('subscriptionEvents/')).length, 1);
}));

test('existing local subscription/quota/registry cannot override cloud authority after a denied read', async () => isolated(async file => {
  const root = 'organizations/org-authority-owner';
  const local = { [root]: { id: 'org-authority-owner', planId: 'Free', subscriptionStatus: 'active' }, [`${root}/meta/usage`]: { lifetimeInvoiceCount: 0 }, [`platformAdmins/${admin.uid}`]: { active: true, role: 'super_admin' } };
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(local)); const before = fs.readFileSync(file, 'utf8');
  const r = remote({ [root]: { id: 'org-authority-owner', planId: 'Professional', subscriptionStatus: 'expired' }, [`${root}/meta/usage`]: { lifetimeInvoiceCount: 100 } });
  const store = new ResilientStore(r.db), denied = Object.assign(new Error('permission denied'), { code: 7 });
  r.fail(denied); await assert.rejects(store.transaction(tx => tx.get(root)), e => e === denied);
  r.fail(); assert.equal((await store.transaction(tx => tx.get(root)))?.subscriptionStatus, 'expired');
  assert.equal((await store.transaction(tx => tx.get(`${root}/meta/usage`)))?.lifetimeInvoiceCount, 100);
  await assert.rejects(new PlatformBilling(store).assertAdmin(admin), (e: unknown) => (e as { status: number }).status === 403);
  assert.equal(fs.readFileSync(file, 'utf8'), before); assert.equal(store.authority, 'server');
}));

test('malformed local persistence cannot bootstrap an empty company or affect a healthy cloud read', async () => isolated(async file => {
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, '{broken');
  const r = remote({ 'organizations/existing': { owner_uid: owner.uid, marker: 'canonical' } });
  assert.equal((await new ResilientStore(r.db).transaction(tx => tx.get('organizations/existing')))?.marker, 'canonical');
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
}));

test('a revoked platform admin cannot use a stale local active registry', async () => isolated(async file => {
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, JSON.stringify({ [`platformAdmins/${admin.uid}`]: { active: true, role: 'super_admin' } }));
  const r = remote({ [`platformAdmins/${admin.uid}`]: { active: false, role: 'super_admin' } });
  await assert.rejects(new PlatformBilling(new ResilientStore(r.db)).assertAdmin(admin), (e: unknown) => (e as { status: number }).status === 403);
  assert.equal(r.persisted.dump()[`platformAdmins/${admin.uid}`].active, false);
}));

test('HTTP registration returns an error for remote failure and retries without false local success', async () => isolated(async file => {
  const r = remote(), denied = Object.assign(new Error('permission denied'), { code: 7 }); r.fail(denied);
  const app = express(); app.use(express.json()); app.use('/api', createApi({ operations: new Operations(new ResilientStore(r.db)), verify: async () => owner }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  const request = () => fetch(`http://127.0.0.1:${addr.port}/api/organizations`, { method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: JSON.stringify({ initial: true, name: 'شركة اصطناعية', operationId: 'http-register' }) });
  try {
    const failed = await request(); assert.equal(failed.status, 503); assert.equal(fs.existsSync(file), false); assert.deepEqual(r.persisted.dump(), {});
    r.fail(); assert.equal((await request()).status, 200); assert.ok(r.persisted.dump()['organizations/org-authority-owner']);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));

test('offline guest MemoryStore retains persistence rollback and local authority', async () => {
  let blocked = true; const guest = new MemoryStore({}, () => { if (blocked) throw Error('quota exceeded'); });
  await assert.rejects(guest.transaction(async tx => tx.set('guest/document', { marker: 'synthetic' })), /quota exceeded/);
  assert.deepEqual(guest.dump(), {}); blocked = false;
  await guest.transaction(async tx => tx.set('guest/document', { marker: 'synthetic' }));
  assert.equal(guest.dump()['guest/document'].marker, 'synthetic'); assert.equal(guest.authority, 'local');
});
