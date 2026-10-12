import { correctionDocumentFixture } from './helpers/correctionDocuments';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { purchaseCorrectionGuestFixture } from './helpers/purchaseCorrections';
import { correctionGuestFixture } from './helpers/salesCorrections';
import { openingBooksFixture, settleOpeningBooks } from '../fixtures/openingBooks';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
import { createDefaultSubscription, getPlanConfig } from '../../src/lib/plans';
import { periodGuestFixture } from './helpers/accountingPeriods';

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

test('C2 mobile opening AR/AP show independent sources and export original lots without fake invoices',async({page},testInfo)=>{
  const orgId='local-guest-org',root=`organizations/${orgId}`,data=openingBooksFixture(orgId,'guest');settleOpeningBooks(data,'a',1);settleOpeningBooks(data,'s',1);
  const records:Record<string,any>={[root]:{id:orgId,owner_uid:'guest',name:'متجر الاختبار',status:'active',accounting_version:2,settings:{...INITIAL_SETTINGS,business_name:'متجر الاختبار'}},[`${root}/members/guest`]:{uid:'guest',role:'Owner',status:'active'},[`${root}/meta/subscription`]:{...createDefaultSubscription(orgId),...getPlanConfig('Enterprise'),plan:'Enterprise',org_id:orgId}};
  for(const [name,rows] of Object.entries(data))for(const row of rows)records[`${root}/${name}/${name==='accounts'?row.code:row.id}`]=row;
  await page.addInitScript(records=>localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records)),records);await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.locator('#tab-customers').click();await page.getByRole('button',{name:'كشوف العملاء وأعمار الديون',exact:true}).click();let center=page.getByRole('region',{name:'كشوف العملاء وأعمار الديون',exact:true});await center.getByLabel('نهاية التقرير التشغيلي').fill('2026-10-03');await center.getByLabel('العميل للكشف').selectOption('a');await expect(center.getByText('رصيد افتتاحي: AR-A',{exact:false})).toBeVisible();
  const arDownload=page.waitForEvent('download');await center.getByRole('button',{name:'تصدير الكشف CSV',exact:true}).click();const arPath=testInfo.outputPath('opening-ar.csv');await (await arDownload).saveAs(arPath);const arCsv=await readFile(arPath,'utf8');expect(arCsv).toContain('AR-A');expect(arCsv).toContain('opening_lot:');expect(arCsv).toContain('opening_settlement:settle-a-1');
  await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'الموردون والمشتريات',exact:true}).click();center=page.getByRole('region',{name:'مركز الموردين والمشتريات',exact:true});await center.getByLabel('نهاية كشف المورد').fill('2026-10-03');await center.getByLabel('المورد للكشف').selectOption('s');await expect(center.getByText('رصيد افتتاحي: AP-S',{exact:false})).toBeVisible();
  const apDownload=page.waitForEvent('download');await center.getByRole('button',{name:'تصدير كشف CSV',exact:true}).click();const apPath=testInfo.outputPath('opening-ap.csv');await (await apDownload).saveAs(apPath);const apCsv=await readFile(apPath,'utf8');expect(apCsv).toContain('opening_lot');expect(apCsv).toContain('AP-S');expect(apCsv).toContain('jv-os-settle-s-1');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('opening-sources-mobile.png'),fullPage:true});
});

