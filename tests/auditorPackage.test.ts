import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import express from 'express';
import { createApi } from '../server/api';
import { historicalRecoveryFixture } from './helpers/historicalRecovery';
import { MemoryStore, type Document, type Store } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { readAuditorSources } from '../src/domain/auditorPackage';
import { restoreAuditArchives } from '../src/domain/auditArchives';
import { defaultPlatformPlans } from '../src/lib/plans';

async function fixture() {
  const memory = new MemoryStore(), f = await historicalRecoveryFixture(memory, 'auditor');
  await f.commit();
  const journal = async (date: string, sdg: number, usd: number, id: string, adjusting = false) => f.run('journal.create', { reference_type: 'manual', date, description: adjusting ? '=HYPERLINK("https://example.test","نص حرفي")' : id, ...(adjusting ? { adjusting: true, reason: 'تسوية مراجعة' } : {}), lines: [{ account_code: '5200', debit_sdg: sdg, credit_sdg: 0, debit_usd: usd, credit_usd: 0 }, { account_code: '4100', debit_sdg: 0, credit_sdg: sdg, debit_usd: 0, credit_usd: usd }] }, id);
  const command = { action: 'auditorExport.create', operationId: 'auditor-export', data: { period: { start: '2026-01-10', end: '2026-01-15' } } };
  const exportFile = () => f.ops.execute(f.org.id, f.owner, command);
  return { ...f, memory, journal, command, exportFile };
}
async function workbook(result: Document) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(result.workbook_base64, 'base64') as never); return book;
}
function records(book: ExcelJS.Workbook, name: string) {
  const sheet = book.getWorksheet(name)!; assert.ok(sheet, name);
  const headers = (sheet.getRow(1).values as string[]).slice(1), rows: Document[] = [];
  sheet.eachRow((row, index) => { if (index > 1) rows.push(Object.fromEntries(headers.map((header, column) => [header, row.getCell(column + 1).value]))); }); return rows;
}
const mutate = async (f: Awaited<ReturnType<typeof fixture>>, path: string, updates: Document) => f.memory.transaction(async tx => tx.set(path, { ...await tx.get(path), ...updates }));

test('Auditor XLSX independently reconciles opening, period movements and dual-book closing; later close/reopen evidence remains linked', async () => {
  const f = await fixture(); await f.journal('2026-01-05', 40000, 20, 'prior'); await f.journal('2026-01-12', 400, .2, 'adjustment', true); await f.journal('2026-01-25', 900, .45, 'later');
  await f.run('period.softClose', { id: '2026', expected_revision: 1, reason: 'مراجعة الفترة' }, 'soft-close');
  await f.run('period.close', { id: '2026', expected_revision: 2, reason: 'إغلاق بعد المراجعة', fx_review_completed: true }, 'hard-close');
  await f.run('period.reopen', { id: '2026', expected_revision: 3, reason: 'إعادة فتح موثقة' }, 'reopen');
  const before = f.memory.dump(), first = await f.exportFile(), again = await f.exportFile(); assert.deepEqual(again, first);
  assert.equal(first.result.record_count, 2); assert.equal(first.result.line_count, 4); assert.equal(first.result.findings_count, 0);
  const book = await workbook(first.result), trial = records(book, 'Trial_Balance').find(row => row.account_code === '5200')!;
  assert.deepEqual([trial.opening_sdg, trial.opening_usd, trial.debit_sdg, trial.credit_sdg, trial.debit_usd, trial.credit_usd, trial.closing_sdg, trial.closing_usd], [40000, 20, 500, 0, .2, 0, 40500, 20.2]);
  const ledger = records(book, 'General_Ledger').filter(row => row.account_code === '5200');
  assert.equal(ledger[0].balance_sdg_debit_positive, 40000); assert.equal(ledger.at(-1)!.balance_sdg_debit_positive, 40500); assert.equal(ledger.at(-1)!.balance_usd_debit_positive, 20.2);
  assert.equal(ledger.filter(row => row.row_kind === 'movement').length, 2); assert.equal(records(book, 'Journal_Lines').length, 4);
  const sources = records(book, 'Source_References'); assert.ok(sources.some(row => row.historical_session_id === f.session.id));
  const audits = records(book, 'Audit_References'); assert.ok(audits.some(row => row.action === 'historicalImport.commit' && row.entity_id === f.session.id));
  assert.equal(records(book, 'Period_Close_History').length, 2); assert.equal(records(book, 'Reopen_History').length, 1); assert.equal(records(book, 'Adjustments').length, 2);
  const formulaText = records(book, 'Journal_Entries').find(row => String(row.description).startsWith('=HYPERLINK'))!.description; assert.equal(typeof formulaText, 'string');
  book.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => { assert.notEqual(cell.type, ExcelJS.ValueType.Formula); assert.notEqual(cell.type, ExcelJS.ValueType.Hyperlink); })));
  const after = f.memory.dump(); for (const [path, value] of Object.entries(before)) if (!/\/(meta|rate_limits)\//.test(path)) assert.deepEqual(after[path], value, path);
  assert.equal(Object.values(after).filter(row => row.action === 'auditorExport.create').length, 1);
  const audit = after[`${f.root}/audit_logs/audit-auditor-export`]; assert.equal(audit.event_type, 'DATA_EXPORT_CREATED'); assert.equal(audit.export_metadata.export_type, 'auditor');
  assert.equal(audit.export_metadata.sha256, createHash('sha256').update(Buffer.from(first.result.workbook_base64, 'base64')).digest('hex')); assert.equal(audit.export_metadata.source_snapshot_sha256, first.result.source_snapshot_sha256);
});

