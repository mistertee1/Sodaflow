import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mohasbasd_guest_session', 'true');
    localStorage.setItem('sudanese_merchant_has_seen_tour_v2', 'true');
    localStorage.setItem('hisabuk_guest_v1_settings', JSON.stringify({ business_name: 'متجر الاختبار', phone: '0912345678', logo_url: '', address: 'الخرطوم', default_exchange_rate: 2000, primary_currency: 'SDG', secondary_currency: 'USD', currencies_configured: true, sdg_decimals: 0, usd_decimals: 2, rounding_rule: 'round', invoice_prefix: 'INV-', default_invoice_notes: '' }));
    localStorage.setItem('hisabuk_guest_v1_customers', JSON.stringify([{ id: 'customer', name: 'عميل الاختبار', phone: '', preferred_currency: 'USD', balance_sdg: 0, balance_usd: 0, created_at: '2026-10-01', updated_at: '2026-10-01' }]));
    localStorage.setItem('hisabuk_guest_v1_products', JSON.stringify([{ id: 'product', name: 'منتج الاختبار', unit: 'قطعة', price_sdg: 2000, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: 100, created_at: '2026-10-01' }]));
  });
});
test('RTL brand, local assets, both themes and mobile navigation render without overflow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('متجر الاختبار', { exact: true }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl'); await expect(page.locator('html')).toHaveAttribute('data-sf-theme', 'light');
  expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily)).toContain('IBM Plex Sans Arabic');
  await expect(page.getByRole('img', { name: 'سودافلو | SudaFlow' }).first()).toBeVisible();
  expect(await page.locator('img[src*="/brand/"]').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.locator('main')).not.toContainText('جاري التحميل');
  await page.screenshot({ path: 'test-results/sudaflow-light.png', fullPage: true });
  await page.getByRole('button', { name: /تبديل وضع السمة/ }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-sf-theme', 'dark');
  await page.screenshot({ path: 'test-results/sudaflow-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#tab-products').click(); await expect(page.getByText('منتج الاختبار', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/sudaflow-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('invalid expense stays open, shows an error and never enters the saved list', async ({ page }) => {
  await page.goto('/'); await page.locator('#tab-expenses').click();
  await page.getByRole('button', { name: /إضافة مصروف|مصروف جديد/ }).first().click();
  const dialog = page.locator('form').last();
  await dialog.locator('input[type="text"]').first().fill('مصروف مرفوض');
  await dialog.locator('input[type="number"]').first().fill('1.5');
  await dialog.getByRole('button', { name: 'تسجيل المصروف' }).click();
  await expect(page.getByText(/المبلغ يتجاوز الدقة المسموحة/).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}')).filter(key => key.includes('/expenses/')).length)).toBe(0);
});

test('invoice and receipt UI preserve historical receivable and do not duplicate rapid submissions', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'فاتورة جديدة', exact: true }).first().click();
  const form = page.locator('form').filter({ has: page.getByLabel('عميل الفاتورة') });
  await form.getByLabel('عميل الفاتورة').selectOption('customer');
  await form.getByRole('button', { name: 'دولار فقط', exact: true }).click();
  await form.getByLabel('منتج البند 1').selectOption('product');
  await form.getByLabel('عملة البند 1').selectOption('USD');
  await form.getByLabel('سعر البند 1').fill('100');
  // Two immediate submit events reproduce an accidental double tap.
  await form.evaluate(node => { (node as HTMLFormElement).requestSubmit(); (node as HTMLFormElement).requestSubmit(); });
  await expect(page.getByRole('button', { name: 'تسجيل دفعة', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'تسجيل دفعة', exact: true }).click();
  await page.getByLabel('مبلغ الدفعة').fill('50');
  await page.getByLabel('سعر الصرف عند السداد').fill('3000');
  const receiptForm = page.locator('form').filter({ has: page.getByLabel('مبلغ الدفعة') });
  await receiptForm.evaluate(node => { (node as HTMLFormElement).requestSubmit(); (node as HTMLFormElement).requestSubmit(); });
  await expect(page.getByText('سند قبض مالي (إيصال استلام)', { exact: true })).toBeVisible();
  const records = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}')));
  const invoices = records.filter(([key]) => key.includes('/invoices/')).map(([, value]) => value as any);
  const payments = records.filter(([key]) => key.includes('/payments/')).map(([, value]) => value as any);
  const customers = records.filter(([key]) => key.includes('/customers/')).map(([, value]) => value as any);
  expect(invoices).toHaveLength(1); expect(payments).toHaveLength(1);
  expect(invoices[0].remaining_sdg).toBe(100000); expect(invoices[0].remaining_usd).toBe(50);
  expect(customers[0].balance_sdg).toBe(100000); expect(payments[0].cash_amount_sdg).toBe(150000);
});
