import type { Page } from '@playwright/test';
const uid = 'guest', email = 'owner@example.com';
export async function fakeFirebase(page: Page, emailVerified: boolean) {
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