test('B3 mobile credit/physical return/refund forms enforce sources, resist duplicate submission, and preserve both books after reload', async ({ page }) => {
  const fixture = await correctionGuestFixture();
  await page.addInitScript(records => localStorage.setItem('sudaflow_guest_transactions_v3', JSON.stringify(records)), fixture.records);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await page.locator('#tab-invoices').click();
  await page.getByRole('button', { name: `فتح الفاتورة ${fixture.invoiceNumber}`, exact: true }).click();
  await page.getByRole('button', { name: 'معاينة المستند', exact: true }).click();
  await page.getByRole('button', { name: 'إشعار دائن / مردود', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'إشعار دائن ومردود بيع', exact: true });
  await dialog.getByLabel('تاريخ التصحيح أو الرد', { exact: true }).fill('2026-10-07'); await dialog.getByLabel('مبلغ التصحيح للبند 1').fill('101'); await dialog.getByLabel('سبب التصحيح أو الرد').fill('خصم متفق عليه');
  await dialog.getByRole('button', { name: 'ترحيل الإشعار الدائن', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('يتجاوز');
  await dialog.getByLabel('مبلغ التصحيح للبند 1').fill('20'); await dialog.locator('form').evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); }); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'تصحيحات الفاتورة' })).toContainText('20.00 USD');
  await page.getByRole('button', { name: 'إشعار دائن / مردود', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'إشعار دائن ومردود بيع', exact: true });
  await dialog.getByLabel('نوع الإشعار الدائن').selectOption('sales_return'); await dialog.getByLabel('تاريخ التصحيح أو الرد').fill('2026-10-07'); await dialog.getByLabel('كمية المردود للبند 1').fill('1'); await dialog.getByLabel('كمية المردود للبند 2').fill('2'); await dialog.getByLabel('سبب التصحيح أو الرد').fill('استلام المرتجع الفعلي'); await dialog.getByRole('button', { name: 'ترحيل الإشعار الدائن', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'رد نقدي للعميل', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'رد رصيد العميل الدائن', exact: true });
  await dialog.getByLabel('تاريخ التصحيح أو الرد').fill('2026-10-07'); await dialog.getByLabel('حساب الرد النقدي').selectOption(fixture.cashId); await dialog.getByLabel('مبلغ الرد النقدي').fill('300'); await dialog.getByLabel('سعر الصرف عند الرد').fill('3000'); await dialog.getByLabel('سبب التصحيح أو الرد').fill('رد كامل للعميل'); await dialog.locator('form').evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); }); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'تصحيحات الفاتورة' })).toContainText('رد نقدي'); await expect(page.getByRole('button', { name: 'رد نقدي للعميل', exact: true })).toHaveCount(0);
  const records = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}')));
  const rows = (name: string) => records.filter(([path]) => path.includes(`/${name}/`)).map(([, row]) => row as any);
  expect(rows('credit_notes')).toHaveLength(2); expect(rows('customer_refunds')).toHaveLength(1); expect(rows('products')[0].stock_quantity).toBe(10); expect(rows('products')[0].inventory_value_usd).toBe(20); expect(rows('invoices')[0].credit_balance_usd).toBe(0); expect(rows('invoices')[0].refunded_amount_usd).toBe(300); expect(rows('customers')[0].balance_usd).toBe(0);
  expect(rows('journal_entries').find(row => row.reference_type === 'customer_refund').lines.find((line: any) => line.account_code === '5500').debit_sdg).toBe(300000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'test-results/accounting-v2-sales-corrections-mobile.png', fullPage: true });
  // Remove only the fixture initializer so the reload observes the actual committed guest store.
  const saved = await page.evaluate(() => localStorage.getItem('sudaflow_guest_transactions_v3'));
  await page.addInitScript(saved => localStorage.setItem('sudaflow_guest_transactions_v3', saved!), saved);
  await page.reload(); await page.locator('#tab-invoices').click(); await page.getByRole('button', { name: `فتح الفاتورة ${fixture.invoiceNumber}`, exact: true }).click(); await page.getByRole('button', { name: 'معاينة المستند', exact: true }).click(); await expect(page.getByRole('region', { name: 'تصحيحات الفاتورة' })).toContainText('رد نقدي');
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
  await page.getByRole('button', { name: 'معاينة المستند', exact: true }).click();
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

test('D1.2 expense and manual journal dimensions survive posting and reload', async ({ page }) => {
  const records=await periodGuestFixture(false,'Owner'),root='organizations/local-guest-org',now='2026-10-05T12:00:00.000Z';
  Object.assign(records,{[`${root}/branches/north`]:{id:'north',org_id:'local-guest-org',kind:'branch',code:'NORTH',name_ar:'الفرع الشمالي',status:'active',created_by:'guest',created_at:now,updated_at:now,revision:1},[`${root}/cost_centers/sales`]:{id:'sales',org_id:'local-guest-org',kind:'cost_center',code:'SALES',name_ar:'المبيعات',status:'active',created_by:'guest',created_at:now,updated_at:now,revision:1},[`${root}/projects/contract-a`]:{id:'contract-a',org_id:'local-guest-org',kind:'project',code:'A',name_ar:'العقد أ',status:'active',created_by:'guest',created_at:now,updated_at:now,revision:1}});
  await page.addInitScript(records=>localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records)),records);await page.goto('/');await page.locator('#tab-expenses').click();await page.getByRole('button',{name:/إضافة مصروف|مصروف جديد/}).first().click();let dialog=page.getByRole('dialog',{name:'تسجيل مصروف'});
  await dialog.locator('input[type="text"]').first().fill('إيجار مشروع الفرع');await dialog.locator('input[type="number"]').first().fill('75');await dialog.getByLabel('فرع المصروف').selectOption('north');await dialog.getByLabel('مركز تكلفة المصروف').selectOption('sales');await dialog.getByLabel('مشروع المصروف').selectOption('contract-a');await dialog.locator('form').evaluate(form=>(form as HTMLFormElement).requestSubmit());await expect(dialog).toHaveCount(0);
  await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'قيد يومية يدوي',exact:true}).click();dialog=page.getByRole('dialog',{name:'إنشاء قيد يومية'});await dialog.getByLabel('البيان العام للقيد').fill('قيد أبعاد مستقل');await dialog.getByLabel('فرع القيد').selectOption('north');await dialog.getByLabel('مركز تكلفة القيد').selectOption('sales');await dialog.getByLabel('مشروع القيد').selectOption('contract-a');const lineSelects=dialog.locator('.space-y-3 select');await lineSelects.nth(0).selectOption('1110');await lineSelects.nth(1).selectOption('3100');await dialog.getByPlaceholder('مدين ج.س').nth(0).fill('10');await dialog.getByPlaceholder('دائن ج.س').nth(1).fill('10');await dialog.locator('form').evaluate(form=>(form as HTMLFormElement).requestSubmit());await expect(dialog).toHaveCount(0);
  const verify=async()=>page.evaluate(()=>Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}')).filter(([path])=>path.includes('/journal_entries/')).map(([,row])=>row as any).filter(row=>row.description?.includes('إيجار مشروع الفرع')||row.description==='قيد أبعاد مستقل').every(row=>row.lines.every((line:any)=>line.branch_id==='north'&&line.cost_center_id==='sales'&&line.project_id==='contract-a')));expect(await verify()).toBe(true);
  const saved=await page.evaluate(()=>localStorage.getItem('sudaflow_guest_transactions_v3'));await page.addInitScript(saved=>localStorage.setItem('sudaflow_guest_transactions_v3',saved!),saved);await page.reload();expect(await verify()).toBe(true);
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

