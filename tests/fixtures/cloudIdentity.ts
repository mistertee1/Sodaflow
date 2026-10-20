import type { Actor } from '../../src/domain/operations';
// Stable synthetic identifiers retained for the accounting regression fixtures.
// This is a verified test Auth identity, never a production guest session.
export const guestId = 'local-guest-org';
export const guestActor: Actor = { uid: 'guest', email: 'merchant@example.test', emailVerified: true, name: 'مالك اختبار سحابي' };
