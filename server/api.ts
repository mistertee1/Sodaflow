import platformControls from '../src/config/platform-controls.json';
import { verifyDeployedAccountingRules } from './accountingSecurity';
import { organizationRevision } from './revision';
import { authenticationFailure } from './authErrors';
import { firebaseServiceFailure } from './serviceErrors';
import { firebaseReadiness } from './readiness';
import { netlifyCustomerFileStorage, safeCustomerFileType, type CustomerFileFolder, type CustomerFileStorage } from './customerFiles';
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
import config from '../firebase-applet-config.json';
import { FirestoreStore } from './firestoreStore';
import { ResilientStore } from './resilientStore';
import { resolveSubscription } from './subscriptions';
import { PlatformBilling } from './platformBilling';
import { OperationIntents } from './operationIntents';
import { loadSubscription, assertSubscriptionActive } from '../src/domain/subscriptions';
import { authorizedLargeExportDownload, firebaseLargeExportWorker } from './largeExportWorker';

type Verify = (token: string) => Promise<Actor>;
export function createApi(options?: { operations?: Operations; verify?: Verify; fileStorage?: CustomerFileStorage; storageContext?: string }) {
  const router = express.Router();
  // Tenant records and platform access decisions must not become a browser/CDN
  // disk snapshot. Apply this to successful responses and authorization errors.
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const controlsEnabled = options?.operations?.controlsEnabled ?? platformControls.enabled;
  const service = () => options?.operations || new Engine(new ResilientStore(adminServices().db), undefined, resolveSubscription, verifyDeployedAccountingRules, controlsEnabled);
  const platform = () => new PlatformBilling(service().store, options?.operations ? undefined : adminServices().db, controlsEnabled);
  const files = () => options?.fileStorage || netlifyCustomerFileStorage(options?.storageContext);
  const verify: Verify = options?.verify || (async token => {
    const claims = await adminServices().auth.verifyIdToken(token, true);
    return { uid: claims.uid, email: claims.email || '', emailVerified: claims.email_verified === true, name: claims.name, superAdmin: claims.superAdmin === true, authTime: claims.auth_time };
  });
  router.get('/platform-controls', (_req, res) => res.json({ enabled: controlsEnabled }));
  // Block the entire control plane before initializing Firebase or reading any records.
  router.use('/super-admin', (_req, _res, next) => next(controlsEnabled ? undefined : new BusinessError('لوحة السوبر أدمن وإدارة الاشتراكات متوقفة مؤقتاً.', 403, 'platform_controls_paused')));
  router.get('/health', (_req, res) => res.json({ status: 'ok', app: 'SudaFlow', version: '3.0.0', release: '2026-10-05-central-sync-recovery' }));
  router.get('/health/ready', async (_req, res) => {
    const result = await firebaseReadiness();
    res.status(result.status === 'ready' ? 200 : 503).json(result);
  });
  // Only an explicit logo record is public (logos appear on customer invoices).
  // No caller-provided blob key or tenant metadata is exposed here.
  router.get('/public/logos/:orgId/:fileId', async (req, res, next) => {
    try {
      const orgId = identifier(req.params.orgId), fileId = identifier(req.params.fileId);
      const record = await service().store.transaction(tx => tx.get(`organizations/${orgId}/files/${fileId}`));
      if (!record || record.folder !== 'logos' || record.public !== true || record.org_id !== orgId) { res.sendStatus(404); return; }
      const bytes = await files().get(record.key);
      if (!bytes) { res.sendStatus(404); return; }
      res.setHeader('Content-Type', record.content_type);
      res.setHeader('Content-Disposition', 'inline');
      res.status(200).send(bytes);
    } catch (error) { next(error); }
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
  router.post('/operation-intents', route((req, actor) => new OperationIntents(service().store, undefined, controlsEnabled).begin(actor, req.body)));
  router.post('/operation-intents/acknowledge', route((req, actor) => new OperationIntents(service().store, undefined, controlsEnabled).acknowledge(actor, req.body)));
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
  router.get('/organizations', route(async (_req, actor) => new Organizations(service().store, resolveSubscription, undefined, controlsEnabled).list(actor)));
  router.post('/organizations', route(async (req, actor) => {
    ensure(typeof req.body.initial === 'boolean', 'نوع إنشاء المؤسسة مطلوب.');
    return new Organizations(service().store, resolveSubscription, undefined, controlsEnabled).create(actor, req.body.name, req.body.settings || {}, identifier(req.body.operationId), req.body.initial);
  }));
  router.post('/organizations/:orgId/opening-balances/preview', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route((req,actor)=>{ensure(Object.keys(req.query).length===0,'مرشحات معاينة الأرصدة غير صالحة.');return service().openingPreview(req.params.orgId,actor,req.body);}));
  router.post('/organizations/:orgId/fx-revaluations/preview', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route((req,actor)=>{ensure(Object.keys(req.query).length===0,'مرشحات معاينة إعادة التقييم غير صالحة.');return service().fxRevaluationPreview(req.params.orgId,actor,req.body);}));
  router.post('/organizations/:orgId/fixed-assets/preview', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route((req,actor)=>{ensure(Object.keys(req.query).length===0,'مرشحات معاينة الأصل غير صالحة.');return service().fixedAssetPreview(req.params.orgId,actor,req.body);}));
  router.get('/organizations/:orgId/accounting-periods', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route((req,actor)=>{ensure(Object.keys(req.query).every(key=>key==='periodId')&&(!('periodId' in req.query)||typeof req.query.periodId==='string'&&!!req.query.periodId),'مرشحات الفترات غير صالحة.');return service().periodReports(req.params.orgId,actor,req.query.periodId as string|undefined);}));
  router.get('/organizations/:orgId/revision', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, route(async (req, actor) => organizationRevision(service().store, req.params.orgId, actor, controlsEnabled)));
  router.get('/organizations/:orgId/snapshot', route(async (req, actor) => service().snapshot(req.params.orgId, actor)));
  router.get('/organizations/:orgId/backup', route(async (req, actor) => service().snapshot(req.params.orgId, actor, true)));
  router.get('/organizations/:orgId/export-jobs/:collection/:jobId/download', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>authorizedLargeExportDownload(service().store,firebaseLargeExportWorker(),req.params.orgId,req.params.collection,req.params.jobId,actor)));
  router.get('/organizations/:orgId/reports/advanced', route(async (req, actor) => {ensure(Object.keys(req.query).every(key=>['start','end','compareStart','compareEnd'].includes(key)),'مرشحات التقارير المتقدمة غير صالحة.');const value=(key:string)=>typeof req.query[key]==='string'&&req.query[key]?req.query[key] as string:undefined,comparison=value('compareStart')||value('compareEnd')?{start:value('compareStart'),end:value('compareEnd')}:undefined;ensure(!comparison||comparison.start&&comparison.end,'المقارنة تتطلب بداية ونهاية كاملتين.');return service().advancedReports(req.params.orgId,actor,{start:value('start'),end:value('end')},comparison);}));
  router.get('/organizations/:orgId/reports/accounting-health', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>key==='asOf')&&(!('asOf' in req.query)||typeof req.query.asOf==='string'&&!!req.query.asOf),'مرشحات صحة المحاسبة غير صالحة.');return service().accountingHealth(req.params.orgId,actor,req.query.asOf as string|undefined);}));
  router.get('/organizations/:orgId/reports/accounting-assistance', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>key==='asOf')&&(!('asOf' in req.query)||typeof req.query.asOf==='string'&&!!req.query.asOf),'مرشحات مساعد المحاسبة غير صالحة.');return service().accountingAssistance(req.params.orgId,actor,req.query.asOf as string|undefined);}));
  router.get('/organizations/:orgId/reports/owner-financial-summary', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>key==='asOf')&&(!('asOf' in req.query)||typeof req.query.asOf==='string'&&!!req.query.asOf),'مرشحات ملخص المالك غير صالحة.');return service().ownerFinancialSummary(req.params.orgId,actor,req.query.asOf as string|undefined);}));
  router.get('/organizations/:orgId/reports/branch-profit-loss', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>['branchId','start','end'].includes(key))&&typeof req.query.branchId==='string'&&!!req.query.branchId,'مرشحات تقرير الفرع غير صالحة.');return service().branchProfitAndLoss(req.params.orgId,actor,req.query.branchId,{start:typeof req.query.start==='string'&&req.query.start?req.query.start:undefined,end:typeof req.query.end==='string'&&req.query.end?req.query.end:undefined});}));
  router.get('/organizations/:orgId/reports/product-profitability', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>['start','end'].includes(key)),'مرشحات ربحية المنتجات غير صالحة.');return service().productProfitability(req.params.orgId,actor,{start:typeof req.query.start==='string'&&req.query.start?req.query.start:undefined,end:typeof req.query.end==='string'&&req.query.end?req.query.end:undefined});}));
  router.get('/organizations/:orgId/reports/customer-profitability', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>['start','end'].includes(key)),'مرشحات ربحية العملاء غير صالحة.');return service().customerProfitability(req.params.orgId,actor,{start:typeof req.query.start==='string'&&req.query.start?req.query.start:undefined,end:typeof req.query.end==='string'&&req.query.end?req.query.end:undefined});}));
  router.get('/organizations/:orgId/reports/budget-vs-actual', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>key==='budgetId')&&typeof req.query.budgetId==='string'&&!!req.query.budgetId,'معرّف الميزانية مطلوب.');return service().budgetReport(req.params.orgId,actor,req.query.budgetId); }));
  router.get('/organizations/:orgId/reports/cash-forecast', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>['asOf','days'].includes(key)),'مرشحات توقع النقد غير صالحة.');return service().cashForecastReport(req.params.orgId,actor,{asOf:typeof req.query.asOf==='string'&&req.query.asOf?req.query.asOf:undefined,days:typeof req.query.days==='string'&&req.query.days?Number(req.query.days):undefined}); }));
  router.get('/organizations/:orgId/reports/payables', route(async (req, actor) => service().payableReports(req.params.orgId, actor, { start: typeof req.query.start === 'string' ? req.query.start : undefined, end: typeof req.query.end === 'string' ? req.query.end : undefined })));
  router.get('/organizations/:orgId/reports/tax', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>['start','end'].includes(key)),'مرشحات تقرير الضريبة غير صالحة.');return service().taxReports(req.params.orgId,actor,{start:typeof req.query.start==='string'&&req.query.start?req.query.start:undefined,end:typeof req.query.end==='string'&&req.query.end?req.query.end:undefined});}));
  for (const view of ['ledger', 'receivables', 'cash'] as const) {
    router.get(`/organizations/:orgId/reports/${view}`, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, route(async (req, actor) => {
      return service().operationalReport(req.params.orgId, actor, view, req.query);
    }));
  }
  router.get('/organizations/:orgId/reports/reconciliations', (_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();}, route(async(req,actor)=>{ensure(Object.keys(req.query).every(key=>key==='asOf')&&(!('asOf' in req.query)||typeof req.query.asOf==='string'&&!!req.query.asOf),'مرشحات المطابقة غير صالحة.');return service().cashReconciliationReports(req.params.orgId,actor,req.query.asOf as string|undefined);}));
  router.post('/organizations/:orgId/operations', route(async (req, actor) => service().execute(req.params.orgId, actor, req.body)));
  router.post('/organizations/:orgId/invitations/:invId/accept', route(async (req, actor) => new Organizations(service().store, resolveSubscription, undefined, controlsEnabled).accept(actor, req.params.orgId, req.params.invId)));
  const uploadCustomerFile = route(async (req, actor) => {
    const orgId = identifier(req.params.orgId), folder = req.params.folder as CustomerFileFolder;
    ensure(['logos', 'receipts', 'attachments'].includes(folder), 'مسار الملفات غير صالح.');
    ensure(!req.path.includes('/images/') || folder !== 'attachments', 'مسار المرفقات غير صالح.');
    const bytes = req.body as Buffer;
    ensure(Buffer.isBuffer(bytes) && bytes.length > 0, 'بيانات الملف غير صالحة.');
    const contentType = safeCustomerFileType(bytes, String(req.headers['content-type'] || ''), folder);
    const permission = folder === 'logos' ? 'org:update_settings' : 'expenses:create';
    const store = service().store;
    const assertAccess = async () => store.transaction(async tx => {
      const { role, org } = await membership(tx, orgId, actor, false, controlsEnabled);
      const subscription = await loadSubscription(tx, orgId, org, new Date(), resolveSubscription, controlsEnabled);
      assertSubscriptionActive(subscription);
      ensure(hasPermission(role, permission), 'رفع الملف غير مسموح.', 403);
    });
    await assertAccess();
    const id = randomUUID(), key = `organizations/${orgId}/${folder}/${id}`;
    const blobStore = files();
    try { await blobStore.put(key, bytes, contentType); }
    catch { throw new BusinessError('تعذر حفظ الملف في خدمة التخزين السحابي المجانية.', 503, 'file_storage_unavailable'); }
    try {
      await store.transaction(async tx => {
        const { role } = await membership(tx, orgId, actor, false, controlsEnabled);
        ensure(hasPermission(role, permission), 'رفع الملف غير مسموح.', 403);
        tx.set(`organizations/${orgId}/files/${id}`, { id, org_id: orgId, folder, key, content_type: contentType, size: bytes.length, public: folder === 'logos', uploaded_by: actor.uid, created_at: new Date().toISOString() });
      });
    } catch (error) {
      try { await blobStore.delete(key); } catch { /* Unreachable orphan: never return a success URL. */ }
      throw error;
    }
    // Receipts and attachments are private references, NOT public object URLs.
    return { id, url: folder === 'logos' ? `/api/public/logos/${orgId}/${id}` : `sudaflow-file:${orgId}:${id}` };
  });
  router.post(['/organizations/:orgId/images/:folder', '/organizations/:orgId/files/:folder'], express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'], limit: '2mb' }), uploadCustomerFile);
  router.get('/organizations/:orgId/files/:fileId', async (req, res, next) => {
    try {
      const orgId = identifier(req.params.orgId), fileId = identifier(req.params.fileId);
      const record = await service().store.transaction(async tx => {
        const { role } = await membership(tx, orgId, res.locals.actor, false, controlsEnabled);
        const file = await tx.get(`organizations/${orgId}/files/${fileId}`);
        ensure(hasPermission(role, file?.folder === 'logos' ? 'org:read' : 'expenses:read'), 'قراءة الملف غير مسموحة.', 403);
        ensure(file && file.org_id === orgId, 'الملف غير موجود.', 404);
        return file;
      });
      const bytes = await files().get(record.key);
      if (!bytes) { res.sendStatus(404); return; }
      res.setHeader('Content-Type', record.content_type);
      res.setHeader('Content-Disposition', record.content_type === 'application/pdf' ? 'attachment' : 'inline');
      res.status(200).send(bytes);
    } catch (error) { next(error); }
  });
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
