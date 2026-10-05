import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { BusinessError } from '../domain/validation';
import { api } from './businessApi';
const isPermissionDenied = (error: unknown) => ['permission-denied', 'firestore/permission-denied'].includes((error as { code?: string }).code || '');
const syncFailure = (error: unknown) => {
  const code = (error as { code?: string }).code || '';
  if (['unavailable', 'firestore/unavailable', 'deadline-exceeded', 'firestore/deadline-exceeded'].includes(code)) {
    return new BusinessError('تعذر الوصول إلى Firestore لتأكيد المزامنة. آخر نسخة محفوظة للعرض فقط؛ ستُعاد المحاولة عند عودة الاتصال.', 503, 'firestore_unavailable');
  }
  return error;
};
const testBridge = (): { watchRevision?: (orgId: string, onRevision: (revision: number) => void, onError?: (error: unknown) => void) => () => void } | null => {
  if (typeof window === 'undefined' || !['127.0.0.1', 'localhost'].includes(window.location.hostname)) return null;
  return (window as any).__SUDANFLOW_FIREBASE_SYNC_TEST__ || null;
};

export function watchFirebaseRevision(
  orgId: string,
  onRevision: (revision: number) => void,
  onError?: (error: unknown) => void,
) {
  const uid = auth.currentUser?.uid;
  let closed = false, polling = false, fallback = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  const current = () => !closed && Boolean(uid) && auth.currentUser?.uid === uid;
  const poll = async () => {
    if (!current() || polling || document.visibilityState !== 'visible') return;
    polling = true;
    try {
      let revision: number;
      try {
        const snapshot = await getDocFromServer(doc(db, `organizations/${orgId}/meta/counters`));
        revision = Number(snapshot.data()?.revision ?? 0);
      } catch (error) {
        if (!current()) return;
        if (!isPermissionDenied(error)) throw error;
        revision = (await api<{ revision: number }>(`/organizations/${encodeURIComponent(orgId)}/revision`)).revision;
      }
      if (!Number.isSafeInteger(revision) || revision < 0) throw new BusinessError('استجابة عدّاد المزامنة غير صالحة.', 503, 'invalid_revision');
      if (current()) onRevision(revision);
    } catch (error) {
      if (current()) onError?.(syncFailure(error));
    } finally {
      polling = false;
    }
  };
  const schedule = () => {
    if (!current()) return;
    timer = setTimeout(() => {
      void poll().finally(schedule);
    }, 30000);
  };
  const recover = () => {
    if (!current() || fallback) return;
    // A failed listener receives no more events. Continue through server-confirmed
    // SDK reads first; the Admin API remains a fallback for Rules that deny these reads.
    fallback = true;
    unsubscribe?.();
    void poll().finally(schedule);
  };
  const reconcile = () => { if (fallback) void poll(); };
  window.addEventListener('online', reconcile);
  window.addEventListener('focus', reconcile);
  document.addEventListener('visibilitychange', reconcile);
  const bridge = testBridge();
  unsubscribe = bridge?.watchRevision
    ? bridge.watchRevision(orgId, revision => { if (current()) onRevision(revision); }, recover)
    : onSnapshot(
      doc(db, `organizations/${orgId}/meta/counters`),
      { includeMetadataChanges: true },
      snapshot => {
        if (!current() || snapshot.metadata.fromCache) return;
        const revision = Number(snapshot.data()?.revision ?? 0);
        if (!Number.isSafeInteger(revision) || revision < 0) {
          onError?.(new BusinessError('استجابة عدّاد المزامنة غير صالحة.', 503, 'invalid_revision'));
          recover();
          return;
        }
        onRevision(revision);
      },
      recover,
    );
  // Also handle test adapters or subscriptions that report an error synchronously.
  if (fallback) unsubscribe?.();
  return () => {
    closed = true;
    clearTimeout(timer);
    unsubscribe?.();
    window.removeEventListener('online', reconcile);
    window.removeEventListener('focus', reconcile);
    document.removeEventListener('visibilitychange', reconcile);
  };
}
