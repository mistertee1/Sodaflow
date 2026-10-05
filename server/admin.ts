import { serverEnv, onNetlify } from './env';
import { BusinessError } from '../src/domain/validation';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import config from '../firebase-applet-config.json';

export function selectedFirebaseProjectId() {
  const projectId = config.projectId;
  const override = serverEnv('FIREBASE_PROJECT_ID')?.trim();
  if (override && override !== projectId) {
    throw new BusinessError('مشروع Firebase في الخادم مختلف عن مشروع الواجهة. احذف قيمة FIREBASE_PROJECT_ID القديمة أو اضبطها على ' + projectId + ' ثم أعد النشر.', 503, 'firebase_project_mismatch');
  }
  return projectId;
}

function serverCredential() {
  const raw = serverEnv('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
  if (!raw) {
    if (onNetlify() || serverEnv('NETLIFY') === 'true' || serverEnv('AWS_LAMBDA_FUNCTION_NAME')) {
      throw new BusinessError('إعداد Firebase في الخادم ناقص: أضف FIREBASE_SERVICE_ACCOUNT_JSON في متغيرات بيئة Netlify ثم أعد النشر.', 503, 'firebase_configuration_missing');
    }
    return applicationDefault();
  }
  try {
    const serviceAccount = JSON.parse(raw);
    const expectedProject = selectedFirebaseProjectId();
    const credentialProject = serviceAccount.project_id || serviceAccount.projectId;
    if (credentialProject && credentialProject !== expectedProject) {
      throw new BusinessError('مفتاح Firebase في الخادم يخص مشروعاً مختلفاً عن مشروع التطبيق. صحّح FIREBASE_SERVICE_ACCOUNT_JSON ثم أعد النشر.', 503, 'firebase_project_mismatch');
    }
    return cert(serviceAccount);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('مفتاح Firebase في الخادم غير صالح. راجع FIREBASE_SERVICE_ACCOUNT_JSON ثم أعد النشر.', 503, 'firebase_configuration_invalid');
  }
}

export function selectedFirestoreDatabaseId() {
  return serverEnv('FIRESTORE_DATABASE_ID')?.trim() || config.firestoreDatabaseId || '(default)';
}

export function adminServices() {
  const projectId = selectedFirebaseProjectId();
  const app = getApps().find(a => a.name === 'sudaflow-server') || initializeApp({
    projectId,
    credential: serverCredential(),
    storageBucket: serverEnv('FIREBASE_STORAGE_BUCKET') || config.storageBucket,
  }, 'sudaflow-server');
  const db = getFirestore(app, selectedFirestoreDatabaseId());
  return { app, auth: getAuth(app), db, bucket: getStorage(app).bucket() };
}