test('Auditor exports actual reconciliation findings instead of certifying an inconsistent cache as zero', async () => {
  const f = await fixture(); await mutate(f, `${f.root}/customers/problem`, { id: 'problem', org_id: f.org.id, name: 'عميل مراجعة', balance_sdg: 1, balance_usd: 0 });
  const { result } = await f.exportFile(); assert.ok(result.findings_count > 0);
  const rows = records(await workbook(result), 'Reconciliation'); assert.equal(rows.length, result.findings_count); assert.ok(rows.some(row => row.collection === 'customers' && row.id === 'problem' && row.actual === 1));
  assert.ok(rows.every(row => row.scope === 'current_snapshot_all_dates'));
});

test('Auditor includes hash-verified restored audit provenance but never contact fields, credentials or raw before/after payloads', async () => {
  const f = await fixture(), event = { id: 'old-event', org_id: 'source-org', actor_uid: 'old-actor', actor_email: 'private-contact@example.test', action: 'period.close', entity_type: 'period', entity_id: '2026', operation_id: 'old-operation', reason: 'دليل محفوظ', created_at: '2026-02-02T12:00:00Z', new_state: { credentials: 'RAW_SECRET_MUST_NOT_EXPORT' } };
  const archives = await restoreAuditArchives({ org: { id: 'source-org' }, collections: { audit_logs: [event], audit_archives: [] }, counters: { audit_archive_count: 0 } }, f.org.id, f.owner.uid, 'restore-proof', f.now().toISOString());
  await mutate(f, `${f.root}/audit_archives/${archives[0].id}`, archives[0]);
  const book = await workbook((await f.exportFile()).result), refs = records(book, 'Audit_References'), archived = refs.find(row => row.archive_id === archives[0].id)!;
  assert.equal(archived.source_organization_id, 'source-org'); assert.equal(archived.source_hash, archives[0].source_hash);
  const visible: unknown[] = []; book.eachSheet(sheet => sheet.eachRow(row => visible.push(row.values)));
  assert.ok(!JSON.stringify(visible).includes('RAW_SECRET_MUST_NOT_EXPORT')); assert.ok(!JSON.stringify(visible).includes('private-contact@example.test'));
  await mutate(f, `${f.root}/audit_archives/${archives[0].id}`, { source_hash: 'f'.repeat(64) });
  await assert.rejects(f.ops.execute(f.org.id, f.owner, { ...f.command, operationId: 'corrupt-archive' }), /بصمة أرشيف/);
  assert.equal(f.memory.dump()[`${f.root}/audit_logs/audit-corrupt-archive`], undefined);
});

