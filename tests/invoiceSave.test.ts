import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApi } from '../server/api';
import { MemoryStore } from '../src/domain/store';
import { invoiceSaveFixture, assertSavedInvoice } from './helpers/invoiceSave';

test('reported invoice saves without optional dimensions and retries preserve one invoice, movement, balanced journal and customer debt', async () => {
  const f = await invoiceSaveFixture(), data = f.input();
  const sale = await f.run('invoice.create', data, 'reported-invoice');
  assert.deepEqual(await f.run('invoice.create', data, 'reported-invoice'), sale);
  const { snapshot } = await assertSavedInvoice(f, sale.result.id);
  const entry = snapshot.collections.journal_entries.find(row => row.reference_id === sale.result.id)!;
  assert.ok(entry.lines.every((line: Record<string, unknown>) => !line.branch_id && !line.cost_center_id && !line.project_id));
});

test('invoice dimension tags reach every journal line; missing, inactive and foreign tenant tags reject the whole invoice atomically', async () => {
  const f = await invoiceSaveFixture();
  await f.store.transaction(async tx => {
    for (const [collection, kind, id, org_id, status] of [['branches', 'branch', 'main-shop', f.org.id, 'active'], ['cost_centers', 'cost_center', 'retail', f.org.id, 'active'], ['projects', 'project', 'launch', f.org.id, 'active'], ['branches', 'branch', 'inactive', f.org.id, 'inactive'], ['branches', 'branch', 'foreign', 'another-tenant', 'active']]) tx.set(`${f.root}/${collection}/${id}`, { id, kind, org_id, status });
  });
  for (const branch_id of ['absent', 'inactive', 'foreign']) {
    const before = (f.store as MemoryStore).dump();
    await assert.rejects(f.run('invoice.create', { ...f.input(), branch_id }, `invalid-${branch_id}`));
    assert.deepEqual((f.store as MemoryStore).dump(), before);
  }
  const tags = { branch_id: 'main-shop', cost_center_id: 'retail', project_id: 'launch' };
  const sale = await f.run('invoice.create', { ...f.input(), ...tags }, 'tagged-invoice');
  const { snapshot } = await assertSavedInvoice(f, sale.result.id);
  for (const line of snapshot.collections.journal_entries.find(row => row.reference_id === sale.result.id)!.lines) for (const [key, value] of Object.entries(tags)) assert.equal(line[key], value);
});

test('invoice HTTP persistence failure returns 503 with no partial writes; same operation retry succeeds once and foreign identities stay denied', async () => {
  let fail = false;
  const store = new MemoryStore({}, () => { if (fail) throw Object.assign(Error('Synthetic persistence outage'), { code: 14 }); });
  const f = await invoiceSaveFixture(store), before = store.dump();
  const app = express(); app.use(express.json());
  app.use('/api', createApi({ operations: f.ops, verify: async token => token === 'owner' ? f.actor : token === 'outsider' ? { ...f.actor, uid: 'outsider' } : Promise.reject(Error('invalid synthetic identity')) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/organizations/${f.org.id}/operations`;
  const send = (token = 'owner') => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invoice.create', operationId: 'http-invoice', data: f.input() }) });
  try {
    assert.equal((await send('invalid')).status, 401);
    assert.equal((await send('outsider')).status, 403);
    fail = true; const failed = await send(); assert.equal(failed.status, 503); assert.equal((await failed.json()).code, 'service_unavailable'); assert.deepEqual(store.dump(), before);
    fail = false; const saved = await send(); assert.equal(saved.status, 200); const response = await saved.json();
    const replay = await send(); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), response);
    await assertSavedInvoice(f, response.result.id);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('concurrent invoices still cannot sell the same remaining inventory twice', async () => {
  const f = await invoiceSaveFixture(), data = f.input(49);
  const results = await Promise.allSettled([f.run('invoice.create', data, 'race-a'), f.run('invoice.create', data, 'race-b')]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  const snapshot = await f.snapshot(); assert.equal(snapshot.collections.invoices.length, 1); assert.equal(snapshot.collections.products[0].stock_quantity, 1);
});
