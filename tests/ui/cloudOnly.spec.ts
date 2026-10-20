import { test, expect, openMerchant, cloudRecords } from './helpers/cloudMerchant';

test('a legacy guest flag and local financial records cannot open a signed-out business session', async ({ page, merchant }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mohasbasd_guest_session', 'true');
    localStorage.setItem('sudaflow_guest_transactions_v3', JSON.stringify({ 'organizations/legacy/invoices/private': { customer_name: 'فاتورة محلية سرية' } }));
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'دخول الحساب السحابي', exact: true })).toBeVisible();
  await expect(page.locator('.sf-app-shell')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('فاتورة محلية سرية');
  expect(merchant.requests).toEqual([]);
  // Retire the reader, never silently destroy/import someone's old financial file.
  expect(await page.evaluate(() => localStorage.getItem('sudaflow_guest_transactions_v3'))).toContain('فاتورة محلية سرية');
});

test('confirmed cloud writes survive reload without business data or retry IDs in browser storage', async ({ page, merchant }) => {
  await page.addInitScript(() => {
    (window as any).__businessStorageWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (/^(sudaflow_|hisabuk_|mohasbasd_|sudanese_merchant_)/.test(key)) (window as any).__businessStorageWrites.push(key);
      return original.call(this, key, value);
    };
  });
  await openMerchant(page);
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
  await dialog.getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' }).fill('اسم محفوظ في Firebase');
  await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(page.locator('header')).toContainText('اسم محفوظ في Firebase');
  expect((await cloudRecords(page))['organizations/local-guest-org'].settings.business_name).toBe('اسم محفوظ في Firebase');
  const reads = merchant.requests.filter(path => path.endsWith('/snapshot')).length;
  expect(await page.evaluate(() => (window as any).__businessStorageWrites)).toEqual([]);
  await page.reload();
  await expect(page.locator('header')).toContainText('اسم محفوظ في Firebase');
  expect(merchant.requests.filter(path => path.endsWith('/snapshot')).length).toBeGreaterThan(reads);
  expect(await page.evaluate(() => (window as any).__businessStorageWrites)).toEqual([]);
  expect(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(key => /^(sudaflow_|hisabuk_|mohasbasd_|sudanese_merchant_)/.test(key)))).toEqual([]);
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name || ''));
  expect(databases.some(name => name.startsWith('firestore/'))).toBe(false);
});

test('a reload during a cloud outage ignores legacy snapshots and recovers from the same cloud tenant', async ({ page, merchant }) => {
  await openMerchant(page);
  await page.evaluate(() => {
    localStorage.setItem('sudaflow_cloud_snapshot_v2_sodaflow_(default)_guest_local-guest-org', JSON.stringify({ version: 1, uid: 'guest', orgId: 'local-guest-org', savedAt: new Date().toISOString(), snapshot: { schema_version: 3, org: { id: 'local-guest-org' }, settings: { business_name: 'نسخة قديمة غير موثوقة' }, collections: { invoices: [{ grand_total_sdg: 999999 }] } } }));
  });
  const before = await cloudRecords(page);
  merchant.failCloudReads(); await page.reload();
  await expect(page.getByRole('alert')).toContainText('خدمة Firebase غير متاحة');
  await expect(page.getByRole('heading', { name: 'الاتصال بمؤسستك على Firebase' })).toBeVisible();
  await expect(page.locator('.sf-app-shell')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('نسخة قديمة غير موثوقة');
  expect(await cloudRecords(page)).toEqual(before); expect(merchant.mutations).toEqual([]);
  merchant.recoverCloudReads(); await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await expect(page.locator('header')).toContainText('متجر الاختبار');
  expect(await cloudRecords(page)).toEqual(before);
});

test('a lost cloud acknowledgement retries after reload with the same Firebase ID and one server transaction', async ({ page, merchant }) => {
  await openMerchant(page);
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
  await dialog.getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' }).fill('معاملة مؤكدة مرة واحدة');
  merchant.abortAfterCommit(); await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(dialog.getByRole('alert')).toContainText('تعذر تأكيد الحفظ');
  await expect(page.locator('header')).not.toContainText('معاملة مؤكدة مرة واحدة');
  const committed = await cloudRecords(page);
  await page.reload(); await expect(page.locator('header')).toContainText('معاملة مؤكدة مرة واحدة');
  await page.getByTitle('الإعدادات', { exact: true }).click();
  await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('header')).toContainText('معاملة مؤكدة مرة واحدة');
  expect(await cloudRecords(page)).toEqual(committed);
  const commands = merchant.mutations.filter(row => row.action === 'settings.update');
  expect(commands).toHaveLength(2); expect(commands[0].operationId).toBe(commands[1].operationId);
});

test('a confirmed save remains successful when cloud retry cleanup fails and reload cannot duplicate it', async ({ page, merchant }) => {
  await openMerchant(page); await page.getByTitle('الإعدادات', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'إعدادات المؤسسة' });
  await dialog.getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' }).fill('حفظ مؤكد رغم فشل التنظيف');
  merchant.failNextAcknowledgement(); await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('header')).toContainText('حفظ مؤكد رغم فشل التنظيف');
  await expect(page.getByRole('alert')).toHaveCount(0); const committed = await cloudRecords(page);
  await page.reload(); await expect(page.locator('header')).toContainText('حفظ مؤكد رغم فشل التنظيف');
  await page.getByTitle('الإعدادات', { exact: true }).click(); await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(dialog).toHaveCount(0); expect(await cloudRecords(page)).toEqual(committed);
  const commands = merchant.mutations.filter(row => row.action === 'settings.update');
  expect(commands).toHaveLength(2); expect(commands[0].operationId).toBe(commands[1].operationId);
});
