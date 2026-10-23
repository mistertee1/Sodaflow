import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNetlifyRuntime } from '../scripts/check-netlify-runtime.mjs';

test('Netlify accepts supported build and function runtimes', () => {
  for (const nodeVersion of ['22.12.0', '22.16.0', '24.0.0']) {
    for (const lambdaRuntime of [undefined, '', 'nodejs22.x', 'nodejs24.x']) {
      assert.doesNotThrow(() => assertNetlifyRuntime({ nodeVersion, lambdaRuntime }));
    }
  }
});

test('Netlify rejects legacy Node builds before a broken Firebase function is deployed', () => {
  for (const nodeVersion of ['18.20.0', '20.18.0', '20.19.0', '22.11.0']) {
    assert.throws(() => assertNetlifyRuntime({ nodeVersion }), /Firebase requires Node/);
  }
});

test('Netlify rejects an old function runtime override even when the build uses Node24', () => {
  for (const lambdaRuntime of ['nodejs18.x', 'nodejs20.x', 'invalid']) {
    assert.throws(() => assertNetlifyRuntime({ nodeVersion: '24.0.0', lambdaRuntime }), /AWS_LAMBDA_JS_RUNTIME/);
  }
});

