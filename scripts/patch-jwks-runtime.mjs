import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const patches = {
  'src/utils.js': {
    original: 'c535773fd798202296e846e7c057f96f631148686194ff2990f0729fa4c1b7af',
    patched: 'f1ffe481947f3de681f1b37418208dab0968bbbd20eb12a544b5276642f6c9e2',
    convert: source => source.replace("const jose = require('jose');\n", '')
      .replace('async function retrieveSigningKeys(jwks) {\n', "async function retrieveSigningKeys(jwks) {\n  const jose = await import('jose');\n"),
  },
  'src/integrations/passport.js': {
    original: '03557fac70296dda6d19872b1702d2b8f1d4c50d22d3fbcf1fb65f9afa7ddcbb',
    patched: '6f071bedf7fb3477670bf2c9bf98944010a0bcd88b269899a064835f8ef8920e',
    convert: source => source.replace("const jose = require('jose');\n", '')
      .replace('return function secretProvider(req, rawJwtToken, cb) {', 'return async function secretProvider(req, rawJwtToken, cb) {')
      .replace('    try {\n', "    try {\n      const jose = await import('jose');\n"),
  },
};

// jwks-rsa 4.1.0 imports jose6 with require(), disabled by the Lambda runtime.
// Move both import sites into async key conversion / the callback secret provider.
// Refuse unknown versions/bytes; an SDK update must explicitly review this patch.
export function patchJwksSource(source, version, file = 'src/utils.js') {
  if (version !== '4.1.0') throw new Error('Review the Netlify jwks-rsa compatibility patch before updating this dependency.');
  const patch = patches[file], before = hash(source);
  if (!patch) throw new Error('Unknown jwks-rsa patch target.');
  if (before === patch.patched) return source;
  if (before !== patch.original) throw new Error('Unexpected jwks-rsa source; refusing to modify an unreviewed dependency.');
  const patched = patch.convert(source);
  if (hash(patched) !== patch.patched) throw new Error('The jwks-rsa compatibility patch failed verification.');
  return patched;
}

export async function applyJwksRuntimePatch() {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('jwks-rsa/package.json'));
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  // Validate every file before writing any file.
  const changes = await Promise.all(Object.keys(patches).map(async file => {
    const path = join(root, file), source = await readFile(path, 'utf8');
    return { path, source, patched: patchJwksSource(source, version, file) };
  }));
  for (const { path, source, patched } of changes) if (source !== patched) await writeFile(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await applyJwksRuntimePatch();
  console.log('Verified jwks-rsa async ESM compatibility patch.');
}
