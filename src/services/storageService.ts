import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '../lib/firebase';

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
    ALLOWED_IMAGE_MIME_TYPES.includes(file.type.toLowerCase()) ||
    file.type.toLowerCase().startsWith('image/');

  if (!isMimeAllowed) {
    return {
      isValid: false,
      error: 'نوع الملف غير مدعوم. يرجى اختيار ملف صورة صالح (JPG, PNG, WebP).',
    };
  }

  return { isValid: true };
}

/**
 * Uploads an image to Firebase Storage scoped under organizations/{orgId}/{folder}/
 * and returns the public download URL string to store in Firestore.
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

  if (!orgId || orgId === 'local-guest-org') {
    throw new Error('يرجى اختيار أو تفعيل منشأة معتمدة لرفع الملفات سحابياً.');
  }

  // 3. Generate sanitized unique filename
  const rawExt = (file.name || 'image.jpg').split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(rawExt) ? rawExt : 'jpg';
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const fileName = `${folder}_${timestamp}_${randomSuffix}.${safeExt}`;
  const storagePath = `organizations/${orgId}/${folder}/${fileName}`;

  const storageRef = ref(storage, storagePath);

  // 4. Resumable upload with progress tracking
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type || 'image/jpeg',
    customMetadata: {
      orgId,
      uploadedBy: auth.currentUser.uid,
      originalName: file.name || 'unnamed',
    },
  });

  return new Promise<string>((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0 && onProgress) {
          const progress = Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          );
          onProgress(progress);
        }
      },
      (error: any) => {
        console.error('Firebase Storage upload error:', error);
        let friendlyMessage = 'فشل رفع الصورة إلى التخزين السحابي.';
        if (error?.code === 'storage/unauthorized') {
          friendlyMessage =
            'ليس لديك الصلاحية لرفع الملفات في هذه المنشأة. يرجى التأكد من صلاحيات حسابك.';
        } else if (error?.code === 'storage/canceled') {
          friendlyMessage = 'تم إلغاء عملية رفع الصورة.';
        } else if (
          error?.code === 'storage/retry-limit-exceeded' ||
          error?.code === 'storage/cannot-slice-blob'
        ) {
          friendlyMessage =
            'تعذر الاتصال بخدمة التخزين السحابي. يرجى التحقق من اتصال الإنترنت والمحاولة مجدداً.';
        } else if (error?.code === 'storage/quota-exceeded') {
          friendlyMessage = 'تم تجاوز حصة التخزين المتاحة للتطبيق.';
        } else if (error?.message) {
          friendlyMessage = `خطأ أثناء رفع الصورة: ${error.message}`;
        }
        reject(new Error(friendlyMessage));
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadUrl);
        } catch (urlError: any) {
          console.error('Failed to get download URL from Storage:', urlError);
          reject(
            new Error(
              'تم حفظ الصورة في التخزين السحابي ولكن تعذر استخراج الرابط المباشر. يرجى المحاولة ثانية.'
            )
          );
        }
      }
    );
  });
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
