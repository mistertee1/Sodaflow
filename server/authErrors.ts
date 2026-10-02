// Credential/configuration outages must never be reported as invalid user sessions.
export function isInvalidSession(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token',
    'auth/argument-error', 'auth/user-disabled', 'auth/user-not-found'].includes(code || '');
}
