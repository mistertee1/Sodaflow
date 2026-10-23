import { test, expect, openMerchant, defaultMerchantRecords, seedCloudMerchant, cloudRecords, cloudMerchant, guestId } from './helpers/cloudMerchant';
import { costState } from '../../src/domain/inventoryCost';

test.use({ controlsEnabled: false });
const root = `organizations/${guestId}`;
function valuedEmptyRecords() {
  const records = defaultMerchantRecords();
  records[root].accounting_version = 2;
  Object.assign(records[`${root}/products/product`], costState(0, 0, 0, '2026-01-01'));
  return records;
}

test('adding documented opening stock previews and atomically records quantity and both cost books', async ({ page }) => {
  await seedCloudMerchant(page, valuedEmptyRecords()); await openMerchant(page); await page.locator('#tab-products').click();
  await page.getByRole('button', { name: 'إضافة منتج جديد', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'إضافة أو تعديل منتج' });
  await form.getByPlaceholder('مثال: سكر كنانة (جوال 50 كيلو)').fill('رصيد افتتاحي موثق');
  await form.getByLabel('كمية المخزون الافتتاحية', { exact: true }).fill('3.5');
  await form.getByLabel('تكلفة الوحدة الافتتاحية', { exact: true }).fill('0.01');
  await expect(form.getByRole('button', { name: 'إضافة المنتج', exact: true })).toBeDisabled();
  await form.getByLabel('سبب التكلفة الافتتاحية الصفرية', { exact: true }).fill('قيمة العينة تقرب إلى صفر في الدفترين');
  await expect(form.getByRole('button', { name: 'إضافة المنتج', exact: true })).toBeEnabled();
  await form.getByLabel('تكلفة الوحدة الافتتاحية', { exact: true }).fill('1000');
  await form.getByLabel('سبب التكلفة الافتتاحية الصفرية', { exact: true }).fill('');
  await form.getByLabel('صرف التكلفة الافتتاحية', { exact: true }).fill('2000');
  await expect(form.getByRole('status')).toContainText('إجمالي تكلفة المخزون');
  await form.getByRole('button', { name: 'إضافة المنتج', exact: true }).click(); await expect(form).toHaveCount(0);
  const records = await cloudRecords(page);
  const product = Object.entries(records).find(([path, row]) => path.startsWith(`${root}/products/`) && row.name === 'رصيد افتتاحي موثق')![1];
  expect(product.stock_quantity).toBe(3.5); expect(product.inventory_value_sdg).toBe(3500); expect(product.inventory_value_usd).toBe(1.75);
  const journals = Object.entries(records).filter(([path]) => path.startsWith(`${root}/journal_entries/`)).map(([, row]) => row);
  expect(journals).toHaveLength(1); expect(journals[0].lines.some((line: any) => line.account_code === '3900')).toBe(true);
});

test('inventory reorders a supplier product at a new manually entered cost and updates AP without a duplicate product', async ({ page }) => {
  await seedCloudMerchant(page, valuedEmptyRecords()); await openMerchant(page);
  const supplier = (await cloudMerchant(page).executeCommand('supplier.create', { name: 'مورد سابق', default_currency: 'SDG', payment_terms_days: 30 }, 'inventory-supplier')).result;
  const date = new Date().toISOString().slice(0, 10);
  await cloudMerchant(page).executeCommand('purchase.create', { supplier_id: supplier.id, supplier_reference: 'OLD-1', issue_date: date, due_date: date, currency: 'SDG', exchange_rate_used: 2000, settlement: 'credit', reason: 'توريد سابق موثق', items: [{ product_id: 'product', quantity: 2, unit_cost: 1000 }] }, 'inventory-old-purchase');
  await page.reload(); await expect(page.locator('.sf-app-shell')).toBeVisible(); await page.locator('#tab-products').click();
  await page.getByRole('button', { name: 'الموردون ومنتجاتهم والمشتريات والذمم الدائنة', exact: true }).click();
  const center = page.getByRole('region', { name: 'مركز الموردين والمشتريات' });
  await center.getByLabel('المورد للكشف', { exact: true }).selectOption(supplier.id);
  await expect(center.getByRole('region', { name: 'منتجات المورد السابقة' })).toContainText('منتج الاختبار');
  await center.getByRole('button', { name: 'فاتورة شراء جديدة', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'فاتورة شراء', exact: true });
  await form.getByLabel('منتجات سبق شراؤها من المورد فقط', { exact: true }).check();
  await form.getByLabel('منتج الشراء 1', { exact: true }).selectOption('product');
  await expect(form.getByLabel('تكلفة شراء 1', { exact: true })).toHaveValue('0');
  await form.getByLabel('كمية الشراء 1', { exact: true }).fill('3');
  await form.getByLabel('تكلفة شراء 1', { exact: true }).fill('2000');
  await form.getByLabel('رقم فاتورة المورد', { exact: true }).fill('NEW-2');
  await form.getByLabel('سبب الشراء', { exact: true }).fill('توريد جديد بتكلفة يدوية');
  await expect(form.getByRole('status')).toContainText('يضاف إلى ذمة المورد');
  await form.getByRole('button', { name: 'ترحيل فاتورة الشراء', exact: true }).click(); await expect(form).toHaveCount(0);
  const saved = await cloudRecords(page);
  expect(Object.keys(saved).filter(path => path.startsWith(`${root}/products/`))).toHaveLength(1);
  expect(saved[`${root}/products/product`].stock_quantity).toBe(5);
  expect(saved[`${root}/products/product`].inventory_value_sdg).toBe(8000);
  expect(saved[`${root}/products/product`].inventory_value_usd).toBe(4);
  const bills = Object.entries(saved).filter(([path]) => path.startsWith(`${root}/purchase_bills/`)).map(([, row]) => row);
  expect(bills).toHaveLength(2); expect(bills.find(bill => bill.supplier_reference === 'NEW-2')!.remaining_sdg).toBe(6000);
});

test('owner activates V2 from inventory only after documented costs and reconciliation', async ({ page }) => {
  const records = valuedEmptyRecords(); delete records[root].accounting_version;
  await seedCloudMerchant(page, records); await openMerchant(page); await page.locator('#tab-products').click();
  await page.getByRole('button', { name: 'تفعيل المحاسبة V2 بعد المطابقة', exact: true }).click();
  await expect(page.getByText('المحاسبة V2 مفعّلة', { exact: false })).toBeVisible();
  expect((await cloudRecords(page))[root].accounting_version).toBe(2);
});
