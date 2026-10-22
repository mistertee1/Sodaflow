import { auth } from '../lib/firebase';
import { api } from './businessApi';

export const MAX_IMAGE_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MiB strict client-side limit
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export interface UploadImageOptions {
  file: File;
  orgId: string;
  folder: 'logos' | 'receipts';
  onProgress?: (progressPercent: number) => void;
}

export interface UploadReceiptResult {
  url: string;
  storageType: 'cloud_storage';
  fileSize: number;
}

/**
 * Validates file size and MIME type before starting upload.
 */
export function validateImageFile(
  file: File,
  maxSizeBytes: number = MAX_IMAGE_FILE_SIZE_BYTES
): ValidationResult {
  if (!file) {
    return { isValid: false, error: 'لم يتم تحديد أي ملف.' };
  }

  if (file.size > maxSizeBytes) {
    const sizeMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    return {
      isValid: false,
      error: `حجم الصورة (${(file.size / (1024 * 1024)).toFixed(2)} ميغابايت) يتجاوز الحد الأقصى المسموح به (${sizeMb} ميغابايت). يرجى اختيار صورة أصغر حجماً.`,
    };
  }

  const isMimeAllowed =
    ALLOWED_IMAGE_MIME_TYPES.includes(file.type.toLowerCase());

  if (!isMimeAllowed) {
    return {
      isValid: false,
      error: 'نوع الملف غير مدعوم. يرجى اختيار ملف صورة صالح (JPG, PNG, WebP).',
    };
  }

  return { isValid: true };
}

/**
 * Uploads through the authenticated API into tenant-scoped Netlify Blobs.
 * Logos are public on invoices; receipts are private opaque references.
 */
export async function uploadOrganizationImage({
  file,
  orgId,
  folder,
  onProgress,
}: UploadImageOptions): Promise<string> {
  // 1. Client-side validation before network activity
  const validation = validateImageFile(file);
  if (!validation.isValid) {
    throw new Error(validation.error || 'ملف الصورة غير صالح.');
  }

  // 2. Authentication and tenancy guard
  if (!auth.currentUser) {
    throw new Error('يتطلب رفع الصور السحابية تسجيل الدخول بحساب نشط في المنشأة أولاً.');
  }

  if (!orgId) {
    throw new Error('يرجى اختيار أو تفعيل منشأة معتمدة لرفع الملفات سحابياً.');
  }

  onProgress?.(0);
  const result = await api<{ url: string }>(`/organizations/${encodeURIComponent(orgId)}/images/${folder}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  onProgress?.(100);
  return result.url;
}

/** Loads a private receipt with Firebase authentication, never a public URL. */
export async function loadCustomerImageForPreview(reference: string): Promise<{ src: string; revoke: () => void }> {
  if (!reference.startsWith('sudaflow-file:')) return { src: reference, revoke: () => {} }; // Existing Firebase URLs remain readable.
  const match = /^sudaflow-file:([\w.-]{1,128}):([\w.-]{1,128})$/.exec(reference);
  if (!match) throw new Error('مرجع الملف غير صالح.');
  const user = auth.currentUser;
  if (!user) throw new Error('سجّل الدخول لعرض الملف.');
  const request = async (refresh: boolean) => fetch(`/api/organizations/${encodeURIComponent(match[1])}/files/${encodeURIComponent(match[2])}`, {
    headers: { Authorization: `Bearer ${await user.getIdToken(refresh)}` }, cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  let response = await request(false);
  if (response.status === 401) response = await request(true);
  if (auth.currentUser?.uid !== user.uid) throw new Error('تغيّرت جلسة الدخول. أعد المحاولة.');
  if (!response.ok) throw new Error('تعذر فتح الملف أو ليست لديك صلاحية عرضه.');
  if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('محتوى الصورة غير صالح.');
  const url = URL.createObjectURL(await response.blob());
  return { src: url, revoke: () => URL.revokeObjectURL(url) };
}

/**
 * Backward compatibility helper for receipt processing
 */
export const validateAndProcessReceipt = async (
  file: File,
  orgId: string,
  _expenseId?: string,
  onProgress?: (progress: number) => void
): Promise<UploadReceiptResult> => {
  const url = await uploadOrganizationImage({
    file,
    orgId,
    folder: 'receipts',
    onProgress,
  });

  return {
    url,
    storageType: 'cloud_storage',
    fileSize: file.size,
  };
};
