import type { Document, Transaction } from './store';
import { clean } from './store';
import { BusinessError, identifier } from './validation';
import { largeImportStagingSha256, sameLargeImportRecord } from './largeImportEvidence';

const proof: (condition: unknown) => asserts condition = condition => {
  if (!condition) throw new BusinessError('تعذر التحقق من أدلة جلسة الاستيراد أو نتيجة اعتمادها؛ لا تكرر الترحيل. راجع سجل التدقيق.', 409, 'historical_recovery_inconsistent');
};
const fields = (value: Document, names: string[]) => Object.fromEntries(names.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const sources = [
  ['journal_entries', 'commit_journal_ids', 'journals_created'], ['invoices', 'commit_invoice_ids', 'invoices_created'],
  ['payments', 'commit_payment_ids', 'payments_created'], ['purchase_bills', 'commit_purchase_bill_ids', 'purchase_bills_created'],
  ['supplier_payments', 'commit_supplier_payment_ids', 'supplier_payments_created'], ['inventory_movements', 'commit_inventory_movement_ids', 'inventory_movements_created'],
] as const;
export interface HistoricalImportRecoveryResult {
  org_id: string;
  recovered_at: string;
  session: Document;
  requires_fresh_review: boolean;
  receipt: (Document & { operation_id: string; review_sha256: string | null; review_status: 'verified' | 'legacy_without_review_evidence' }) | null;
}

/** Read-only recovery. It never regenerates approval evidence or replays a command. */
export async function readHistoricalImportRecovery(tx: Transaction, orgId: string, sessionId: string, now: string): Promise<HistoricalImportRecoveryResult> {
  const root = `organizations/${orgId}`, session = await tx.get(`${root}/historical_import_sessions/${sessionId}`);
  if (!session) throw new BusinessError('جلسة الاستيراد غير موجودة في هذه المؤسسة.', 404);
  proof(session.id === sessionId && session.org_id === orgId && session.schema_version === 1);
  proof(['staged', 'staged_accounting_block', 'completed', 'completed_accounting_block'].includes(session.status));
  proof(digest(session.file_hash) && digest(session.rows_sha256) && digest(session.validation_context_sha256));
  const staging = await tx.get(`${root}/historical_import_staging/${sessionId}`);
  proof(staging && staging.id === sessionId && staging.session_id === sessionId && staging.org_id === orgId && staging.schema_version === 1);
  proof(Array.isArray(staging.rows) && staging.rows.length > 0 && staging.rows.length <= 200 && staging.rows.length === session.rows_total);
  proof(staging.validation_basis?.orgId === orgId && staging.rows_sha256 === session.rows_sha256 && staging.validation_context_sha256 === session.validation_context_sha256);
  proof(await largeImportStagingSha256(staging.rows) === session.rows_sha256);
  proof(await largeImportStagingSha256([staging.validation_basis]) === session.validation_context_sha256);
  if (session.document_evidence_sha256 !== undefined) {
    proof(digest(session.document_evidence_sha256) && staging.document_evidence_sha256 === session.document_evidence_sha256);
    proof(await largeImportStagingSha256([staging.document_evidence]) === session.document_evidence_sha256);
  } else proof(!staging.rows.some((row: Document) => ['invoice', 'purchase'].includes(row.kind)));
  const summary = fields(session, ['id', 'org_id', 'schema_version', 'file_name', 'file_hash', 'import_type', 'status', 'created_by', 'created_at', 'rows_total', 'rows_valid', 'rows_failed', 'rows_imported', 'rows_skipped', 'rows_sha256', 'validation_context_sha256', 'document_evidence_sha256', 'accounting_block', 'committed_at', 'committed_by', 'commit_operation_id']);
  if (session.status.startsWith('staged')) return clean({ org_id: orgId, recovered_at: now, session: summary, receipt: null, requires_fresh_review: true });

  const operationId = identifier(session.commit_operation_id), cached = await tx.get(`${root}/idempotency/${operationId}`), audit = await tx.get(`${root}/audit_logs/audit-${operationId}`);
  const result = cached?.response?.result;
  proof(typeof session.committed_by === 'string' && session.committed_by.length > 0);
  proof(cached?.status === 'completed' && cached.actor_uid === session.committed_by && digest(cached.fingerprint) && result);
  proof(audit?.org_id === orgId && audit.actor_uid === session.committed_by && audit.action === 'historicalImport.commit' && audit.operation_id === operationId && audit.entity_id === sessionId && audit.event_type === 'DATA_IMPORT_COMPLETED');
  proof(audit.import_metadata?.import_session_id === sessionId);
  for (const key of ['id', 'org_id', 'schema_version', 'import_type', 'file_hash', 'status', 'rows_total', 'rows_imported', 'rows_failed', 'rows_sha256', 'validation_context_sha256', 'document_evidence_sha256', 'accounting_block', 'completion_code', 'reconciliation']) proof(sameLargeImportRecord({ value: result[key] }, { value: session[key] }));
  for (const key of ['file_hash', 'status', 'rows_total', 'rows_imported', 'rows_failed', 'rows_sha256', 'document_evidence_sha256', 'accounting_block', 'completion_code', 'reconciliation']) proof(sameLargeImportRecord({ value: audit.import_metadata[key] }, { value: result[key] }));
  const total = sources.reduce((n, [, field]) => n + (Array.isArray(session[field]) ? session[field].length : 0), 0);
  proof(total <= 450);
  for (const [collection, field, count] of sources) {
    const ids = session[field] ?? [];
    proof(Array.isArray(ids) && new Set(ids).size === ids.length && result[count] === ids.length);
    for (const id of ids) {
      const source = await tx.get(`${root}/${collection}/${identifier(id)}`);
      proof(source && source.id === id && source.org_id === orgId && source.historical_import_session_id === sessionId);
    }
  }
  const review = audit.import_metadata.review_sha256;
  proof(review === undefined || digest(review));
  const receipt = fields(result, ['id', 'org_id', 'schema_version', 'import_type', 'file_hash', 'status', 'completion_code', 'accounting_block', 'rows_total', 'rows_imported', 'rows_failed', 'journals_created', 'invoices_created', 'payments_created', 'purchase_bills_created', 'supplier_payments_created', 'inventory_movements_created', 'rows_sha256', 'validation_context_sha256', 'document_evidence_sha256', 'reconciliation']);
  return clean({ org_id: orgId, recovered_at: now, session: summary, requires_fresh_review: false, receipt: { ...receipt, operation_id: operationId, review_sha256: review ?? null, review_status: review ? 'verified' : 'legacy_without_review_evidence' } });
}
