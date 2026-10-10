import { test, expect, type Page } from '@playwright/test';
import { freshOpeningBooksFixture } from '../fixtures/openingBooks';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
import { createDefaultSubscription, getPlanConfig } from '../../src/lib/plans';

async function seed(page: Page, role = 'Owner') {
  const org = 'local-guest-org', root = `organizations/${org}`, { data } = freshOpeningBooksFixture(org, 'guest');
  const records: Record<string, any> = {
    [root]: { id: org, owner_uid: role === 'Owner' ? 'guest' : 'other-owner', name: 'متجر اختبار الأرصدة', status: 'active', accounting_version: 2, settings: INITIAL_SETTINGS },
    [`${root}/members/guest`]: { uid: 'guest', role, status: 'active' },
    [`${root}/meta/subscription`]: { ...createDefaultSubscription(org), ...getPlanConfig('Enterprise'), plan: 'Enterprise', org_id: org },
    [`${root}/accounting_periods/start`]: { schema_version: 1, operation_id: 'period-start', id: 'start', org_id: org, start_date: '2026-01-01', end_date: '2026-12-31', status: 'OPEN', revision: 1, reason: 'اختبار', created_by: 'guest', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  };
  for (const [name, rows] of Object.entries(data)) for (const row of rows) records[`${root}/${name}/${name === 'accounts' ? row.code : row.id}`] = row;
  for (const row of data.financial_accounts) records[`${root}/financial_account_mappings/${row.account_code}`] = { id: row.id };
  await page.addInitScript(records => {
    localStorage.setItem('mohasbasd_guest_session', 'true'); localStorage.setItem('sudanese_merchant_has_seen_tour_v2', 'true');
    if (!localStorage.getItem('sudaflow_guest_transactions_v3')) localStorage.setItem('sudaflow_guest_transactions_v3', JSON.stringify(records));
  }, records);
  await page.goto('/'); await page.locator('#tab-accounting').click();
  await page.getByRole('button', { name: 'الأرصدة الافتتاحية والسداد', exact: true }).click();
}
async function prepare(page: Page) {
  const center = page.getByRole('region', { name: 'الأرصدة الافتتاحية والسداد', exact: true });
  await center.getByLabel('تاريخ الأرصدة', { exact: true }).fill('2026-10-01');
  await center.getByLabel('سبب بدء الأرصدة').fill('افتتاح تمت مراجعته');
  await center.getByRole('button', { name: 'إضافة نقدية وبنوك', exact: true }).click();
  await center.getByLabel('المصدر 1', { exact: true }).selectOption('cash'); await center.getByLabel('المبلغ 1', { exact: true }).fill('1000');
  await center.getByRole('button', { name: 'إضافة قروش ليك عند العملاء', exact: true }).click();
  await center.getByLabel('المصدر 2', { exact: true }).selectOption('a'); await center.getByLabel('المبلغ 2', { exact: true }).fill('100');
  await center.getByLabel('مرجع الرصيد 2').fill('AR-START'); await center.getByLabel('رأس المال SDG', { exact: true }).fill('1100');
  await center.getByRole('button', { name: 'معاينة الأرصدة بدون حفظ', exact: true }).click();
  await expect(center.getByRole('region', { name: 'مراجعة الأرصدة' })).toBeVisible();
  return center;
}
const records = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}'));

test('C2 wizard mobile read-only preview, owner confirmation, atomic commit and opening settlement persist after reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page);
  const before = await records(page), center = await prepare(page);
  expect(await records(page)).toEqual(before);
  await center.getByRole('button', { name: 'تحقق المالك وحفظ الأرصدة', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'تحقق المالك وحفظ الأرصدة' });
  await expect(dialog.getByLabel('سبب تأكيد الأرصدة')).toHaveValue('افتتاح تمت مراجعته');
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'التحقق وحفظ الأرصدة', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(center.getByText('دفعة الأرصدة محفوظة.', { exact: false })).toBeVisible();
  let saved = await records(page); const batches = Object.entries(saved).filter(([path]) => path.includes('/opening_batches/')); expect(batches).toHaveLength(1);
  const lot = Object.entries(saved).find(([path]) => path.includes('/opening_lots/'))!;
  await center.getByLabel('مصدر السداد').selectOption((lot[1] as any).id); await center.getByLabel('حساب السداد').selectOption('cash');
  await center.getByLabel('تاريخ سداد الرصيد').fill('2026-10-02'); await center.getByLabel('مبلغ سداد الرصيد').fill('100'); await center.getByLabel('سبب سداد الرصيد').fill('تحصيل كامل');
  await center.getByRole('button', { name: 'تحصيل رصيد العميل', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); }); await expect(center.getByRole('status')).toContainText('تم حفظ السداد');
  saved = await records(page); expect(Object.entries(saved).filter(([path]) => path.includes('/opening_settlements/'))).toHaveLength(1);
  expect(saved['organizations/local-guest-org/customers/a'].balance_sdg).toBe(0);
  await page.reload(); await page.locator('#tab-accounting').click(); await page.getByRole('button', { name: 'الأرصدة الافتتاحية والسداد', exact: true }).click();
  await expect(page.getByText('دفعة الأرصدة محفوظة.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('opening-wizard-mobile.png'),fullPage:true});
});

test('C2 wizard rejects unreviewed equity and invalidates preview after input edits', async ({ page }) => {
  await seed(page); const center = await prepare(page);
  await center.getByLabel('رأس المال SDG', { exact: true }).fill('0'); await expect(center.getByRole('region', { name: 'مراجعة الأرصدة' })).toHaveCount(0);
  await center.getByRole('button', { name: 'معاينة الأرصدة بدون حفظ', exact: true }).click();
  await expect(center.getByText('اكتب تفسير فرق حقوق الملكية وأعد المعاينة.')).toBeVisible(); await expect(center.getByRole('button', { name: 'تحقق المالك وحفظ الأرصدة', exact: true })).toBeDisabled();
  await center.getByLabel('تفسير فرق حقوق الملكية').fill('أرباح افتتاحية راجعها المحاسب'); await center.getByRole('button', { name: 'معاينة الأرصدة بدون حفظ', exact: true }).click();
  await expect(center.getByRole('button', { name: 'تحقق المالك وحفظ الأرصدة', exact: true })).toBeEnabled();
});

test('C2 Accountant can prepare protected preview but cannot open owner commit', async ({ page }) => {
  await seed(page, 'Accountant'); const center = await prepare(page);
  await expect(center.getByRole('button', { name: 'تحقق المالك وحفظ الأرصدة', exact: true })).toBeDisabled();
  await expect(center.getByText('المحاسب يجهز المعاينة؛ الحفظ يتطلب المالك.')).toBeVisible();
  expect(Object.keys(await records(page)).filter(path => path.includes('/opening_batches/'))).toHaveLength(0);
});
