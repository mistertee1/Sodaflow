import { test, expect, type Page } from '@playwright/test';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../../src/types';
import { createDefaultSubscription } from '../../src/lib/plans';

const uid = 'test-cloud-owner', email = 'owner@example.com';
const cloudStateKey = 'sudaflow_ui_test_direct_cloud_v1';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU8sAAAAASUVORK5CYII=', 'base64');

async function fakeFirebase(page: Page, emailVerified: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const token = [
    { alg: 'RS256', typ: 'JWT' },
    { aud: 'sodaflow', iss: 'https://securetoken.google.com/sodaflow', sub: uid, user_id: uid, auth_time: now, iat: now, exp: now + 3600, email, email_verified: emailVerified, firebase: { sign_in_provider: 'password' } },
  ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.test-signature';
  const requests: string[] = [];
  await page.route('https://identitytoolkit.googleapis.com/**', async route => {
    const action = new URL(route.request().url()).pathname.split(':').at(-1)!;
    requests.push(action);
    const body = route.request().postDataJSON();
    let response: unknown;
    if (action === 'lookup') response = { users: [{ localId: uid, email, emailVerified, displayName: 'مالك الاختبار', providerUserInfo: [{ providerId: 'password', email }], createdAt: String(Date.now()), lastLoginAt: String(Date.now()) }] };
    else if (action === 'sendOobCode') response = { email };
    else if (action === 'update') response = { localId: uid, email, displayName: body.displayName, idToken: token, refreshToken: 'test-refresh', expiresIn: '3600' };
    else if (action === 'signUp' || action === 'signInWithPassword') response = { localId: uid, email, idToken: token, refreshToken: 'test-refresh', expiresIn: '3600', registered: true };
    else { await route.abort(); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.route('https://securetoken.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: token, id_token: token, refresh_token: 'test-refresh', expires_in: '3600', user_id: uid, project_id: 'sodaflow' }) }));
  return requests;
}

async function fakeCloud(page: Page, failFirstLoad = false, denyDirect = false, failFirstSnapshot = false, fallbackOrganizations = false) {
  const orgId = `org-${uid}`;
  let org = { id: orgId, name: 'متجر الاختبار السحابي', owner_uid: uid, status: 'active', settings: { ...INITIAL_SETTINGS, business_name: 'متجر الاختبار السحابي', phone: '0912345678', default_exchange_rate: 2000, currencies_configured: true }, created_at: new Date().toISOString() };
  const requests: string[] = [];
  let loads = 0, revision = 0, failRevision = false;
  let snapshots = 0, failWrites = false;
  const operationIds: string[] = [];
  const intents = new Map<string, string>();
  await page.addInitScript(({ initialOrg, fallbackOrganizations, denyDirect }) => {
    (window as any).__SUDANFLOW_FIREBASE_SYNC_TEST__ = {
      organizations: async () => fallbackOrganizations ? [initialOrg] : [],
      watchRevision: (_orgId: string, onRevision: (revision: number) => void, onError: (error: unknown) => void) => {
        (window as any).__sudaflowWatchCount = Number((window as any).__sudaflowWatchCount || 0) + 1;
        if (denyDirect) { queueMicrotask(() => onError(Object.assign(new Error('listener permission denied'), { code: 'permission-denied' }))); return () => {}; }
        const handler = (event: Event) => onRevision(Number((event as CustomEvent).detail || 0));
        window.addEventListener('sudaflow-test-revision', handler);
        return () => window.removeEventListener('sudaflow-test-revision', handler);
      },
    };
  }, { initialOrg: org, fallbackOrganizations, denyDirect });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === '/api/operation-intents') {
      const body = route.request().postDataJSON(), id = intents.get(body.fingerprint) || body.operationId || crypto.randomUUID();
      intents.set(body.fingerprint, id);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ operationId: id }) });
    } else if (path === '/api/operation-intents/acknowledge') {
      const body = route.request().postDataJSON(); if (intents.get(body.fingerprint) === body.operationId) intents.delete(body.fingerprint);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ acknowledged: true }) });
    } else if (path === '/api/organizations') {
      if (++loads === 1 && failFirstLoad) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'انقطاع اختبار مؤقت', code: 'service_unavailable' }) }); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([org]) });
    } else if (path.endsWith('/revision')) {
      if (failRevision) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'انقطاع مراقبة المزامنة' }) }); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision }) });
    } else if (path.endsWith('/images/logos')) {
      expect(route.request().headers()['content-type']).toBe('image/png');
      expect(route.request().postDataBuffer()!.equals(png)).toBe(true);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://firebasestorage.googleapis.com/test-store-logo.png' }) });
    } else if (path.endsWith('/snapshot') || path.endsWith('/backup')) {
      if (failRevision) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'انقطاع مراقبة المزامنة' }) }); return; }
      if (failFirstSnapshot && ++snapshots === 1) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'انقطاع قراءة المؤسسة' }) }); return; }
      const member = { uid, org_id: orgId, email, role: 'Owner', status: 'active' };
      const collections = { customers: [], products: [], invoices: [], payments: [], expenses: [], inventory_movements: [], accounts: [], journal_entries: [], members: [member], audit_logs: [], invitations: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema_version: 3, org, role: 'Owner', member, settings: org.settings, collections, counters: { ...DEFAULT_ORGANIZATION_COUNTERS, revision }, subscription: createDefaultSubscription(orgId), exported_at: new Date().toISOString() }) });
    } else if (path.endsWith('/operations')) {

      const command = route.request().postDataJSON();
      operationIds.push(command.operationId);
      if (failWrites) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'تعذر تأكيد الحفظ من الخادم', code: 'service_unavailable' }) }); return; }
      expect(command.action).toBe('settings.update');
      org = { ...org, name: command.data.updates.business_name || org.name, settings: { ...org.settings, ...command.data.updates } };
      revision += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: org.settings, changes: [
        { path: `organizations/${orgId}`, value: org },
        { path: `organizations/${orgId}/meta/counters`, value: { ...DEFAULT_ORGANIZATION_COUNTERS, revision } }
      ] }) });
    } else await route.abort();
  });
  await page.route('https://firebasestorage.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
  return { requests, failNextRevision: () => { failRevision = true; }, recoverReads: () => { failRevision = false; }, remoteUpdate: (name: string) => { org = { ...org, name, settings: { ...org.settings, business_name: name } }; revision += 1; }, saved: async () => structuredClone(org.settings), operationIds, failWrites: () => { failWrites = true; }, recoverWrites: () => { failWrites = false; } };
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'البريد الإلكتروني', exact: true }).fill(email);
  await page.locator('input[type="password"]').fill('test-password');
  await page.getByRole('button', { name: 'دخول الحساب السحابي', exact: true }).click();
}

