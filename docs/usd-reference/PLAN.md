# USD reference pricing

1. Keep historical purchases, WAC and posted invoices unchanged. USD is the reference for new sales quotes, using current draft FX.
2. Support a precise fixed USD selling reference and documented USD WAC plus a configurable markup. Preserve explicit manual prices. Legacy products with a USD catalog price can use that existing reference; SDG-only history must not acquire an invented original FX.
3. Recompute automatic quotes on the server using current product/cost state and frozen invoice rates. Reject stale previews before posting. Store immutable pricing evidence.
4. Update product and invoice UI, with FX/cost/markup explanation and safe missing-source errors. No business data persisted locally.
5. Acceptance: MemoryStore and HTTP behavior, demo-sudaflow Firestore Emulator, real browser/API tests, full regression/build/audit. Keep Super Admin paused.
6. User reviews/merges the stacked PR after PR118. No production deploy, Rules changes, account/role changes or commercial migration. Review other accountant branch overlap before integration.
