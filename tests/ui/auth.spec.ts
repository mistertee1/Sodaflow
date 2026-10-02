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
  await page.addInitScript(() => localStorage.setItem('sudanese_merchant_has_seen_tour_v2', 'true'));
  return requests;
}

async function fakeCloud(page: Page, failFirstLoad = false, denyDirect = false) {
  const orgId = `org-${uid}`;
  let org = { id: orgId, name: 'متجر الاختبار السحابي', owner_uid: uid, status: 'active', settings: { ...INITIAL_SETTINGS, business_name: 'متجر الاختبار السحابي', phone: '0912345678', default_exchange_rate: 2000, currencies_configured: true }, created_at: new Date().toISOString() };
  const requests: string[] = [];
  let loads = 0, revision = 0;
  await page.addInitScript(({ stateKey, initialOrg, ownerUid, ownerEmail, counters, subscription, denyDirect }) => {
    const read = () => {
      const raw = localStorage.getItem(stateKey);
      if (raw) return JSON.parse(raw);
      const seeded = { org: initialOrg, revision: Number(counters.revision || 0) };
      localStorage.setItem(stateKey, JSON.stringify(seeded));
      return seeded;
    };
    const write = (value: any) => localStorage.setItem(stateKey, JSON.stringify(value));
    const makeSnapshot = () => {
      const state = read();
      const member = { uid: ownerUid, org_id: state.org.id, email: ownerEmail, role: 'Owner', status: 'active' };
      return {
        schema_version: 3,
        org: state.org,
        role: 'Owner',
        member,
        settings: state.org.settings,
        collections: { customers: [], products: [], invoices: [], payments: [], expenses: [], inventory_movements: [], accounts: [], journal_entries: [], members: [member], audit_logs: [], invitations: [] },
        counters: { ...counters, revision: state.revision },
        subscription,
        exported_at: new Date().toISOString(),
      };
    };
    (window as any).__SUDANFLOW_FIREBASE_SYNC_TEST__ = {
      snapshot: async () => { if (denyDirect) throw Object.assign(new Error('stale Firestore rules'), { code: 'permission-denied' }); return makeSnapshot(); },
      command: async (orgId: string, action: string, data: any) => {
        if (denyDirect) throw Object.assign(new Error('stale Firestore rules'), { code: 'permission-denied' });
        if (action !== 'settings.update') throw new Error(`Unsupported UI-test direct command: ${action}`);
        const state = read();
        const updates = data?.updates || {};
        state.org = {
          ...state.org,
          name: updates.business_name || state.org.name,
          settings: { ...state.org.settings, ...updates },
          updated_at: new Date().toISOString(),
        };
        state.revision = Number(state.revision || 0) + 1;
        write(state);
        window.dispatchEvent(new CustomEvent('sudaflow-test-revision', { detail: state.revision }));
        return {
          result: state.org.settings,
          changes: [
            { path: `organizations/${orgId}`, value: state.org },
            { path: `organizations/${orgId}/meta/counters`, value: { ...counters, revision: state.revision } },
          ],
        };
      },
      watchRevision: (_orgId: string, onRevision: (revision: number) => void) => {
        const handler = (event: Event) => onRevision(Number((event as CustomEvent).detail || 0));
        window.addEventListener('sudaflow-test-revision', handler);
        return () => window.removeEventListener('sudaflow-test-revision', handler);
      },
    };
  }, { stateKey: cloudStateKey, initialOrg: org, ownerUid: uid, ownerEmail: email, counters: DEFAULT_ORGANIZATION_COUNTERS, subscription: createDefaultSubscription(orgId), denyDirect });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === '/api/organizations') {
      if (++loads === 1 && failFirstLoad) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'انقطاع اختبار مؤقت', code: 'service_unavailable' }) }); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([org]) });
    } else if (path.endsWith('/images/logos')) {
      expect(route.request().headers()['content-type']).toBe('image/png');
      expect(route.request().postDataBuffer()!.equals(png)).toBe(true);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://firebasestorage.googleapis.com/test-store-logo.png' }) });
    } else if (path.endsWith('/snapshot') || path.endsWith('/backup')) {
      if (!denyDirect) throw new Error(`Tenant data unexpectedly used legacy API path: ${path}`);
      const member = { uid, org_id: orgId, email, role: 'Owner', status: 'active' };
      const collections = { customers: [], products: [], invoices: [], payments: [], expenses: [], inventory_movements: [], accounts: [], journal_entries: [], members: [member], audit_logs: [], invitations: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema_version: 3, org, role: 'Owner', member, settings: org.settings, collections, counters: { ...DEFAULT_ORGANIZATION_COUNTERS, revision }, subscription: createDefaultSubscription(orgId), exported_at: new Date().toISOString() }) });
    } else if (path.endsWith('/operations')) {
      if (!denyDirect) throw new Error(`Tenant data unexpectedly used legacy API path: ${path}`);
      const command = route.request().postDataJSON();
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
  return { requests, saved: () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').org?.settings || {}, cloudStateKey) };
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


test('stale production Firestore rules fall back to the idempotent operations API', async ({ page }) => {
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
