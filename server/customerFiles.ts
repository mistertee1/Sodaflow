import { getStore } from '@netlify/blobs';
import { BusinessError } from '../src/domain/validation';

export type CustomerFileFolder = 'logos' | 'receipts' | 'attachments';

export interface CustomerFileStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

// Files are stored separately from Firestore; only tenant-scoped metadata is
// kept there. This adapter must never be imported into the browser bundle.
export function netlifyCustomerFileStorage(deployContext?: string): CustomerFileStorage {
  // `CONTEXT` is build-only, NOT a trusted runtime environment variable.
  // The context comes from the Netlify function's deploy metadata. Never write
  // from previews: they may point to production Firestore, and deploy-scoped
  // Blobs would be discarded while the shared metadata persisted.
  if (deployContext !== 'production') throw new BusinessError('رفع الملفات متاح من نسخة SudaFlow المنشورة فقط.', 503, 'file_storage_unavailable');
  const store = getStore({ name: 'sudaflow-customer-files-production', consistency: 'strong' });
  return {
    async put(key, bytes, contentType) {
      await store.set(key, new Blob([new Uint8Array(bytes)], { type: contentType }), { onlyIfNew: true });
    },
    async get(key) {
      const value = await store.get(key, { type: 'arrayBuffer', consistency: 'strong' });
      return value === null ? null : Buffer.from(value);
    },
    async delete(key) { await store.delete(key); },
  };
}

export function safeCustomerFileType(data: Buffer, claimedType: string, folder: CustomerFileFolder): string {
  const type = claimedType.toLowerCase().split(';', 1)[0].trim();
  const image = type === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || type === 'image/jpeg' && data.length > 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
    || type === 'image/gif' && /^GIF8[79]a$/.test(data.subarray(0, 6).toString())
    || type === 'image/webp' && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  const pdf = folder === 'attachments' && type === 'application/pdf' && data.subarray(0, 5).toString() === '%PDF-';
  if (data.length === 0 || (!image && !pdf)) throw new BusinessError('نوع الملف أو محتواه غير مدعوم. يُسمح بصور PNG/JPG/WebP/GIF وPDF للمرفقات فقط.', 400, 'invalid_file');
  if (data.length > 2 * 1024 * 1024) throw new BusinessError('حجم الملف يتجاوز 2 ميغابايت.', 413, 'file_too_large');
  return type;
}
