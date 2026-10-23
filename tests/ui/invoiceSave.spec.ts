import { test, expect, openMerchant, defaultMerchantRecords, seedCloudMerchant, cloudRecords, cloudMerchant, guestId } from './helpers/cloudMerchant';

test.use({ controlsEnabled: false });
for (const retry of [false, true]) test(`reported mobile invoice saves on the cloud with correct stock and no duplicate ${retry ? 'after a failed commit' : 'on first submit'}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = `organizations/${guestId}`, records = defaultMerchantRecords();
  Object.assign(records[root].settings, { default_exchange_rate: 10200, manual_exchange_rate: 0 });
  Object.assign(records[`${root}/products/product`], { price_sdg: 10200000, price_usd: 1000, pricing_mode: 'usd_reference', pricing_reference_usd: 1000, stock_quantity: 50 });
  await seedCloudMerchant(page, records); await openMerchant(page); await page.locator('#btn-quick-new-invoice').click();
  const form = page.locator('form').filter({ has: page.getByLabel('عميل الفاتورة') });
  await form.getByLabel('منتج البند 1').selectOption('product');
  await expect(form.getByLabel('سعر البند 1')).toHaveValue('10200000');
  await expect(form.getByLabel('سعر صرف الفاتورة')).toHaveValue('10200');
  if (retry) cloudMerchant(page).failNextWrite();
  await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
  if (retry) {
    await expect(form).toContainText('تعذر تأكيد الحفظ');
    const failed = await cloudRecords(page); expect(failed[`${root}/products/product`].stock_quantity).toBe(50);
    expect(Object.keys(failed).filter(path => path.startsWith(`${root}/invoices/`))).toHaveLength(0);
    await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
  }
  await expect(form).toHaveCount(0);
  const saved = await cloudRecords(page), invoices = Object.entries(saved).filter(([path]) => path.startsWith(`${root}/invoices/`));
  expect(invoices).toHaveLength(1); const invoice = invoices[0][1];
  expect(invoice.grand_total_sdg).toBe(10200000); expect(invoice.grand_total_usd).toBe(1000);
  expect(saved[`${root}/products/product`].stock_quantity).toBe(49);
  expect(Object.values(saved).filter(row => row.reference_type === 'invoice' && row.reference_id === invoice.id && row.lines)).toHaveLength(1);
  await page.reload(); await expect(page.locator('.sf-app-shell')).toBeVisible();
  expect((await cloudRecords(page))[`${root}/invoices/${invoice.id}`]).toEqual(invoice);
});
