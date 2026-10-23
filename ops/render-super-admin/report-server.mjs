import http from 'node:http';
import fs from 'node:fs';
const result = JSON.parse(fs.readFileSync(new URL('./summary.json', import.meta.url), 'utf8'));
const report = { ...result, serviceCommit: process.env.RENDER_GIT_COMMIT || null };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  if (!['/', '/health', '/report.json'].includes(req.url)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const body = req.url === '/health' ? { status: 'ok', role: 'synthetic-acceptance-report', acceptanceStatus: report.status, productionReady: false } : report;
  res.writeHead(200); res.end(req.method === 'HEAD' ? '' : JSON.stringify(body, null, 2));
});
server.listen(Number(process.env.PORT || 10000), '0.0.0.0');
