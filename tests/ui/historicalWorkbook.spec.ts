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
