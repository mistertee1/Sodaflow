import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApi } from '../server/api';
import { MemoryStore } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';

test('HTTP API rejects missing/invalid identity, validates empty journal and never reports write failure as success', async () => {
  const actor = { uid: 'owner', email: 'owner@example.com', emailVerified: true }, store = new MemoryStore();
  const org = await new Organizations(store).create(actor, 'test', INITIAL_SETTINGS, 'setup', true);
  const app = express(); app.use(express.json()); app.use('/api', createApi({ operations: new Operations(store), verify: async token => { if (token !== 'valid') throw new Error('invalid'); return actor; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    assert.equal((await fetch(`${base}/organizations`)).status, 401);
    assert.equal((await fetch(`${base}/organizations`, { headers: { Authorization: 'Bearer forged' } })).status, 401);
    const invalid = await fetch(`${base}/accounting/validate-entry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [{}, {}] }) }); assert.equal(invalid.status, 400);
    const write = await fetch(`${base}/organizations/${org.id}/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid' }, body: JSON.stringify({ action: 'invoice.create', operationId: 'bad', data: { customer_id: 'missing', issue_date: '2026-10-01' } }) }); assert.equal(write.status, 400); assert.ok((await write.json()).error); assert.equal(Object.keys(store.dump()).some(p => p.includes('/invoices/')), false);
    const protectedRead = await fetch(`${base}/organizations/org-foreign/snapshot`, { headers: { Authorization: 'Bearer valid' } }); assert.equal(protectedRead.status, 403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('contact form only acknowledges committed messages; retry is once and persistence failure is an error', async () => {
  for (const fail of [false, true]) {
    const store = new MemoryStore({}, fail ? () => { throw new Error('storage unavailable'); } : undefined);
    const app = express(); app.use(express.json()); app.use('/api', createApi({ operations: new Operations(store), verify: async () => { throw new Error('unauthenticated'); } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/contact-messages`;
    const send = (message: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: 'message', name: 'test', email: 'test@example.com', subject: 'help', message }) });
    try {
      const response = await send('save me'); assert.equal(response.status, fail ? 503 : 201);
      const result = await response.json();
      if (fail) { assert.equal(result.saved, undefined); assert.deepEqual(store.dump(), {}); }
      else { assert.equal(result.saved, true); assert.equal((await send('save me')).status, 201); assert.equal((await send('different')).status, 409); assert.equal(Object.keys(store.dump()).filter(key => key.startsWith('contact_messages/')).length, 1); }
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }
});
