import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import config from '../firebase-applet-config.json';
export function adminServices() {
  const app = getApps().find(a => a.name === 'sudaflow-server') || initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || config.projectId, credential: applicationDefault(), storageBucket: config.storageBucket }, 'sudaflow-server');
  const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || config.firestoreDatabaseId || '(default)');
  return { auth: getAuth(app), db, bucket: getStorage(app).bucket() };
}
