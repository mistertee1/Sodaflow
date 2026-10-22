import { test as base, expect } from '@playwright/test';
import { platformFixture, servePlatform } from '../../helpers/platform';
import type { Actor } from '../../../src/domain/operations';

interface PlatformHarness {
  fixture: Awaited<ReturnType<typeof platformFixture>>;
  requests: string[];
  mutations: Record<string, any>[];
  login(): Promise<void>;
  abortAfterCommit(): void;
  failCompanyRefresh(): void;
  failOverview(): void;
}
type Options = { platformRole: 'admin' | 'owner' | 'other_admin'; verifiedEmail: boolean };
export const test = base.extend<Options & { platform: PlatformHarness }>({
  platformRole: ['admin', { option: true }], verifiedEmail: [true, { option: true }],
  platform: async ({ page, platformRole, verifiedEmail }, use) => {
    const fixture = await platformFixture();
    const actor: Actor = { ...(platformRole === 'owner' ? fixture.owner : fixture.admin), emailVerified: verifiedEmail,
      ...(platformRole === 'other_admin' ? { uid: 'other-platform-admin', email: 'other-admin@example.test' } : {}) };
    if (platformRole === 'other_admin') await fixture.store.transaction(async tx => tx.set(`platformAdmins/${actor.uid}`, { uid: actor.uid, active: true, role: 'super_admin' }));
    const backend = await servePlatform(fixture, { session: actor });
    const now = Math.floor(Date.now() / 1000);
    const token = [{ alg: 'RS256', typ: 'JWT' }, { aud: 'sodaflow', iss: 'https://securetoken.google.com/sodaflow', sub: actor.uid, user_id: actor.uid, auth_time: now, iat: now, exp: now + 3600, email: actor.email, email_verified: verifiedEmail, superAdmin: actor.superAdmin === true, firebase: { sign_in_provider: 'password' } }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.test-signature';
    // Synthetic Auth only. Commercial requests exercise the actual HTTP API and
    // domain transactions on an isolated MemoryStore, never a production account.
    await page.route('https://identitytoolkit.googleapis.com/**', async route => {
      const action = new URL(route.request().url()).pathname.split(':').at(-1)!;
      const response = action === 'lookup' ? { users: [{ localId: actor.uid, email: actor.email, emailVerified: verifiedEmail, displayName: 'إدارة الاختبار', providerUserInfo: [{ providerId: 'password', email: actor.email }], createdAt: String(Date.now()), lastLoginAt: String(Date.now()) }] } : action === 'sendOobCode' ? { email: actor.email } : { localId: actor.uid, email: actor.email, idToken: token, refreshToken: 'test-refresh', expiresIn: '3600', registered: true };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.route('https://securetoken.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: token, id_token: token, refresh_token: 'test-refresh', expires_in: '3600', user_id: actor.uid, project_id: 'sodaflow' }) }));
    const requests: string[] = [], mutations: Record<string, any>[] = [];
    let abortNext = false, failRefresh = false, didCommit = false, failOverview = false;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), path = url.pathname.slice(4) + url.search;
      requests.push(path); if (path !== '/platform-controls') expect(route.request().headers().authorization).toBe('Bearer ' + token);
      if (failOverview && url.pathname.endsWith('/overview')) { failOverview = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'تعذر إحصاء الشركات مؤقتاً' }) }); return; }
      if (failRefresh && didCommit && /\/companies\/[^/]+$/.test(url.pathname)) { failRefresh = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'تعذر قراءة العرض مؤقتاً' }) }); return; }
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
      const isBusinessWrite = !!body && !path.startsWith('/operation-intents');
      if (isBusinessWrite) mutations.push(body);
      const response = await backend.request(path, 'session', body);
      if (isBusinessWrite && response.ok) didCommit = true;
      if (abortNext && isBusinessWrite && response.ok) { abortNext = false; await route.abort('failed'); return; }
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    try { await use({ fixture, requests, mutations,
      login: async () => { await page.goto('/super-admin'); await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(actor.email); await page.getByLabel('كلمة المرور', { exact: true }).fill('test-password'); await page.getByRole('button', { name: 'دخول الإدارة', exact: true }).click(); },
      abortAfterCommit: () => { abortNext = true; }, failCompanyRefresh: () => { failRefresh = true; }, failOverview: () => { failOverview = true; },
    }); } finally { await backend.close(); }
  },
});
export { expect };
