import express from 'express';
import { createApi } from './api';
import config from '../firebase-applet-config.json';

export function createApp(storageContext?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('Permissions-Policy', 'web-share=(self)'); next(); });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));
  app.all('/__/auth/*', async (req, res) => {
    try {
      const headers = new Headers();
      for (const name of ['content-type', 'cookie', 'user-agent', 'accept']) { const value = req.get(name); if (value) headers.set(name, value); }
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : req.is('application/x-www-form-urlencoded') ? new URLSearchParams(req.body).toString() : JSON.stringify(req.body);
      const response = await fetch(`https://${config.authDomain}${req.originalUrl}`, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      res.status(response.status);
      for (const [name, value] of response.headers) if (!['content-encoding', 'transfer-encoding', 'content-length', 'set-cookie'].includes(name)) res.setHeader(name, value);
      const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch { res.status(502).send('تعذر الاتصال بخدمة تسجيل الدخول.'); }
  });
  app.use('/api', createApi({ storageContext }));
  app.use((error: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 503;
    res.status(status).json({ error: status === 400 ? 'بيانات الطلب غير صالحة.' : status === 413 ? 'الطلب أكبر من الحد المسموح.' : 'تعذر إكمال طلب الخادم.', code: status === 400 ? 'invalid_json' : 'request_failed' });
  });
  return app;
}
