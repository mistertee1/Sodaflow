import { test, expect, openMerchant, seedCloudMerchant, cloudMerchant, cloudRecords, guestId, guestActor, type Page } from './helpers/cloudMerchant';
import { periodGuestFixture } from './helpers/accountingPeriods';
import { readFile } from 'node:fs/promises';
test.use({ serverAuthority: true });
const root = `organizations/${guestId}`, second = 'scheduled-ui-other';
async function openSchedules(page: Page, role: 'Owner' | 'Accountant' | 'Viewer' = 'Owner', other = false) {
  const records = await periodGuestFixture(false, role);
  records[`user_organizations/${guestActor.uid}/orgs/${guestId}`] = { org_id: guestId };
  if (other) {
    records[`organizations/${second}`] = { ...records[root], id: second, owner_uid: guestActor.uid, name: 'مؤسسة التصدير الثانية', planId: 'Enterprise', subscriptionStatus: 'active', subscriptionEnd: '2099-01-01T00:00:00Z', settings: { ...records[root].settings, business_name: 'مؤسسة التصدير الثانية' } };
    records[`organizations/${second}/members/${guestActor.uid}`] = { uid: guestActor.uid, org_id: second, role: 'Owner', status: 'active' };
    records[`organizations/${second}/meta/subscription`] = { ...records[`${root}/meta/subscription`], org_id: second };
    records[`user_organizations/${guestActor.uid}/orgs/${second}`] = { org_id: second };
  }
  await seedCloudMerchant(page, records); await openMerchant(page); await page.locator('#tab-accounting').click(); await page.getByTestId('data-export-tab').click();
  const panel = page.getByTestId('scheduled-exports-center'); await expect(panel).toBeVisible();
  if (role !== 'Viewer') await expect(panel.getByLabel('اسم جدول التصدير', { exact: true })).toBeVisible();
  return panel;
}
const policies = async (page: Page) => Object.entries(await cloudRecords(page)).filter(([path]) => path.startsWith(root + '/export_schedules/')).map(([, row]) => row);
async function switchCompany(page: Page) {
  await page.getByTitle('الإعدادات', { exact: true }).click(); const settings = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
  await settings.locator('select').filter({ has: page.locator(`option[value="${second}"]`) }).selectOption(second); await expect(page.locator('header')).toContainText('مؤسسة التصدير الثانية');
  await settings.getByRole('button', { name: 'إغلاق النافذة', exact: true }).click(); await page.getByTestId('data-export-tab').click();
  await expect(page.getByTestId('scheduled-exports-center').getByLabel('اسم جدول التصدير', { exact: true })).toBeVisible();
}
async function completedExport(page: Page) {
  await cloudMerchant(page).executeCommand('journal.create', { reference_type: 'manual', date: '2026-10-24', description: 'مصدر ملف الجدولة', lines: [{ account_code: '5200', debit_sdg: 100, credit_sdg: 0, debit_usd: .05, credit_usd: 0 }, { account_code: '4100', debit_sdg: 0, credit_sdg: 100, debit_usd: 0, credit_usd: .05 }] }, 'schedule-ui-source');
  const queued = await cloudMerchant(page).executeCommand('largeExport.request', { kind: 'accounting', period: { start: '2026-10-01', end: '2026-10-31' } }, 'schedule-ui-file');
  const sources = Object.fromEntries(Object.entries(await cloudRecords(page)).filter(([path]) => /\/(journal_entries|accounts|products|invoices|purchase_bills)\//.test(path)));
  const done = await cloudMerchant(page).runExportWorker(); expect(done?.status).toBe('completed');
  const panel = page.getByTestId('scheduled-exports-center'); await panel.getByRole('button', { name: 'تحديث بيانات الجداول' }).click();
  const row = panel.getByTestId(`export-job-${queued.result.id}`); await expect(row).toContainText('مكتمل');
  return { panel, row, sources };
}

test('Mobile cloud schedule creates once, edits weekly to monthly with cleared optional fields, pauses/resumes and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const panel = await openSchedules(page);
  await expect(panel.getByTestId('schedule-execution-state')).toContainText('التشغيل التلقائي غير مفعّل');
  await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('ملف أسبوعي'); await panel.getByLabel('تكرار جدول التصدير').selectOption('weekly');
  await panel.getByLabel('يوم جدول التصدير').selectOption('5'); await panel.getByLabel('نهاية جدول التصدير').fill('2026-12-31');
  await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(panel.getByRole('status')).toContainText('تم تأكيد حفظ الجدول'); expect(await policies(page)).toHaveLength(1);
  let [policy] = await policies(page); await expect(panel.getByTestId(`export-schedule-${policy.id}`)).toContainText('أسبوعي');
  await panel.getByRole('button', { name: 'تعديل الجدول ملف أسبوعي', exact: true }).click(); await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('ملف شهري');
  await panel.getByLabel('تكرار جدول التصدير').selectOption('monthly'); await panel.getByLabel('يوم شهر جدول التصدير').fill('31'); await panel.getByLabel('نهاية جدول التصدير').fill('');
  await panel.getByRole('button', { name: 'تأكيد تعديل الجدول', exact: true }).click(); await expect(panel.getByRole('status')).toContainText('تم تأكيد تعديل الجدول');
  [policy] = await policies(page); expect(policy.revision).toBe(2); expect(policy.month_day).toBe(31); expect(policy.weekday).toBeUndefined(); expect(policy.end_date).toBeUndefined();
  await panel.getByRole('button', { name: 'إيقاف الجدول ملف شهري', exact: true }).click(); await expect(panel.getByRole('button', { name: 'استئناف الجدول ملف شهري', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'استئناف الجدول ملف شهري', exact: true }).click(); await expect(panel.getByRole('button', { name: 'إيقاف الجدول ملف شهري', exact: true })).toBeVisible();
  [policy] = await policies(page); expect(policy.revision).toBe(4); expect(policy.active).toBe(true);
  expect(Object.entries(await cloudRecords(page)).filter(([path, r]) => path.includes('/audit_logs/') && r.action === 'exportSchedule.create')).toHaveLength(1);
  await page.reload(); await page.locator('#tab-accounting').click(); await page.getByTestId('data-export-tab').click(); await expect(page.getByTestId(`export-schedule-${policy.id}`)).toContainText('ملف شهري');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('A lost save response and failed intent acknowledgement reuse one cloud operation without a false early success', async ({ page }) => {
  const panel = await openSchedules(page); await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('إعادة آمنة'); cloudMerchant(page).abortAfterCommit();
  await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('تعذر تأكيد الحفظ');
  expect(await policies(page)).toHaveLength(1); await expect(panel.getByRole('status')).toHaveCount(0);
  cloudMerchant(page).failNextAcknowledgement(); await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).click(); await expect(panel.getByRole('status')).toContainText('تم تأكيد حفظ الجدول');
  expect(await policies(page)).toHaveLength(1); const attempts = cloudMerchant(page).mutations.filter(row => row.input?.name === 'إعادة آمنة'); expect(attempts).toHaveLength(2); expect(attempts[0].operationId).toBe(attempts[1].operationId);
  expect(Object.entries(await cloudRecords(page)).filter(([path, row]) => path.includes('/audit_logs/') && row.action === 'exportSchedule.create')).toHaveLength(1);
});
test('A stale revision requires review of the latest schedule and never reapplies the old edit automatically', async ({ page }) => {
  const panel = await openSchedules(page); await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('الأصل'); await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'تعديل الجدول الأصل', exact: true })).toBeVisible(); const [policy] = await policies(page);
  await panel.getByRole('button', { name: 'تعديل الجدول الأصل', exact: true }).click(); await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('تعديل قديم');
  await cloudMerchant(page).updateSchedule(policy.id, 1, { name: 'تعديل العميل الثاني' }, 'raced-schedule');
  await panel.getByRole('button', { name: 'تأكيد تعديل الجدول', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('راجع الجدول الحالي');
  await expect(panel.getByRole('button', { name: 'تعديل الجدول تعديل العميل الثاني', exact: true })).toBeVisible(); expect((await policies(page))[0]).toMatchObject({ revision: 2, name: 'تعديل العميل الثاني' });
  await expect(panel.getByLabel('اسم جدول التصدير', { exact: true })).toHaveValue('');
});
test('Accountant schedule choices come from current API grants and exclude the full company package', async ({ page }) => {
  const panel = await openSchedules(page, 'Accountant');
  expect(await panel.getByLabel('نوع ملف الجدول').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['accounting', 'auditor']);
  await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('جدول المراجع'); await panel.getByLabel('نوع ملف الجدول').selectOption('auditor');
  await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).click(); await expect(panel.getByRole('status')).toContainText('تم تأكيد حفظ الجدول'); expect((await policies(page))[0]).toMatchObject({ kind: 'auditor', created_by: guestActor.uid });
});
test('Full company schedule is owner-only and pins the data period to the complete package', async ({ page }) => {
  const panel = await openSchedules(page); await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('شركة كاملة'); await panel.getByLabel('نوع ملف الجدول').selectOption('company');
  await expect(panel.getByLabel('فترة بيانات الجدول')).toBeDisabled(); await expect(panel.getByLabel('فترة بيانات الجدول')).toHaveValue('full');
  await panel.getByLabel('ساعات الاحتفاظ بملف الجدول').fill('2'); await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('تم تأكيد حفظ الجدول'); expect((await policies(page))[0]).toMatchObject({ kind: 'company', period_kind: 'full', retention_hours: 2 });
});
test('Cloud read and write failures show a retry state without claiming that a schedule was saved', async ({ page }) => {
  const panel = await openSchedules(page); cloudMerchant(page).failCloudReads(); await panel.getByRole('button', { name: 'تحديث بيانات الجداول' }).click(); await expect(panel.getByRole('alert')).toContainText('خدمة Firebase غير متاحة');
  await expect(panel.getByLabel('اسم جدول التصدير', { exact: true })).toHaveCount(0); cloudMerchant(page).recoverCloudReads(); await panel.getByRole('button', { name: 'تحديث بيانات الجداول' }).click();
  await expect(panel.getByLabel('اسم جدول التصدير', { exact: true })).toBeVisible(); await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('بعد استعادة الاتصال'); cloudMerchant(page).failNextWrite();
  await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible(); expect(await policies(page)).toHaveLength(0); await expect(panel.getByRole('status')).toHaveCount(0);
  await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).click(); await expect(panel.getByRole('status')).toContainText('تم تأكيد حفظ الجدول'); expect(await policies(page)).toHaveLength(1);
});
test('History downloads real numeric worker bytes and removes temporary links when current Auth is revoked', async ({ page }, testInfo) => {
  await openSchedules(page); const { panel, row, sources } = await completedExport(page);
  await row.getByRole('button', { name: 'تجهيز رابط التنزيل' }).click(); const link = row.getByRole('link', { name: 'تنزيل الملف', exact: true }); await expect(link).toHaveAttribute('href', /^https:\/\/private-export\.invalid\//);
  const waiting = page.waitForEvent('download'); await link.click(); const download = await waiting, path = testInfo.outputPath('worker-export.xls'); await download.saveAs(path);
  const text = await readFile(path, 'utf8'); expect(text).toContain('ss:Type="Number">100<'); expect(text).toContain('ss:Type="Number">0.05<'); expect(download.suggestedFilename()).toMatch(/\.xls$/);
  const after = await cloudRecords(page); for (const [key, value] of Object.entries(sources)) expect(after[key]).toEqual(value);
  cloudMerchant(page).disableExportAccount(); await panel.getByRole('button', { name: 'تحديث بيانات الجداول' }).click(); await expect(panel.getByRole('alert')).toBeVisible(); await expect(panel.getByRole('link', { name: 'تنزيل الملف', exact: true })).toHaveCount(0); await expect(panel.getByLabel('اسم جدول التصدير', { exact: true })).toHaveCount(0);
});
test('Switching company during a durable intent response prevents the old business write from being sent', async ({ page }) => {
  const panel = await openSchedules(page, 'Owner', true); await panel.getByLabel('اسم جدول التصدير', { exact: true }).fill('طلب لا ينتقل');
  let release!: () => void, arrived!: () => void; const pending = new Promise<void>(r => { arrived = r; }), gate = new Promise<void>(r => { release = r; });
  await page.route('**/api/operation-intents', async route => { arrived(); await gate; await route.fallback(); });
  try {
    await panel.getByRole('button', { name: 'حفظ جدول التصدير', exact: true }).click(); await pending; await switchCompany(page);
    const response = page.waitForResponse(r => r.url().endsWith('/operation-intents')); release(); await (await response).finished(); await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(cloudMerchant(page).mutations.filter(row => row.input?.name === 'طلب لا ينتقل')).toHaveLength(0); expect(await policies(page)).toHaveLength(0);
    await expect(page.getByTestId('scheduled-exports-center').getByLabel('اسم جدول التصدير', { exact: true })).toHaveValue('');
  } finally { release(); }
});
test('A delayed download response from the previous company never displays its signed URL in the new company', async ({ page }) => {
  await openSchedules(page, 'Owner', true); const { row } = await completedExport(page);
  let release!: () => void, arrived!: () => void; const pending = new Promise<void>(r => { arrived = r; }), gate = new Promise<void>(r => { release = r; });
  await page.route('**/export-jobs/**/download', async route => { arrived(); await gate; await route.fallback(); });
  try {
    await row.getByRole('button', { name: 'تجهيز رابط التنزيل' }).click(); await pending; await switchCompany(page);
    const response = page.waitForResponse(r => r.url().endsWith('/download')); release(); await (await response).finished(); await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.getByTestId('scheduled-exports-center').getByRole('link', { name: 'تنزيل الملف', exact: true })).toHaveCount(0);
    expect(Object.values(await cloudRecords(page)).filter(r => r.org_id === second && r.artifact)).toHaveLength(0);
  } finally { release(); }
});
test('An invalid signed-link response is rejected before rendering an executable or insecure link', async ({ page }) => {
  await openSchedules(page); const { panel, row } = await completedExport(page);
  await page.route('**/export-jobs/**/download', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'javascript:alert(1)', expires_at: new Date(Date.now() + 60000).toISOString() }) }));
  await row.getByRole('button', { name: 'تجهيز رابط التنزيل' }).click(); await expect(panel.getByRole('alert')).toContainText('غير آمن'); await expect(panel.getByRole('link', { name: 'تنزيل الملف', exact: true })).toHaveCount(0);
});
test.describe('Actual Viewer while ordinary platform controls are paused', () => {
  test.use({ controlsEnabled: false });
  test('Effective Owner hints do not expose schedule forms or history for a Viewer', async ({ page }) => {
    const panel = await openSchedules(page, 'Viewer'); await expect(panel).toContainText('لصاحب الصلاحية المالية فقط'); await expect(panel.getByLabel('اسم جدول التصدير', { exact: true })).toHaveCount(0); expect(cloudMerchant(page).requests.filter(path => path.endsWith('/export-schedules') || path.endsWith('/export-job-history'))).toHaveLength(0);
  });
});
