# Render acceptance for Super Admin

Build the proposed branch, never the production service or accounting staging. Select My Workspace, Docker, free, Frankfurt, autoDeploy no, repo mistertee1/Sodaflow and the reviewed work branch. Dockerfile: `ops/render-super-admin/Dockerfile`; context: repository root.

The builder runs synthetic transactions with `demo-sudaflow` only, the existing Rules suites, unit/API behavior, all browser UI, and a pinned pre-fix red/green proof. Do not provide production credentials. Runtime serves only `/health` and `/report.json`; it contains no ERP API, Firebase SDK, database, emulator ports or transaction routes. A successful report deploy is not production activation. `scope_passed_regression_blocked` explicitly means integration is incomplete and the PR stays draft.

Reproduction: `docker build --build-arg RENDER_GIT_COMMIT=<public-commit-sha> -f ops/render-super-admin/Dockerfile .`. Build arguments carry no secrets. The Dockerfile-specific ignore excludes local data and credentials.

Production remains a separate reviewed deployment, after the correct existing Firebase database, service account, explicit verified admin UID, migration preview/backup and Rules are verified. Do not change the tracked production branch until user review. See [operations](../../docs/super-admin/OPERATIONS.md).

Platform references: [Render Docker](https://render.com/docs/docker), [Render build variables](https://render.com/docs/environment-variables), [Firestore Emulator isolation](https://firebase.google.com/docs/emulator-suite/connect_firestore).
