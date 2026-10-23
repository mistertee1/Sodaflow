import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import jwksClient from 'jwks-rsa';
import { applyJwksRuntimePatch, patchJwksSource } from '../scripts/patch-jwks-runtime.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-rsa', use: 'sig', alg: 'RS256' };
const client = keys => jwksClient({ jwksUri: 'https://synthetic.invalid/jwks', cache: false, fetcher: async () => ({ keys }) });

test('patched JWKS resolves a real synthetic RSA signing key while Lambda require(esm) is disabled', async () => {
  assert.equal(process.features.require_module, false);
  const key = await client([jwk]).getSigningKey(jwk.kid);
  const payload = Buffer.from('synthetic signing input');
  const signature = sign('RSA-SHA256', payload, privateKey);
  assert.equal(verify('RSA-SHA256', payload, key.getPublicKey(), signature), true);
  assert.equal(verify('RSA-SHA256', Buffer.from('tampered signing input'), key.getPublicKey(), signature), false);
});

test('patched JWKS still rejects unknown identifiers and symmetric keys as signing public keys', async () => {
  await assert.rejects(client([jwk]).getSigningKey('unknown'), { name: 'SigningKeyNotFoundError' });
  await assert.rejects(client([{ kty: 'oct', k: 'c3ludGhldGljLWtleQ', kid: jwk.kid, use: 'sig', alg: 'HS256' }]).getSigningKey(jwk.kid), /did not contain any signing keys/);
});

test('the callback Passport integration resolves signed tokens and rejects malformed tokens with require(esm) disabled', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'synthetic-user' })).toString('base64url');
  const input = header + '.' + payload;
  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey);
  const token = input + '.' + signature.toString('base64url');
  const provider = jwksClient.passportJwtSecret({ jwksUri: 'https://synthetic.invalid/jwks', cache: false, fetcher: async () => ({ keys: [jwk] }) });
  const resolveKey = value => new Promise((resolve, reject) => provider(null, value, (error, key) => error ? reject(error) : resolve(key)));
  assert.equal(verify('RSA-SHA256', Buffer.from(input), await resolveKey(token), signature), true);
  assert.equal(await resolveKey('invalid-token'), null);
});

test('repeated installation preserves the already reviewed compatibility bytes', async () => {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('jwks-rsa/package.json'));
  const paths = ['src/utils.js', 'src/integrations/passport.js'].map(file => join(root, file));
  const before = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  await applyJwksRuntimePatch();
  assert.deepEqual(await Promise.all(paths.map(path => readFile(path, 'utf8'))), before);
});

test('the compatibility patch refuses changed dependency versions or unknown source bytes', async () => {
  const require = createRequire(import.meta.url);
  const path = join(dirname(require.resolve('jwks-rsa/package.json')), 'src/utils.js');
  const before = await readFile(path, 'utf8');
  assert.throws(() => patchJwksSource(before, '99.0.0'), /Review the Netlify/);
  assert.throws(() => patchJwksSource(before + '// unexpected mutation', '4.1.0'), /Unexpected jwks-rsa source/);
  assert.equal(await readFile(path, 'utf8'), before);
});
