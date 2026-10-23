import 'dotenv/config';
import { parseArgs } from 'node:util';
import { adminServices } from '../server/admin';
import { ensure } from '../src/domain/validation';
import { FirestoreStore } from '../server/firestoreStore';
import { activateExclusiveAdmin, previewExclusiveAdmin } from '../server/platformAdminBootstrap';
import { platformAdminEmail } from '../server/platformAdminAccess';
import { serverEnv } from '../server/env';

// Technical bootstrap only. Never infer an administrator from signup order or an Owner role.
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  email: { type: 'string' }, uid: { type: 'string' }, apply: { type: 'boolean', default: false }, 'review-hash': { type: 'string' },
} });
ensure(positionals.length <= 1, 'Supply at most one exact UID.');
const configured = serverEnv('SUPER_ADMIN_EMAIL');
const email = platformAdminEmail(values.email || configured);
ensure(configured === undefined || platformAdminEmail(configured) === email, 'The supplied email differs from the configured exclusive account.');
const target = { email, uid: values.uid || positionals[0] || serverEnv('SUPER_ADMIN_UID') };
const { auth, db } = adminServices();
const store = new FirestoreStore(db);
const result = values.apply
  ? await activateExclusiveAdmin(store, auth, { ...target, reviewHash: values['review-hash'] || '', operator: process.env.GITHUB_ACTOR || 'technical-bootstrap' })
  : await previewExclusiveAdmin(store, auth, target);
console.log(JSON.stringify({ apply: values.apply, ...result }));
