// Retain uncertain operation IDs even when browser storage is unavailable.
// No request payloads, credentials or financial data are stored here.
const pending = new Map<string, string>();

export function rememberOperation(key: string, suggestedId?: string): string {
  let id = pending.get(key);
  try { id ||= localStorage.getItem(key) || undefined; } catch { /* restricted browser storage */ }
  id ||= suggestedId || crypto.randomUUID();
  pending.set(key, id);
  try { localStorage.setItem(key, id); } catch { /* same-session retries remain possible */ }
  return id;
}

export function forgetOperation(key: string): void {
  pending.delete(key);
  try { localStorage.removeItem(key); } catch { /* confirmed result must still succeed */ }
}
