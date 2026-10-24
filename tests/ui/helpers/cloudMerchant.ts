import { test as base, expect, type Page } from '@playwright/test';
import express from 'express';
import { createApi } from '../../../server/api';
import { MemoryStore, type Document } from '../../../src/domain/store';
import { Operations, type Actor } from '../../../src/domain/operations';
import { INITIAL_SETTINGS } from '../../../src/data/initialData';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../../../src/types';
import { getDefaultChartOfAccounts } from '../../../src/services/accountingService';

import { guestId, guestActor } from '../../fixtures/cloudIdentity';
export { guestId, guestActor } from '../../fixtures/cloudIdentity';
export type Records = Record<string, Document>;
const root = `organizations/${guestId}`;

export function defaultMerchantRecords(): Records {
  const settings = { ...INITIAL_SETTINGS, business_name: 'متجر الاختبار', phone: '0912345678', address: 'الخرطوم', default_exchange_rate: 2000, currencies_configured: true };
  const customer = { id: 'customer', name: 'عميل الاختبار', phone: '', preferred_currency: 'USD', balance_sdg: 0, balance_usd: 0, created_at: '2026-10-01', updated_at: '2026-10-01' };
  const product = { id: 'product', name: 'منتج الاختبار', unit: 'قطعة', price_sdg: 2000, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: 100, created_at: '2026-10-01' };
  return { [root]: { id: guestId, owner_uid: guestActor.uid, name: settings.business_name, status: 'active', settings, schema_version: 3 },
    [`${root}/members/${guestActor.uid}`]: { uid: guestActor.uid, org_id: guestId, role: 'Owner', status: 'active' },
    [`${root}/customers/customer`]: customer, [`${root}/products/product`]: product,
    ...Object.fromEntries(getDefaultChartOfAccounts(guestId).map(account => [`${root}/accounts/${account.code}`, account])),
  };
}

interface MerchantHarness {
  seed(records: Records): void;
  records(): Records;
  executeCommand(action: string, data: Document, operationId?: string): Promise<Document>;
  failNextWrite(): void;
  abortAfterCommit(): void;
  failCloudReads(): void;
  recoverCloudReads(): void;
  failNextAcknowledgement(): void;
  requests: string[];
  mutations: Document[];
}
const harnesses = new WeakMap<Page, MerchantHarness>();
export const cloudMerchant = (page: Page): MerchantHarness => {
  const harness = harnesses.get(page);
  if (!harness) throw Error('Use the cloudMerchant test fixture.');
  return harness;
};
export const cloudRecords = async (page: Page) => cloudMerchant(page).records();
export const seedCloudMerchant = async (page: Page, records: Records) => cloudMerchant(page).seed(records);
export async function updateCloudMerchant(page: Page, update: (records: Records) => void) {
  const records = await cloudRecords(page); update(records); await seedCloudMerchant(page, records);
}
export function seedRows(records: Records, name: string, rows: Document[]) {
  const prefix = `${root}/${name}/`;
  for (const path of Object.keys(records)) if (path.startsWith(prefix)) delete records[path];
  for (const row of rows) records[`${prefix}${row.id || row.code}`] = { ...row, org_id: guestId };
}
export async function openMerchant(page: Page, waitForCompany = true) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'البريد الإلكتروني', exact: true }).fill(guestActor.email);
  await page.locator('input[type="password"]').fill('synthetic-password');
  await page.getByRole('button', { name: 'دخول الحساب السحابي', exact: true }).click();
  if (waitForCompany) await expect(page.locator('.sf-app-shell')).toBeVisible();
}

