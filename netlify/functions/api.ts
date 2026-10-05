import type { Config, Context } from '@netlify/functions';
import serverless from 'serverless-http';
import { createApp } from '../../server/app';
interface GatewayResponse { statusCode: number; body: string; isBase64Encoded?: boolean; headers?: Record<string, string | number | boolean>; multiValueHeaders?: Record<string, string[]>; cookies?: string[]; }

/** Adapt the existing Express operations API, retaining auth, raw uploads and JSON errors. */
export default async function api(request: Request, context: Context): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.startsWith('/.netlify/functions/api') ? '/api' + url.pathname.slice('/.netlify/functions/api'.length) : url.pathname;
  const bytes = request.method === 'GET' || request.method === 'HEAD' ? undefined : Buffer.from(await request.arrayBuffer());
  if (bytes && bytes.length > 2 * 1024 * 1024) return Response.json({ error: 'الطلب أكبر من الحد المسموح.' }, { status: 413 });
  const headers = Object.fromEntries(request.headers.entries());
  delete headers['content-length'];
  const event = { version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: url.search.slice(1), headers,
    requestContext: { http: { method: request.method, path, protocol: 'HTTP/1.1', sourceIp: context.ip || '127.0.0.1', userAgent: headers['user-agent'] || '' } },
    body: bytes?.toString('base64'), isBase64Encoded: Boolean(bytes) };
  const result = await serverless(createApp())(event, {}) as GatewayResponse;
  const outputHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers || {})) if (value !== undefined) outputHeaders.set(key, String(value));
  for (const [key, values] of Object.entries(result.multiValueHeaders || {})) for (const value of values as string[]) outputHeaders.append(key, value);
  for (const cookie of result.cookies || []) outputHeaders.append('set-cookie', cookie);
  outputHeaders.set('Cache-Control', 'no-store');
  const body = result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body;
  return new Response(request.method === 'HEAD' || [204, 304].includes(result.statusCode) ? null : body, { status: result.statusCode, headers: outputHeaders });
}

export const config: Config = { path: ['/api/*', '/__/auth/*'] };
import { organizationRevision } from '../../server/revision';
import { authenticationFailure } from '../../server/authErrors';
import { firebaseServiceFailure } from '../../server/serviceErrors';
import { firebaseReadiness } from '../../server/readiness';
import firebaseConfig from '../../firebase-applet-config.json';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { membership, Operations as Engine, type Actor } from '../../src/domain/operations';
import { invoiceFinancials } from '../../src/domain/financial';
import { BusinessError, ensure, identifier, text, validateJournal, validateSettings } from '../../src/domain/validation';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
import { hasPermission } from '../../src/services/rbacService';
import { Organizations } from '../../server/organizations';
import { adminServices, selectedFirestoreDatabaseId } from '../../server/admin';
import { FirestoreStore } from '../../server/firestoreStore';
import { resolveSubscription } from '../../server/subscriptions';

type NetlifyEvent = {
  httpMethod?: string;
  path?: string;
  rawUrl?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
};

const json = (statusCode: number, value: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(value),
});

const service = () => new Engine(new FirestoreStore(adminServices().db), undefined, resolveSubscription);

function normalizePath(event: NetlifyEvent) {
  let path = event.path || (event.rawUrl ? new URL(event.rawUrl).pathname : '/');
  for (const prefix of ['/.netlify/functions/api', '/api']) {
    if (path === prefix) return '/';
    if (path.startsWith(prefix + '/')) {
      path = path.slice(prefix.length);
      break;
    }
  }
  return path || '/';
}

function header(event: NetlifyEvent, name: string) {
  const entries = Object.entries(event.headers || {});
  return entries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || '';
}

function parseJson(event: NetlifyEvent) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(raw);
}

async function actorFrom(event: NetlifyEvent): Promise<Actor> {
  const match = header(event, 'authorization').match(/^Bearer (\S+)$/);
  if (!match) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  const auth = adminServices().auth;
  try {
    const claims = await auth.verifyIdToken(match[1], true);
    return {
      uid: claims.uid,
      email: claims.email || '',
      emailVerified: claims.email_verified === true,
      name: claims.name,
    };
  } catch (error) {
    throw authenticationFailure(error);
  }
}

