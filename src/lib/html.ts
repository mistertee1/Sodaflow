export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
export function escapeStrings<T>(value: T): T {
  if (typeof value === 'string') return escapeHtml(value) as T;
  if (Array.isArray(value)) return value.map(escapeStrings) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, escapeStrings(v)])) as T;
  return value;
}
export function imageUrl(value: string | undefined): string {
  if (!value || value === '/hisabuk_logo.jpg') return '';
  return /^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,|\/brand\/)/i.test(value) ? value : '';
}
