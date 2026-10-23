import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { fakeFirebase } from './helpers/historicalAuth';
import { periodGuestFixture } from './helpers/accountingPeriods';
import { guestId, guestActor } from '../../src/services/guestStore';
import { MemoryStore } from '../../src/domain/store';
import { Operations } from '../../src/domain/operations';
import { createHistoricalImportTemplate } from '../../src/services/historicalImportWorkbook';

for (const scenario of ['retry', 'switch'] as const) test(`signed-in historical staging isolates ${scenario} without financial writes`, async ({ page }) => {
  const orgId = 'historical-cloud-org', root = `organizations/${orgId}`;
  const original = await periodGuestFixture(true, 'Owner');
  const records = JSON.parse(JSON.stringify(original).replaceAll(guestId, orgId));
  records[`${root}/customers/history-party`] = { id: 'history-party', org_id: orgId, name: 'عميل الترحيل', balance_sdg: 0, balance_usd: 0 };
  const secondOrgId = 'historical-second-org';
  const secondRecords = JSON.parse(JSON.stringify(records).replaceAll(orgId, secondOrgId));
  secondRecords[`organizations/${secondOrgId}`].name = 'المؤسسة الثانية';
  secondRecords[`organizations/${secondOrgId}`].settings.business_name = 'المؤسسة الثانية';
  const memory = new MemoryStore({ ...records, ...secondRecords });
  let releaseResponse!: () => void, markStarted!: () => void;
  const heldResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  let securityChecks = 0;
  const operations = new Operations({ authority: 'server', transaction: work => memory.transaction(work) }, () => new Date('2026-10-23T02:00:00Z'), undefined, async () => { securityChecks++; });
  await fakeFirebase(page, true);
  await page.addInitScript(() => { (window as any).__SUDANFLOW_FIREBASE_SYNC_TEST__ = { organizations: async () => [], watchRevision: () => () => {} }; });
  const ids: string[] = []; let loseResponse = true, foreignResponse = true;
  const before = memory.dump();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/organizations') return send([memory.dump()[root], memory.dump()[`organizations/${secondOrgId}`]]);
    if (path.endsWith('/snapshot')) return send(await operations.snapshot(path.includes(secondOrgId) ? secondOrgId : orgId, guestActor));
    if (path.endsWith('/revision')) return send({ revision: memory.dump()[`${root}/meta/counters`].revision });
    if (path.endsWith('/operations')) {
      const command = route.request().postDataJSON(); expect(command.action).toBe('historicalImport.stage'); ids.push(command.operationId);
      if (scenario === 'switch') {
        const response = await operations.execute(orgId, guestActor, command); markStarted(); await heldResponse; return send(response);
      }
      if (foreignResponse) { foreignResponse = false; return send({ result: { org_id: 'another-tenant', file_hash: command.data.file_hash, file_name: command.data.file_name, rows_total: 1 }, changes: [] }); }
      const response = await operations.execute(orgId, guestActor, command);
      if (loseResponse) { loseResponse = false; return send({ error: 'تعذر تأكيد حفظ جلسة المراجعة', code: 'service_unavailable' }, 503); }
      return send(response);
    }
    return route.abort();
  });
  await page.goto('/'); await page.getByRole('textbox', { name: 'البريد الإلكتروني', exact: true }).fill('owner@example.com'); await page.locator('input[type="password"]').fill('test-password'); await page.getByRole('button', { name: 'دخول الحساب السحابي', exact: true }).click();
  await page.locator('#tab-accounting').click(); await page.getByTestId('data-import-tab').click();
  const template = await createHistoricalImportTemplate(), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(template.bytes as never);
  workbook.getWorksheet('Documents')!.addRow([1, 'invoice', 'CLOUD-HISTORY-1', '2026-10-01', 'SDG', 'main', '4100', 'history-party', '2026-10-31', 0, '1200', '', '', 100, 0]);
  workbook.getWorksheet('Lines')!.addRow([1, 1, '', 'خدمة أصلية', 1, 100, 0, '', '']);
  const center = page.getByTestId('historical-workbook-center');
  await center.getByTestId('historical-workbook-file').setInputFiles({ name: 'cloud-history.xlsx', mimeType: template.mime_type, buffer: Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer) });
  if (scenario === 'switch') {
    await center.getByTestId('stage-historical-workbook').click(); await started;
    await page.getByTitle('الإعدادات', { exact: true }).click();
    await page.getByRole('dialog').locator('select').filter({ has: page.locator(`option[value="${secondOrgId}"]`) }).selectOption(secondOrgId);
    await expect(page.locator('header')).toContainText('المؤسسة الثانية');
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/operations'));
    releaseResponse(); await (await lateResponse).finished();
    await expect(page.locator('header')).toContainText('المؤسسة الثانية');
    await expect(page.getByTestId('historical-server-session')).toHaveCount(0);
    await expect(page.getByTestId('historical-workbook-review')).toHaveCount(0);
    expect(Object.keys(memory.dump()).filter(path => path.startsWith(`organizations/${secondOrgId}/historical_import_`))).toHaveLength(0);
    expect(ids).toHaveLength(1); return;
  }
  await center.getByTestId('stage-historical-workbook').click(); await expect(center.getByRole('alert')).toContainText('لا تطابق المؤسسة');
  await expect(center.getByTestId('historical-server-session')).toHaveCount(0);
  expect(memory.dump()).toEqual(before);
  await center.getByTestId('stage-historical-workbook').click(); await expect(center.getByRole('alert')).toContainText('تعذر تأكيد');
  await center.getByTestId('stage-historical-workbook').click(); await expect(center.getByTestId('historical-server-session')).toContainText('حُفظت جلسة المراجعة');
  expect(securityChecks).toBeGreaterThan(0);
  expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(1);
  const after = memory.dump(); expect(Object.keys(after).filter(path => path.startsWith(`${root}/historical_import_sessions/`))).toHaveLength(1);
  expect(Object.keys(after).filter(path => path.startsWith(`${root}/historical_import_staging/`))).toHaveLength(1);
  for (const name of ['invoices', 'payments', 'purchase_bills', 'supplier_payments', 'inventory_movements', 'journal_entries', 'customers', 'products']) {
    const subset = (data: typeof after) => Object.fromEntries(Object.entries(data).filter(([path]) => path.startsWith(`${root}/${name}/`)));
    expect(subset(after)).toEqual(subset(before));
  }
});
