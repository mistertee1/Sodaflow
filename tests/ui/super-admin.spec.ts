import { test, expect } from './helpers/platform';

test('five RTL platform sections use isolated real backend data and fit mobile widths', async ({ page, platform }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform.login();
  const nav = page.getByRole('navigation', { name: 'أقسام إدارة المنصة' });
  await expect(nav.getByRole('button')).toHaveCount(5);
  await expect(page.getByText('إجمالي الشركات', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'الشركات', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'شركة اختبار', exact: false })).toBeVisible();
  await page.getByLabel('بحث باسم الشركة (بداية الاسم)').fill('غير موجود');
  await page.getByRole('button', { name: 'بحث وتصفية' }).click(); await expect(page.getByText('لا توجد شركات مطابقة.')).toBeVisible();
  await page.getByLabel('بحث باسم الشركة (بداية الاسم)').fill('شركة');
  await page.getByRole('button', { name: 'بحث وتصفية' }).click(); await expect(page.getByRole('button', { name: 'إدارة الاشتراك' })).toBeVisible();
  await page.getByRole('combobox', { name: 'حالة الاشتراك', exact: true }).selectOption('expired');
  await page.getByRole('button', { name: 'بحث وتصفية' }).click(); await expect(page.getByText('لا توجد شركات مطابقة.')).toBeVisible();
  await nav.getByRole('button', { name: 'الاشتراكات', exact: true }).click(); await expect(page.getByRole('heading', { name: 'طلبات ترقية تنتظر المراجعة' })).toBeVisible();
  await nav.getByRole('button', { name: 'الباقات', exact: true }).click(); await expect(page.getByRole('button', { name: 'تعديل الباقة والميزات' })).toHaveCount(5);
  await nav.getByRole('button', { name: 'سجل التعديلات', exact: true }).click(); await expect(page.getByRole('table')).toContainText('subscription.created');
  await page.getByText('عرض التغيير', { exact: true }).click(); await expect(page.getByRole('table')).toContainText('Free');
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.screenshot({ path: 'test-results/super-admin-mobile.png', fullPage: true });
  expect(platform.requests.filter(path => path.startsWith('/organizations'))).toEqual([]); expect(errors).toEqual([]);
});

