import express from 'express';
import assert from 'node:assert/strict';
import { createApi } from '../../server/api';
import { Organizations } from '../../server/organizations';
import { PlatformBilling } from '../../server/platformBilling';
import { Operations, type Actor } from '../../src/domain/operations';
import { MemoryStore } from '../../src/domain/store';
import { INITIAL_SETTINGS } from '../../src/data/initialData';

export async function platformFixture(persist?: (data: Record<string, Record<string, unknown>>) => void) {
  const owner: Actor = { uid: 'company-owner', email: 'owner@example.test', emailVerified: true };
  const admin: Actor = { uid: 'platform-admin', email: 'admin@example.test', emailVerified: true, superAdmin: true };
  const store = new MemoryStore({}, persist);
  const organizations = new Organizations(store);
  const org = await organizations.create(owner, 'شركة اختبار', INITIAL_SETTINGS, 'initial', true);
  // Trusted test setup, never an actual Auth claim or production registry write.
  await store.transaction(async tx => tx.set(`platformAdmins/${admin.uid}`, { active: true, role: 'super_admin' }));
  const operations = new Operations(store);
  return { owner, admin, org, store, operations, organizations, platform: new PlatformBilling(store) };
}

export async function servePlatform(fixture: Awaited<ReturnType<typeof platformFixture>>, actors: Record<string, Actor> = { owner: fixture.owner, admin: fixture.admin }) {
  const app = express();
  app.use(express.json());
  app.use('/api', createApi({ operations: fixture.operations, verify: async token => {
    if (!actors[token]) throw new Error('Invalid test token');
    return actors[token];
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  return {
    request: (path: string, token: string, body?: unknown) => fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
