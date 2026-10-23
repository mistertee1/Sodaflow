# SudaFlow — Free customer file storage rollout

## Approved architecture

| Concern | Provider | Boundary |
| --- | --- | --- |
| Financial/customer records and file metadata | Existing Firebase Firestore | Server API, existing tenant permissions and transactions |
| Logo/receipt/attachment bytes | Netlify Blobs site-wide store `sudaflow-customer-files-production` | Server-side functions only; never the browser SDK |
| Source/deploys | Existing GitHub repo / Netlify | No files committed to git |

No Firebase Storage bucket, Firebase Blaze upgrade, external storage API key, or payment card is required for the **file upload integration**. Netlify's Free plan is not unlimited. Function invocations, transfer and deployment traffic consume shared account credits; a free site can pause upon reaching its monthly hard limit.

## Security and behavior

- Only the production Netlify deploy can read/write the customer-file store. Context comes from the trusted `Context.deploy.context` field of the Netlify Function, **not** a request header or build-only `CONTEXT` environment variable.
- All other contexts (Deploy Previews, branch deploys, local server, missing context) fail closed for uploads. This avoids accidentally writing preview-only file references into production Firestore. Preview testing uses injected mock storage in automated tests.
- `POST /api/organizations/:orgId/images/logos` and `/images/receipts` remain compatible with the existing UI. New `POST /api/organizations/:orgId/files/:folder` also accepts `attachments` (PDF or images); there is not yet an attachments-list UI.
- Max body and individual file size: 2 MiB. Allowed: PNG, JPEG, WebP and GIF with matching file signatures; PDF only for `attachments`. SVG/HTML/scripts are not accepted. Unrecognized folder or mismatched content is rejected.
- Organization identity, role and subscription are checked before upload, and membership is rechecked before committing metadata to `organizations/{orgId}/files/{fileId}`. If Firestore rejects the commit, the uploaded blob is deleted on a best-effort basis; the API never reports success for a failed commit.
- Logos are intentionally public via `GET /api/public/logos/:orgId/:fileId` because invoices need to display them. The API only serves files marked as public logos in Firestore; direct blob keys are not accepted. URLs are same-origin and stable across production redeploys.
- Receipts and attachments return opaque `sudaflow-file:<orgId>:<fileId>` references. `GET /api/organizations/:orgId/files/:fileId` requires Firebase sign-in, organization membership, and `expenses:read` permission. Receipts are loaded into a temporary browser object URL for preview, then revoked.
- Legacy Firebase Storage URLs remain readable for historical content if already valid. There is no automatic migration of historical blobs.

## Release checklist

1. Confirm the connected Netlify site is **the actual SudaFlow production site** and matches the service whose domain serves the app. Do not publish to an unrelated project.
2. Confirm that the Netlify account is using the Free plan and no paid plan or auto-recharge was enabled. Netlify Blobs provisions automatically for Functions; do not place a storage secret in GitHub.
3. Confirm Firebase Admin credentials and Firestore API still work from that Netlify site's Functions; `GET /api/health/ready` must be `200` with `checks.firestore.status = ready`.
4. Run `npm run lint`, `node --import tsx --test tests/api.test.ts`, `npm run test:netlify`, `npm test`, and `npm run build:netlify`. Test previews must not write to production customer files.
5. Publish production only after the new Function bundle and UI are deployed **together**. With an authenticated Owner, upload a small logo and a receipt, reload, then confirm the logo on an invoice and the receipt's authenticated preview. Log out: logo remains public, receipt is denied. Verify another organization cannot read that receipt.
6. Check Netlify Blobs storage usage and free-plan credit usage. Keep a periodic backup/export policy for customer attachments; Netlify Blobs is not the same as a managed customer document retention/compliance service.

## Known constraints

- `GET /api/health/ready` now checks Firebase Auth credentials and Firestore only. It does not assert that the Netlify Blob store has working write access. End-to-end upload smoke testing remains required before declaring release ready.
- The Free plan has metered shared limits; this is suitable as a **starting option**, not a promised zero-cost path for thousands of customers with heavy file traffic.
- This first step supports logo uploads and expense-receipt uploads end to end. The attachments endpoint can store images/PDFs, but its UI and business-record association are future work.
- Retention, hard per-company storage quotas, virus scanning and dedicated independent file backups have not yet been implemented. Existing Firestore backup/restore exports do **not** include Blob file bytes. Do not treat this as regulated-document archival storage.
