import { test, expect, openMerchant, seedCloudMerchant, cloudMerchant, cloudRecords, guestId, guestActor, type Page } from './helpers/cloudMerchant';
import { periodGuestFixture } from './helpers/accountingPeriods';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
test.use({ serverAuthority: true });
const root = `organizations/${guestId}`;
async function openExport(page: Page, role: 'Owner' | 'Accountant' | 'Admin' | 'Viewer' = 'Owner', other = false) {
  const records = await periodGuestFixture(false, role);
  records[`user_organizations/${guestActor.uid}/orgs/${guestId}`] = { org_id: guestId };
  if (other) {
    const id = 'auditor-other';
    records[`organizations/${id}`] = { ...records[root], id, owner_uid: guestActor.uid, name: 'مؤسسة المراجع الثانية', settings: { ...records[root].settings, business_name: 'مؤسسة المراجع الثانية' } };
    records[`organizations/${id}/members/${guestActor.uid}`] = { uid: guestActor.uid, org_id: id, role: 'Owner', status: 'active' };
    records[`organizations/${id}/meta/subscription`] = { ...records[`${root}/meta/subscription`], org_id: id };
    records[`user_organizations/${guestActor.uid}/orgs/${id}`] = { org_id: id };
  }
  await seedCloudMerchant(page, records); await openMerchant(page); await page.locator('#tab-accounting').click();
  if (role !== 'Viewer') await page.getByTestId('data-export-tab').click();
  return page.getByTestId('data-export-center');
}

test('Accountant downloads real numeric auditor evidence, double click audits once and the recorded export survives reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); const center = await openExport(page, 'Accountant');
  await cloudMerchant(page).executeCommand('journal.create', { date: '2026-10-07', reference_type: 'manual', description: 'تسوية ملف المراجع', adjusting: true, reason: 'تسوية معتمدة', lines: [{ account_code: '5200', debit_sdg: 100, credit_sdg: 0, debit_usd: .05, credit_usd: 0 }, { account_code: '4100', debit_sdg: 0, credit_sdg: 100, debit_usd: 0, credit_usd: .05 }] }, 'auditor-ui-journal');
  const before = await cloudRecords(page); await center.getByLabel('بداية فترة التصدير المحاسبي').fill('2026-10-01'); await center.getByLabel('نهاية فترة التصدير المحاسبي').fill('2026-10-31');
  const download = page.waitForEvent('download'); await center.getByRole('button', { name: 'تصدير حزمة المراجع', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  const file = await download, path = testInfo.outputPath('auditor.xlsx'); await file.saveAs(path); expect(file.suggestedFilename()).toMatch(/^sudaflow-auditor-.*\.xlsx$/);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await readFile(path) as never);
  for (const name of ['Trial_Balance', 'General_Ledger', 'Journal_Entries', 'Source_References', 'Adjustments', 'Period_Close_History', 'Reopen_History', 'Audit_References', 'Reconciliation']) expect(book.getWorksheet(name)).toBeTruthy();
  const lines = book.getWorksheet('Journal_Lines')!; expect(lines.getRow(2).getCell(5).value).toBe(100); expect(lines.getRow(2).getCell(7).value).toBe(.05);
  expect(lines.getRow(2).getCell(5).type).toBe(ExcelJS.ValueType.Number); await expect(center.getByRole('status')).toContainText('تم تجهيز حزمة المراجع');
  const after = await cloudRecords(page); expect(Object.values(after).filter(row => row.action === 'auditorExport.create')).toHaveLength(1);
  for (const [key, row] of Object.entries(before)) if (!/\/(meta|rate_limits)\//.test(key)) expect(after[key]).toEqual(row);
  expect(cloudMerchant(page).mutations.filter(row => row.action === 'auditorExport.create')).toHaveLength(1);
  await page.reload(); await page.locator('#tab-accounting').click(); await page.getByTestId('data-export-tab').click(); await expect(page.getByTestId('data-transfer-history')).toContainText('auditor');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('An uncertain auditor response retries its cloud intent and downloads one confirmed file without duplicating its audit', async ({ page, merchant }, testInfo) => {
  const center = await openExport(page), button = center.getByRole('button', { name: 'تصدير حزمة المراجع', exact: true });
  merchant.abortAfterCommit(); await button.click(); await expect(center.getByRole('status')).toContainText('تعذر تأكيد'); await expect(button).toBeEnabled();
  expect(Object.values(await cloudRecords(page)).filter(row => row.action === 'auditorExport.create')).toHaveLength(1);
  const download = page.waitForEvent('download'); await button.click(); const path = testInfo.outputPath('retried-auditor.xlsx'); await (await download).saveAs(path); expect((await readFile(path)).subarray(0, 2).toString()).toBe('PK');
  const commands = merchant.mutations.filter(row => row.action === 'auditorExport.create'); expect(commands).toHaveLength(2); expect(new Set(commands.map(row => row.operationId)).size).toBe(1);
  expect(Object.values(await cloudRecords(page)).filter(row => row.action === 'auditorExport.create')).toHaveLength(1);
});

test('Admin can discover the scoped auditor package while Viewer cannot discover sensitive exports', async ({ page }) => {
  await openExport(page, 'Admin'); await expect(page.getByTestId('auditor-export')).toBeVisible(); await expect(page.getByTestId('company-export')).toHaveCount(0);
});
test('Viewer cannot discover the auditor package or accounting export tab', async ({ page }) => {
  await openExport(page, 'Viewer'); await expect(page.getByTestId('data-export-tab')).toHaveCount(0); await expect(page.getByTestId('auditor-export')).toHaveCount(0);
});

test('A late auditor response from the previous company never downloads into the new company session', async ({ page }) => {
  const center = await openExport(page, 'Owner', true); let started!: () => void, release!: () => void;
  const pending = new Promise<void>(resolve => started = resolve), held = new Promise<void>(resolve => release = resolve), downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.route('**/operations', async route => { if (route.request().postDataJSON()?.action === 'auditorExport.create') { started(); await held; } await route.fallback(); });
  try {
    await center.getByRole('button', { name: 'تصدير حزمة المراجع', exact: true }).click(); await pending;
    await page.getByTitle('الإعدادات', { exact: true }).click(); const settings = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
    await settings.locator('select').filter({ has: page.locator('option[value="auditor-other"]') }).selectOption('auditor-other'); await expect(page.locator('header')).toContainText('مؤسسة المراجع الثانية');
    const late = page.waitForResponse(response => response.url().endsWith('/operations')); release(); await (await late).finished();
    await settings.getByRole('button', { name: 'إغلاق النافذة', exact: true }).click();
    await page.getByTestId('data-export-tab').click();
    await expect(page.getByTestId('auditor-export').getByRole('button')).toBeEnabled(); expect(downloads).toEqual([]);
    expect(Object.values(await cloudRecords(page)).filter(row => row.org_id === 'auditor-other' && row.action === 'auditorExport.create')).toHaveLength(0);
  } finally { release(); }
});
