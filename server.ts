import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './server/app';
export { createApp } from './server/app';

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