test('public login and registration only accept email and show verification without entering the app', async ({ page }) => {
  const authRequests = await fakeFirebase(page, false);
  const cloud = await fakeCloud(page);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'البريد الإلكتروني', exact: true })).toHaveAttribute('type', 'email');
  await expect(page.locator('body')).not.toContainText('البريد الإلكتروني أو رقم الهاتف');
  await page.getByRole('button', { name: 'حساب جديد', exact: true }).click();
  await page.getByPlaceholder('مثال: محمد أحمد').fill('مالك الاختبار');
  await page.getByPlaceholder('مثال: مؤسسة النيل للتجارة').fill('متجر الاختبار');
  await page.getByRole('textbox', { name: 'البريد الإلكتروني', exact: true }).fill(email);
  await page.locator('input[type="password"]').nth(0).fill('test-password');
  await page.locator('input[type="password"]').nth(1).fill('test-password');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText(/تم إنشاء الحساب وإرسال رابط التحقق/)).toBeVisible();
  expect(authRequests).toContain('sendOobCode');
  expect(cloud.requests).toEqual([]);
  await expect(page.locator('.sf-app-shell')).toHaveCount(0);
});

test('unverified login displays the verification instructions and never accesses cloud data', async ({ page }) => {
  const authRequests = await fakeFirebase(page, false);
  const cloud = await fakeCloud(page);
  await login(page);
  await expect(page.getByText(/البريد الإلكتروني غير مؤكد/)).toBeVisible();
  expect(authRequests).toContain('sendOobCode');
  expect(cloud.requests).toEqual([]);
});

