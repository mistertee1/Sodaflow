import config from '../firebase-applet-config.json';
import { adminServices, selectedFirestoreDatabaseId } from './admin';
import { firebaseServiceFailure } from './serviceErrors';
import { BusinessError } from '../src/domain/validation';

type Check = { status: 'ready' | 'error'; code?: string; message?: string };
type ProbeServices = {
  app: { options: { credential?: { getAccessToken(): Promise<unknown> } } };
  db: { doc(path: string): { get(): Promise<unknown> } };
};

async function check(service: 'firebase' | 'firestore', work: () => Promise<unknown>): Promise<Check> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new BusinessError('انتهت مهلة الاتصال بالخدمة. أعد المحاولة.', 503, 'service_timeout')), 8000); }),
    ]);
    return { status: 'ready' };
  } catch (error) {
    const failure = firebaseServiceFailure(error, service);
    return { status: 'error', code: failure.code, message: failure.message };
  } finally { if (timer) clearTimeout(timer); }
}

// This probe never writes data or returns credentials, users, or document contents.
export async function inspectFirebaseReadiness(services: () => ProbeServices = adminServices) {
  const result: {
    status: 'ready' | 'error';
    firebase_project_id: string;
    firestore_database_id: string;
    checks: { firebase: Check; firestore?: Check };
  } = { status: 'error', firebase_project_id: config.projectId, firestore_database_id: selectedFirestoreDatabaseId(), checks: { firebase: { status: 'error' } } };
  let connection: ProbeServices | undefined;
  result.checks.firebase = await check('firebase', async () => {
    connection = services();
    if (!connection.app.options.credential) throw new BusinessError('اعتماد Firebase غير متاح في الخادم.', 503, 'firebase_configuration_missing');
    await connection.app.options.credential.getAccessToken();
  });
  if (result.checks.firebase.status !== 'ready' || !connection) return result;
  const readyConnection = connection;
  // Images and receipts no longer use Firebase Storage. An absent Firebase
  // bucket must not make healthy Firestore synchronization appear degraded.
  result.checks.firestore = await check('firestore', () => readyConnection.db.doc('_health/readiness').get());
  result.status = result.checks.firestore.status === 'ready' ? 'ready' : 'error';
  return result;
}

let cached: { at: number; result: Promise<Awaited<ReturnType<typeof inspectFirebaseReadiness>>> } | undefined;
export function firebaseReadiness() {
  if (!cached || Date.now() - cached.at > 30000) cached = { at: Date.now(), result: inspectFirebaseReadiness() };
  return cached.result;
}
