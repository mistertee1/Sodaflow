import type { Account, JournalEntry, MerchantSettings } from '../types';
import type { Document, Transaction } from './store';
import { dateOnly, ensure } from './validation';
import { financialCollections, reconcileFinancialData, type FinancialData } from './reconciliation';
import { ledgerTrialBalance } from './ledgerReports';
import { accountLedger, type ReportPeriod } from './operationalReports';
import { largeImportValueSha256 } from './largeImportEvidence';
import { verifyAuditArchives } from './auditArchives';
import { hasPermission, type ActionType } from '../services/rbacService';
import type { OrgRole } from '../types';
import { verifyClosedPeriodHashes } from './periodContracts';
import { verifyTaxConfigurationSources } from './taxConfigurationTransactions';

export const auditorPermissions: ActionType[] = ['export:accounting', 'audit_logs:view', 'journal:read', 'reports:advanced', 'periods:read', 'payables:read', 'invoices:read', 'payments:read', 'expenses:read', 'customers:read', 'products:read'];
export const canExportAuditorPackage = (role: OrgRole) => auditorPermissions.every(permission => hasPermission(role, permission));
const maxRecords = 5000, maxLines = 20000, maxRows = 50000, maxBytes = 600000;
type Value = string | number | boolean | null | undefined;

export function auditorPeriod(value: unknown): ReportPeriod {
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['start', 'end'].includes(key)), 'حقول فترة حزمة المراجع غير صالحة.');
  const period = value as ReportPeriod;
  for (const date of [period.start, period.end]) if (date !== undefined) ensure(typeof date === 'string' && dateOnly(date) === date, 'حدد تاريخاً صحيحاً لحزمة المراجع.');
  ensure(!period.start || !period.end || period.start <= period.end, 'بداية فترة المراجع بعد نهايتها.');
  return { ...(period.start ? { start: period.start } : {}), ...(period.end ? { end: period.end } : {}) };
}

/** Bounded transaction reads; no source is silently dropped to fit the file. */
export async function readAuditorSources(tx: Transaction, root: string) {
  const data: Record<string, Document[]> = {};
  let count = 0, bytes = 0;
  for (const name of [...financialCollections, 'audit_logs']) {
    const rows = await tx.list(`${root}/${name}`, { limit: maxRecords - count + 1 });
    count += rows.length; bytes += new TextEncoder().encode(JSON.stringify(rows)).length;
    ensure(count <= maxRecords && bytes <= 5000000, 'حزمة المراجع المباشرة تتجاوز حد البيانات؛ قسّم نطاق العمل أو استخدم تصديراً خادمياً مخصصاً.', 413);
    data[name] = rows;
  }
  const { audit_logs: audit, ...financial } = data;
  return { financial: financial as FinancialData, audit, source_record_count: count };
}

