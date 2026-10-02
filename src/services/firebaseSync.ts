import { FirebaseError } from 'firebase/app';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { canonical, Operations, type Actor, type OperationResult } from '../domain/operations';
import type { Document } from '../domain/store';
import type { OrgSubscription } from '../types';
import { createDefaultSubscription } from '../lib/plans';
import { BusinessError } from '../domain/validation';
import { BrowserFirestoreStore } from './browserFirestoreStore';

const store = new BrowserFirestoreStore(db);
const operations = new Operations(
  store,
  undefined,
  (saved, orgId) => saved ? saved as OrgSubscription : createDefaultSubscription(orgId),
);

const currentActor = (): Actor => {
  const user = auth.currentUser;
  if (!user) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  if (!user.emailVerified) throw new BusinessError('أكّد بريدك الإلكتروني قبل استخدام البيانات السحابية.', 403, 'email_not_verified');
  return {
    uid: user.uid,
    email: user.email || '',
    emailVerified: user.emailVerified,
    name: user.displayName || undefined,
  };
};

const directFailure = (error: unknown): never => {
  if (error instanceof BusinessError) throw error;
  if (error instanceof FirebaseError) {
    const map: Record<string, { message: string; status: number }> = {
      'permission-denied': { message: 'صلاحية Firebase غير كافية لهذه العملية.', status: 403 },
      'unauthenticated': { message: 'جلسة Firebase غير صالحة. سجّل الدخول من جديد.', status: 401 },
      'unavailable': { message: 'تعذر الوصول إلى Firebase حالياً. تحقق من الاتصال ثم أعد المحاولة.', status: 503 },
      'deadline-exceeded': { message: 'استغرقت مزامنة Firebase وقتاً أطول من المتوقع. أعد المحاولة.', status: 503 },
      'resource-exhausted': { message: 'تم بلوغ حد مؤقت في Firebase. حاول بعد قليل.', status: 429 },
      'aborted': { message: 'تعارضت العملية مع تعديل آخر وتم إيقافها. أعد المحاولة.', status: 409 },
    };
    const failure = map[error.code];
    if (failure) throw new BusinessError(failure.message, failure.status, error.code);
  }
  throw error;
};

export async function firebaseSnapshot(orgId: string, backup = false) {
  try {
    return await operations.snapshot(orgId, currentActor(), backup);
  } catch (error) {
    return directFailure(error);
  }
}

const operationId = () => crypto.randomUUID();

export async function firebaseCommand(
  orgId: string,
  action: string,
  data: Record<string, unknown>,
  suggestedId?: string,
): Promise<OperationResult> {
  const user = auth.currentUser;
  if (!user) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  const fingerprint = canonical({ action, data });
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const digest = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  const key = `sudaflow_pending_${user.uid}_${orgId}_${digest}`;
  const id = localStorage.getItem(key) || suggestedId || operationId();
  localStorage.setItem(key, id);
  try {
    const response = await operations.execute(orgId, currentActor(), { action, operationId: id, data: data as Document });
    try { localStorage.removeItem(key); } catch { /* confirmed write already succeeded */ }
    return response;
  } catch (error) {
    if (error instanceof BusinessError && error.status < 500 && error.status !== 429) {
      try { localStorage.removeItem(key); } catch { /* no-op */ }
    }
    return directFailure(error);
  }
}

export function watchFirebaseRevision(
  orgId: string,
  onRevision: (revision: number) => void,
  onError?: (error: unknown) => void,
) {
  return onSnapshot(
    doc(db, `organizations/${orgId}/meta/counters`),
    snapshot => onRevision(Number(snapshot.data()?.revision || 0)),
    error => onError?.(error),
  );
}
