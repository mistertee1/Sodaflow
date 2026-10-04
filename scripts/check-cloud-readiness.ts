import 'dotenv/config';
import { inspectFirebaseReadiness } from '../server/readiness';
const result = await inspectFirebaseReadiness();
console.log(JSON.stringify(result));
if (result.checks.firebase.status !== 'ready' || result.checks.firestore?.status !== 'ready') process.exitCode = 2;
// Missing Storage is independent of invoice synchronization; it affects image uploads.