/** Server-owned data only. Workbook cells are scalar values, never formulas or links. */
export async function buildAuditorPackage(input: { orgId: string; operationId: string; createdAt: string; period: ReportPeriod; settings: MerchantSettings; financial: FinancialData; audit: Document[] }) {
  const period = auditorPeriod({ ...input.period, end: input.period.end || input.createdAt.slice(0, 10) }), data = input.financial;
  for (const rows of [...Object.values(data), input.audit]) for (const row of rows) ensure(row.org_id === input.orgId, 'مصدر حزمة المراجع يتبع مؤسسة أخرى.', 409);
  ensure(Object.values(data).reduce((n, rows) => n + rows.length, input.audit.length) <= maxRecords, 'عدد مصادر حزمة المراجع يتجاوز الحد المباشر.', 413);
  const accounts = data.accounts as Account[], entries = data.journal_entries as JournalEntry[];
  ensure(entries.reduce((n, entry) => n + (entry.lines?.length || 0), 0) <= maxLines, 'عدد سطور حزمة المراجع يتجاوز الحد المباشر.', 413);
  await verifyAuditArchives(data.audit_archives);
  const findings = reconcileFinancialData(data, input.settings, { requireCosting: true });
  // The synchronous reconciliation also needs the asynchronous hash proofs.
  // Export reviewable discrepancies rather than labelling broken evidence zero.
  for (const [collection, verify] of [
    ['accounting_periods', () => verifyClosedPeriodHashes(data.accounting_periods, data.journal_entries, data)],
    ['tax_configuration_versions', () => verifyTaxConfigurationSources(data, input.orgId)],
  ] as const) {
    try { await verify(); } catch (error) { findings.push({ code: 'source_evidence_mismatch', collection, id: 'source-proof', message: error instanceof Error ? error.message : 'تعذر إثبات المصدر المحفوظ.' }); }
  }
  const trial = ledgerTrialBalance(accounts, entries, period);
  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const within = (date: string) => (!period.start || date >= period.start) && (!period.end || date <= period.end);
  const selected = ordered.filter(entry => within(dateOnly(entry.date)));
  const periods = data.accounting_periods.filter(row => (!period.end || row.start_date <= period.end) && (!period.start || row.end_date >= period.start));
  const periodIds = new Set(periods.map(row => row.id));
  const localEvents = input.audit.map(event => ({ event, archive: '', sourceOrg: input.orgId, sourceHash: '' }));
  const archives = data.audit_archives.map(row => ({ event: row.source_event as Document, archive: row.id, sourceOrg: row.source_organization_id as string, sourceHash: row.source_hash as string }));
  const allEvents = [...localEvents, ...archives].sort((a, b) => String(a.event.created_at).localeCompare(String(b.event.created_at)) || a.event.id.localeCompare(b.event.id));
  const referenceIds = new Set(selected.flatMap(entry => [entry.id, entry.reference_id, entry.period_id, entry.historical_import_session_id]).filter(Boolean));
  const auditEvents = allEvents.filter(({ event }) => within(dateOnly(event.created_at)) || referenceIds.has(event.entity_id) || (String(event.action).startsWith('period.') && periodIds.has(event.entity_id)));
  const stableRows = (rows: Document[]) => [...rows].sort((a, b) => String(a.id || a.code).localeCompare(String(b.id || b.code)));
  const snapshotHash = await largeImportValueSha256({ org_id: input.orgId, period, financial: Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, stableRows(rows)])), audit: stableRows(input.audit) });
  // Operations also supplies a small canonical helper to the browser. Keep the
  // server workbook engine out of the initial application bundle.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SudaFlow'; workbook.created = new Date(input.createdAt); workbook.modified = new Date(input.createdAt);
  let rowCount = 0;
  const sheet = (name: string, headers: string[], rows: Value[][]) => {
    rowCount += rows.length + 1; ensure(rowCount <= maxRows, 'عدد صفوف مصنف المراجع يتجاوز الحد المباشر.', 413);
    const ws = workbook.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.addRow(headers);
    for (const row of rows) {
      ensure(row.every(value => value == null || ['string', 'number', 'boolean'].includes(typeof value)), 'خلية حزمة المراجع ليست قيمة أصلية.');
      ensure(row.every(value => typeof value !== 'number' || Number.isFinite(value)), 'قيمة رقمية غير صالحة في حزمة المراجع.', 409);
      ensure(row.every(value => typeof value !== 'string' || value.length <= 32767), 'نص حزمة المراجع يتجاوز حد خلية Excel؛ لم يُختصر النص.', 413);
      ws.addRow(row.map(value => value ?? null));
    }
    ws.getRow(1).font = { bold: true }; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    ws.columns.forEach(column => { column.width = 22; });
  };
  const lineHeaders = ['journal_id', 'line_index', 'date', 'account_code', 'debit_sdg', 'credit_sdg', 'debit_usd', 'credit_usd', 'branch_id', 'cost_center_id', 'project_id'];
  const lines = (rows: JournalEntry[]) => rows.flatMap(entry => entry.lines.map((line, index) => [entry.id, index, dateOnly(entry.date), line.account_code, line.debit_sdg, line.credit_sdg, line.debit_usd, line.credit_usd, line.branch_id, line.cost_center_id, line.project_id] as Value[]));
  sheet('Trial_Balance', ['account_code', 'account_name', 'nature', 'opening_sdg', 'opening_usd', 'debit_sdg', 'credit_sdg', 'debit_usd', 'credit_usd', 'closing_sdg', 'closing_usd'], trial.items.map(row => [row.account_code, row.account_name, row.nature, row.opening_balance_sdg, row.opening_balance_usd, row.total_debit_sdg, row.total_credit_sdg, row.total_debit_usd, row.total_credit_usd, row.net_balance_sdg, row.net_balance_usd]));
  sheet('Journal_Entries', ['journal_id', 'date', 'reference_type', 'reference_id', 'description', 'created_by', 'adjusting', 'historical_session_id'], selected.map(row => [row.id, dateOnly(row.date), row.reference_type, row.reference_id, row.description, row.created_by, Boolean(row.adjusting), row.historical_import_session_id]));
  sheet('Journal_Lines', lineHeaders, lines(selected));
  const ledgerRows: Value[][] = [];
  for (const account of [...accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const ledger = accountLedger(accounts, ordered, { ...period, accountCode: account.code }, period.end || input.createdAt.slice(0, 10));
    ledgerRows.push([account.code, 'opening', '', '', '', 0, 0, 0, 0, ledger.opening.SDG, ledger.opening.USD]);
    for (const row of ledger.rows) ledgerRows.push([account.code, 'movement', row.journal_id, row.line_index, row.date, row.debit.SDG, row.credit.SDG, row.debit.USD, row.credit.USD, row.balance.SDG, row.balance.USD]);
    ledgerRows.push([account.code, 'closing', '', '', '', ledger.total_debit.SDG, ledger.total_credit.SDG, ledger.total_debit.USD, ledger.total_credit.USD, ledger.closing.SDG, ledger.closing.USD]);
  }
  sheet('General_Ledger', ['account_code', 'row_kind', 'journal_id', 'line_index', 'date', 'debit_sdg', 'credit_sdg', 'debit_usd', 'credit_usd', 'balance_sdg_debit_positive', 'balance_usd_debit_positive'], ledgerRows);
  sheet('Source_References', ['journal_id', 'reference_type', 'reference_id', 'historical_session_id', 'source_rows_sha256'], selected.map(row => [row.id, row.reference_type, row.reference_id, row.historical_import_session_id, row.source_rows_sha256]));
  sheet('Adjustments', [...lineHeaders, 'reason', 'period_id'], selected.filter(row => row.adjusting || ['fx_revaluation', 'fixed_asset_depreciation'].includes(row.reference_type)).flatMap(row => lines([row]).map(line => [...line, row.adjustment_reason, row.period_id])));
  const periodState = (event: Document, key: string) => Object.values(event[key] || {}).find((value: any) => value?.id === event.entity_id) as Document | undefined;
  sheet('Period_Close_History', ['audit_id', 'period_id', 'action', 'created_at', 'actor_uid', 'reason', 'previous_status', 'new_status', 'saved_ledger_hash', 'archive_id', 'source_organization_id'], auditEvents.filter(({ event }) => ['period.softClose', 'period.close'].includes(event.action)).map(({ event, archive, sourceOrg }) => [event.id, event.entity_id, event.action, event.created_at, event.actor_uid, event.reason, periodState(event, 'previous_state')?.status, periodState(event, 'new_state')?.status, periodState(event, 'new_state')?.close_evidence?.ledger_hash, archive, sourceOrg]));
  sheet('Reopen_History', ['audit_id', 'period_id', 'created_at', 'actor_uid', 'reason', 'previous_status', 'new_status', 'archive_id', 'source_organization_id'], auditEvents.filter(({ event }) => event.action === 'period.reopen').map(({ event, archive, sourceOrg }) => [event.id, event.entity_id, event.created_at, event.actor_uid, event.reason, periodState(event, 'previous_state')?.status, periodState(event, 'new_state')?.status, archive, sourceOrg]));
  sheet('Periods', ['period_id', 'start_date', 'end_date', 'current_status', 'revision', 'closed_ledger_hash'], periods.map(row => [row.id, row.start_date, row.end_date, row.status, row.revision, row.close_evidence?.ledger_hash]));
  sheet('Audit_References', ['audit_id', 'action', 'entity_type', 'entity_id', 'operation_id', 'created_at', 'actor_uid', 'actor_role', 'reason', 'archive_id', 'source_organization_id', 'source_hash'], auditEvents.map(({ event, archive, sourceOrg, sourceHash }) => [event.id, event.action, event.entity_type, event.entity_id, event.operation_id, event.created_at, event.actor_uid, event.actor_role, event.reason, archive, sourceOrg, sourceHash]));
  sheet('Reconciliation', ['scope', 'collection', 'id', 'code', 'field', 'expected', 'actual', 'message'], findings.map(row => ['current_snapshot_all_dates', row.collection, row.id, row.code, row.field, row.expected, row.actual, row.message]));
  sheet('Cash_Bank_Evidence', ['id', 'kind', 'financial_account_id', 'account_code', 'difference', 'opening_difference', 'created_at', 'saved_ledger_hash'], [...data.bank_reconciliations, ...data.cash_reconciliations].map(row => [row.id, row.kind || (row.statement_lines ? 'bank' : 'cash'), row.financial_account_id, row.account_code, row.difference, row.opening_difference, row.created_at, row.ledger_snapshot?.ledger_hash]));
  sheet('Export_Summary', ['field', 'value'], [['schema_version', 1], ['export_type', 'auditor'], ['organization_id', input.orgId], ['operation_id', input.operationId], ['created_at', input.createdAt], ['period_start', period.start || ''], ['period_end', period.end || ''], ['journal_count', selected.length], ['line_count', lines(selected).length], ['trial_balance_balanced', trial.isBalanced], ['current_reconciliation_findings', findings.length], ['reconciliation_scope', 'current_snapshot_all_dates'], ['source_snapshot_sha256', snapshotHash], ['books', 'SDG/USD'], ['sensitive_fields', 'No contact details, credentials, raw audit state or approval payloads.'], ['readiness', 'Review evidence only; zero findings does not certify commercial readiness.']]);
  sheet('Data_Dictionary', ['sheet', 'meaning'], [['Trial_Balance', 'Opening and closing follow each account normal balance; movements are within the selected period.'], ['General_Ledger', 'Debit-positive balances; zero-based source line_index. Opening includes every prior journal.'], ['Reconciliation', 'Full current snapshot across all dates; findings are exported, never replaced with zero.'], ['Cash_Bank_Evidence', 'Saved evidence, not a new reconciliation or proof of current matching.'], ['Audit_References', 'Whitelisted local events and hash-verified restored provenance; source org is not current membership.'], ['Period_Close_History', 'Includes later closure/reopen events for periods overlapping the selected period.'], ['Source_References', 'Original source references; missing/inconsistent subsidiary proof is reported in reconciliation.']]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  ensure(bytes.byteLength <= maxBytes, 'حجم حزمة المراجع يتجاوز الحد المباشر؛ لا يُختصر الملف تلقائياً.', 413);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return { id: `auditor-export-${input.operationId}`, schema_version: 1, export_type: 'auditor', format: 'xlsx', filename: `sudaflow-auditor-${input.createdAt.slice(0, 10)}.xlsx`, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', workbook_base64: btoa(binary), byte_size: bytes.byteLength, sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), source_snapshot_sha256: snapshotHash, record_count: selected.length, line_count: lines(selected).length, findings_count: findings.length, trial_balance_balanced: trial.isBalanced, period, created_at: input.createdAt };
}
