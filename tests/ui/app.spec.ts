import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function seedBrandInvoices(page: Page, longInvoice = false) {
  await page.addInitScript(({ longInvoice }) => {
    const settings = JSON.parse(localStorage.getItem('hisabuk_guest_v1_settings') || '{}');
    settings.sdg_decimals = 2;
    localStorage.setItem('hisabuk_guest_v1_settings', JSON.stringify(settings));
    const states = longInvoice ? ['sent'] : ['paid', 'partially_paid', 'overdue', 'cancelled', 'void'];
    const invoices = states.map((status, index) => {
      const total = longInvoice ? 60000 : [20000, 30000, 10000, 999000, 999000][index];
      const paid = longInvoice ? 0 : [20000, 5000, 0, 0, 0][index];
      return {
        id:`brand-${index}`, invoice_number:`INV-${String(41 + index).padStart(4, '0')}`,
        customer_id:'customer', customer_name:`عميل تجريبي ${index + 1}`, customer_phone:'0912345678',
        issue_date:'2026-10-01', due_date:'2026-10-01', status, currency_mode:'dual', exchange_rate_used:2000,
        items:Array.from({ length:longInvoice ? 60 : 1 }, (_, row) => ({ id:`line-${row}`, product_id:'product', description:`بند تجريبي ${row + 1}`, unit:'قطعة', quantity:1, unit_price:longInvoice ? 1000 : total, currency:'SDG', tax_rate:0, discount_percent:0, line_total:longInvoice ? 1000 : total })),
        subtotal_sdg:total, subtotal_usd:total/2000, discount_type:'fixed', discount_value:0,
        discount_total_sdg:0, discount_total_usd:0, tax_total_sdg:0, tax_total_usd:0,
        grand_total_sdg:total, grand_total_usd:total/2000, paid_amount_sdg:paid, paid_amount_usd:paid/2000,
        remaining_sdg:total-paid, remaining_usd:(total-paid)/2000,
        created_at:'2026-10-01T12:00:00Z', updated_at:'2026-10-01T12:00:00Z',
      };
    });
    localStorage.setItem('hisabuk_guest_v1_invoices', JSON.stringify(invoices));
  }, { longInvoice });
}

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
  await expect(page.locator('.sf-app-shell')).toHaveCSS('background-color', 'rgb(247, 249, 248)');
  await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#btn-quick-new-invoice')).toHaveCSS('background-color', 'rgb(8, 127, 117)');
  expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily)).toContain('IBM Plex Sans Arabic');
  await expect(page.getByRole('img', { name: 'سودافلو | SudaFlow' }).first()).toBeVisible();
  expect(await page.locator('img[src*="/brand/"]').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.locator('main')).not.toContainText('جاري التحميل');
  await page.screenshot({ path: 'test-results/sudaflow-light.png', fullPage: true });
  await page.getByRole('button', { name: /تبديل وضع السمة/ }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-sf-theme', 'dark');
  await expect(page.locator('.sf-app-shell')).toHaveCSS('background-color', 'rgb(16, 31, 37)');
  await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(21, 45, 53)');
  await expect(page.locator('#btn-quick-new-invoice')).toHaveCSS('background-color', 'rgb(110, 223, 198)');
  await expect(page.locator('#btn-quick-new-invoice')).toHaveCSS('color', 'rgb(10, 38, 45)');
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

test('invoice and receipt UI preserve historical receivable and do not duplicate rapid submissions', async ({ page }, testInfo) => {
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
  await expect(page.locator('#printable-receipt .sf-document-watermark img')).toBeVisible();
  await page.screenshot({ path:'test-results/sudaflow-receipt-watermark.png', fullPage:true });
  const receiptDownload = page.waitForEvent('download');
  await page.getByRole('button', { name:'تحميل PDF', exact:true }).click();
  const downloadedReceipt = await receiptDownload;
  const receiptFile = testInfo.outputPath('merchant-receipt.pdf');
  await downloadedReceipt.saveAs(receiptFile);
  expect((await readFile(receiptFile)).subarray(0, 5).toString()).toBe('%PDF-');
  const records = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}')));
  const invoices = records.filter(([key]) => key.includes('/invoices/')).map(([, value]) => value as any);
  const payments = records.filter(([key]) => key.includes('/payments/')).map(([, value]) => value as any);
  const customers = records.filter(([key]) => key.includes('/customers/')).map(([, value]) => value as any);
  expect(invoices).toHaveLength(1); expect(payments).toHaveLength(1);
  expect(invoices[0].remaining_sdg).toBe(100000); expect(invoices[0].remaining_usd).toBe(50);
  expect(customers[0].balance_sdg).toBe(100000); expect(payments[0].cash_amount_sdg).toBe(150000);
});