test('C6 report shortcuts derive a complete prior comparison period and can clear it', async ({ page }) => {
  await page.goto('/'); await page.locator('#tab-accounting').click();
  await page.getByRole('button', { name: 'هذا الشهر', exact: true }).click();
  const start = await page.getByLabel('بداية فترة التقرير').inputValue(); const end = await page.getByLabel('نهاية فترة التقرير').inputValue();
  expect(start).toMatch(/^\d{4}-\d{2}-01$/); expect(end >= start).toBeTruthy();
  await page.getByRole('button', { name: 'قارن بالفترة السابقة', exact: true }).click();
  const compareStart = await page.getByLabel('بداية فترة المقارنة').inputValue(); const compareEnd = await page.getByLabel('نهاية فترة المقارنة').inputValue();
  expect(compareStart <= compareEnd).toBeTruthy(); expect(compareEnd < start).toBeTruthy();
  await page.getByRole('button', { name: 'إلغاء المقارنة', exact: true }).click(); await expect(page.getByLabel('بداية فترة المقارنة')).toHaveCount(0);
});

test('A2 owner establishes cost, activates V2, receives stock and snapshots COGS without duplicate submission', async ({ page }) => {
  await page.addInitScript(() => {
    const products = JSON.parse(localStorage.getItem('hisabuk_guest_v1_products') || '[]'); products[0].stock_quantity = 0;
    localStorage.setItem('hisabuk_guest_v1_products', JSON.stringify(products));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.locator('#tab-products').click();
  await page.getByRole('button', { name: 'تسجيل تكلفة أو استلام مخزون' }).click();
  let dialog = page.getByRole('dialog', { name: 'تكلفة المخزون', exact: true });
  await dialog.getByLabel('منتج التكلفة', { exact: true }).selectOption('product');
  await dialog.getByLabel('تكلفة الوحدة الموثقة', { exact: true }).fill('2');
  await dialog.getByLabel('عملة التكلفة', { exact: true }).selectOption('USD');
  await dialog.getByLabel('سبب العملية ومرجع وثيقة التكلفة').fill('مخزون افتتاحي فارغ تمت مراجعته');
  await dialog.getByRole('button', { name: 'حفظ عملية التكلفة' }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'تفعيل المحاسبة V2 بعد المطابقة' }).click();
  await expect(page.getByText('المحاسبة V2 مفعّلة', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'تسجيل تكلفة أو استلام مخزون' }).click();
  dialog = page.getByRole('dialog', { name: 'تكلفة المخزون', exact: true });
  await dialog.getByLabel('عملية المخزون', { exact: true }).selectOption('receipt');
  await dialog.getByLabel('منتج التكلفة', { exact: true }).selectOption('product');
  await dialog.getByLabel('كمية عملية التكلفة').fill('10');
  await dialog.getByLabel('تكلفة الوحدة الموثقة', { exact: true }).fill('2');
  await dialog.getByLabel('سداد استلام المخزون').selectOption('bankak');
  await dialog.getByLabel('سبب العملية ومرجع وثيقة التكلفة').fill('فاتورة شراء نقدية 10');
  await dialog.locator('form').evaluate(node => { (node as HTMLFormElement).requestSubmit(); (node as HTMLFormElement).requestSubmit(); });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/accounting-v2-cost-mobile.png', fullPage: true });
  await page.locator('#btn-quick-new-invoice').click();
  const form = page.locator('form').filter({ has: page.getByLabel('عميل الفاتورة') });
  await form.getByLabel('عميل الفاتورة').selectOption('customer'); await form.getByRole('button', { name: 'دولار فقط', exact: true }).click();
  await form.getByLabel('منتج البند 1').selectOption('product'); await form.getByLabel('عملة البند 1').selectOption('USD'); await form.getByLabel('سعر البند 1').fill('10');
  await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
  await expect(page.getByRole('button', { name: 'تسجيل دفعة', exact: true })).toBeVisible();
  const rows = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}')));
  const product = rows.find(([path]) => path.endsWith('/products/product'))![1] as any, invoice = rows.find(([path]) => path.includes('/invoices/'))![1] as any;
  expect(product.stock_quantity).toBe(9); expect(product.inventory_value_usd).toBe(18); expect(invoice.cogs_usd).toBe(2); expect(invoice.costing_status).toBe('complete');
  expect(rows.filter(([path, row]) => path.includes('/inventory_movements/') && (row as any).type === 'PURCHASE')).toHaveLength(1);
});

