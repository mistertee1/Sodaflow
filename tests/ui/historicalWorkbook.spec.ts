import { test, expect } from '@playwright/test';
import { periodGuestFixture } from './helpers/accountingPeriods';

test('historical workbook download and invalid upload never write financial or staging records', async ({ page }) => {
  const records = await periodGuestFixture(true, 'Owner');
  await page.addInitScript(records => { localStorage.setItem('mohasbasd_guest_session', 'true'); localStorage.setItem('sudanese_merchant_has_seen_tour_v2', 'true'); localStorage.setItem('sudaflow_guest_transactions_v3', JSON.stringify(records)); }, records);
  await page.goto('/'); await page.locator('#tab-accounting').click(); await page.getByTestId('data-import-tab').click();
  const center = page.getByTestId('historical-workbook-center'); await expect(center).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('sudaflow_guest_transactions_v3'));
  const download = page.waitForEvent('download'); await center.getByRole('button', { name: 'تنزيل قالب المستندات التاريخية' }).click();
  expect((await download).suggestedFilename()).toBe('sudaflow_historical_documents_template.xlsx');
  await center.getByTestId('historical-workbook-file').setInputFiles({ name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from('untrusted') });
  await expect(center.getByRole('alert')).toContainText('XLSX'); await expect(center.getByTestId('historical-workbook-review')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sudaflow_guest_transactions_v3'))).toBe(before);
});

test('valid historical workbook shows original document evidence and clears review on replacement without writes', async ({ page }) => {
  const { createHistoricalImportTemplate } = await import('../../src/services/historicalImportWorkbook');
  const { default: ExcelJS } = await import('exceljs');
  const { guestId } = await import('../../src/services/guestStore');
  const records = await periodGuestFixture(true, 'Owner');
  records[`organizations/${guestId}/customers/historical-customer`] = { id: 'historical-customer', org_id: guestId, name: 'عميل تاريخي', phone: '', email: '', address: '', balance_sdg: 0, balance_usd: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
  await page.addInitScript(records => { localStorage.setItem('mohasbasd_guest_session', 'true'); localStorage.setItem('sudanese_merchant_has_seen_tour_v2', 'true'); localStorage.setItem('sudaflow_guest_transactions_v3', JSON.stringify(records)); }, records);
  await page.goto('/'); await page.locator('#tab-accounting').click(); await page.getByTestId('data-import-tab').click();
  const center = page.getByTestId('historical-workbook-center');
  const before = await page.evaluate(() => localStorage.getItem('sudaflow_guest_transactions_v3'));
  const template = await createHistoricalImportTemplate(), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(template.bytes as never);
  workbook.getWorksheet('Documents')!.addRow([1, 'invoice', 'HIST-UI-1', '2026-10-01', 'SDG', 'main', '4100', 'historical-customer', '2026-10-31', 0, '1200', '', '', 100, 0]);
  workbook.getWorksheet('Lines')!.addRow([1, 1, '', 'خدمة تاريخية موثقة', 1, 100, 0, '', '']);
  const bytes = await workbook.xlsx.writeBuffer();
  await center.getByTestId('historical-workbook-file').setInputFiles({ name: 'history.xlsx', mimeType: template.mime_type, buffer: Buffer.from(bytes as ArrayBuffer) });
  const review = center.getByTestId('historical-workbook-review'); await expect(review).toContainText('HIST-UI-1'); await expect(review).toContainText('اجتاز التحقق المحلي');
  await review.getByText('البنود والدفعات').click(); await expect(review).toContainText('خدمة تاريخية موثقة');
  expect(await page.evaluate(() => localStorage.getItem('sudaflow_guest_transactions_v3'))).toBe(before);
  await center.getByTestId('historical-workbook-file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('bad') });
  await expect(review).toHaveCount(0); await expect(center.getByRole('alert')).toContainText('XLSX');
  expect(await page.evaluate(() => localStorage.getItem('sudaflow_guest_transactions_v3'))).toBe(before);
});
