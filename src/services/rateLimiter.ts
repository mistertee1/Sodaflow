/**
 * Client-side Token Bucket / Cooldown Rate Limiter
 * Guards sensitive operations (invoices, payments, exports, invitations, backup)
 * Note: CENTRALIZED SERVER RATE LIMITING: NOT DEPLOYED.
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const LIMITS: Record<string, RateLimitConfig> = {
  invoice_create: { maxRequests: 20, windowMs: 60 * 1000 },
  payment_record: { maxRequests: 30, windowMs: 60 * 1000 },
  expense_create: { maxRequests: 30, windowMs: 60 * 1000 },
  invitation_send: { maxRequests: 10, windowMs: 60 * 1000 },
  export_backup: { maxRequests: 5, windowMs: 60 * 1000 },
  stock_adjustment: { maxRequests: 20, windowMs: 60 * 1000 },
};

const timestampsMap: Map<string, number[]> = new Map();

export const checkRateLimit = (action: string, identifier: string = 'default'): { allowed: boolean; retryAfterMs?: number } => {
  const config = LIMITS[action] || { maxRequests: 50, windowMs: 60 * 1000 };
  const key = `${action}:${identifier}`;
  const now = Date.now();

  const timestamps = timestampsMap.get(key) || [];
  const validTimestamps = timestamps.filter((t) => now - t < config.windowMs);

  if (validTimestamps.length >= config.maxRequests) {
    const oldest = validTimestamps[0];
    const retryAfterMs = config.windowMs - (now - oldest);
    return { allowed: false, retryAfterMs };
  }

  validTimestamps.push(now);
  timestampsMap.set(key, validTimestamps);
  return { allowed: true };
};