test('A2 income report marks unknown historical cost instead of presenting complete profit', async ({ page }) => {
  await page.goto('/'); await page.locator('#btn-quick-new-invoice').click();
  const form = page.locator('form').filter({ has: page.getByLabel('عميل الفاتورة') });
  await form.getByLabel('عميل الفاتورة').selectOption('customer'); await form.getByLabel('منتج البند 1').selectOption('product');
  await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
  await expect(page.getByRole('button', { name: 'تسجيل دفعة', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator('#tab-accounting').click(); await page.getByRole('button', { name: /قائمة الدخل/ }).first().click();
  await expect(page.getByRole('status')).toContainText('تكلفة بعض فواتير هذه الفترة غير موثقة');
  await expect(page.getByText('غير مكتمل', { exact: true }).first()).toBeVisible();
});

test('B1 mobile supplier purchase and partial FX payment post once and export the dated statement', async ({ page }, testInfo) => {
  await page.addInitScript(() => { const products=JSON.parse(localStorage.getItem('hisabuk_guest_v1_products') || '[]');products[0].stock_quantity=0;localStorage.setItem('hisabuk_guest_v1_products',JSON.stringify(products)); });
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#tab-products').click();
  await page.getByRole('button',{name:'تسجيل تكلفة أو استلام مخزون'}).click();let dialog=page.getByRole('dialog',{name:'تكلفة المخزون',exact:true});
  await dialog.getByLabel('منتج التكلفة',{exact:true}).selectOption('product');await dialog.getByLabel('تكلفة الوحدة الموثقة',{exact:true}).fill('2');await dialog.getByLabel('عملة التكلفة',{exact:true}).selectOption('USD');await dialog.getByLabel('سبب العملية ومرجع وثيقة التكلفة').fill('رصيد فارغ موثق');await dialog.getByRole('button',{name:'حفظ عملية التكلفة'}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'تفعيل المحاسبة V2 بعد المطابقة'}).click();await expect(page.getByText('المحاسبة V2 مفعّلة',{exact:false}).first()).toBeVisible();
  await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'الموردون والمشتريات',exact:true}).click();await page.getByRole('button',{name:'إضافة مورد',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'بيانات المورد',exact:true});await dialog.getByLabel('اسم المورد',{exact:true}).fill('مورد الموبايل');await dialog.getByLabel('عملة المورد',{exact:true}).selectOption('USD');await dialog.getByRole('button',{name:'حفظ المورد'}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'فاتورة شراء جديدة',exact:true}).click();dialog=page.getByRole('dialog',{name:'فاتورة شراء',exact:true});
  await dialog.getByLabel('رقم فاتورة المورد',{exact:true}).fill('MOB-1');await dialog.getByLabel('عملة الشراء',{exact:true}).selectOption('USD');await dialog.getByLabel('منتج الشراء 1',{exact:true}).selectOption('product');await dialog.getByLabel('كمية الشراء 1',{exact:true}).fill('10');await dialog.getByLabel('تكلفة شراء 1',{exact:true}).fill('2');await dialog.getByLabel('سبب الشراء',{exact:true}).fill('فاتورة المورد MOB-1');
  await dialog.locator('form').evaluate(f=>{(f as HTMLFormElement).requestSubmit();(f as HTMLFormElement).requestSubmit();});await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'سداد MOB-1',exact:true}).click();dialog=page.getByRole('dialog',{name:'سداد المورد',exact:true});await dialog.getByLabel('مبلغ سداد المورد',{exact:true}).fill('10');await dialog.getByLabel('صرف سداد المورد',{exact:true}).fill('3000');await dialog.getByLabel('طريقة سداد المورد',{exact:true}).selectOption('bankak');await dialog.locator('form').evaluate(f=>{(f as HTMLFormElement).requestSubmit();(f as HTMLFormElement).requestSubmit();});await expect(dialog).toHaveCount(0);
  const data=await page.evaluate(()=>Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}')));
  expect(data.filter(([p])=>p.includes('/purchase_bills/'))).toHaveLength(1);expect(data.filter(([p])=>p.includes('/supplier_payments/'))).toHaveLength(1);
  const bill=data.find(([p])=>p.includes('/purchase_bills/'))![1] as any;const payment=data.find(([p])=>p.includes('/supplier_payments/'))![1] as any;
  expect(bill.remaining_usd).toBe(10);expect(bill.remaining_sdg).toBe(20000);expect(payment.cash_amount_sdg).toBe(30000);
  const supplier=data.find(([p])=>p.includes('/suppliers/'))![1] as any;await page.getByLabel('المورد للكشف',{exact:true}).selectOption(supplier.id);
  await expect(page.getByRole('button',{name:'تصدير كشف CSV',exact:true})).toBeVisible();const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير كشف CSV',exact:true}).click();const csv=await csvDownload;const csvPath=testInfo.outputPath('supplier.csv');await csv.saveAs(csvPath);expect(await readFile(csvPath,'utf8')).toContain('closing');
  const pdfDownload=page.waitForEvent('download');await page.getByRole('button',{name:'تحميل كشف PDF',exact:true}).click();const pdf=await pdfDownload;const pdfPath=testInfo.outputPath('supplier.pdf');await pdf.saveAs(pdfPath);expect((await readFile(pdfPath)).subarray(0,5).toString()).toBe('%PDF-');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/accounting-v2-payables-mobile.png',fullPage:true});
});

