import { auth } from '../lib/firebase';
import { canonical, type Command, type OperationResult } from '../domain/operations';
import { BusinessError } from '../domain/validation';
import { rememberOperation, forgetOperation } from './pendingOperations';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  const request = async (forceRefresh = false) => {
    const token = await user.getIdToken(forceRefresh);
    if (auth.currentUser?.uid !== user.uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401);
    try {
      return await fetch(`/api${path}`, { ...init, headers: { ...(init.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), ...init.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    } catch { throw new BusinessError('تعذر تأكيد الحفظ من الخادم. أعد المحاولة بنفس البيانات؛ لن تتكرر العملية.', 503); }
  };
  let response = await request();
  // Retry only authentication rejection; retain the same command and operation ID.
  if (response.status === 401) response = await request(true);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new BusinessError('خدمة الحفظ السحابي لا ترجع بيانات صالحة. حسابك لم يُعلّق؛ أعد المحاولة أو تواصل مع الإدارة.', 503, 'backend_unavailable');
  const result = await response.json().catch(() => { throw new BusinessError('تعذر قراءة استجابة خدمة الحفظ.', 502, 'invalid_response'); });
  if (!response.ok) throw new BusinessError(result.error || 'تعذر إكمال العملية.', response.status, result.code);
  return result;
}
export const operationId = () => crypto.randomUUID();
export async function sendCommand(orgId: string, action: string, data: Record<string, unknown>, suggestedId?: string): Promise<OperationResult> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new BusinessError('تسجيل الدخول مطلوب.', 401);
  const fingerprint = canonical({ action, data });
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const digest = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  if (auth.currentUser?.uid !== uid) throw new BusinessError('تغيّرت جلسة الدخول. أعد المحاولة.', 401);
  const key = `sudaflow_pending_${uid}_${orgId}_${digest}`;
  const id = rememberOperation(key, suggestedId);
  // Persist the ID before sending so uncertain transport failures can be retried after reload.
  const command: Command = { action, operationId: id, data };
  try {
    const response = await api<OperationResult>(`/organizations/${encodeURIComponent(orgId)}/operations`, { method: 'POST', body: JSON.stringify(command) });
    forgetOperation(key);
    return response;
  } catch (error) {
    if (error instanceof BusinessError && error.status < 500 && error.status !== 429) forgetOperation(key);
    throw error;
  }
}
