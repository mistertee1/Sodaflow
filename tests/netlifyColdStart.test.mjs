import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let api, directory;
before(async () => {
  // No production credential, bearer token or database write is used by this suite.
  for (const name of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PROJECT_ID', 'FIRESTORE_DATABASE_ID']) delete process.env[name];
  process.env.NETLIFY = 'true';
  const cache = resolve('node_modules/.cache');
  await mkdir(cache, { recursive: true });
  directory = await mkdtemp(join(cache, 'sudaflow-netlify-'));
  const outfile = join(directory, 'api.mjs');
  // Keep the same external SDK boundaries used by Netlify; do not stub Firebase imports.
  await build({ entryPoints: [resolve('netlify/functions/api.ts')], outfile, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', target: 'node22', logLevel: 'silent' });
  api = (await import(pathToFileURL(outfile).href)).default;
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function request(path, init) {
  return api(new Request('https://synthetic.invalid' + path, init), { ip: '127.0.0.1' });
}
async function json(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

test('the bundled Netlify function cold-starts and serves JSON health without Firebase credentials', async () => {
  const body = await json(await request('/api/health'), 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.app, 'SudaFlow');
});

test('the Netlify function preserves HEAD semantics', async () => {
  const response = await request('/api/health', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('the Netlify function rejects anonymous company discovery with JSON401', async () => {
  const body = await json(await request('/api/organizations'), 401);
  assert.equal(typeof body.error, 'string');
});

test('the Netlify function rejects anonymous Super Admin access with JSON401', async () => {
  const body = await json(await request('/api/super-admin/session'), 401);
  assert.equal(typeof body.error, 'string');
});

test('the Netlify function rejects an anonymous financial request without a database write', async () => {
  await json(await request('/api/organizations/synthetic-org/operations', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'invoice.create', operationId: 'synthetic-not-authorized', data: {} }) }), 401);
});

test('missing runtime credentials produce a structured readiness503 after successful startup', async () => {
  const body = await json(await request('/api/health/ready'), 503);
  assert.equal(body.checks.firebase.code, 'firebase_configuration_missing');
});
