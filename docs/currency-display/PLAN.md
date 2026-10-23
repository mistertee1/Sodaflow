# Global presentation currency

User approved option1 with a manual quote before Apply. Store one tenant-owned display setting containing the selected currency, units per USD and the manual SDG/USD conversion basis. Validate all rates on the server; no assumed market rates. Keep the existing cloud-only settings/snapshot authority, authorization and atomic audit. No browser/local persistence or ledger migration.

Apply the projection at the presentation boundary, never by altering formatMoney globally, pricing/posting engines, posted invoices, receipts, frozen FX or backup historical amounts. Convert each independent ledger book explicitly; never add the two books or present one as a translated version of the other. Use a single selected summary from the USD book (or SDG book when SDG is selected), retaining source values for review. Foreign document displays use frozen native rates if converted; original document/PDF stays original.

Cover dashboard/customer/product/invoice/expense screens, accounting totals/journals/GL/AR/AP/cash/assets/opening/equity/revaluation, inventory audit, charts and report CSV/PDF. Use one pure projection and React hook based on current org settings, explicit labels for source books and native entry units, missing-rate errors rather than invented values. Settings Apply must wait for server success and survive reload; draft changes/cancel/failure must not affect the rest of the app.

Behavioral acceptance: all supported currencies and precision/rounding, zero/negative/high-precision amounts, missing/invalid quotes, atomic authorized settings with no financial rewrites, idempotency and tenant isolation, real Emulator/Rules; browser settings Apply/cancel/failure/reload/context isolation and cross-screen assertions, original invoice/receipt/PDF unchanged. Full combined regression plus Node22 compatibility and production dependency audit.

Source depends on PR130, built from latest main and reviewed USD pricing. No main merge, production deploy, Rules/claims/secrets changes or real financial test writes. Other accounting agent source/checkpoint left intact.
