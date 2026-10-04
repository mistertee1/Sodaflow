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
