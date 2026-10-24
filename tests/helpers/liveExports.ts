import type { Store, Document } from '../../src/domain/store';
import { MemoryStore } from '../../src/domain/store';
import { Operations } from '../../src/domain/operations';
import { LargeExportWorker, type LargeExportArtifactStore, type LargeExportContent } from '../../src/domain/largeExportWorker';
import { ServerLargeExportBuilder, authorizedLargeExportDownload } from '../../server/largeExportWorker';
import { scheduledExportsFixture } from './scheduledExports';

export class TestExportArtifacts implements LargeExportArtifactStore {
  files = new Map<string, LargeExportContent>(); deleted: string[] = []; signed: { path: string; expires: string }[] = [];
  onPut?: () => Promise<void>;
  async put(path: string, content: LargeExportContent) { this.files.set(path, content); if (this.onPut) await this.onPut(); }
  async delete(path: string) { this.files.delete(path); this.deleted.push(path); }
  async signedUrl(path: string, expiresAt: Date) { if (!this.files.has(path)) throw Error('Missing synthetic artifact'); this.signed.push({ path, expires: expiresAt.toISOString() }); return `https://private-export.invalid/fixture?expires=${expiresAt.toISOString()}`; }
}
export async function liveExportFixture(store: Store = new MemoryStore(), suffix = 'live-export') {
  const f = await scheduledExportsFixture(store, suffix);
  const operations = new Operations(f.server, f.now, undefined, f.verifySecurity);
  await operations.execute(f.org.id, f.owner, { action: 'journal.create', operationId: 'export-source', data: { reference_type: 'manual', date: '2026-10-23', description: 'دليل تصدير فعلي', lines: [{ account_code: '5200', debit_sdg: 100, credit_sdg: 0, debit_usd: .05, credit_usd: 0 }, { account_code: '4100', debit_sdg: 0, credit_sdg: 100, debit_usd: 0, credit_usd: .05 }] } });
  const options = { lookupAccount: f.lookup, verifySecurity: f.verifySecurity, now: f.now };
  const builder = new ServerLargeExportBuilder(operations, options), artifacts = new TestExportArtifacts(); let claim = 0;
  const worker = new LargeExportWorker(f.server, artifacts, builder, f.now, () => `claim-${++claim}`);
  const queue = async (id = 'live-export-job', uid = 'Accountant', kind = 'accounting') => (await operations.execute(f.org.id, f.actor(uid), { action: 'largeExport.request', operationId: id, data: { kind, ...(kind === 'accounting' ? { period: { start: '2026-10-01', end: '2026-10-31' } } : {}) } })).result;
  const download = (job: Document, uid = job.requested_by, collection = job.kind === 'company' ? 'company_export_jobs' : 'accounting_export_jobs') => authorizedLargeExportDownload(f.server, worker, f.org.id, collection, job.id, f.actor(uid), options);
  return { ...f, operations, options, builder, artifacts, worker, queue, download };
}
