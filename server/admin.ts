import { BusinessError } from '../src/domain/validation';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import config from '../firebase-applet-config.json';

function serverCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    if (process.env.NETLIFY === 'true') {
      throw new BusinessError('إعداد Firebase في الخادم ناقص: أضف FIREBASE_SERVICE_ACCOUNT_JSON في متغيرات بيئة Netlify ثم أعد النشر.', 503, 'firebase_configuration_missing');
    }
    return applicationDefault();
  }
  try {
    const serviceAccount = JSON.parse(raw);
    const expectedProject = process.env.FIREBASE_PROJECT_ID || config.projectId;
    if (serviceAccount.project_id && serviceAccount.project_id !== expectedProject) {
      throw new BusinessError('مفتاح Firebase في الخادم يخص مشروعاً مختلفاً عن مشروع التطبيق. صحّح FIREBASE_SERVICE_ACCOUNT_JSON ثم أعد النشر.', 503, 'firebase_project_mismatch');
    }
    return cert(serviceAccount);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('مفتاح Firebase في الخادم غير صالح. راجع FIREBASE_SERVICE_ACCOUNT_JSON ثم أعد النشر.', 503, 'firebase_configuration_invalid');
  }
}

export function adminServices() {
  const app = getApps().find(a => a.name === 'sudaflow-server') || initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || config.projectId,
    credential: serverCredential(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || config.storageBucket,
  }, 'sudaflow-server');
  const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || config.firestoreDatabaseId || '(default)');
  return { auth: getAuth(app), db, bucket: getStorage(app).bucket() };
}
