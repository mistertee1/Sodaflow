import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { adminServices } from '../server/admin';
import { ensure, identifier } from '../src/domain/validation';

// Technical bootstrap only. Never infer an administrator from signup order or an Owner role.
const args = process.argv.slice(2), uid = identifier(args[0]), apply = args.includes('--apply');
const { auth, db } = adminServices();
const user = await auth.getUser(uid);
ensure(user.emailVerified && !user.disabled, 'The exact Firebase UID must belong to an enabled, verified account.');
console.log(JSON.stringify({ uid, verified: user.emailVerified, apply }));
if (apply) {
  const now = new Date().toISOString(), eventId = `bootstrap-${randomUUID()}`;
  // Both gates are required. A failed claims update leaves no usable additional access.
  await db.runTransaction(async tx => {
    const ref = db.doc(`platformAdmins/${uid}`), previous = await tx.get(ref);
    const next = { ...(previous.data() || {}), uid, role: 'super_admin', active: true, createdAt: previous.data()?.createdAt || now, updatedAt: now };
    tx.set(ref, next);
    tx.create(db.doc(`subscriptionEvents/${eventId}`), { id: eventId, organizationId: null, action: 'platform_admin.bootstrap', previousValue: previous.data() || null, newValue: next, performedBy: process.env.GITHUB_ACTOR || 'technical-bootstrap', createdAt: now, reason: 'Explicit verified UID supplied to trusted bootstrap', method: 'bootstrap', operationId: eventId });
  });
  await auth.setCustomUserClaims(uid, { ...user.customClaims, superAdmin: true });
  console.log('Platform administrator activated. Refresh the user session before opening /super-admin.');
} else console.log('Read-only preview. Add --apply to activate this exact verified UID.');
