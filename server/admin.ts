import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import config from '../firebase-applet-config.json';

function serverCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return applicationDefault();
  try {
    return cert(JSON.parse(raw));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
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