test('an uncertain save retries the same identifier and creates a single renewal and audit event', async ({ page, platform }) => {
  await platform.login(); await page.getByRole('button', { name: 'الشركات', exact: true }).click(); await page.getByRole('button', { name: 'إدارة الاشتراك' }).click();
  const dialog = page.getByRole('dialog', { name: 'إدارة اشتراك الشركة' });
  await dialog.getByLabel('عدد الأيام').fill('5'); await dialog.getByLabel('سبب التعديل (إلزامي في سجل العمليات)').fill('تمديد اختبار');
  platform.abortAfterCommit(); await dialog.getByRole('button', { name: 'حفظ التعديل', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('تعذر تأكيد الحفظ');
  const afterFirst = platform.fixture.store.dump();
  await dialog.getByRole('button', { name: 'حفظ التعديل', exact: true }).click(); await expect(dialog.getByRole('status')).toContainText('تم حفظ التعديل');
  expect(platform.mutations).toHaveLength(2); expect(platform.mutations[0].operationId).toBe(platform.mutations[1].operationId);
  expect(platform.fixture.store.dump()).toEqual(afterFirst); expect(Object.values(afterFirst).filter(d => d.action === 'subscription.extend')).toHaveLength(1);
});

test('a confirmed save with a failed refresh remains distinct from an unconfirmed mutation', async ({ page, platform }) => {
  await platform.login(); await page.getByRole('button', { name: 'الشركات', exact: true }).click(); await page.getByRole('button', { name: 'إدارة الاشتراك' }).click();
  const dialog = page.getByRole('dialog', { name: 'إدارة اشتراك الشركة' }); await dialog.getByLabel('سبب التعديل (إلزامي في سجل العمليات)').fill('حفظ مؤكد للاختبار');
  platform.failCompanyRefresh(); await dialog.getByRole('button', { name: 'حفظ التعديل', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('تم حفظ التعديل'); await expect(dialog.getByRole('alert')).toContainText('تم الحفظ، لكن تعذر تحديث العرض');
  await expect(dialog.getByRole('button', { name: 'حفظ التعديل', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'تحديث قبل التعديل' }).click(); await expect(dialog.getByRole('alert')).toHaveCount(0); expect(platform.mutations).toHaveLength(1);
});

test('Free constraints stay fixed while features and custom plans remain editable', async ({ page, platform }) => {
  await platform.login(); await page.getByRole('button', { name: 'الباقات', exact: true }).click();
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'الباقة المجانية', exact: true }) }).getByRole('button', { name: 'تعديل الباقة والميزات' }).click();
  const dialog = page.getByRole('dialog', { name: 'تعديل الباقة' });
  for (const label of ['السعر', 'مدة الاشتراك بالأيام (المجانية: صفر)', 'دورة حصة الفواتير', 'المستخدمون، شاملاً المالك (999999 = غير محدود)', 'الفواتير (999999 = غير محدود)']) await expect(dialog.getByLabel(label)).toBeDisabled();
  await dialog.getByLabel('سجل تدقيق الشركة', { exact: true }).check(); await dialog.getByLabel('سبب التعديل', { exact: true }).fill('تفعيل سجل التدقيق');
  await dialog.getByRole('button', { name: 'حفظ الباقة والميزات' }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'باقة جديدة' })).toBeVisible(); await page.getByRole('button', { name: 'باقة جديدة' }).click();
  const create = page.getByRole('dialog', { name: 'إنشاء باقة' });
  await create.getByLabel('معرّف ثابت بالإنجليزية').fill('custom-professional'); await create.getByLabel('اسم الباقة', { exact: true }).fill('باقة خاصة'); await create.getByLabel('سبب التعديل', { exact: true }).fill('إنشاء باقة تجارية');
  await create.getByRole('button', { name: 'حفظ الباقة والميزات' }).click(); await expect(create).toHaveCount(0); await expect(page.getByRole('heading', { name: 'باقة خاصة', exact: true })).toBeVisible();
  expect(platform.fixture.store.dump()['plans/Free'].limits.maxInvoices).toBe(100); expect(platform.fixture.store.dump()['plans/Free'].features.audit_trail).toBe(true);
  expect(platform.fixture.store.dump()['plans/custom-professional'].revision).toBe(1);
});

test('dashboard failures recover through refresh without changing commercial data', async ({ page, platform }) => {
  platform.failOverview(); await platform.login(); await expect(page.getByRole('alert')).toContainText('تعذر إحصاء الشركات مؤقتاً');
  await page.getByRole('button', { name: 'تحديث البيانات', exact: true }).click(); await expect(page.getByText('إجمالي الشركات', { exact: true })).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0); expect(platform.mutations).toEqual([]);
});

test('a pending upgrade is approved in Subscriptions with a payment reference and audit evidence', async ({ page, platform }) => {
  const f = platform.fixture; await f.operations.execute(f.org.id, f.owner, { action: 'subscription.request', data: { plan: 'Business' }, operationId: 'ui-upgrade-request' });
  await platform.login(); await page.getByRole('button', { name: 'الاشتراكات', exact: true }).click(); await page.getByRole('button', { name: 'مراجعة الطلب', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'إدارة اشتراك الشركة' });
  await dialog.getByRole('combobox', { name: 'نوع التعديل', exact: true }).selectOption('change_plan'); await expect(dialog.getByRole('combobox', { name: 'الباقة الجديدة', exact: true })).toHaveValue('Business');
  await dialog.getByRole('combobox', { name: 'طريقة التفعيل أو التجديد', exact: true }).selectOption('bank_transfer'); await dialog.getByLabel('مرجع العملية أو الدفع', { exact: true }).fill('TRANSFER-001');
  await dialog.getByLabel('سبب التعديل (إلزامي في سجل العمليات)').fill('اعتماد تحويل العميل'); await dialog.getByLabel('اعتماد طلب الترقية المعلّق ضمن هذا التفعيل').check();
  await dialog.getByRole('button', { name: 'حفظ التعديل', exact: true }).click(); await expect(dialog.getByRole('status')).toContainText('تم حفظ التعديل');
  const state = f.store.dump(); expect(state[`organizations/${f.org.id}`].planId).toBe('Business'); expect(state[`organizations/${f.org.id}`].subscriptionMetadata.providerReference).toBe('TRANSFER-001'); expect(state[`subscriptionRequests/${f.org.id}`].status).toBe('fulfilled');
  await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click(); await expect(page.getByText('لا توجد طلبات معلّقة في هذه الصفحة.')).toBeVisible();
  await page.getByRole('button', { name: 'سجل التعديلات', exact: true }).click(); await expect(page.getByRole('table')).toContainText('اعتماد تحويل العميل'); await expect(page.getByRole('table')).toContainText('bank_transfer');
});