export const test = base.extend<{ merchant: MerchantHarness; controlsEnabled: boolean }>({
  controlsEnabled: [true, { option: true }],
  merchant: [async ({ page, controlsEnabled }, use) => {
    let records = defaultMerchantRecords(), store: MemoryStore | undefined;
    let failWrite = false, abortNext = false, failReads = false, failAck = false, clock = Date.now();
    const actor = { ...guestActor, authTime: Math.floor(clock / 1000) };
    const issued = new Set<string>();
    let token = '';
    const issueToken = async (sourcePage = page) => {
      clock = await sourcePage.evaluate(() => Date.now()); actor.authTime = Math.floor(clock / 1000);
      token = [{ alg: 'RS256', typ: 'JWT' }, { aud: 'sodaflow', iss: 'https://securetoken.google.com/sodaflow', sub: actor.uid, user_id: actor.uid, auth_time: actor.authTime, iat: actor.authTime, exp: actor.authTime + 3600, email: actor.email, email_verified: true, firebase: { sign_in_provider: 'password' } }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.synthetic-signature';
      issued.add(token);
      return token;
    };
    await page.context().route('https://identitytoolkit.googleapis.com/**', async route => {
      const action = new URL(route.request().url()).pathname.split(':').at(-1);
      const response = action === 'lookup' ? { users: [{ localId: actor.uid, email: actor.email, emailVerified: true, displayName: actor.name, providerUserInfo: [{ providerId: 'password', email: actor.email }], createdAt: String(clock), lastLoginAt: String(clock) }] }
        : { localId: actor.uid, email: actor.email, idToken: await issueToken(route.request().frame().page()), refreshToken: 'synthetic-refresh', expiresIn: '3600', registered: true };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.context().route('https://securetoken.googleapis.com/**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: await issueToken(route.request().frame().page()), id_token: token, refresh_token: 'synthetic-refresh', expires_in: '3600', user_id: actor.uid, project_id: 'sodaflow' }) }));
    // Only Firestore discovery/notifications are doubled. Reads, reports, owner
    // verification, accounting writes, idempotency and quotas use the real API.
    await page.context().addInitScript(() => {
      (window as any).__SUDANFLOW_FIREBASE_SYNC_TEST__ = { organizations: async () => [], watchRevision: () => () => {} };
    });
    const requests: string[] = [], mutations: Document[] = [];
    let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
    let backendUrl: string;
    const initializeBackend = async () => {
      if (server) return;
      const org = records[root];
      records = { ...records, [root]: { ...org, id: guestId, settings: { ...INITIAL_SETTINGS, ...org.settings }, ...(controlsEnabled ? { planId: 'Enterprise', subscriptionStatus: 'active', subscriptionStart: '2026-01-01T00:00:00Z', subscriptionEnd: '2099-01-01T00:00:00Z', billingRevision: 1 } : {}) },
        [`${root}/meta/counters`]: { ...DEFAULT_ORGANIZATION_COUNTERS, ...records[`${root}/meta/counters`] },
        [`user_organizations/${actor.uid}/orgs/${guestId}`]: { org_id: guestId },
      };
      store = new MemoryStore(records, () => { if (failWrite) { failWrite = false; throw Object.assign(Error('Synthetic cloud commit unavailable'), { code: 14 }); } });
      const app = express(); app.use(express.json({ limit: '10mb' }));
      app.use('/api', createApi({ operations: new Operations(store, () => new Date(clock), undefined, undefined, controlsEnabled), verify: async value => { if (!issued.has(value)) throw Error('Invalid synthetic token'); return { ...actor }; } }));
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject); });
      const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing synthetic API address');
      backendUrl = `http://127.0.0.1:${address.port}`;
    };
    let tearingDown = false;
    const pendingRoutes = new Set<Promise<void>>();
    await page.context().route('**/api/**', async route => {
      if (tearingDown) { await route.abort('aborted').catch(() => {}); return; }
      const task = (async () => {
      await initializeBackend(); clock = await route.request().frame().page().evaluate(() => Date.now());
      const request = route.request(), url = new URL(request.url()), path = url.pathname + url.search;
      requests.push(path);
      const bearer = request.headers().authorization || '';
      if (path !== '/api/platform-controls') expect(issued.has(bearer.replace(/^Bearer /, ''))).toBe(true);
      const body = request.postData(), isBusinessWrite = !!body && !path.startsWith('/api/operation-intents');
      if (isBusinessWrite) mutations.push(JSON.parse(body));
      if (failAck && path === '/api/operation-intents/acknowledge') { failAck = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'تعذر تنظيف نية إعادة المحاولة' }) }); return; }
      if (failReads && request.method() === 'GET') { await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'خدمة Firebase غير متاحة في الاختبار', code: 'service_unavailable' }) }); return; }
      const response = await fetch(backendUrl + path, { method: request.method(), headers: { Authorization: bearer, 'Content-Type': 'application/json' }, ...(body ? { body } : {}) });
      if (abortNext && isBusinessWrite && response.ok) { abortNext = false; await response.text(); await route.abort('failed'); return; }
      await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'Cache-Control': response.headers.get('cache-control') || 'no-store' }, body: await response.text() });
      })();
      pendingRoutes.add(task);
      try { await task; } finally { pendingRoutes.delete(task); }
    });
    const harness: MerchantHarness = {
      seed: value => { if (server) throw Error('Seed before opening the cloud app; never replace committed server records on reload.'); records = structuredClone(value); },
      records: () => Object.fromEntries(Object.entries(store ? store.dump() : structuredClone(records)).filter(([path]) => !path.includes('/operationIntents/') && !path.startsWith('platformOperationIntents/'))), requests, mutations,
      // Simulate a second signed-in client through the same real API. Never
      // replace already committed records to manufacture a stale-state test.
      executeCommand: async (action, data, operationId = crypto.randomUUID()) => {
        if (!server || !token) throw Error('Open and sign into the synthetic cloud app before issuing a second-client command.');
        const command = { action, data, operationId }; mutations.push(command);
        const response = await fetch(`${backendUrl}/api/organizations/${guestId}/operations`, { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify(command) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Synthetic second-client command failed.');
        return result;
      },
      failNextWrite: () => { failWrite = true; }, abortAfterCommit: () => { abortNext = true; },
      failCloudReads: () => { failReads = true; }, recoverCloudReads: () => { failReads = false; },
      failNextAcknowledgement: () => { failAck = true; },
    };
    harnesses.set(page, harness);
    try { await use(harness); }
    finally {
      tearingDown = true;
      // Keep the synthetic API alive until every route that started in this test
      // has finished. Late refreshes during fixture teardown never open a fetch.
      await Promise.all([...pendingRoutes]);
      harnesses.delete(page);
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    }
  }, { auto: true }],
});
export { expect, type Page };
