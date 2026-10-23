import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const argument = process.argv[2];
if (!['--enable', '--pause'].includes(argument)) throw new Error('Use --enable or --pause, then review, test and publish API/frontend and Rules together.');
const enabled = argument === '--enable';
const path = 'firestore.rules';
const rules = readFileSync(path, 'utf8');
const pattern = /function platformControlsEnabled\(\) \{ return (true|false); \}/g;
if ([...rules.matchAll(pattern)].length !== 1) throw new Error('Expected exactly one platform controls Rules switch.');
writeFileSync('src/config/platform-controls.json', JSON.stringify({ enabled }, null, 2) + '\n');
writeFileSync(path, rules.replace(pattern, `function platformControlsEnabled() { return ${enabled}; }`));
execFileSync(process.execPath, ['scripts/accounting-rules-hash.mjs'], { stdio: 'inherit' });
console.log(`Platform controls ${enabled ? 'enabled' : 'paused'} in source only. Review, test and publish API/frontend and Rules together; this command does not deploy or migrate data.`);
