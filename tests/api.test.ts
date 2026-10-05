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

test('authentication outages are distinct from invalid sessions', async () => {
  const { isInvalidSession } = await import('../server/authErrors');
  assert.equal(isInvalidSession({ code: 'auth/id-token-expired' }), true);
  assert.equal(isInvalidSession({ code: 'auth/id-token-revoked' }), true);
  assert.equal(isInvalidSession({ code: 'app/invalid-credential' }), false);
  assert.equal(isInvalidSession({ code: 'auth/internal-error' }), false);
  assert.equal(isInvalidSession(new Error('missing service-account JSON')), false);
});

test('unverified accounts cannot provision organizations; verified owners start active', async () => {
  const store = new MemoryStore();
  const actor = { uid: 'new-owner', email: 'new@example.com', emailVerified: false };
  await assert.rejects(new Organizations(store).create(actor, 'shop', INITIAL_SETTINGS, 'initial', true));
  assert.deepEqual(store.dump(), {});
  const org = await new Organizations(store).create({ ...actor, emailVerified: true }, 'shop', INITIAL_SETTINGS, 'initial', true);
  assert.equal(org.status, 'active');
  const member = store.dump()[`organizations/${org.id}/members/${actor.uid}`];
  assert.equal(member.role, 'Owner');
  assert.equal(member.status, 'active');
});

test('Netlify missing credentials returns a service outage instead of invalid session', async () => {
  const previousNetlify = process.env.NETLIFY;
  const previousCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  process.env.NETLIFY = 'true';
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    const response = await invokeNetlify('/api/organizations', { authorization: 'Bearer token' });
    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).code, 'firebase_configuration_missing');
  } finally {
    if (previousNetlify === undefined) delete process.env.NETLIFY; else process.env.NETLIFY = previousNetlify;
    if (previousCredential === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON; else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousCredential;
  }
});

test('stale server project overrides fail as configuration errors before session verification', async () => {
  const { selectedFirebaseProjectId } = await import('../server/admin');
  const { authenticationFailure } = await import('../server/authErrors');
  const { BusinessError } = await import('../src/domain/validation');
  const config = (await import('../firebase-applet-config.json')).default;
  const previous = process.env.FIREBASE_PROJECT_ID;
  try {
    process.env.FIREBASE_PROJECT_ID = 'obsolete-project';
    assert.throws(selectedFirebaseProjectId, error => error instanceof BusinessError && error.status === 503 && error.code === 'firebase_project_mismatch');
    const failure = authenticationFailure(new BusinessError('wrong project', 503, 'firebase_project_mismatch'));
    assert.equal(failure.status, 503);
    assert.equal(failure.code, 'firebase_project_mismatch');
    process.env.FIREBASE_PROJECT_ID = ' ' + config.projectId + ' ';
    assert.equal(selectedFirebaseProjectId(), config.projectId);
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = previous;
  }
});