test('Auditor rejects unauthorized roles, unverified and foreign actors without storing a file or audit', async () => {
  const f = await fixture();
  for (const role of ['Viewer', 'Sales', 'Cashier']) {
    await mutate(f, `${f.root}/members/${role}`, { uid: role, org_id: f.org.id, role, status: 'active' });
    await assert.rejects(f.ops.execute(f.org.id, { ...f.owner, uid: role }, f.command), (e: any) => e.status === 403);
  }
  await assert.rejects(f.ops.execute(f.org.id, { ...f.owner, emailVerified: false }, f.command), (e: any) => e.status === 403);
  await assert.rejects(f.ops.execute(f.org.id, { ...f.owner, uid: 'stranger' }, f.command), (e: any) => e.status === 403);
  assert.equal(f.memory.dump()[`${f.root}/idempotency/auditor-export`], undefined);
});

test('Auditor rechecks stored permissions before cached exports even with platform commercial controls paused', async () => {
  const f = await fixture(), accountant = { ...f.owner, uid: 'Accountant' };
  const first = await f.ops.execute(f.org.id, accountant, f.command); assert.equal(first.result.export_type, 'auditor');
  await mutate(f, `${f.root}/members/Accountant`, { role: 'Viewer' });
  await assert.rejects(f.ops.execute(f.org.id, accountant, f.command), (e: any) => e.status === 403);
  const paused = new Operations(f.server, f.now, undefined, async () => {}, false);
  await assert.rejects(paused.execute(f.org.id, accountant, f.command), /صلاحية حزمة المراجع/);
});

test('Auditor live V2, subscription, membership and server authority gates also apply to retries', async () => {
  const f = await fixture(); await f.exportFile();
  const original = f.memory.dump()[f.root];
  for (const updates of [{ accounting_version: 1 }, { subscriptionEnd: '2020-01-01' }, { status: 'suspended' }, { planId: 'Free' }]) {
    await mutate(f, f.root, updates); await assert.rejects(f.exportFile()); await f.memory.transaction(async tx => tx.set(f.root, original));
  }
  for (const authority of ['browser', 'local'] as const) {
    const store: Store = { authority, transaction: work => f.memory.transaction(work) };
    await assert.rejects(new Operations(store, f.now).execute(f.org.id, f.owner, f.command), /خدمة الخادم/);
  }
});

test('Auditor validates period and protected fields before writes, with no silent date normalization', async () => {
  const f = await fixture(), before = f.memory.dump();
  for (const period of [null, [], { hidden: true }, { start: '' }, { start: '2026-01-10T00:00:00Z' }, { start: '2026-02-30' }, { start: '2026-02-01', end: '2026-01-01' }]) await assert.rejects(f.ops.execute(f.org.id, f.owner, { ...f.command, data: { period } }));
  await assert.rejects(f.ops.execute(f.org.id, f.owner, { ...f.command, data: { period: {}, financial: {} } }), /حقول/);
  assert.deepEqual(f.memory.dump(), before);
});

test('Auditor bounded reader rejects oversize sources without partial audit, cache or financial writes', async () => {
  const f = await fixture();
  await f.memory.transaction(async tx => { for (let i = 0; i < 5001; i++) tx.set(`${f.root}/customers/overflow-${i}`, { id: `overflow-${i}`, org_id: f.org.id }); });
  const before = f.memory.dump(); await assert.rejects(f.exportFile(), (e: any) => e.status === 413); assert.deepEqual(f.memory.dump(), before);
  await assert.rejects(readAuditorSources({ list: async (_path: string, options?: { limit?: number }) => { assert.ok(options?.limit && options.limit <= 5001); return Array.from({ length: 5001 }, () => ({})); } } as never, f.root), (e: any) => e.status === 413);
});

test('Auditor rejects foreign sources and invalid ledger evidence without inventing empty totals', async () => {
  const f = await fixture(), path = `${f.root}/journal_entries/${f.memory.dump()[`${f.root}/historical_import_sessions/${f.session.id}`].commit_journal_ids[0]}`;
  const original = f.memory.dump()[path]; await mutate(f, path, { org_id: 'foreign' }); await assert.rejects(f.exportFile(), /مؤسسة أخرى/);
  await f.memory.transaction(async tx => tx.set(path, { ...original, lines: [] })); await assert.rejects(f.exportFile());
  assert.equal(f.memory.dump()[`${f.root}/audit_logs/audit-auditor-export`], undefined);
});

