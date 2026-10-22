import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { applyJwksRuntimePatch } from './patch-jwks-runtime.mjs';

// firebase-admin 14 requires a supported Node22/24 runtime.
export function assertNetlifyRuntime({
  nodeVersion = process.versions.node,
  lambdaRuntime = process.env.AWS_LAMBDA_JS_RUNTIME,
} = {}) {
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (!((major === 22 && minor >= 12) || major >= 24)) {
    throw new Error('Firebase requires Node22.12+ or Node24+. Use the repository Netlify NODE_VERSION=24 setting and rebuild.');
  }
  const runtime = lambdaRuntime?.trim();
  if (runtime && !['nodejs22.x', 'nodejs24.x'].includes(runtime)) {
    throw new Error('AWS_LAMBDA_JS_RUNTIME overrides the build runtime. Remove the old override or set nodejs24.x in Netlify, then rebuild.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertNetlifyRuntime();
  // Also cover installs with lifecycle scripts disabled, before Netlify packages files.
  await applyJwksRuntimePatch();
  // Use Lambda's actual restrictions, rather than the build machine's defaults.
  const result = spawnSync(process.execPath, ['--no-experimental-require-module',
    '--no-experimental-detect-module', '--input-type=module', '-e', "await import('firebase-admin/auth');"],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 15000 });
  if (result.error || result.status !== 0) {
    throw new Error('Netlify Firebase startup failed under Lambda module restrictions. ' + (result.error?.message || result.stderr));
  }
  console.log('Netlify Firebase runtime preflight passed on Node ' + process.versions.node + '.');
}
