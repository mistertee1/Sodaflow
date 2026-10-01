import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { adminServices } from '../server/admin';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { financialCollections, reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { ensure, identifier } from '../src/domain/validation';

const [mode, input] = process.argv.slice(2);
ensure(['--backup', '--org'].includes(mode) && input, 'Usage: node --import tsx scripts/audit-financial-data.ts --backup FILE.json | --org ORG_ID');
let snapshot;
if (mode === '--backup') snapshot = JSON.parse(await readFile(input, 'utf8'));
else {
  const orgId = identifier(input), { db } = adminServices();
  snapshot = await db.runTransaction(async tx => {
    const org = await tx.get(db.doc(`organizations/${orgId}`)); ensure(org.exists, 'Organization does not exist.');
    const collections: Record<string, unknown[]> = {};
    for (const name of financialCollections) collections[name] = (await tx.get(db.collection(`organizations/${orgId}/${name}`))).docs.map(row => row.data());
    return { settings: org.data()!.settings, collections };
  }, { readOnly: true });
}
ensure(snapshot && financialCollections.every(name => Array.isArray(snapshot.collections?.[name])), 'Backup is missing financial collections.');
const findings = reconcileFinancialData(snapshot.collections as FinancialData, { ...INITIAL_SETTINGS, ...snapshot.settings });
// IDs and amounts only. No customer names, emails or phone numbers are included in the report.
console.log(JSON.stringify({ read_only: true, generated_at: new Date().toISOString(), findings_count: findings.length, findings }, null, 2));
if (findings.length) process.exitCode = 2;