test('B2 mobile dated AR, ledger currency and cash reports export source-linked statements without overflow', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const invoice = { id:'report-invoice', invoice_number:'INV-REPORT', customer_id:'customer', customer_name:'عميل الاختبار', issue_date:'2026-10-01', due_date:'2026-10-01', status:'paid', currency_mode:'single_sdg', exchange_rate_used:2000, items:[{id:'line-1',description:'خدمة',unit:'ساعة',quantity:1,unit_price:6000,currency:'SDG',tax_rate:0,discount_percent:0,line_total:6000}], subtotal_sdg:6000,subtotal_usd:3,discount_type:'fixed',discount_value:0,discount_total_sdg:0,discount_total_usd:0,tax_total_sdg:0,tax_total_usd:0,grand_total_sdg:6000,grand_total_usd:3,paid_amount_sdg:6000,paid_amount_usd:3,remaining_sdg:0,remaining_usd:0,created_at:'2026-10-01',updated_at:'2026-10-06' };
    const payment = {id:'report-payment',invoice_id:invoice.id,customer_id:'customer',payment_date:'2026-10-06'};
    const line=(code:string,ds:number,cs:number,du:number,cu:number)=>({account_code:code,account_name:code,debit_sdg:ds,credit_sdg:cs,debit_usd:du,credit_usd:cu});
    const journal=(id:string,date:string,type:string,ref:string,lines:any[])=>({id,date,entry_number:`JV-${id}`,reference_type:type,reference_id:ref,description:type==='invoice'?'فاتورة كشف تاريخي':'تحصيل لاحق',lines});
    localStorage.setItem('hisabuk_guest_v1_invoices',JSON.stringify([invoice]));localStorage.setItem('hisabuk_guest_v1_payments',JSON.stringify([payment]));localStorage.setItem('hisabuk_guest_v1_journal_entries',JSON.stringify([journal('j-report-sale','2026-10-01','invoice',invoice.id,[line('1200',6000,0,3,0),line('4100',0,6000,0,3)]),journal('j-report-pay','2026-10-06','payment',payment.id,[line('1110',4000,0,2,0),line('1200',0,4000,0,2)])]));
  });
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#tab-customers').click();await page.getByRole('button',{name:'كشوف العملاء وأعمار الديون',exact:true}).click();
  let center=page.getByRole('region',{name:'كشوف العملاء وأعمار الديون',exact:true});await center.getByLabel('نهاية التقرير التشغيلي').fill('2026-10-05');await center.getByLabel('العميل للكشف').selectOption('customer');await expect(center.getByText('فاتورة كشف تاريخي',{exact:false}).first()).toBeVisible();await expect(center).toContainText('6,000');
  const csvWait=page.waitForEvent('download');await center.getByRole('button',{name:'تصدير الكشف CSV',exact:true}).click();const csv=await csvWait;const csvPath=testInfo.outputPath('customer.csv');await csv.saveAs(csvPath);const text=await readFile(csvPath,'utf8');expect(text).toContain('j-report-sale:0');expect(text).not.toContain('j-report-pay:1');
  const pdfWait=page.waitForEvent('download');await center.getByRole('button',{name:'تصدير الكشف PDF',exact:true}).click();const pdf=await pdfWait;const pdfPath=testInfo.outputPath('customer.pdf');await pdf.saveAs(pdfPath);expect((await readFile(pdfPath)).subarray(0,5).toString()).toBe('%PDF-');
  await center.getByLabel('نهاية التقرير التشغيلي').fill('2026-10-06');await center.getByLabel('بداية التقرير التشغيلي').fill('2026-10-06');await expect(center.getByText('تحصيل لاحق',{exact:false}).first()).toBeVisible();await expect(center).toContainText('2,000');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'دفتر الأستاذ',exact:true}).click();center=page.getByRole('region',{name:'دفتر الأستاذ العام',exact:true});await center.getByLabel('حساب الأستاذ').selectOption('1200');await center.getByLabel('نهاية التقرير التشغيلي').fill('2026-10-05');await center.getByLabel('عملة الأستاذ').selectOption('USD');await expect(center.getByRole('columnheader',{name:'مدين USD',exact:true})).toBeVisible();await expect(center.getByRole('columnheader',{name:'مدين SDG',exact:true})).toHaveCount(0);await expect(center.getByText('فاتورة كشف تاريخي',{exact:false}).first()).toBeVisible();
  await page.getByRole('button',{name:'النقدية والبنوك',exact:true}).click();center=page.getByRole('region',{name:'النقدية والبنوك',exact:true});await center.getByLabel('بداية التقرير التشغيلي').fill('2026-10-01');await center.getByLabel('نهاية التقرير التشغيلي').fill('2026-10-06');await expect(center).toContainText('4,000');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/accounting-v2-operational-mobile.png',fullPage:true});
  const data=await page.evaluate(()=>Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}')));expect(data.filter(([key,value])=>key.includes('/audit_logs/')&&(value as any).action==='operational.export')).toHaveLength(2);expect(data.filter(([key])=>key.includes('/journal_entries/'))).toHaveLength(2);
});

