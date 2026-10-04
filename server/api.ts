import { authenticationFailure } from './authErrors';
import { firebaseServiceFailure } from './serviceErrors';
import { firebaseReadiness } from './readiness';
import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import type { Actor, Operations } from '../src/domain/operations';
import { membership, Operations as Engine } from '../src/domain/operations';
import { invoiceFinancials } from '../src/domain/financial';
import { BusinessError, ensure, identifier, text, validateJournal, validateSettings } from '../src/domain/validation';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { hasPermission } from '../src/services/rbacService';
import { Organizations } from './organizations';
import { adminServices } from './admin';
import { FirestoreStore } from './firestoreStore';
import { resolveSubscription } from './subscriptions';
import { PlatformBilling } from './platformBilling';
import { loadSubscription, assertSubscriptionActive } from '../src/domain/subscriptions';

type Verify = (token: string) => Promise<Actor>;
export function createApi(options?: { operations: Operations; verify: Verify }) {
  const router = express.Router();
  const service = () => options?.operations || new Engine(new FirestoreStore(adminServices().db), undefined, resolveSubscription);
  const platform = () => new PlatformBilling(service().store, options ? undefined : adminServices().db);
  const verify: Verify = options?.verify || (async token => {
    const claims = await adminServices().auth.verifyIdToken(token, true);
    return { uid: claims.uid, email: claims.email || '', emailVerified: claims.email_verified === true, name: claims.name, superAdmin: claims.superAdmin === true };
  });
  router.get('/health', (_req, res) => res.json({ status: 'ok', app: 'SudaFlow', version: '3.0.0' }));
  router.get('/health/ready', async (_req, res) => {
    const result = await firebaseReadiness();
    res.status(result.status === 'ready' ? 200 : 503).json(result);
  });
  router.post('/financial/calculate-invoice', (req, res, next) => {
    try { const s = validateSettings({ ...INITIAL_SETTINGS, ...req.body }); const data = { ...req.body, exchange_rate_used: req.body.exchange_rate }; res.json({ success: true, ...invoiceFinancials(data, s) }); } catch (e) { next(e); }
  });
  router.post('/accounting/validate-entry', (req, res, next) => {
    try { res.json({ isValid: true, ...validateJournal(req.body.lines) }); } catch (e) { next(e); }
  });
  router.post('/contact-messages', async (req, res, next) => {
    try {
      const id = identifier(req.body.operationId), name = text(req.body.name, 200, true), email = text(req.body.email, 320, true), subject = text(req.body.subject, 200, true), message = text(req.body.message, 5000, true);
      ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'البريد الإلكتروني غير صالح.');
      const hash = createHash('sha256').update(JSON.stringify({ name, email, subject, message })).digest('hex');
      await service().store.transaction(async tx => {
        const path = `contact_messages/${id}`, old = await tx.get(path);
        if (old) { ensure(old.fingerprint === hash, 'معرّف الرسالة مستخدم.', 409); return; }
        const key = createHash('sha256').update(req.ip || 'unknown').digest('hex'), ratePath = `support_rate_limits/${key}`, rate = await tx.get(ratePath), now = Date.now();
        ensure(!rate || now - rate.start > 600000 || rate.count < 10, 'طلبات كثيرة. حاول لاحقاً.', 429);
        tx.set(ratePath, { start: rate && now - rate.start < 600000 ? rate.start : now, count: rate && now - rate.start < 600000 ? rate.count + 1 : 1 });
        tx.set(path, { name, email, subject, message, fingerprint: hash, created_at: new Date(now).toISOString() });
      });
      res.status(201).json({ id, saved: true });
    } catch (error) { next(error); }
  });
  router.use(async (req, res, next) => {
    const match = req.headers.authorization?.match(/^Bearer (\S+)$/);
    if (!match) { res.status(401).json({ error: 'تسجيل الدخول مطلوب.' }); return; }
    try {
      res.locals.actor = await verify(match[1]);
      if (!res.locals.actor.emailVerified) { res.status(403).json({ error: 'أكّد بريدك الإلكتروني قبل استخدام البيانات السحابية.', code: 'email_not_verified' }); return; }
      next();
    } catch (error) {
      const failure = options?.verify && !(error instanceof BusinessError) ? new BusinessError('جلسة الدخول غير صالحة. سجّل الدخول من جديد.', 401, 'invalid_session') : authenticationFailure(error);
      res.status(failure.status).json({ error: failure.message, code: failure.code });
    }
  });
  const route = (work: (req: express.Request, actor: Actor) => Promise<unknown>): express.RequestHandler => async (req, res, next) => {
    try { res.json(await work(req, res.locals.actor)); } catch (e) { next(e); }
  };
  router.get('/plans', route(async () => (await platform().catalog()).filter(plan => plan.active)));
  router.get('/super-admin/session', route(async (_req, actor) => { await platform().assertAdmin(actor); return { uid: actor.uid, email: actor.email, role: 'super_admin' }; }));
  router.get('/super-admin/overview', route(async (_req, actor) => platform().overview(actor)));
  router.get('/super-admin/companies', route(async (req, actor) => platform().companies(actor, req.query)));
  router.get('/super-admin/companies/:orgId', route(async (req, actor) => platform().company(actor, req.params.orgId)));
  router.post('/super-admin/companies/:orgId/subscription', route(async (req, actor) => platform().updateSubscription(actor, req.params.orgId, req.body)));
  router.get('/super-admin/plans', route(async (_req, actor) => platform().plans(actor)));
  router.post('/super-admin/plans/:planId', route(async (req, actor) => platform().updatePlan(actor, req.params.planId, req.body)));
  router.get('/super-admin/events', route(async (req, actor) => platform().events(actor, req.query)));
  router.get('/super-admin/requests', route(async (req, actor) => platform().requests(actor, req.query)));
  router.get('/organizations', route(async (_req, actor) => new Organizations(service().store).list(actor)));
  router.post('/organizations', route(async (req, actor) => {
    ensure(typeof req.body.initial === 'boolean', 'نوع إنشاء المؤسسة مطلوب.');
    return new Organizations(service().store).create(actor, req.body.name, req.body.settings || {}, identifier(req.body.operationId), req.body.initial);
  }));
  router.get('/organizations/:orgId/snapshot', route(async (req, actor) => service().snapshot(req.params.orgId, actor)));
  router.get('/organizations/:orgId/backup', route(async (req, actor) => service().snapshot(req.params.orgId, actor, true)));
  router.get('/organizations/:orgId/reports/advanced', route(async (req, actor) => service().advancedReports(req.params.orgId, actor)));
  router.post('/organizations/:orgId/operations', route(async (req, actor) => service().execute(req.params.orgId, actor, req.body)));
  router.post('/organizations/:orgId/invitations/:invId/accept', route(async (req, actor) => new Organizations(service().store).accept(actor, req.params.orgId, req.params.invId)));
  router.post('/organizations/:orgId/images/:folder', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '2mb' }), route(async (req, actor) => {
    const folder = req.params.folder; ensure(['logos', 'receipts'].includes(folder), 'مسار الصور غير صالح.');
    const engine = service();
    await engine.store.transaction(async tx => { const { role, org } = await membership(tx, req.params.orgId, actor); const subscription = await loadSubscription(tx, req.params.orgId, org, new Date(), resolveSubscription); assertSubscriptionActive(subscription); ensure(hasPermission(role, folder === 'logos' ? 'org:update_settings' : 'expenses:create'), 'رفع الصورة غير مسموح.', 403); });
    const buffer = req.body as Buffer, type = req.headers['content-type'];
    ensure(Buffer.isBuffer(buffer) && buffer.length > 0, 'بيانات الصورة غير صالحة.');
    const valid = type === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : type === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 : type === 'image/gif' ? /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString()) : type === 'image/webp' && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    ensure(valid, 'محتوى الصورة لا يطابق نوع الملف.');
    const bucket = adminServices().bucket, token = randomUUID(), filePath = `organizations/${identifier(req.params.orgId)}/${folder}/${randomUUID()}`;
    try { await bucket.file(filePath).save(buffer, { resumable: false, metadata: { contentType: type, metadata: { firebaseStorageDownloadTokens: token, uploadedBy: actor.uid } } }); }
    catch (error) { throw firebaseServiceFailure(error, 'storage'); }
    return { url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}` };
  }));
  router.use((_req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof BusinessError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    if ((error as any)?.type === 'entity.too.large') { res.status(413).json({ error: 'الملف أكبر من الحد المسموح.' }); return; }
    console.error('SudaFlow operation failed:', error instanceof Error ? error.name : 'UnknownError');
    const failure = firebaseServiceFailure(error, 'firestore');
    res.status(failure.status).json({ error: failure.message, code: failure.code });
  });
  return router;
}