test('invoice summary excludes voided records and status filters preserve distinct meanings across viewports', async ({ page }) => {
  await seedBrandInvoices(page);
  await page.goto('/'); await page.locator('#tab-invoices').click();
  const summary = page.getByRole('region', { name:'ملخص الفواتير الصادرة' });
  await expect(summary).toContainText('60,000.00 SDG');
  await expect(summary).toContainText('25,000.00 SDG');
  await expect(summary).toContainText('35,000.00 SDG');
  await expect(page.locator('#tab-invoices')).toHaveAttribute('aria-current', 'page');
  const table = page.getByRole('region', { name:'جدول الفواتير، قابل للتمرير أفقياً' });
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await page.getByRole('button', { name:'مبطلة', exact:true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('INV-0045'); await expect(table).not.toContainText('INV-0044');
  await page.getByRole('button', { name:'ملغاة', exact:true }).click();
  await expect(table).toContainText('INV-0044'); await expect(table).not.toContainText('INV-0045');
  await page.getByRole('button', { name:'الكل', exact:true }).click();
  await page.screenshot({ path:'test-results/sudaflow-invoices-light.png', fullPage:true });
  await page.getByRole('button', { name:'تبديل وضع السمة' }).click();
  await expect(page.locator('.sf-app-shell')).toHaveCSS('background-color', 'rgb(16, 31, 37)');
  await page.screenshot({ path:'test-results/sudaflow-invoices-dark.png', fullPage:true });
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height:900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    const values = await table.locator('.sf-number').evaluateAll(nodes => nodes.map(node => ({ size:parseFloat(getComputedStyle(node).fontSize), line:parseFloat(getComputedStyle(node).lineHeight), direction:getComputedStyle(node).direction })));
    expect(values.every(value => value.size >= 14 && value.line >= 22 && value.direction === 'ltr')).toBe(true);
  }
  await page.setViewportSize({ width:390, height:844 });
  await page.screenshot({ path:'test-results/sudaflow-invoices-mobile.png', fullPage:true });
});

test('dialog keyboard navigation and focus return work with nested customer entry', async ({ page }) => {
  await page.goto('/');
  const trigger = page.locator('#btn-quick-new-invoice');
  await trigger.focus(); await trigger.click();
  const dialog = page.getByRole('dialog', { name:'إنشاء فاتورة جديدة' });
  await expect(dialog).toBeVisible(); await expect(page.locator('#root')).toHaveAttribute('inert', '');
  for (let index = 0; index < 30; index++) {
    await page.keyboard.press(index % 3 === 0 ? 'Shift+Tab' : 'Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await dialog.getByRole('button', { name:/عميل جديد|إضافة عميل/ }).click();
  const nested = page.getByRole('dialog', { name:'إضافة عميل سريع' });
  await expect(nested).toBeVisible();
  expect(await nested.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(nested).toHaveCount(0);
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused(); await expect(page.locator('#root')).not.toHaveAttribute('inert');
});

test('approved landing artwork renders in both themes and the guest action remains usable on mobile', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('mohasbasd_guest_session'));
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name:'فواتيرك ومخزونك في مكان واحد.' })).toBeVisible();
  await expect(page.getByText('بيانات تجريبية لعرض الواجهة؛ ليست سجلات متجرك أو أسعار صرف حالية.')).toBeVisible();
  expect(await page.locator('img[src*="/brand/"]').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path:'test-results/sudaflow-landing-light.png', fullPage:true });
  await page.getByRole('button', { name:'تبديل وضع السمة' }).click();
  await page.screenshot({ path:'test-results/sudaflow-landing-dark.png', fullPage:true });
  await page.setViewportSize({ width:320, height:844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name:'ابدأ التجربة', exact:true }).click();
  await expect(page.locator('#tab-invoices')).toBeVisible();
});