export const handler = async (event: NetlifyEvent) => {
  try {
    const method = (event.httpMethod || 'GET').toUpperCase();
    const path = normalizePath(event);

    if (method === 'GET' && path === '/health') {
      return json(200, {
        status: 'ok',
        app: 'SudaFlow',
        version: '3.0.3-netlify',
        firebase_admin_configured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS),
        firebase_project_id: firebaseConfig.projectId,
        firebase_server_project_id: process.env.FIREBASE_PROJECT_ID?.trim() || firebaseConfig.projectId,
        firestore_database_id: selectedFirestoreDatabaseId(),
      });
    }

    if (method === 'GET' && path === '/health/ready') {
      const result = await firebaseReadiness();
      return json(result.status === 'ready' ? 200 : 503, result);
    }

    if (method === 'POST' && path === '/financial/calculate-invoice') {
      const body = parseJson(event) as Record<string, unknown>;
      const settings = validateSettings({ ...INITIAL_SETTINGS, ...body });
      return json(200, { success: true, ...invoiceFinancials({ ...body, exchange_rate_used: Number(body.exchange_rate) }, settings) });
    }

    if (method === 'POST' && path === '/accounting/validate-entry') {
      const body = parseJson(event) as Record<string, any>;
      return json(200, { isValid: true, ...validateJournal(body.lines) });
    }

    if (method === 'POST' && path === '/contact-messages') {
      const body = parseJson(event) as Record<string, any>;
      const id = identifier(body.operationId);
      const name = text(body.name, 200, true);
      const email = text(body.email, 320, true);
      const subject = text(body.subject, 200, true);
      const message = text(body.message, 5000, true);
      ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'البريد الإلكتروني غير صالح.');
      const fingerprint = createHash('sha256').update(JSON.stringify({ name, email, subject, message })).digest('hex');
      await service().store.transaction(async tx => {
        const path = `contact_messages/${id}`;
        const old = await tx.get(path);
        if (old) {
          ensure(old.fingerprint === fingerprint, 'معرّف الرسالة مستخدم.', 409);
          return;
        }
        const source = header(event, 'x-forwarded-for') || header(event, 'client-ip') || 'unknown';
        const key = createHash('sha256').update(source).digest('hex');
        const ratePath = `support_rate_limits/${key}`;
        const rate = await tx.get(ratePath);
        const now = Date.now();
        ensure(!rate || now - rate.start > 600000 || rate.count < 10, 'طلبات كثيرة. حاول لاحقاً.', 429);
        tx.set(ratePath, {
          start: rate && now - rate.start < 600000 ? rate.start : now,
          count: rate && now - rate.start < 600000 ? rate.count + 1 : 1,
        });
        tx.set(path, { name, email, subject, message, fingerprint, created_at: new Date(now).toISOString() });
      });
      return json(201, { id, saved: true });
    }

    const actor = await actorFrom(event);
    if (!actor.emailVerified) throw new BusinessError('أكّد بريدك الإلكتروني قبل استخدام البيانات السحابية.', 403, 'email_not_verified');
    const engine = service();

    if (method === 'GET' && path === '/organizations') {
      return json(200, await new Organizations(engine.store).list(actor));
    }

    if (method === 'POST' && path === '/organizations') {
      const body = parseJson(event) as Record<string, any>;
      ensure(typeof body.initial === 'boolean', 'نوع إنشاء المؤسسة مطلوب.');
      const result = await new Organizations(engine.store).create(
        actor,
        body.name,
        body.settings || {},
        identifier(body.operationId),
        body.initial
      );
      return json(200, result);
    }

    let match = path.match(/^\/organizations\/([^/]+)\/revision$/);
    if (method === 'GET' && match) {
      return json(200, await organizationRevision(engine.store, decodeURIComponent(match[1]), actor));
    }

    match = path.match(/^\/organizations\/([^/]+)\/snapshot$/);
    if (method === 'GET' && match) {
      return json(200, await engine.snapshot(decodeURIComponent(match[1]), actor));
    }

    match = path.match(/^\/organizations\/([^/]+)\/backup$/);
    if (method === 'GET' && match) {
      return json(200, await engine.snapshot(decodeURIComponent(match[1]), actor, true));
    }

    match = path.match(/^\/organizations\/([^/]+)\/operations$/);
    if (method === 'POST' && match) {
      return json(200, await engine.execute(decodeURIComponent(match[1]), actor, parseJson(event) as any));
    }

    match = path.match(/^\/organizations\/([^/]+)\/invitations\/([^/]+)\/accept$/);
    if (method === 'POST' && match) {
      return json(200, await new Organizations(engine.store).accept(
        actor,
        decodeURIComponent(match[1]),
        decodeURIComponent(match[2])
      ));
    }

    match = path.match(/^\/organizations\/([^/]+)\/images\/(logos|receipts)$/);
    if (method === 'POST' && match) {
      const orgId = decodeURIComponent(match[1]);
      const folder = match[2] as 'logos' | 'receipts';
      await engine.store.transaction(async tx => {
        const { role } = await membership(tx, orgId, actor);
        ensure(hasPermission(role, folder === 'logos' ? 'org:update_settings' : 'expenses:create'), 'رفع الصورة غير مسموح.', 403);
      });

      const type = header(event, 'content-type').split(';')[0].trim().toLowerCase();
      const buffer = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'binary');
      ensure(buffer.length > 0 && buffer.length <= 2 * 1024 * 1024, 'بيانات الصورة غير صالحة أو أكبر من الحد المسموح.');
      const valid =
        type === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
        type === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 :
        type === 'image/gif' ? /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString()) :
        type === 'image/webp' && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
      ensure(valid, 'محتوى الصورة لا يطابق نوع الملف.');

      const bucket = adminServices().bucket;
      const token = randomUUID();
      const filePath = `organizations/${identifier(orgId)}/${folder}/${randomUUID()}`;
      try { await bucket.file(filePath).save(buffer, {
        resumable: false,
        metadata: {
          contentType: type,
          metadata: { firebaseStorageDownloadTokens: token, uploadedBy: actor.uid },
        },
      }); } catch (error) { throw firebaseServiceFailure(error, 'storage'); }
      return json(200, {
        url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`,
      });
    }

    return json(404, { error: 'المسار غير موجود.' });
  } catch (error) {
    if (error instanceof BusinessError) {
      return json(error.status, { error: error.message, code: error.code });
    }
    const message = error instanceof Error ? error.message : 'UnknownError';
    const upstreamCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
    console.error('SudaFlow Netlify API failed:', { code: upstreamCode || 'unknown', message, database: selectedFirestoreDatabaseId() });
    const failure = firebaseServiceFailure(error, 'firestore');
    return json(failure.status, { error: failure.message, code: failure.code });
  }
};
