// Credential/configuration outages must never be reported as invalid user sessions.
export function isInvalidSession(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token',
    'auth/argument-error', 'auth/user-disabled', 'auth/user-not-found'].includes(code || '');
}

export function authenticationFailure(error: unknown): BusinessError {
  if (error instanceof BusinessError) return error;
  if (isInvalidSession(error)) return new BusinessError('جلسة الدخول غير صالحة. سجّل الدخول من جديد.', 401, 'invalid_session');
  return new BusinessError('تعذر الاتصال بخدمة المصادقة. تحقّق من إعداد Firebase في الخادم ثم أعد المحاولة.', 503, 'auth_service_unavailable');
}
import { BusinessError } from '../src/domain/validation';

