import { auth } from '../lib/firebase';
import { canonical, type Command, type OperationResult } from '../domain/operations';
import { BusinessError } from '../domain/validation';

export async function api<T>(path: string, init: RequestInit = {}, assertContext?: () => void): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  const request = async (forceRefresh = false) => {
    const token = await user.getIdToken(forceRefresh);
    if (auth.currentUser?.uid !== user.uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401, 'session_changed');
    assertContext?.(); // Token refresh may outlast a company/session switch.
    try {
      return await fetch(`/api${path}`, { ...init, cache: 'no-store', headers: { ...(init.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), ...init.headers, Authorization: `Bearer ${token}` }, signal: init.signal || AbortSignal.timeout(60000) });
    } catch { throw new BusinessError('تعذر تأكيد الحفظ من الخادم. أعد المحاولة بنفس البيانات بعد عودة الاتصال.', 503); }
  };
  let response = await request();
  if (auth.currentUser?.uid !== user.uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401, 'session_changed');
  // Retry only authentication rejection; retain the same command and operation ID.
  if (response.status === 401) response = await request(true);
  if (auth.currentUser?.uid !== user.uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401, 'session_changed');
  if (!response.headers.get('content-type')?.includes('application/json')) throw new BusinessError('خدمة الحفظ السحابي غير مهيأة على هذا الموقع. تواصل مع إدارة المنصة؛ حسابك لم يُعلّق.', 503, 'backend_unavailable');
  const result = await response.json().catch(() => { throw new BusinessError('تعذر قراءة استجابة خدمة الحفظ. أعد المحاولة؛ لم يتم تأكيد الحفظ.', 502, 'invalid_response'); });
  if (auth.currentUser?.uid !== user.uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401, 'session_changed');
  if (!response.ok) throw new BusinessError(result.error || 'تعذر إكمال العملية.', response.status, result.code);
  return result;
}
export const operationId = () => crypto.randomUUID();
function requireSession(uid: string) {
  if (auth.currentUser?.uid !== uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401, 'session_changed');
}
// Retry IDs are persisted by the Firebase-backed API, including across reloads.
// Acknowledgement cleanup must never turn a confirmed business commit into a failure.
async function acknowledgeIntent(intent: { organizationId?: string; fingerprint: string; operationId: string }, uid: string) {
  try { requireSession(uid); await api('/operation-intents/acknowledge', { method: 'POST', body: JSON.stringify(intent), signal: AbortSignal.timeout(4000) }); }
  catch { /* The cloud keeps this ID for a safe repeat; never fall back to browser storage. */ }
}
export async function platformMutation<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ path, payload })));
  const digest = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  if (auth.currentUser?.uid !== uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401, 'session_changed');
  const intent = { fingerprint: digest };
  const { operationId: id } = await api<{ operationId: string }>('/operation-intents', { method: 'POST', body: JSON.stringify(intent) });
  requireSession(uid);
  try {
    const result = await api<T>(path, { method: 'POST', body: JSON.stringify({ ...payload, operationId: id }) });
    await acknowledgeIntent({ ...intent, operationId: id }, uid);
    requireSession(uid);
    return result;
  } catch (error) {
    if (error instanceof BusinessError && error.status < 500 && error.status !== 429 && error.code !== 'session_changed') await acknowledgeIntent({ ...intent, operationId: id }, uid);
    throw error;
  }
}
/** Durable retry identity plus a caller-owned organization/session fence. */
export async function organizationMutation<T>(orgId: string, path: string, payload: Record<string, unknown>, assertScope: () => void): Promise<T> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  const check = () => { requireSession(uid); assertScope(); };
  check();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ path, payload })));
  const fingerprint = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  check();
  const intent = { organizationId: orgId, fingerprint };
  const { operationId: id } = await api<{ operationId: string }>('/operation-intents', { method: 'POST', body: JSON.stringify(intent) });
  check(); // Never send a stale business write after a slow intent response.
  try {
    const result = await api<T>(path, { method: 'POST', body: JSON.stringify({ ...payload, operationId: id }) }, check);
    check();
    await acknowledgeIntent({ ...intent, operationId: id }, uid);
    check();
    return result;
  } catch (error) {
    if (error instanceof BusinessError && error.status < 500 && error.status !== 429 && !['session_changed', 'scope_changed'].includes(error.code || '')) {
      check(); await acknowledgeIntent({ ...intent, operationId: id }, uid);
    }
    throw error;
  }
}
export async function sendCommand(orgId: string, action: string, data: Record<string, unknown>, suggestedId?: string): Promise<OperationResult> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  const fingerprint = canonical({ action, data });
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const digest = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  if (auth.currentUser?.uid !== uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401, 'session_changed');
  const intent = { organizationId: orgId, fingerprint: digest };
  const { operationId: id } = await api<{ operationId: string }>('/operation-intents', { method: 'POST', body: JSON.stringify({ ...intent, operationId: suggestedId }) });
  requireSession(uid);
  // Do not send a business write unless its durable cloud retry ID is confirmed.
  const command: Command = { action, operationId: id, data };
  try {
    const response = await api<OperationResult>(`/organizations/${encodeURIComponent(orgId)}/operations`, { method: 'POST', body: JSON.stringify(command) });
    await acknowledgeIntent({ ...intent, operationId: id }, uid);
    requireSession(uid);
    return response;
  } catch (error) {
    if (error instanceof BusinessError && error.status < 500 && error.status !== 429 && error.code !== 'session_changed') await acknowledgeIntent({ ...intent, operationId: id }, uid);
    throw error;
  }
}
