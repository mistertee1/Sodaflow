import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

for (const key of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'BILLING_SIGNING_SECRET']) {
  assert.ok(!process.env[key], `Acceptance must not receive ${key}`);
}
// Rewrite only the isolated build image's configuration, never the GitHub source.
const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
Object.assign(config, { projectId: 'demo-sudaflow', authDomain: 'demo-sudaflow.firebaseapp.com', apiKey: 'demo-sudaflow-test-key', appId: 'demo-sudaflow', storageBucket: 'demo-sudaflow.appspot.com', messagingSenderId: '000', firestoreDatabaseId: '(default)' });
fs.writeFileSync('firebase-applet-config.json', JSON.stringify(config, null, 2) + '\n');
const directory = '.render-acceptance'; fs.mkdirSync(directory, { recursive: true });
const summary = { schemaVersion: 1, sourceCommit: process.env.RENDER_GIT_COMMIT || null, provider: 'Render', startedAt: new Date().toISOString(), projectId: 'demo-sudaflow', productionWrites: 0, status: 'running', checks: [] };
async function run(name, command, args, extraEnv = {}) {
  console.log(`ACCEPTANCE START ${name}`);
  const started = Date.now();
  const child = spawn(command, args, { env: { ...process.env, CI: 'true', GCLOUD_PROJECT: 'demo-sudaflow', GOOGLE_CLOUD_PROJECT: 'demo-sudaflow', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; const collect = chunk => { const text = chunk.toString(); output += text; process.stdout.write(text); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
  const counts = {};
  for (const match of plain.matchAll(/(?:#|ℹ)\s*(tests|pass|fail|skipped|cancelled)\s+(\d+)/g)) counts[match[1]] = Number(match[2]);
  const check = { name, command: [command, ...args].join(' '), exitCode, durationMs: Date.now() - started, counts, status: exitCode === 0 ? 'passed' : 'failed' };
  summary.checks.push(check); fs.writeFileSync(path.join(directory, `${name}.log`), output);
  console.log(`ACCEPTANCE END ${name} ${JSON.stringify(check)}`);
  return check;
}

try {
  // A real red/green proof: run the new guard tests against the pinned pre-fix
  // implementation, then always restore the proposed code before acceptance.
  const baseline = 'docs/super-admin/fixtures/resilientStore.pre-authority.ts.txt';
  const file = 'server/resilientStore.ts', proposed = fs.readFileSync(file, 'utf8');
  let red;
  try {
    fs.writeFileSync(file, fs.readFileSync(baseline, 'utf8'));
    red = await run('authority-baseline', 'node', ['--import', 'tsx', '--test', 'tests/serverAuthority.test.ts']);
  } finally { fs.writeFileSync(file, proposed); }
  assert.ok(red.exitCode !== 0 && red.counts.fail > 0, 'Pre-fix baseline must reproduce authority failures');

  for (const [name, args] of [
    ['types', ['run', 'lint']], ['core', ['run', 'lint:core']],
    ['unit-api', ['test']], ['build', ['run', 'build']],
    ['firestore-emulator', ['run', 'test:emulator']],
    ['production-audit', ['audit', '--omit=dev', '--audit-level=high']],
  ]) {
    const check = await run(name, 'npm', args, name === 'build' ? { NODE_ENV: 'production' } : {});
    assert.equal(check.exitCode, 0, `${name} failed; no acceptance image may be published`);
    if (['unit-api', 'firestore-emulator'].includes(name)) {
      assert.ok(check.counts.tests > 0 && check.counts.pass === check.counts.tests && check.counts.fail === 0, `${name} has no complete behavioral pass evidence`);
    }
  }
  const mode = await run('browser-build-mode', 'node', ['--input-type=module', '-e', "import assert from 'node:assert/strict'; import {resolveConfig} from 'vite'; const config=await resolveConfig({},'build'); console.log(JSON.stringify({mode:config.mode,isProduction:config.isProduction,nodeEnv:process.env.NODE_ENV})); assert.equal(config.isProduction,true);"], { NODE_ENV: 'production' });
  assert.equal(mode.exitCode, 0, 'Browser acceptance must match production compilation');
  summary.browserBuildEnvironment = 'production';
  const uiPath = path.resolve(directory, 'ui.json');
  const ui = await run('ui-regression', 'node', ['--import', 'tsx', 'node_modules/@playwright/test/cli.js', 'test', '--reporter=list,json'], { PLAYWRIGHT_JSON_OUTPUT_NAME: uiPath });
  const result = JSON.parse(fs.readFileSync(uiPath, 'utf8')), cases = [];
  function walk(suites, parents = []) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) for (const test of spec.tests || []) cases.push({ file: spec.file || suite.file, title: [...parents, spec.title].filter(Boolean).join(' / '), status: test.status });
      walk(suite.suites, [...parents, suite.title]);
    }
  }
  walk(result.suites);
  const sa = cases.filter(c => c.file?.endsWith('super-admin.spec.ts'));
  ui.counts = { tests: cases.length, pass: cases.filter(c => c.status === 'expected').length, fail: cases.filter(c => c.status === 'unexpected').length, skipped: cases.filter(c => c.status === 'skipped').length };
  summary.superAdminUi = { tests: sa.length, passed: sa.filter(c => c.status === 'expected').length, failed: sa.filter(c => c.status === 'unexpected').length, skipped: sa.filter(c => c.status === 'skipped').length };
  summary.uiFailures = cases.filter(c => c.status !== 'expected');
  assert.equal(sa.length, 9, 'All nine Super Admin UI scenarios must execute');
  assert.ok(sa.every(c => c.status === 'expected'), 'Super Admin UI failed or skipped');
  summary.status = ui.exitCode === 0 ? 'scope_passed_regression_passed' : 'scope_passed_regression_blocked';
  // A report-only service may publish incomplete regression evidence, never ERP.
  summary.productionReady = false;
} catch (error) {
  summary.status = 'failed'; summary.error = String(error);
  process.exitCode = 1;
} finally {
  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`ACCEPTANCE SUMMARY ${JSON.stringify(summary)}`);
}
