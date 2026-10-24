import { test, expect, defaultMerchantRecords, seedCloudMerchant, openMerchant, cloudRecords, guestId } from './helpers/cloudMerchant';
import { costState } from '../../src/domain/inventoryCost';

test.use({ controlsEnabled: false, serverAuthority: true });
const root = `organizations/${guestId}`;
function freeRecords(v2 = true) {
  const records = defaultMerchantRecords();
  Object.assign(records[root], { status: 'suspended', planId: 'missing-plan', subscriptionStatus: 'expired', subscriptionEnd: '2020-01-01' });
  if (v2) {
    records[root].accounting_version = 2;
    Object.assign(records[`${root}/products/product`], costState(0, 0, 0, '2026-01-01'));
  } else records[`${root}/products/product`].stock_quantity = 0;
  records[`${root}/meta/usage`] = { lifetimeInvoiceCount: 100 };
  records[`${root}/meta/counters`] = { invoice_count: 100, lifetime_invoice_count: 100 };
  return records;
}

test('free cloud company has no upgrade flow and V2 health loads after expiry and reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedCloudMerchant(page, freeRecords()); await openMerchant(page);
  await expect(page.getByRole('button', { name: 'فاتورة جديدة', exact: true }).first()).toBeEnabled();
  await expect(page.getByText('إدارة الاشتراك وطلب الترقية', { exact: true })).toHaveCount(0);
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
  await expect(settings.getByRole('heading', { name: 'سودافلو مجاني 100٪' })).toBeVisible();
  await expect(settings.getByText('كل المزايا متاحة بدون اشتراك مدفوع', { exact: false })).toBeVisible();
  await expect(settings.getByText('طلب ترقية (للمالك فقط)', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click(); await expect(settings).toHaveCount(0);
  await page.locator('#tab-accounting').click(); await page.getByTestId('accounting-health-tab').click();
  const center = page.getByRole('region', { name: 'مركز صحة المحاسبة' });
  await expect(center.getByTestId('health-check')).toHaveCount(6);
  await expect(center.getByRole('alert')).toHaveCount(0);
  await page.reload(); await page.locator('#tab-accounting').click(); await page.getByTestId('accounting-health-tab').click();
  await expect(page.getByRole('region', { name: 'مركز صحة المحاسبة' }).getByTestId('health-check')).toHaveCount(6);
  const records = await cloudRecords(page);
  expect(records[root].subscriptionStatus).toBe('expired'); expect(records[root].planId).toBe('missing-plan');
  expect(records[`${root}/meta/usage`].lifetimeInvoiceCount).toBe(100);
});

test('free legacy company documents its cost before server-verified V2 activation and persists after reload', async ({ page }) => {
  await seedCloudMerchant(page, freeRecords(false)); await openMerchant(page); await page.locator('#tab-products').click();
  const activate = page.getByRole('button', { name: 'تفعيل المحاسبة V2 بعد المطابقة', exact: true });
  await expect(activate).toBeDisabled();
  await page.getByRole('button', { name: 'تسجيل تكلفة أو استلام مخزون', exact: true }).click();
  const cost = page.getByRole('dialog', { name: 'تكلفة المخزون' });
  await cost.getByLabel('منتج التكلفة', { exact: true }).selectOption('product');
  await cost.getByLabel('تكلفة الوحدة الموثقة', { exact: true }).fill('2');
  await cost.getByLabel('عملة التكلفة', { exact: true }).selectOption('USD');
  await cost.getByLabel('سعر صرف التكلفة', { exact: true }).fill('2000');
  await cost.getByLabel('سبب العملية ومرجع وثيقة التكلفة').fill('رصيد فارغ موثق؛ بيانات اصطناعية');
  await cost.getByRole('button', { name: 'حفظ عملية التكلفة', exact: true }).click(); await expect(cost).toHaveCount(0);
  await expect(activate).toBeEnabled(); await activate.click();
  await expect(page.getByText('المحاسبة V2 مفعّلة', { exact: false })).toBeVisible();
  const records = await cloudRecords(page); expect(records[root].accounting_version).toBe(2); expect(records[root].subscriptionStatus).toBe('expired');
  expect(Object.values(records).filter(row => row.action === 'accounting.activate')).toHaveLength(1);
  await page.reload(); await page.locator('#tab-products').click();
  await expect(page.getByText('المحاسبة V2 مفعّلة', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تفعيل المحاسبة V2 بعد المطابقة', exact: true })).toHaveCount(0);
});
