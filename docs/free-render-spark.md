# SudaFlow: zero-billing Render + Firebase Spark deployment

This is an **evaluation / closed beta** runbook, not a claim of a 24/7 production SLA.
No paid Render instance, Firebase Blaze billing account, Firebase Storage bucket, or database migration is required by this procedure.

## Existing deployment

- Keep the current **Render Free web service** running Node.js (`npm ci && npm run build`, then `npm start`). It serves the frontend and `/api` on the same origin, so do **not** create an unrelated static frontend with broken relative API requests.
- Render Free sleeps after 15 minutes without inbound traffic, may take about a minute to wake, and has an ephemeral filesystem. Do not use disk files as the source of truth for customer data.
- Do not point this service to `main` or apply Firebase rules only because a build succeeds. Production currently deploys from `codex/wafer-ux-phase1`; audit/test newer commits separately.

## Firebase without billing

1. Confirm the intended Firebase project: the app currently has `projectId: sodaflow` in `firebase-applet-config.json`. If starting with a different new project, update the frontend configuration, Admin credentials, Auth allowed domains, and rules together before deploying; do not mix projects.
2. In Firebase Console, create/enable **Cloud Firestore** in `(default)` for the project and enable **Cloud Firestore API**. Use a region close to expected clients and review Security Rules before admitting users.
3. Under **Project settings → Service accounts**, create a dedicated server-side credential with only the required permissions. In Render service **Environment**, set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete JSON, or use `GOOGLE_APPLICATION_CREDENTIALS` with an actual protected file. Do not commit, paste into issues/PRs/chat, print, or expose a service account key to a browser. Prefer a dedicated account without project Owner permissions.
4. Set `FIREBASE_PROJECT_ID` only if it matches the frontend project. Use `FIRESTORE_DATABASE_ID=(default)` unless the app configuration is intentionally changed.
5. After credentials are configured, check `GET /api/health/ready`. **HTTP 200 with `status: ready`** indicates core database and bucket ready; **HTTP 200 with `status: degraded`** indicates Firestore is available but optional image Storage is not. **HTTP 503** means authentication/Firestore is not ready; do not treat `GET /api/health` alone as proof that transactions work.
6. Verify signup, tenant isolation, invoice creation, journal posting, transaction retry, and a second-device refresh against a *test company*. Readiness is a read-only check: it does not prove Security Rules, writes, or accounting invariants.
7. Only after the dedicated rules tests and previews pass should an operator publish Firestore rules/indexes and initialize platform subscriptions. Do not run a destructive migration against unknown data. Do not grant a Super Admin role without verifying the exact Firebase UID and email.

## Features unavailable on Spark

Cloud Storage for Firebase is not available under the original no-billing requirement on current Firebase plans. Uploaded logos/receipts through `/api/organizations/:orgId/images/:folder` will fail until a supported storage design is deployed. Keep image upload out of the closed-beta acceptance requirements; **never** silently save sensitive receipts to Render's temporary filesystem or an unprotected public bucket.

Firestore managed export/backups and point-in-time recovery require billing. Build and validate a **manual, access-controlled, tested** export/restore procedure before any real merchant data. The current app's restore limit of 350 records must be addressed before relying on it for full disaster recovery.

## Guardrails

- Render Free is not always-on; do not promise instant startup or 24/7 uptime.
- Firebase Spark Firestore has quotas; do not assume the platform can serve 1,000 companies for free without measuring reads/writes.
- Do not use automated keepalive traffic as a substitute for a paid availability guarantee.
- Do not store customer financial data in git, local server files, browser cache as source of truth, or transient Render volumes.
- If readiness fails, inspect its structured codes (`firebase_configuration_missing`, `firebase_project_mismatch`, `firestore_api_disabled`, `firestore_access_denied`, `firestore_database_missing`) before attempting deployment or rules changes.
