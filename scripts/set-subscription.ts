import 'dotenv/config';
import { adminServices } from '../server/admin';
import { FirestoreStore } from '../server/firestoreStore';
import { PlatformBilling } from '../server/platformBilling';
import { identifier, ensure, text } from '../src/domain/validation';

// Emergency operator tool; daily commercial changes belong in /super-admin.
const args = process.argv.slice(2), [uidInput, orgInput, planInput] = args;
const option = (key: string) => { const at = args.indexOf(key); return at >= 0 ? args[at + 1] : undefined; };
const uid = identifier(uidInput), orgId = identifier(orgInput), planId = identifier(planInput);
const operationId = identifier(option('--operation-id')), reason = text(option('--reason'), 1000, true);
const { auth, db } = adminServices(), user = await auth.getUser(uid);
ensure(user.emailVerified && !user.disabled, 'Operator account must be enabled and verified.');
const actor = { uid, email: user.email || '', emailVerified: user.emailVerified, superAdmin: user.customClaims?.superAdmin === true };
const billing = new PlatformBilling(new FirestoreStore(db), db);
await billing.assertAdmin(actor);
const company = await billing.company(actor, orgId), days = option('--days');
await billing.updateSubscription(actor, orgId, { action: 'change_plan', expectedRevision: company.billingRevision, operationId, reason, method: 'manual', payload: { planId, ...(days ? { days: Number(days) } : {}) } });
console.log('Subscription changed and immutable audit event stored.');
