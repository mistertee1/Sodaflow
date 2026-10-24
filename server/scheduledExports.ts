import { adminServices } from './admin';
import type { ScheduledAccountLookup } from '../src/domain/scheduledExportManagement';

/** Resolve by UID through the trusted project; tokens/client JSON are not user records. */
export const firebaseScheduledAccountLookup: ScheduledAccountLookup = async uid => {
  try {
    const account = await adminServices().auth.getUser(uid);
    return { uid: account.uid, disabled: account.disabled, emailVerified: account.emailVerified };
  } catch (error) {
    if ((error as { code?: string })?.code === 'auth/user-not-found') return undefined;
    throw error;
  }
};