test('B2 mobile cash account mapping and rapid duplicate transfer preserve total cash and its historical USD basis',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('hisabuk_guest_v1_products','[]');
    const line=(code:string,ds:number,cs:number,du:number,cu:number)=>({account_code:code,account_name:code,debit_sdg:ds,credit_sdg:cs,debit_usd:du,credit_usd:cu});
    localStorage.setItem('hisabuk_guest_v1_journal_entries',JSON.stringify([{id:'opening-cash',entry_number:'JV-OPEN',date:'2026-10-01',reference_type:'opening_balance',reference_id:'opening-cash',description:'افتتاحي نقدية',lines:[line('1110',10000,0,5,0),line('3100',0,10000,0,5)]}]));
  });
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#tab-products').click();await page.getByRole('button',{name:'تفعيل المحاسبة V2 بعد المطابقة'}).click();await expect(page.getByText('المحاسبة V2 مفعّلة',{exact:false}).first()).toBeVisible();
  await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'النقدية والبنوك',exact:true}).click();
  for(const [name,code,kind] of [['الصندوق','1110','cash'],['البنك','1130','bank']]){
    await page.getByRole('button',{name:'ربط حساب مالي',exact:true}).click();const dialog=page.getByRole('dialog',{name:'ربط حساب مالي',exact:true});await dialog.getByLabel('اسم الحساب المالي').fill(name);await dialog.getByLabel('حساب الدليل المالي').selectOption(code);await dialog.getByLabel('نوع الحساب المالي').selectOption(kind);await dialog.getByRole('button',{name:'حفظ الحساب المالي',exact:true}).click();await expect(dialog).toHaveCount(0);
  }
  await page.getByRole('button',{name:'تحويل داخلي',exact:true}).click();const dialog=page.getByRole('dialog',{name:'تحويل داخلي',exact:true});await dialog.getByLabel('مصدر التحويل').selectOption({label:'الصندوق (SDG)'});await dialog.getByLabel('وجهة التحويل').selectOption({label:'البنك (SDG)'});await dialog.getByLabel('مبلغ التحويل الداخلي').fill('2500');await dialog.getByLabel('تاريخ التحويل الداخلي').fill('2026-10-05');await dialog.getByLabel('سبب التحويل الداخلي').fill('إيداع الصندوق في البنك');await dialog.getByLabel('مرجع التحويل الداخلي').fill('BANK-1');await dialog.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});await expect(dialog).toHaveCount(0);
  const center=page.getByRole('region',{name:'النقدية والبنوك',exact:true});await center.getByLabel('نهاية التقرير التشغيلي').fill('2026-10-05');await center.getByLabel('بداية التقرير التشغيلي').fill('2026-10-05');await expect(center).toContainText('10,000');await expect(center).toContainText('BANK-1');
  const records=await page.evaluate(()=>Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}')));const transfers=records.filter(([key])=>key.includes('/internal_transfers/'));expect(transfers).toHaveLength(1);expect((transfers[0][1] as any).amount_sdg).toBe(2500);expect((transfers[0][1] as any).amount_usd).toBe(1.25);expect(records.filter(([key])=>key.includes('/journal_entries/'))).toHaveLength(2);expect(records.filter(([key])=>key.includes('/financial_accounts/'))).toHaveLength(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/accounting-v2-cash-transfer-mobile.png',fullPage:true});
});

