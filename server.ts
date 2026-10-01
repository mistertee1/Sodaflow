import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApi } from './server/api';
import config from './firebase-applet-config.json';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });
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
  app.use('/api', createApi());
  return app;
}
export async function startServer() {
  const app = createApp();
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares);
  } else {
    const dist = path.resolve('dist'); app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  const port = Number(process.env.PORT || 3000);
  return app.listen(port, '0.0.0.0', () => console.log(`SudaFlow listening on port ${port}`));
}
if (process.env.SUDAFLOW_START_SERVER === 'true' || process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) startServer().catch(() => { console.error('SudaFlow startup failed'); process.exitCode = 1; });