test('Auditor API returns a real workbook only after authorization and records a single export audit on retry', async () => {
  const f = await fixture(), app = express(); app.use(express.json()); app.use('/api', createApi({ operations: f.ops, verify: async token => token === 'owner' ? f.owner : { ...f.owner, uid: 'Viewer' } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number }, url = `http://127.0.0.1:${address.port}/api/organizations/${f.org.id}/operations`;
  try {
    const request = (token: string) => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(f.command) });
    const denied = await request('viewer'); assert.equal(denied.status, 403);
    const one = await request('owner'); assert.equal(one.status, 200); const body = await one.json();
    assert.equal(Buffer.from(body.result.workbook_base64, 'base64').subarray(0, 2).toString(), 'PK'); assert.equal((await workbook(body.result)).worksheets.length, 14);
    assert.deepEqual(await (await request('owner')).json(), body); assert.equal(Object.values(f.memory.dump()).filter(row => row.action === 'auditorExport.create').length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('Auditor cached files remain inaccessible after a live audit or reporting feature revocation', async () => {
  const f = await fixture(); await f.exportFile();
  const plan = defaultPlatformPlans().find(row => row.id === 'Enterprise')!;
  for (const feature of ['audit_trail', 'advanced_reports', 'accounting'] as const) {
    await f.memory.transaction(async tx => tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, [feature]: false } }));
    await assert.rejects(f.exportFile(), (error: any) => error.status === 403 && error.code === 'feature_unavailable');
  }
  assert.equal(Object.values(f.memory.dump()).filter(row => row.action === 'auditorExport.create').length, 1);
});

test('Auditor reports a broken closed-period hash as a finding even when its journal numbers still balance', async () => {
  const f = await fixture();
  await f.run('period.softClose', { id: '2026', expected_revision: 1, reason: 'إغلاق موثق' }, 'hash-soft');
  const closed = (await f.run('period.close', { id: '2026', expected_revision: 2, reason: 'مراجعة الإغلاق', fx_review_completed: true }, 'hash-close')).result;
  await mutate(f, `${f.root}/accounting_periods/2026`, { close_evidence: { ...closed.close_evidence, ledger_hash: 'f'.repeat(64) } });
  const { result } = await f.exportFile(); assert.ok(result.findings_count > 0); assert.equal(result.trial_balance_balanced, true);
  assert.ok(records(await workbook(result), 'Reconciliation').some(row => row.code === 'source_evidence_mismatch' && row.collection === 'accounting_periods'));
});

test('Auditor refuses an oversized real XLSX without silently dropping audit evidence or persisting a successful export', async () => {
  const f = await fixture();
  await f.memory.transaction(async tx => { for (let i = 0; i < 80; i++) tx.set(`${f.root}/audit_logs/large-${i}`, { id: `large-${i}`, org_id: f.org.id, actor_uid: f.owner.uid, action: 'review.note', entity_id: `note-${i}`, created_at: '2026-01-11T12:00:00Z', reason: randomBytes(12000).toString('base64') }); });
  const before = f.memory.dump(); await assert.rejects(f.exportFile(), (error: any) => error.status === 413); assert.deepEqual(f.memory.dump(), before);
});

test('Auditor storage failure cannot acknowledge a file or leave a partial export audit; retry commits once', async () => {
  let fail = false; const memory = new MemoryStore({}, () => { if (fail) { fail = false; throw Error('Synthetic storage unavailable'); } });
  const f = await historicalRecoveryFixture(memory, 'auditor-rollback'); await f.commit();
  const command = { action: 'auditorExport.create', operationId: 'rollback-export', data: { period: {} } }, before = memory.dump();
  fail = true; await assert.rejects(f.ops.execute(f.org.id, f.owner, command), /Synthetic storage/); assert.deepEqual(memory.dump(), before);
  const retry = await f.ops.execute(f.org.id, f.owner, command); assert.equal(retry.result.export_type, 'auditor'); assert.equal(Object.values(memory.dump()).filter(row => row.action === 'auditorExport.create').length, 1);
});