test('B2 mobile bank matching and cash counts preserve evidence, require difference reasons and never auto-post adjustments', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hisabuk_guest_v1_products','[]');
    const line=(code:string,ds:number,cs:number,du:number,cu:number)=>({account_code:code,account_name:code,debit_sdg:ds,credit_sdg:cs,debit_usd:du,credit_usd:cu});
    localStorage.setItem('hisabuk_guest_v1_journal_entries',JSON.stringify([
      {id:'opening-reconcile',entry_number:'JV-OPEN',date:'2026-10-01',reference_type:'opening_balance',reference_id:'opening-reconcile',description:'افتتاحي للمطابقة',lines:[line('1130',6000,0,3,0),line('1110',1000,0,.5,0),line('3100',0,7000,0,3.5)]},
      {id:'bank-out',entry_number:'JV-OUT',date:'2026-10-03',reference_type:'manual',reference_id:'bank-out',description:'صرف بنكي مثبت',lines:[line('5200',1000,0,.5,0),line('1130',0,1000,0,.5)]},
    ]));
  });
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#tab-products').click();await page.getByRole('button',{name:'تفعيل المحاسبة V2 بعد المطابقة'}).click();await expect(page.getByText('المحاسبة V2 مفعّلة',{exact:false}).first()).toBeVisible();
  await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'النقدية والبنوك',exact:true}).click();
  for(const [name,code,kind] of [['صندوق الجرد','1110','cash'],['بنك المطابقة','1130','bank']]){
    await page.getByRole('button',{name:'ربط حساب مالي',exact:true}).click();const dialog=page.getByRole('dialog',{name:'ربط حساب مالي',exact:true});await dialog.getByLabel('اسم الحساب المالي').fill(name);await dialog.getByLabel('حساب الدليل المالي').selectOption(code);await dialog.getByLabel('نوع الحساب المالي').selectOption(kind);await dialog.getByRole('button',{name:'حفظ الحساب المالي',exact:true}).click();await expect(dialog).toHaveCount(0);
  }
  const center=page.getByRole('region',{name:'النقدية والبنوك',exact:true});await center.getByLabel('بداية التقرير التشغيلي').fill('2026-10-01');await center.getByLabel('نهاية التقرير التشغيلي').fill('2026-10-05');
  await page.getByRole('button',{name:'مطابقة كشف بنك',exact:true}).click();let dialog=page.getByRole('dialog',{name:'مطابقة كشف بنك',exact:true});await dialog.getByLabel('حساب المطابقة').selectOption({label:'بنك المطابقة (SDG)'});await dialog.getByLabel('بداية المطابقة').fill('2026-10-01');await dialog.getByLabel('نهاية المطابقة').fill('2026-10-05');await expect(dialog).toContainText('5,000');await dialog.getByLabel('ختامي كشف البنك').fill('5000');
  for (const [index,date,direction,amount,match] of [[1,'2026-10-01','inflow','6000','opening-reconcile:0'],[2,'2026-10-03','outflow','1000','bank-out:1']] as const) {
    await dialog.getByRole('button',{name:'إضافة حركة كشف',exact:true}).click();await dialog.getByLabel(`تاريخ حركة ${index}`).fill(date);await dialog.getByLabel(`اتجاه حركة ${index}`).selectOption(direction);await dialog.getByLabel(`مبلغ حركة ${index}`).fill(amount);await dialog.getByLabel(`مطابقة حركة ${index}`).selectOption(match);
  }
  await dialog.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});await expect(dialog).toHaveCount(0);
  const rec=page.getByRole('region',{name:'مطابقة البنك وجرد الصندوق',exact:true});await expect(rec.getByRole('cell',{name:'مطابق',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'جرد صندوق',exact:true}).click();dialog=page.getByRole('dialog',{name:'جرد صندوق',exact:true});await dialog.getByLabel('حساب المطابقة').selectOption({label:'صندوق الجرد (SDG)'});await dialog.getByLabel('نهاية المطابقة').fill('2026-10-05');await expect(dialog).toContainText('1,000');await dialog.getByLabel('النقد الفعلي').fill('980');await dialog.getByRole('button',{name:'حفظ إثبات المطابقة',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('النقد الفعلي')).toHaveValue('980');await dialog.getByLabel('سبب فرق المطابقة').fill('نقص عشرين موثق عند الجرد');await dialog.getByRole('button',{name:'حفظ إثبات المطابقة',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(rec.getByRole('cell',{name:'يحتاج تسوية',exact:true})).toBeVisible();
  const data=await page.evaluate(()=>Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}')));expect(data.filter(([key])=>key.includes('/bank_reconciliations/'))).toHaveLength(1);expect(data.filter(([key])=>key.includes('/cash_reconciliations/'))).toHaveLength(1);expect(data.filter(([key])=>key.includes('/journal_entries/'))).toHaveLength(2);expect(data.filter(([key,value])=>key.includes('/audit_logs/')&&(value as any).action==='bankReconciliation.create')).toHaveLength(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/accounting-v2-reconciliation-mobile.png',fullPage:true});
});

test('B3 mobile purchase returns and supplier reimbursements reject excess, resist double submission and retain WAC/AP evidence after reload',async({page},testInfo)=>{
  const fixture=await purchaseCorrectionGuestFixture();await page.addInitScript(records=>localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records)),fixture.records);await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'الموردون والمشتريات',exact:true}).click();
  await page.getByRole('button',{name:`مردود ${fixture.reference}`,exact:true}).click();let dialog=page.getByRole('dialog',{name:'مردود المورد',exact:true});await dialog.getByLabel('تاريخ تصحيح المورد').fill('2026-10-07');await dialog.getByLabel('سبب تصحيح المورد').fill('مرتجع فعلي');await dialog.getByLabel('كمية مردود المورد 1').fill('2');await dialog.getByRole('button',{name:'ترحيل مردود المورد',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('تتجاوز');await dialog.getByLabel('كمية مردود المورد 1').fill('1');await dialog.getByLabel('كمية مردود المورد 2').fill('2');await dialog.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:`استرداد ${fixture.reference}`,exact:true}).click();dialog=page.getByRole('dialog',{name:'استرداد من المورد',exact:true});await dialog.getByLabel('تاريخ تصحيح المورد').fill('2026-10-07');await dialog.getByLabel('سبب تصحيح المورد').fill('تحصيل الاسترداد');await dialog.getByLabel('حساب استرداد المورد').selectOption(fixture.cashId);await dialog.getByLabel('صرف استرداد المورد').fill('3000');await dialog.getByLabel('مبلغ استرداد المورد').fill('61');await dialog.getByRole('button',{name:'تسجيل استرداد المورد',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await dialog.getByLabel('مبلغ استرداد المورد').fill('60');await dialog.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:`استرداد ${fixture.reference}`,exact:true})).toHaveCount(0);
  const records=await page.evaluate(()=>Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}'))),rows=(name:string)=>records.filter(([path])=>path.includes(`/${name}/`)).map(([,row])=>row as any);expect(rows('purchase_returns')).toHaveLength(1);expect(rows('supplier_refunds')).toHaveLength(1);expect(rows('purchase_returns')[0].supplier_credit_usd).toBe(60);expect(rows('purchase_returns')[0].inventory_out_usd).toBe(22.2);expect(rows('purchase_returns')[0].variance_usd).toBe(37.8);expect(rows('purchase_bills')[0].advance_balance_usd).toBe(0);expect(rows('purchase_bills')[0].refunded_amount_usd).toBe(60);expect(rows('products')[0].stock_quantity).toBe(7);expect(rows('products')[0].inventory_value_usd).toBe(51.8);
  await page.getByLabel('المورد للكشف',{exact:true}).selectOption(fixture.supplierId);const wait=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير كشف CSV',exact:true}).click();const download=await wait,path=testInfo.outputPath('supplier-corrections.csv');await download.saveAs(path);expect(await readFile(path,'utf8')).toContain('supplier_refund');expect(await readFile(path,'utf8')).toContain('purchase_return');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:`سجل ${fixture.reference}`,exact:true}).click();dialog=page.getByRole('dialog',{name:'سجل تصحيحات المورد',exact:true});await expect(dialog).toContainText('فرق التكلفة');await expect(dialog).toContainText('استرداد المورد');await page.screenshot({path:'test-results/accounting-v2-purchase-corrections-mobile.png',fullPage:true});await dialog.getByRole('button',{name:'إغلاق تصحيح المورد'}).click();const saved=await page.evaluate(()=>localStorage.getItem('sudaflow_guest_transactions_v3'));await page.addInitScript(saved=>localStorage.setItem('sudaflow_guest_transactions_v3',saved!),saved);await page.reload();await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'الموردون والمشتريات',exact:true}).click();await page.getByRole('button',{name:`سجل ${fixture.reference}`,exact:true}).click();await expect(page.getByRole('dialog',{name:'سجل تصحيحات المورد',exact:true})).toContainText('تحصيل الاسترداد');
});

