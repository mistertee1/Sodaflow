import { test, expect, defaultMerchantRecords, seedCloudMerchant, openMerchant, cloudRecords, cloudMerchant, guestId } from './helpers/cloudMerchant';
import { getDefaultChartOfAccounts } from '../../src/services/accountingService';

test.use({ controlsEnabled: false });
const root = `organizations/${guestId}`;
async function seedViewer(page: Parameters<typeof seedCloudMerchant>[0], v2 = false) {
  const records = defaultMerchantRecords();
  records[root] = { ...records[root], owner_uid: 'actual-owner', status: 'suspended', planId: 'Free', subscriptionStatus: 'expired', subscriptionEnd: '2020-01-01T00:00:00Z', ...(v2 ? { accounting_version: 2 } : {}) };
  records[`${root}/members/guest`] = { uid: 'guest', org_id: guestId, role: 'Viewer', status: 'suspended' };
  records[`${root}/meta/usage`] = { lifetimeInvoiceCount: 100 };
  records[`${root}/meta/counters`] = { invoice_count: 100, lifetime_invoice_count: 100 };
  // A clean V2 chart is needed for a real tax-policy write, without any production data.
  if (v2) for (const account of getDefaultChartOfAccounts(guestId)) records[`${root}/accounts/${account.code}`] = account;
  await seedCloudMerchant(page, records);
}

test('paused Super Admin shows no login or commercial panel and makes no admin request', async ({ page }) => {
  await page.goto('/super-admin');
  await expect(page.getByRole('heading', { name: 'لوحة السوبر أدمن متوقفة مؤقتاً' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'دخول الإدارة', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'أقسام إدارة المنصة' })).toHaveCount(0);
  expect(cloudMerchant(page).requests).toEqual(['/api/platform-controls']);
  expect(cloudMerchant(page).mutations).toEqual([]);
});

test('suspended Viewer at invoice 100 creates customers, saves settings and reloads with original role/billing', async ({ page }) => {
  await seedViewer(page); await openMerchant(page);
  await expect(page.getByRole('button', { name: 'فاتورة جديدة', exact: true }).first()).toBeEnabled();
  await expect(page.getByText('حسابك في هذه المؤسسة معلق حالياً', { exact: false })).toHaveCount(0);
  await page.locator('#tab-customers').click();
  await page.getByRole('button', { name: 'إضافة عميل جديد', exact: true }).first().click();
  const customerDialog = page.getByRole('dialog', { name: 'إضافة أو تعديل عميل' });
  await customerDialog.getByPlaceholder('مثال: محلات البركة (أحمد إبراهيم)').fill('عميل الوصول الكامل');
  await customerDialog.getByPlaceholder('مثال: 0912345678').fill('0912345678');
  await customerDialog.getByRole('button', { name: 'إضافة العميل', exact: true }).click();
  await expect(customerDialog).toHaveCount(0); await expect(page.getByText('عميل الوصول الكامل', { exact: true })).toBeVisible();
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
  await expect(settings.getByRole('region', { name: 'وضع الوصول الكامل' })).toBeVisible();
  await expect(settings.getByRole('link', { name: 'فتح إدارة منصة SudaFlow' })).toHaveCount(0);
  await expect(settings.getByText('طلب ترقية (للمالك فقط)', { exact: true })).toHaveCount(0);
  await settings.getByLabel('اسم المتجر أو المؤسسة').fill('متجر بصلاحيات كاملة');
  await expect(settings.getByRole('button', { name: 'حفظ كافة الإعدادات' })).toBeEnabled();
  await settings.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click(); await expect(settings).toHaveCount(0);
  await page.reload(); await expect(page.locator('.sf-app-shell')).toContainText('متجر بصلاحيات كاملة');
  const records = await cloudRecords(page);
  expect(records[`${root}/members/guest`].role).toBe('Viewer'); expect(records[`${root}/members/guest`].status).toBe('suspended');
  expect(records[root].owner_uid).toBe('actual-owner'); expect(records[root].subscriptionStatus).toBe('expired'); expect(records[root].planId).toBe('Free');
  expect(records[`${root}/meta/usage`].lifetimeInvoiceCount).toBe(100);
  expect(Object.values(records).some(row => row.action === 'settings.update' && row.actor_role === 'Viewer' && row.effective_actor_role === 'Owner')).toBe(true);
});

test('paused Viewer can commit a tax policy after verifying their own identity and see it after reload', async ({ page }) => {
  await seedViewer(page, true); await openMerchant(page);
  await page.locator('#tab-accounting').click(); await page.getByTestId('tax-center-tab').click();
  const form = page.getByRole('form', { name: 'إعداد ضريبة' }); await expect(form).toBeVisible();
  await form.getByLabel('معرف الضريبة').fill('paused-vat'); await form.getByLabel('اسم الضريبة').fill('ضريبة اختبار الوصول');
  await form.getByLabel('نطاق الضريبة').fill('بيانات اصطناعية'); await form.getByLabel('نسبة الضريبة').fill('5');
  await form.getByLabel('حساب الضريبة', { exact: true }).selectOption('2130'); await form.getByLabel('بداية سريان الضريبة').fill('2026-01-01');
  await form.getByLabel('سبب إعداد الضريبة').fill('اختبار صلاحيات مؤقتة'); await form.getByRole('button', { name: 'اعتماد الإعداد' }).click();
  const dialog = page.getByRole('dialog', { name: 'تحقق المالك وحفظ إعداد الضريبة' });
  await dialog.getByLabel('كلمة مرور الحساب').fill('synthetic-password'); await dialog.getByRole('button', { name: 'التحقق وحفظ الإعداد' }).click();
  await expect(page.getByRole('status')).toContainText('بالإصدار 1');
  const records = await cloudRecords(page); expect(records[`${root}/tax_configurations/paused-vat`].rate).toBe(5);
  expect(records[`${root}/members/guest`].role).toBe('Viewer'); expect(records[root].subscriptionStatus).toBe('expired');
  await page.reload(); await page.locator('#tab-accounting').click(); await page.getByTestId('tax-center-tab').click();
  await expect(page.getByRole('region', { name: 'سجل إعدادات الضرائب' })).toContainText('ضريبة اختبار الوصول');
});
