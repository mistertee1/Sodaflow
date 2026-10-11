import {test, expect, type Page} from '@playwright/test';
import {INITIAL_SETTINGS} from '../../src/data/initialData';
import {createDefaultSubscription, getPlanConfig} from '../../src/lib/plans';
import {getDefaultChartOfAccounts} from '../../src/services/accountingService';
import {journal, journalLine} from '../../src/domain/financial';
import {fixedAssetRegistrationEvidence} from '../../src/domain/fixedAssetSources';

const org = 'local-guest-org', root = `organizations/${org}`;
const assetInput = {id: 'FA-UI', name: 'حاسوب المبيعات', category: 'معدات', purchase_date: '2026-09-01', in_service_date: '2026-09-01', source_journal_id: 'asset-source', source_line_index: 0, useful_life_months: 12, residual_value_sdg: 0, residual_value_usd: 0, asset_account_code: '1500', accumulated_depreciation_account_code: '1590', depreciation_expense_account_code: '5600', reason: 'تسجيل شراء موثق', reference_number: 'FA-2026'};
async function seed(page: Page, role = 'Owner', registered = false) {
  const accounts: any[] = getDefaultChartOfAccounts(org);
  for (const [code, name, type, nature, group] of [['1500', 'معدات', 'ASSET', 'DEBIT', 'fixed_assets'], ['1590', 'مجمع إهلاك', 'ASSET', 'CREDIT', 'fixed_assets'], ['5600', 'مصروف إهلاك', 'EXPENSE', 'DEBIT', 'operating_expense']]) {
    const account = {code, name_ar: name, name_en: name, type, nature, reporting_group: group, is_active: true, is_system: false, balance_sdg: 0, balance_usd: 0, org_id: org};
    const index = accounts.findIndex(row => row.code === code); if (index >= 0) accounts[index] = account; else accounts.push(account);
  }
  const entry = journal('asset-source', org, 'guest', '2026-09-01', 'manual', 'asset-buy', 'شراء حاسوب', [journalLine('1500', 'معدات', 1200, 0, 12, 0), journalLine('1130', 'بنك', 0, 1200, 0, 12)], 100);
  const records: Record<string, any> = {
    [root]: {id: org, owner_uid: role === 'Owner' ? 'guest' : 'owner', name: 'اختبار الأصول', status: 'active', accounting_version: 2, settings: INITIAL_SETTINGS},
    [`${root}/members/guest`]: {uid: 'guest', org_id: org, role, status: 'active'},
    [`${root}/meta/subscription`]: {...createDefaultSubscription(org), ...getPlanConfig('Enterprise'), plan: 'Enterprise', org_id: org},
    [`${root}/journal_entries/asset-source`]: entry,
    [`${root}/accounting_periods/sep`]: {id: 'sep', org_id: org, schema_version: 1, start_date: '2026-09-01', end_date: '2026-09-30', status: 'OPEN', revision: 1, created_by: 'guest', created_at: '2026-09-01', operation_id: 'period-sep'},
  };
  for (const account of accounts) records[`${root}/accounts/${account.code}`] = account;
  if (registered) records[`${root}/fixed_assets/FA-UI`] = fixedAssetRegistrationEvidence(assetInput, {org_id: org, accounts, journal_entries: [entry], fixed_assets: []}, {operation_id: 'seed-asset', created_by: 'guest', created_at: '2026-09-02T12:00:00Z'});
  await page.addInitScript(records => {
    localStorage.setItem('mohasbasd_guest_session', 'true'); localStorage.setItem('sudanese_merchant_has_seen_tour_v2', 'true');
    if (!localStorage.getItem('sudaflow_guest_transactions_v3')) localStorage.setItem('sudaflow_guest_transactions_v3', JSON.stringify(records));
  }, records);
  await page.goto('/'); await page.locator('#tab-accounting').click(); await page.getByTestId('fixed-assets-tab').click();
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}'));
async function fillRegister(page: Page) {
  const form = page.getByRole('form', {name: 'تسجيل أصل ثابت'});
  await form.getByLabel('طرف قيد شراء الأصل').selectOption('asset-source/0'); await form.getByLabel('رمز الأصل').fill('FA-UI');
  await form.getByLabel('اسم الأصل', {exact: true}).fill('حاسوب المبيعات'); await form.getByLabel('فئة الأصل').fill('معدات');
  await form.getByLabel('حساب مجمع الإهلاك').selectOption('1590'); await form.getByLabel('حساب مصروف الإهلاك').selectOption('5600');
  await form.getByLabel('سبب تسجيل الأصل').fill('تسجيل شراء موثق'); await form.getByLabel('مرجع الأصل').fill('FA-2026'); return form;
}

