import { readFile } from 'node:fs/promises';
import { test, expect, openMerchant, defaultMerchantRecords, seedCloudMerchant, cloudRecords, guestId } from './helpers/cloudMerchant';

test.use({ controlsEnabled: false });
const root = `organizations/${guestId}`;

test('regional settings persist from the real API and changing currency preserves an existing international phone', async ({ page }) => {
  await openMerchant(page);
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
  for (const [currency, prefix] of [['SAR', '966'], ['AED', '971'], ['KWD', '965'], ['QAR', '974'], ['BHD', '973'], ['OMR', '968'], ['EGP', '20']]) {
    await settings.getByLabel('عملة التعامل الافتراضية', { exact: true }).selectOption(currency);
    await expect(settings.getByTestId('settings-phone-prefix')).toContainText('+' + prefix);
  }
  await settings.getByLabel('عملة التعامل الافتراضية', { exact: true }).selectOption('KWD');
  await settings.getByLabel('سعر عملة التعامل لكل دولار', { exact: true }).fill('0.3');
  await settings.getByRole('button', { name: 'حفظ كافة الإعدادات', exact: true }).click();
  await expect(settings).not.toBeVisible(); await page.reload();
  await page.getByTitle('الإعدادات', { exact: true }).click();
  await expect(settings.getByLabel('عملة التعامل الافتراضية', { exact: true })).toHaveValue('KWD');
  await expect(settings.getByLabel('سعر عملة التعامل لكل دولار', { exact: true })).toHaveValue('0.3');
  const records = await cloudRecords(page);
  expect(records[root].settings.default_transaction_currency).toBe('KWD');
  expect(records[root].settings.phone).toBe('+249912345678');
  expect(records[root].settings.primary_currency).toBe('SDG');
});

test('KWD invoice, partial milliunit receipt and WhatsApp PDF retain the original quote after reload', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const records = defaultMerchantRecords();
  records[root].settings = { ...records[root].settings, default_transaction_currency: 'KWD', currency_rates: { KWD: .3 } };
  records[root].accounting_version = 2;
  records[`${root}/customers/customer`].phone = '50012345';
  records[`${root}/customers/customer`].preferred_currency = 'KWD';
  await seedCloudMerchant(page, records); await openMerchant(page);
  await page.getByRole('button', { name: 'فاتورة جديدة', exact: true }).first().click();
  const form = page.locator('form').filter({ has: page.getByLabel('عميل الفاتورة') });
  await expect(form.getByLabel('عملة تسعير الفاتورة', { exact: true })).toHaveValue('KWD');
  await form.getByPlaceholder('اسم الصنف أو الخدمة...').fill('خدمة دينار');
  await form.getByLabel('سعر البند 1').fill('1.234'); await form.getByLabel('كمية البند 1').fill('3');
  await expect(form.getByTestId('invoice-native-preview')).toContainText('3.702 KWD');
  await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
  const detail = page.getByRole('dialog', { name: 'معاينة الفاتورة' });
  await expect(detail.getByTestId('invoice-native-summary')).toContainText('3.702 KWD');
  await detail.getByRole('button', { name: 'تسجيل دفعة', exact: true }).click();
  await expect(page.getByLabel('عملة التحصيل', { exact: true })).toHaveValue('KWD');
  await page.getByLabel('مبلغ الدفعة').fill('1.001');
  await page.getByLabel('سعر عملة التحصيل لكل دولار', { exact: true }).fill('0.4');
  const receiptForm = page.locator('form').filter({ has: page.getByLabel('مبلغ الدفعة') });
  await receiptForm.evaluate(node => (node as HTMLFormElement).requestSubmit());
  const receipt = page.getByRole('dialog', { name: 'سند قبض مالي', exact: true });
  await expect(receipt).toContainText('1.001 KWD');
  await receipt.getByRole('button', { name: 'إغلاق النافذة', exact: true }).click();
  await expect(detail.getByTestId('invoice-native-summary')).toContainText('2.701 KWD');
  await detail.getByRole('button', { name: /واتساب/ }).click();
  const share = page.getByRole('dialog', { name: 'مشاركة الفاتورة مع PDF' });
  await expect(share.getByText(/\.pdf$/).first()).toBeVisible();
  await share.getByText('تنزيل الملف أو الإرفاق اليدوي', { exact: true }).click();
  const link = share.getByRole('link', { name: 'فتح واتساب للإرفاق اليدوي', exact: true });
  const url = new URL((await link.getAttribute('href'))!);
  expect(url.searchParams.get('phone')).toBe('96550012345'); expect(url.searchParams.get('text')).toContain('2.701 KWD');
  const download = page.waitForEvent('download'); await share.getByRole('button', { name: 'تنزيل PDF', exact: true }).click();
  const file = testInfo.outputPath('kwd-invoice.pdf'); await (await download).saveAs(file);
  expect((await readFile(file)).subarray(0, 5).toString()).toBe('%PDF-');
  await page.reload();
  const saved = await cloudRecords(page), invoice = Object.entries(saved).find(([path]) => path.includes('/invoices/'))![1];
  expect(invoice.pricing.total).toBe(3.702); expect(invoice.pricing_remaining).toBe(2.701);
  expect(invoice.currency_rates_used.KWD).toBe(.3);
  expect(Object.entries(saved).filter(([path]) => path.includes('/payments/'))).toHaveLength(1);
});

test('customer currency changes the phone prefix and the saved Egyptian WhatsApp recipient', async ({ page }) => {
  await openMerchant(page); await page.locator('#tab-customers').click();
  await page.getByRole('button', { name: 'إضافة عميل جديد', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'إضافة أو تعديل عميل' });
  await dialog.getByLabel('عملة العميل المفضلة', { exact: true }).selectOption('EGP');
  await expect(dialog).toContainText('+20');
  await dialog.getByPlaceholder('مثال: محلات البركة (أحمد إبراهيم)').fill('عميل مصر');
  await dialog.getByLabel('رقم هاتف العميل', { exact: true }).fill('٠١٠١٢٣٤٥٦٧٨');
  await dialog.getByRole('button', { name: 'إضافة العميل', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const customer = Object.entries(await cloudRecords(page)).find(([path, row]) => path.includes('/customers/') && row.name === 'عميل مصر')![1];
  expect(customer.preferred_currency).toBe('EGP'); expect(customer.phone).toBe('+201012345678');
});
