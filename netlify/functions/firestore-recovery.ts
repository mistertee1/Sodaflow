import { createHash, timingSafeEqual } from 'node:crypto';
import firebaseConfig from '../../firebase-applet-config.json';
import { adminServices } from '../../server/admin';

// Temporary technical recovery, authorized for the existing SudaFlow project only.
// The random capability is never committed or returned. Remove this function after use.
const capabilityHash = '3eaa821975ed4f937c347cbfb12f06ecc731ad6681f9921d6db256b95b3d69ce';
const expiresAt = 1791185282497;
const projectId = 'sodaflow';
const projectNumber = '715757175054';
const serviceName = `projects/${projectNumber}/services/firestore.googleapis.com`;
const output = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export default async function recover(request: Request): Promise<Response> {
  const supplied = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (request.method !== 'POST' || Date.now() >= expiresAt || !supplied
    || !timingSafeEqual(createHash('sha256').update(supplied).digest(), Buffer.from(capabilityHash, 'hex'))) return output(404, { error: 'Not found' });
  if (firebaseConfig.projectId !== projectId || firebaseConfig.messagingSenderId !== projectNumber) return output(409, { error: 'Project configuration mismatch' });

  try {
    const { app } = adminServices();
    const credential = app.options.credential;
    if (!credential) return output(503, { stage: 'credential', error: 'Server credential unavailable' });
    const token = await credential.getAccessToken();
    const call = async (url: string, method: 'GET' | 'POST') => {
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(12000) });
      const data = await response.json() as any;
      return { ok: response.ok, status: response.status, data };
    };
    const failure = (stage: string, result: { status: number; data: any }) => output(503, {
      stage, googleStatus: result.status, status: result.data.error?.status,
      reason: result.data.error?.details?.find((item: any) => item.reason)?.reason,
      message: result.data.error?.message || 'Google Cloud operation failed', projectId,
    });

    // Confirm the existing credential targets the intended project before changing anything.
    const project = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`, 'GET');
    if (!project.ok) return failure('project_access', project);
    if (String(project.data.projectNumber) !== projectNumber || project.data.projectId !== projectId) return output(409, { stage: 'project_access', error: 'Project identity mismatch' });

    const state = await call(`https://serviceusage.googleapis.com/v1/${serviceName}`, 'GET');
    if (!state.ok) return failure('service_status', state);
    if (state.data.state === 'ENABLED') return output(200, { projectId, state: 'ENABLED', changed: false });
    // Only enable Firestore; never grant IAM roles, read tenant records, or change Rules here.
    const enabled = await call(`https://serviceusage.googleapis.com/v1/${serviceName}:enable`, 'POST');
    if (!enabled.ok) return failure('service_enable', enabled);
    return output(200, { projectId, state: enabled.data.done ? 'ENABLED' : 'ENABLING', changed: true, operation: enabled.data.name });
  } catch (error) {
    // Do not print credentials, access tokens or raw upstream requests.
    return output(503, { stage: 'transport', code: (error as { code?: string }).code || 'upstream_unavailable' });
  }
}