test('C4.3 mobile registration and scheduled depreciation save once, reconcile, and survive reload', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844}); await seed(page); const form = await fillRegister(page);
  await form.getByRole('button', {name: 'معاينة الأصل بدون حفظ'}).click();
  const preview = page.getByRole('region', {name: 'معاينة الأصل المحمية'}); await expect(preview).toContainText('حاسوب المبيعات'); await expect(preview.getByRole('row')).toHaveCount(13);
  expect(Object.keys(await saved(page)).filter(key => key.includes('/fixed_assets/'))).toHaveLength(0);
  await expect(preview.getByRole('button', {name: 'تأكيد تسجيل الأصل'})).toBeDisabled(); await preview.getByRole('checkbox').check();
  await preview.getByRole('button', {name: 'تأكيد تسجيل الأصل'}).evaluate((button: HTMLButtonElement) => {button.click(); button.click();});
  await expect(page.getByRole('status')).toContainText('تم تسجيل الأصل'); let data = await saved(page);
  expect(Object.keys(data).filter(key => key.includes('/fixed_assets/'))).toHaveLength(1); expect(Object.keys(data).filter(key => key.includes('/journal_entries/'))).toHaveLength(1);
  await page.getByLabel('سبب قسط الإهلاك').fill('إهلاك سبتمبر'); await page.getByRole('button', {name: 'معاينة قسط الإهلاك بدون حفظ'}).click();
  await expect(preview).toContainText('مبلغ الإهلاك'); await expect(preview).toContainText('100'); expect(Object.keys(await saved(page)).filter(key => key.includes('/fixed_asset_depreciations/'))).toHaveLength(0);
  await preview.getByRole('checkbox').check(); await preview.getByRole('button', {name: 'ترحيل قسط الإهلاك'}).evaluate((button: HTMLButtonElement) => {button.click(); button.click();});
  await expect(page.getByRole('status')).toContainText('تم ترحيل قسط الإهلاك'); data = await saved(page);
  expect(data[`${root}/fixed_assets/FA-UI`].book_value_sdg).toBe(1100); expect(data[`${root}/fixed_assets/FA-UI`].book_value_usd).toBe(11);
  expect(Object.keys(data).filter(key => key.includes('/fixed_asset_depreciations/'))).toHaveLength(1); expect(Object.keys(data).filter(key => key.includes('/journal_entries/jv-fad-'))).toHaveLength(1);
  await page.reload(); await page.locator('#tab-accounting').click(); await page.getByTestId('fixed-assets-tab').click();
  const register = page.getByRole('region', {name: 'سجل الأصول المحفوظ'}); await expect(register).toContainText('حاسوب المبيعات'); await expect(register).toContainText('1,100');
  await register.getByRole('button', {name: 'عرض الأصل حاسوب المبيعات'}).click(); await expect(page.getByRole('region', {name: 'تفاصيل الأصل'})).toContainText('إهلاك سبتمبر');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('C4.3 Admin can inspect register/history but cannot register, preview or depreciate', async ({page}) => {
  await seed(page, 'Admin', true); const center = page.getByRole('region', {name: 'الأصول الثابتة والإهلاك', exact: true});
  await expect(center).toContainText('متاحان للمالك والمحاسب فقط'); await expect(center.getByRole('form', {name: 'تسجيل أصل ثابت'})).toHaveCount(0);
  await center.getByRole('button', {name: 'عرض الأصل حاسوب المبيعات'}).click(); await expect(center.getByRole('form', {name: 'إعداد قسط الإهلاك'})).toHaveCount(0);
  expect(Object.keys(await saved(page)).filter(key => key.includes('/fixed_asset_depreciations/'))).toHaveLength(0);
});

test('C4.3 rejected residual value preserves draft; changes invalidate reviewed quote before retry', async ({page}) => {
  await seed(page); const form = await fillRegister(page); await form.getByLabel('القيمة التخريدية SDG').fill('1300');
  await form.getByRole('button', {name: 'معاينة الأصل بدون حفظ'}).click(); await expect(page.getByRole('status')).toContainText('القيمة التخريدية'); await expect(form.getByLabel('اسم الأصل', {exact: true})).toHaveValue('حاسوب المبيعات');
  expect(Object.keys(await saved(page)).filter(key => key.includes('/fixed_assets/'))).toHaveLength(0); await form.getByLabel('القيمة التخريدية SDG').fill('0');
  await form.getByRole('button', {name: 'معاينة الأصل بدون حفظ'}).click(); const preview = page.getByRole('region', {name: 'معاينة الأصل المحمية'}); await expect(preview).toBeVisible(); await preview.getByRole('checkbox').check();
  await form.getByLabel('العمر الإنتاجي بالأشهر').fill('24'); await expect(preview).toHaveCount(0); await form.getByRole('button', {name: 'معاينة الأصل بدون حفظ'}).click(); await expect(preview.getByRole('row')).toHaveCount(25); await expect(preview.getByRole('checkbox')).not.toBeChecked();
});

test('C4.3 Accountant can review and post next installment; uncovered period keeps the reason and data unchanged', async ({page}) => {
  await page.clock.install({time: new Date('2026-11-30T12:00:00Z')});
  await seed(page, 'Accountant', true); await page.getByRole('button', {name: 'عرض الأصل حاسوب المبيعات'}).click();
  await page.getByLabel('سبب قسط الإهلاك').fill('إهلاك المحاسب'); await page.getByRole('button', {name: 'معاينة قسط الإهلاك بدون حفظ'}).click();
  const preview = page.getByRole('region', {name: 'معاينة الأصل المحمية'}); await expect(preview).toBeVisible();
  await preview.getByRole('checkbox').check(); await preview.getByRole('button', {name: 'ترحيل قسط الإهلاك'}).click(); await expect(page.getByRole('status')).toContainText('تم ترحيل');
  const after = await saved(page); expect(after[`${root}/fixed_assets/FA-UI`].revision).toBe(2);
  await page.getByLabel('سبب قسط الإهلاك').fill('إهلاك أكتوبر خارج الفترة'); await page.getByRole('button', {name: 'معاينة قسط الإهلاك بدون حفظ'}).click();
  await expect(page.getByRole('status')).toContainText('خارج الفترات'); await expect(page.getByLabel('سبب قسط الإهلاك')).toHaveValue('إهلاك أكتوبر خارج الفترة');
  expect(Object.keys(await saved(page)).filter(key => key.includes('/fixed_asset_depreciations/'))).toHaveLength(1);
});
