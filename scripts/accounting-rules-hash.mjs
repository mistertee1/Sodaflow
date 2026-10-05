import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const hash = createHash('sha256').update(readFileSync('firestore.rules', 'utf8').replace(/\r\n/g, '\n').trim()).digest('hex');
const path = 'server/accountingRulesHash.ts';
const expected = `/** Generated from reviewed firestore.rules. Run node scripts/accounting-rules-hash.mjs after a rules change. */\nexport const ACCOUNTING_RULES_SHA256 = '${hash}';\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== expected) throw new Error('Rules fingerprint is stale. Regenerate and review it alongside firestore.rules.');
} else writeFileSync(path, expected);
