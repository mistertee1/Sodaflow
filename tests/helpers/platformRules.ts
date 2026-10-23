import { readFile } from 'node:fs/promises';

/** Keep the archived restrictive policy tested without changing the shipped paused rules. */
export async function strictPlatformRules() {
  const rules = await readFile('firestore.rules', 'utf8');
  const pattern = /function platformControlsEnabled\(\) \{ return (true|false); \}/g;
  if ([...rules.matchAll(pattern)].length !== 1) throw new Error('Expected one reviewed platform policy switch.');
  return rules.replace(pattern, 'function platformControlsEnabled() { return true; }');
}