test('long invoice PDF keeps the merchant identity and exports multiple complete pages', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await seedBrandInvoices(page, true);
  await page.goto('/'); await page.locator('#tab-invoices').click();
  await page.getByRole('button', { name:'فتح الفاتورة INV-0041' }).click();
  const dialog = page.getByRole('dialog', { name:'معاينة الفاتورة' });
  await expect(dialog.locator('#printable-invoice')).toContainText('متجر الاختبار');
  await expect(dialog).toContainText('فاتورة مبيعات'); await expect(dialog).not.toContainText('فاتورة ضريبية');
  await expect(dialog.locator('.sf-frozen-rate')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(dialog.locator('.sf-frozen-rate')).toHaveCSS('background-color', 'rgb(8, 127, 117)');
  await expect(dialog.locator('.sf-document-watermark img')).toBeVisible();
  await page.screenshot({ path:'test-results/sudaflow-invoice-paper.png', fullPage:true });
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name:'تحميل PDF', exact:true }).click();
  const download = await downloadPromise;
  const file = testInfo.outputPath('merchant-invoice.pdf'); await download.saveAs(file);
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect((bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
  await page.emulateMedia({ media:'print' });
  expect(await dialog.locator('#printable-invoice').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 255, 255)');
  await expect(dialog.locator('.sf-frozen-rate')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.screenshot({ path:'test-results/sudaflow-invoice-print.png', fullPage:true });
});

test('exchange-rate save failure preserves the field and exposes a retry inside the active dialog', async ({ page }) => {
  await page.goto('/'); await page.getByTitle('تعديل سعر الصرف اليومي').click();
  const dialog = page.getByRole('dialog', { name:'تحديث سعر الصرف الحالي' });
  await dialog.getByLabel('سعر الصرف (1 دولار أمريكي = كم جنيه سوداني؟)').fill('2500');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    let failOnce = true;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'sudaflow_guest_transactions_v3' && failOnce) { failOnce = false; throw new Error('فشل حفظ تجريبي'); }
      return original.call(this, key, value);
    };
  });
  await dialog.getByRole('button', { name:'حفظ السعر الجديد' }).click();
  await expect(dialog.getByRole('alert')).toContainText('بياناتك ما زالت في النموذج');
  await expect(dialog.getByLabel('سعر الصرف (1 دولار أمريكي = كم جنيه سوداني؟)')).toHaveValue('2500');
  await dialog.getByRole('button', { name:'أعد المحاولة' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('header')).toContainText('2,500 SDG');
});

test('merchant profile saves before exchange setup and remains after reopening and reload', async ({ page }) => {
  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem('hisabuk_guest_v1_settings') || '{}');
    settings.default_exchange_rate = 0;
    settings.currencies_configured = false;
    localStorage.setItem('hisabuk_guest_v1_settings', JSON.stringify(settings));
  });
  await page.goto('/');
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
  const nameInput = dialog.locator('label').filter({ hasText: 'اسم المتجر أو المؤسسة' }).locator('..').locator('input');
  await nameInput.fill('متجر محفوظ');
  await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByTitle('الإعدادات', { exact: true }).click();
  await expect(nameInput).toHaveValue('متجر محفوظ');
  await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.reload();
  await expect(page.getByText('متجر محفوظ', { exact: true }).first()).toBeVisible();
});

test('A1 expense payment selection saves the bank account and removes merchandise expense classification', async ({ page }) => {
  await page.goto('/'); await page.locator('#tab-expenses').click();
  await page.getByRole('button', { name: /إضافة مصروف|مصروف جديد/ }).first().click();
  const form = page.locator('form').last();
  await form.locator('input[type="text"]').first().fill('إيجار مدفوع ببنكك');
  await form.locator('input[type="number"]').first().fill('100');
  await form.getByLabel('طريقة سداد المصروف').selectOption('bankak');
  await expect(form.locator('option', { hasText: 'مشتريات بضاعة وتوريدات' })).toHaveCount(0);
  await form.getByRole('button', { name: 'تسجيل المصروف' }).click();
  await expect(form).not.toBeVisible();
  const records = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}')));
  const expense = records.find(([key]) => key.includes('/expenses/'))![1] as any;
  const posting = records.find(([key]) => key.includes('/journal_entries/'))![1] as any;
  expect(expense.payment_account_code).toBe('1130');
  expect(posting.lines.find((line: any) => line.account_code === '1130').credit_sdg).toBe(100);
});

test('A1 report dates reject reversed ranges without hiding account repair controls', async ({ page }) => {
  await page.goto('/'); await page.locator('#tab-accounting').click();
  await page.getByLabel('بداية فترة التقرير').fill('2026-11-01');
  await page.getByLabel('نهاية فترة التقرير').fill('2026-10-01');
  await expect(page.getByRole('alert')).toContainText('بداية الفترة');
  await expect(page.getByRole('button', { name: 'إضافة حساب', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'كل الفترات', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('دليل الحسابات المتوافق', { exact: false })).toBeVisible();
});
