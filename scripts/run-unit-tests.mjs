import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Discover the complete top-level unit/API suite so a merged feature cannot
// silently lose its regression checks. Firestore suites require test:emulator.
const directory = new URL('../tests/', import.meta.url);
const files = readdirSync(directory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.ts') && !/firestore/i.test(entry.name))
  .map(entry => fileURLToPath(new URL(entry.name, directory)))
  .sort();
if (!files.length) throw new Error('No unit/API test files found.');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status ?? 1;