test('an initial cloud outage recovers on reconnect and the owner can save shop name and logo across reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fakeFirebase(page, true);
  const cloud = await fakeCloud(page, true);
  await login(page);
  await expect(page.getByRole('alert')).toContainText('انقطاع اختبار مؤقت');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('header')).toContainText('متجر الاختبار السحابي');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' })).toBeEnabled();
  await dialog.getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' }).fill('متجر محفوظ');
  await dialog.locator('input[type="file"][accept*="image"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => (await cloud.saved()).logo_url).toBe('https://firebasestorage.googleapis.com/test-store-logo.png');
  await expect(dialog.getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' })).toHaveValue('متجر محفوظ');
  await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(page.locator('header')).toContainText('متجر محفوظ');
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('header')).toContainText('متجر محفوظ');
  await page.getByTitle('الإعدادات', { exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' })).toHaveValue('متجر محفوظ');
  await expect(page.getByRole('dialog').locator('img[src="https://firebasestorage.googleapis.com/test-store-logo.png"]')).toBeVisible();
  expect(errors).toEqual([]);
});


test('cloud writes stay on the idempotent API when Firestore notifications are denied', async ({ page }) => {
  await fakeFirebase(page, true);
  const cloud = await fakeCloud(page, false, true);
  await login(page);
  await expect(page.locator('header')).toContainText('متجر الاختبار السحابي');
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' }).fill('متجر fallback');
  await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(page.locator('header')).toContainText('متجر fallback');
  expect(cloud.requests.some(path => path.endsWith('/snapshot'))).toBe(true);
  expect(cloud.requests.some(path => path.endsWith('/operations'))).toBe(true);
  await page.reload();
  await expect(page.locator('header')).toContainText('متجر fallback');
});


test('failed Firestore monitoring reconciles confirmed API snapshots, recovers, and stops at logout', async ({ page }) => {
  await fakeFirebase(page, true);
  const cloud = await fakeCloud(page, false, true);
  await page.clock.install();
  await login(page);
  await expect(page.locator('header')).toContainText('متجر الاختبار السحابي');
  await expect.poll(() => cloud.requests.filter(path => path.endsWith('/snapshot')).length).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  cloud.remoteUpdate('تحديث من جهاز آخر');
  await page.clock.fastForward(31000);
  await expect(page.locator('header')).toContainText('تحديث من جهاز آخر');
  cloud.failNextRevision();
  await page.clock.fastForward(31000);
  await expect(page.getByRole('alert')).toContainText('انقطاع مراقبة المزامنة');
  cloud.recoverReads();
  await page.clock.fastForward(31000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByTitle('تسجيل الخروج', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'دخول الحساب السحابي', exact: true })).toBeVisible();
  const reads = cloud.requests.filter(path => path.endsWith('/snapshot')).length;
  await page.clock.fastForward(61000);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(cloud.requests.filter(path => path.endsWith('/snapshot')).length).toBe(reads);
});

test('manual retry after a failed initial snapshot starts the realtime monitor', async ({ page }) => {
  await fakeFirebase(page, true);
  const cloud = await fakeCloud(page, false, false, true);
  await login(page);
  await expect(page.getByRole('alert')).toContainText('انقطاع قراءة المؤسسة');
  await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__sudaflowWatchCount)).toBe(1);
  cloud.remoteUpdate('تحديث بعد التعافي');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sudaflow-test-revision', { detail: 1 })));
  await expect(page.locator('header')).toContainText('تحديث بعد التعافي');
  expect(cloud.requests.some(path => path.endsWith('/revision'))).toBe(false);
});

test('an initial organization outage retries while the visible page remains open', async ({ page }) => {
  await fakeFirebase(page, true);
  const cloud = await fakeCloud(page, true);
  await page.clock.install();
  await login(page);
  await expect(page.getByRole('alert')).toContainText('انقطاع اختبار مؤقت');
  await page.clock.fastForward(31000);
  await expect(page.locator('header')).toContainText('متجر الاختبار السحابي');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(cloud.requests.filter(path => path === '/api/organizations').length).toBe(2);
});


test('an existing owner can discover the company through Firebase while snapshots and writes remain on the API', async ({ page }) => {
  await fakeFirebase(page, true);
  const cloud = await fakeCloud(page, true, false, false, true);
  await login(page);
  await expect(page.locator('header')).toContainText('متجر الاختبار السحابي');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(cloud.requests.filter(path => path === '/api/organizations').length).toBe(0);
  await page.getByTitle('الإعدادات', { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' }).fill('حفظ مباشر أثناء الانقطاع');
  await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(page.locator('header')).toContainText('حفظ مباشر أثناء الانقطاع');
  expect((await cloud.saved()).business_name).toBe('حفظ مباشر أثناء الانقطاع');
  expect(cloud.requests.some(path => path.endsWith('/operations'))).toBe(true);
});


test('API write outage retains settings and retries the same operation ID without direct Firebase writes', async ({ page }) => {
  await fakeFirebase(page, true); const cloud = await fakeCloud(page); await login(page);
  await expect(page.locator('header')).toContainText('متجر الاختبار السحابي');
  await page.getByTitle('الإعدادات', { exact: true }).click(); const dialog = page.getByRole('dialog');
  const name = dialog.getByRole('textbox', { name: 'اسم المتجر أو المؤسسة' }); await name.fill('تعديل ينتظر الحفظ');
  cloud.failWrites(); await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click();
  await expect(dialog).toBeVisible(); await expect(name).toHaveValue('تعديل ينتظر الحفظ'); await expect(dialog.getByRole('alert')).toContainText('تعذر تأكيد الحفظ');
  expect((await cloud.saved()).business_name).toBe('متجر الاختبار السحابي');
  cloud.recoverWrites(); await dialog.getByRole('button', { name: 'حفظ كافة الإعدادات' }).click(); await expect(dialog).not.toBeVisible();
  await expect(page.locator('header')).toContainText('تعديل ينتظر الحفظ'); expect(cloud.operationIds).toHaveLength(2); expect(cloud.operationIds[0]).toBe(cloud.operationIds[1]);
});