test('readiness checks actual read access without writing data or exposing credentials', async () => {
  const { inspectFirebaseReadiness } = await import('../server/readiness');
  const calls: string[] = [];
  const services = {
    app: { options: { credential: { getAccessToken: async () => { calls.push('credential'); return { access_token: 'DO-NOT-EXPOSE' }; } } } },
    db: { doc: (path: string) => ({ get: async () => { calls.push(path); return { data: 'DO-NOT-EXPOSE' }; } }) },
    bucket: { getMetadata: async () => { calls.push('bucket'); return { privateMetadata: 'DO-NOT-EXPOSE' }; } },
  };
  const ready = await inspectFirebaseReadiness(() => services);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.checks.firestore?.status, 'ready');
  assert.equal(ready.checks.storage?.status, 'ready');
  assert.deepEqual(calls.sort(), ['_health/readiness', 'bucket', 'credential']);
  assert.equal(JSON.stringify(ready).includes('DO-NOT-EXPOSE'), false);

  const unavailable = await inspectFirebaseReadiness(() => ({ ...services, db: { doc: () => ({ get: async () => { throw { code: 5 }; } }) } }));
  assert.equal(unavailable.status, 'error');
  assert.equal(unavailable.checks.firestore?.code, 'firestore_database_missing');
  assert.equal(unavailable.checks.storage?.status, 'ready');

  const missingBucket = await inspectFirebaseReadiness(() => ({ ...services, bucket: { getMetadata: async () => { throw { code: 404 }; } } }));
  assert.equal(missingBucket.status, 'degraded');
  assert.equal(missingBucket.checks.firestore?.status, 'ready');
  assert.equal(missingBucket.checks.storage?.code, 'storage_bucket_missing');

  const badCredential = await inspectFirebaseReadiness(() => ({ ...services, app: { options: { credential: { getAccessToken: async () => { throw { code: 'app/invalid-credential' }; } } } } }));
  assert.equal(badCredential.checks.firebase.code, 'firebase_credentials_invalid');
  assert.equal(badCredential.checks.firestore, undefined);
});

test('Netlify readiness refuses to report success for a missing service account', async () => {
  const previousNetlify = process.env.NETLIFY;
  const previousCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  process.env.NETLIFY = 'true';
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    const response = await invokeNetlify('/api/health/ready');
    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).checks.firebase.code, 'firebase_configuration_missing');
  } finally {
    if (previousNetlify === undefined) delete process.env.NETLIFY; else process.env.NETLIFY = previousNetlify;
    if (previousCredential === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON; else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousCredential;
  }
});

async function invokeNetlify(path: string, headers?: Record<string, string>) {
  const { default: handle } = await import('../netlify/functions/api');
  const response = await handle(new Request('https://sodaflow.netlify.app' + path, { headers }), { ip: '127.0.0.1' } as import('@netlify/functions').Context);
  return { statusCode: response.status, body: await response.text() };
}

test('A2 HTTP rejects unverified deployed rules and confirms cost once with the same authenticated retry ID', async () => {
  const { readFile } = await import('node:fs/promises');
  const { verifyAccountingRulesSource } = await import('../server/accountingSecurity');
  const store = new MemoryStore(), actor = { uid: 'cost-api', email: 'cost-api@example.com', emailVerified: true };
  const org = await new Organizations(store).create(actor, 'تكلفة API', INITIAL_SETTINGS, 'setup', true);
  const product = (await new Operations(store).execute(org.id, actor, { action: 'product.create', operationId: 'product', data: { name: 'منتج', unit: 'قطعة', price_sdg: 100, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: 10 } })).result;
  const before = store.dump(), rules = await readFile('firestore.rules', 'utf8'); let verified = false;
  const serverStore: import('../src/domain/store').Store = { authority: 'server', transaction: work => store.transaction(work) };
  const operations = new Operations(serverStore, undefined, undefined, async () => verifyAccountingRulesSource([{ content: verified ? rules : 'unreviewed rules' }]));
  const app = express(); app.use(express.json()); app.use('/api', createApi({ operations, verify: async () => actor }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/organizations/${org.id}/operations`;
    const body = JSON.stringify({ action: 'product.cost.establish', operationId: 'cost-proof', data: { id: product.id, unit_cost_sdg: 100, unit_cost_usd: 1, reason: 'وثيقة اختبار' } });
    const send = () => fetch(url, { method: 'POST', headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' }, body });
    const blocked = await send(); assert.equal(blocked.status, 503); assert.equal((await blocked.json()).code, 'accounting_rules_not_deployed'); assert.deepEqual(store.dump(), before);
    verified = true; const accepted = await send(); assert.equal(accepted.status, 200); const result = await accepted.json();
    const retry = await send(); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), result);
    assert.equal(Object.entries(store.dump()).filter(([path]) => path.includes('/journal_entries/jv-cost-')).length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