test('revocation with an open editor rejects the save and never reports success', async ({ page, platform }) => {
  await platform.login(); await page.getByRole('button', { name: 'الشركات', exact: true }).click(); await page.getByRole('button', { name: 'إدارة الاشتراك' }).click();
  const dialog = page.getByRole('dialog', { name: 'إدارة اشتراك الشركة' }); await dialog.getByLabel('سبب التعديل (إلزامي في سجل العمليات)').fill('يجب رفض هذا التعديل');
  const f = platform.fixture; await f.store.transaction(async tx => tx.set(`platformAdmins/${f.admin.uid}`, { role: 'super_admin', active: false })); const before = f.store.dump();
  await dialog.getByRole('button', { name: 'حفظ التعديل', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('غير فعّالة'); await expect(dialog.getByRole('status')).toHaveCount(0); expect(f.store.dump()).toEqual(before);
});

test('an exclusive policy change with an open editor rejects the save without a success notice', async ({ page, platform }) => {
  await platform.login(); await page.getByRole('button', { name: 'الشركات', exact: true }).click(); await page.getByRole('button', { name: 'إدارة الاشتراك' }).click();
  const dialog = page.getByRole('dialog', { name: 'إدارة اشتراك الشركة' }); await dialog.getByLabel('سبب التعديل (إلزامي في سجل العمليات)').fill('يجب رفض التعديل بعد إغلاق السياسة');
  const f = platform.fixture;
  await f.store.transaction(async tx => tx.set('platformAccess/superAdmin', { uid: f.admin.uid, email: f.admin.email, mode: 'exclusive', active: false }));
  const before = f.store.dump(); await dialog.getByRole('button', { name: 'حفظ التعديل', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('محصور'); await expect(dialog.getByRole('status')).toHaveCount(0); expect(f.store.dump()).toEqual(before);
});

test.describe('exclusive account isolation', () => {
  test.use({ platformRole: 'other_admin' });
  test('another verified claimed administrator with an active registry cannot open the platform', async ({ page, platform }) => {
    await platform.login(); await expect(page.getByRole('heading', { name: 'تعذر فتح الإدارة' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('محصور');
    await expect(page.getByRole('navigation', { name: 'أقسام إدارة المنصة' })).toHaveCount(0);
    expect(platform.requests.every(path => path === '/super-admin/session')).toBe(true); expect(platform.mutations).toEqual([]);
  });
});

test.describe('company Owner isolation', () => {
  test.use({ platformRole: 'owner' });
  test('Owner cannot open the commercial platform by visiting its URL', async ({ page, platform }) => {
    await platform.login(); await expect(page.getByRole('heading', { name: 'تعذر فتح الإدارة' })).toBeVisible(); await expect(page.getByRole('navigation', { name: 'أقسام إدارة المنصة' })).toHaveCount(0);
    await page.getByRole('button', { name: 'إعادة التحقق وتحديث جلسة الدخول' }).click(); await expect(page.getByRole('alert')).toContainText('لا يملك صلاحية إدارة المنصة'); expect(platform.requests.every(path => path === '/super-admin/session')).toBe(true);
  });
});
test.describe('unverified identity', () => {
  test.use({ verifiedEmail: false });
  test('unverified administrators see the verification instruction', async ({ page, platform }) => {
    await platform.login(); await expect(page.getByRole('alert').first()).toContainText('البريد الإلكتروني غير مؤكد'); await expect(page.getByRole('navigation', { name: 'أقسام إدارة المنصة' })).toHaveCount(0); expect(platform.mutations).toEqual([]);
  });
});