test('B3 saved sales and supplier correction documents download independently, preserve Arabic evidence and audit once under double clicks',async({page},testInfo)=>{
  test.setTimeout(120000);
  const fixture=await correctionDocumentFixture();await page.addInitScript(records=>{if(window===window.top)localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records));},fixture.records);await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#tab-invoices').click();await page.getByRole('button',{name:`فتح الفاتورة ${fixture.invoiceNumber}`,exact:true}).click();await page.getByRole('button',{name:'معاينة المستند',exact:true}).click();
  const download=async(kind:string,id:string)=>{const button=page.getByRole('button',{name:`تحميل PDF ${id}`,exact:true});const wait=page.waitForEvent('download');await button.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});const file=await wait;expect(file.suggestedFilename()).toBe(`${kind}-${id}.pdf`);const path=testInfo.outputPath(`${kind}-${id}.pdf`);await file.saveAs(path);const bytes=await readFile(path);expect(bytes.subarray(0,4).toString()).toBe('%PDF');expect(bytes.length).toBeGreaterThan(20000);await expect(button).toBeEnabled();};
  for(const [kind,id] of fixture.documents.slice(0,3))await download(kind,id);
  await page.getByRole('button',{name:'إغلاق النافذة',exact:true}).click();await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'الموردون والمشتريات',exact:true}).click();await page.getByRole('button',{name:`سجل ${fixture.bill.supplier_reference}`,exact:true}).click();
  for(const [kind,id] of fixture.documents.slice(3))await download(kind,id);
  const audits=await page.evaluate(()=>Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}')).filter(([path,row]:any)=>path.includes('/audit_logs/')&&row.action==='correctionDocument.export').map(([,row])=>row as any));expect(audits).toHaveLength(5);expect(new Set(audits.map(row=>row.export_metadata.document_id)).size).toBe(5);expect(audits.every(row=>row.event_type==='DATA_EXPORT_CREATED')).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/accounting-v2-correction-documents-mobile.png',fullPage:true,animations:'disabled'});
});
test('B3 a 100-line saved credit PDF paginates complete rows with safe source text and repeated A4 evidence',async({page},testInfo)=>{
  test.setTimeout(120000);const f=await correctionDocumentFixture();const invoice=(await f.run('invoice.create',{customer_id:f.invoice.customer_id,issue_date:'2026-10-07',currency_mode:'single_usd',exchange_rate_used:2000,discount_type:'fixed',discount_value:0,items:Array.from({length:100},(_,i)=>({product_id:f.product.id,description:i===0?'<img src=x onerror=window.pdfInjected=true>':`بند مراجعة طويل ${i+1} يحفظ مرجع المصدر والقيمة في الصفحة`,unit:'قطعة',quantity:.01,unit_price:100,currency:'USD',tax_rate:0,discount_percent:0}))},'long-sale')).result;
  await f.run('creditNote.create',{invoice_id:invoice.id,kind:'price_credit',date:'2026-10-07',reason:'تصحيح مصدر طويل دون إسقاط بنود',lines:Array.from({length:100},(_,i)=>({line_id:`line-${i+1}`,amount:.5}))},'long-credit');await page.addInitScript(records=>{if(window===window.top)localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records));},f.store.dump());await page.goto('/');await page.locator('#tab-invoices').click();await page.getByRole('button',{name:`فتح الفاتورة ${invoice.invoice_number}`,exact:true}).click();await page.getByRole('button',{name:'معاينة المستند',exact:true}).click();const wait=page.waitForEvent('download');await page.getByRole('button',{name:'تحميل PDF cn-long-credit',exact:true}).click();const file=await wait,path=testInfo.outputPath('long-credit.pdf');await file.saveAs(path);const bytes=await readFile(path);expect(bytes.subarray(0,4).toString()).toBe('%PDF');expect((bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length).toBeGreaterThan(3);expect(await page.evaluate(()=>(window as any).pdfInjected)).toBeUndefined();expect(await page.locator('.sf-print-document').count()).toBe(0);
});
