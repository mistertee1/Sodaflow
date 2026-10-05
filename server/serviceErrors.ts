import { BusinessError } from '../src/domain/validation';

export function firebaseServiceFailure(error: unknown, service: 'firebase' | 'firestore' | 'storage'): BusinessError {
  if (error instanceof BusinessError) return error;
  const upstream = error as { code?: unknown; reason?: unknown; message?: unknown; details?: unknown; statusDetails?: unknown } | null;
  const code = String(upstream?.code || '').toLowerCase();
  const details = [upstream?.details, upstream?.statusDetails].flatMap(value => Array.isArray(value) ? value : []);
  const serviceDisabled = upstream?.reason === 'SERVICE_DISABLED'
    || details.some(detail => detail && typeof detail === 'object' && detail.reason === 'SERVICE_DISABLED')
    || /Cloud Firestore API.*(?:has not been used|is disabled)/i.test(String(upstream?.message || '') + ' ' + (typeof upstream?.details === 'string' ? upstream.details : ''));
  if (service === 'firestore' && serviceDisabled) {
    return new BusinessError('خدمة Cloud Firestore API معطّلة في مشروع التطبيق. يلزم تفعيلها من Google Cloud لاستعادة المزامنة؛ تغيير قواعد Firestore وحده لا يعالج ذلك.', 503, 'firestore_api_disabled');
  }
  if (['app/invalid-credential', 'auth/invalid-credential', '16', 'unauthenticated', 'invalid_grant'].includes(code)) {
    return new BusinessError('تعذر استخدام مفتاح Firebase في الخادم. حدّث FIREBASE_SERVICE_ACCOUNT_JSON بمفتاح صالح من مشروع التطبيق ثم أعد النشر.', 503, 'firebase_credentials_invalid');
  }
  if (service === 'storage' && ['404', 'not_found', 'storage/bucket-not-found'].includes(code)) {
    return new BusinessError('حاوية صور المتجر غير موجودة. فعّل Firebase Storage في مشروع التطبيق وتحقق من FIREBASE_STORAGE_BUCKET ثم أعد النشر.', 503, 'storage_bucket_missing');
  }
  if (service === 'storage' && ['401', '403', '7', 'permission_denied', 'storage/unauthorized'].includes(code)) {
    return new BusinessError('الخادم لا يملك صلاحية رفع صور المتجر. راجع صلاحية حساب خدمة Firebase على حاوية Storage.', 503, 'storage_access_denied');
  }
  if (service === 'firestore' && ['5', 'not_found'].includes(code)) {
    return new BusinessError('قاعدة Firestore المحددة غير موجودة. أنشئ قاعدة المشروع وتحقق من FIRESTORE_DATABASE_ID ثم أعد النشر.', 503, 'firestore_database_missing');
  }
  if (service === 'firestore' && ['7', '403', 'permission_denied'].includes(code)) {
    return new BusinessError('الخادم لا يملك صلاحية الوصول إلى Firestore. راجع صلاحية حساب خدمة Firebase وتفعيل قاعدة المشروع.', 503, 'firestore_access_denied');
  }
  if (service === 'firestore' && ['9', 'failed_precondition'].includes(code)) {
    return new BusinessError('قاعدة Firestore غير جاهزة للعملية. راجع تفعيل القاعدة والفهارس المطلوبة في سجل الخادم.', 503, 'firestore_not_ready');
  }
  return new BusinessError('تعذر تأكيد الحفظ. أعد المحاولة بعد التحقق من إعداد الخادم والاتصال.', 503, 'service_unavailable');
}
