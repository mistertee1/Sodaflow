import { verifyDeployedAccountingRules } from '../server/accountingSecurity';
import { ACCOUNTING_RULES_SHA256 } from '../server/accountingRulesHash';
import { selectedFirebaseProjectId, selectedFirestoreDatabaseId } from '../server/admin';
import { deleteApp, getApps } from 'firebase-admin/app';

try {
  await verifyDeployedAccountingRules();
  console.log(JSON.stringify({ project: selectedFirebaseProjectId(), database: selectedFirestoreDatabaseId(), rules_sha256: ACCOUNTING_RULES_SHA256, verified: true }));
} catch (error) {
  // Never print SDK errors or credential details from deployment environments.
  const code = (error as { code?: unknown }).code;
  console.error(JSON.stringify({ verified: false, code: typeof code === 'string' && /^accounting_[a-z_]+$/.test(code) ? code : 'accounting_rules_verification_failed' }));
  process.exitCode = 1;
} finally {
  const app = getApps().find(value => value.name === 'sudaflow-server');
  if (app) await deleteApp(app);
}
