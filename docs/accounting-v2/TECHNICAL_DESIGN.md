# Accounting V2 implementation design

Source: PRD.md, supplied v1.1 filename (internal header remains v1.0). The original is preserved byte for byte. User authorized implementation on 2026-10-05; user reviews and merges branches. No production deployment or main merge is authorized for this work.

## Existing architecture
React/Vite invokes a shared transactional Operations service. Guest mode uses MemoryStore, cloud commands and snapshots now use the authenticated Express/Netlify API after the user-merged billing change; Firestore supplies revision notifications. Express/Netlify uses Firebase Admin. Commands include membership/RBAC, idempotency fingerprint, counters, balanced immutable journals and audit events. Existing inventory is quantity-only; old profit reports classify by code prefixes. Keep synchronization and Super Admin work intact.

## Financial invariants
The journal is the source of truth. SDG ledger precision is 0 decimals, USD 2, quantity 6; calculations use decimal arithmetic and round posting totals only. A balanced pair of books is mandatory. Historical postings are reversed rather than edited. Inventory quantities and values, invoice cost snapshots, journals and audit are committed atomically with the idempotency receipt. Each financial command validates tenant membership, role, period, source records and account type/active state on the server.

Reports use Account.type/subtype/reporting_group/cash_flow_category/normal_balance, not arbitrary account number prefixes. Legacy system accounts have explicit code metadata; custom accounts derive defaults from their declared type. Ledger entries before a report start establish opening balances; income and cash movements use the inclusive selected period; balance sheet is cumulative as of the end. Account.balance_* caches are not extra opening money: opening balances must be journals. Contra accounts use signed accounting balances. Cash flow allocates individual noncash counterparts and excludes internal cash transfers. Missing/unclassified accounts and mixed unsupported postings require review rather than invented classification.

## Stage A costing and migration
Existing organizations stay compatible until explicit Owner activation of Accounting V2. Unknown historical cost is never estimated from selling prices. Preserve old invoices, label incomplete historical cost, and exclude claims of commercially ready profit for that period. New costing fields are average_cost_sdg/usd, inventory_value_sdg/usd, cost_status, cost_effective_date and cost_last_movement_date. WAC movements must be chronological: a sale cannot use a later receipt cost by backdating its posting. Trusted cost establishment uses an auditable opening/value adjustment and a balanced inventory/equity posting; existing inventory GL must be reconciled first. Weighted average derives from carrying value/quantity. Every sale captures immutable per-line unit/total cost and posts Dr COGS/Cr inventory with revenue/tax/AR in the same journal. Voids restore original cost, never current selling price. Quantity adjustments post value changes against an explicit inventory adjustment account. New stock receipts require supplied acquisition cost.

All cloud tenant writes and snapshots remain API-only, preserving the user-merged billing and synchronization transport. Existing Firestore Rules deny all tenant writes, including V2 financial collections and accounting/cost authority fields. Revision watching remains direct Firestore. API RBAC and period checks remain mandatory because Admin SDK bypasses Security Rules. Server outage blocks a financial write safely; idempotency retains its retry ID. Legacy organizations keep their existing API path and quantity-only behavior until a reviewed cost establishment; they cannot bypass the API. Guest mode exercises the same domain rules without server credentials.

Expenses select an active cash/bank account or AP on credit; inventory purchases are a distinct business operation. The expense UI removes merchandise purchase classification, and the backend rejects known inventory purchase categories and inventory/COGS expense account misuse. Old records are retained and flagged for review.

## Delivery sequence and dependencies
| Milestone | Scope | Prerequisite |
| --- | --- | --- |
| A1 | Metadata, dated ledger statements, expense accounts and core report reconciliation | Current main |
| A2 | Cost model, controlled migration, WAC/COGS, inventory GL/rules/API/UI | A1 |
| B | Suppliers, purchases, AP/AR aging/statements, GL, cash/bank, returns/refunds, reconciliation | A accepted |
| C | Period workflow, opening wizard, capital/drawings, FX revaluation, assets/tax/comparatives/evidence | B |
| D | Dimensions, profits/budgets/forecast, credit/approval limits, granular permissions | C |
| E | Accounting Health, financial alerts/assistance, Owner/Accountant views | D |
| Excel 1 | Masters/templates/mapping/staging/validation/preview/quick export | A/B master schemas |
| Excel 2 | Accounting export, controlled opening import, reconciliation gates | C |
| Excel 3 | Full company/accountant packages, presets, large job/history | Excel 2 |
| Excel 4 | Historical/journal migration, auditor package, scheduled exports | Excel 3 |

Each milestone has its own review branch; later branches depend on earlier ones and PRs target their predecessor. Only the user merges. Source and progress persist in GitHub, with a report recording implemented and pending acceptance, checks and limitations. Never label the entire phase complete until its PRD acceptance is met.

## Remaining subsystem design
Suppliers/AP, purchase bills/items/payments/returns, credit notes/refunds, financial accounts/transfers, reconciliation sessions, periods/close checks/reopens, opening batches, fixed assets/depreciation, tax codes, dimensions/budgets/approvals and import/export jobs use tenant-scoped collections. Source documents retain operation IDs, currency/rate, actor and journal links. Financial documents are immutable after posting; correction is a reversal. Period close and financial import are gated by zero unexplained reconciliation differences. Sensitive period reopen and opening changes require Owner authorization, recent reauthentication, reason and before/after audit. Branch/cost center/project propagate to source and journal lines. Backend permissions govern exports and mask sensitive fields before serializing.

Imports stage outside production collections. Hash+row idempotency, mapping, duplicate policy, validation preview and explicit commit precede server job posting; jobs record progress and reconcile before completion. Undo is allowed only without downstream references, otherwise archive/reverse. Historical invoices/journals do not ship with master imports. Exports preserve stable IDs, numeric cell types and separate currency columns, the PRD's 21 workbook sheets, summary/dictionary/reconciliation, permission masks and audit; large jobs emit temporary secured files and a manifest. Backup/restore expands with each new financial collection and remains tenant-safe and atomic or controlled via a migration job.

## Validation and release
Regression tests must prove both books balance, arbitrary custom revenue is included, requested dates/openings/contra balances are correct, selected expense payment accounts are credited, purchases cannot pass through ordinary expenses, cost is snapshotted, WAC rounding is conserved, voids restore original value, concurrent/idempotent operations cannot oversell or duplicate journals, and rules reject direct V2 and cross-tenant writes. Later milestones add every business flow and the end-to-end release scenario from PRD 94-98. Never deploy real financial migrations from tests. CI runs type checks, unit/API tests, build, dependency audit, real Firestore emulator and Playwright.

Primary references: https://firebase.google.com/docs/firestore/security/rules-structure and https://firebase.google.com/docs/firestore/manage-data/transactions .

## A2 protection and operating limits

Before server V2 operations, cost establishment, costed stock movement or V2 backup restore, a read-only Firebase Rules API request fetches the current default-database rules. Their canonical SHA256 must match server/accountingRulesHash.ts, generated from the reviewed firestore.rules. Missing proof, permission or mismatched rules fails before commit; lint:core detects a stale fingerprint. No rule release or deployment is performed by this workflow. Current configured database is (default); named databases fail closed until a separate namespace verification is implemented. Operators need read permission for Firebase Rules; a matching deployed ruleset is an operational prerequisite, not inferred from a browser button.

Cost establishment records current quantity/value against Opening Equity 3900 and requires current inventory GL to match already valued products first. It does not duplicate or guess an existing legacy inventory GL balance. Such tenants need reviewed reconciliation before migration. Receipts in A2 are cash/bank purchases and retain source currency, unit cost, FX, reason and zero-cost evidence; supplier credit bills are stage B. Quantity count changes use Inventory Adjustments 5900. Derived cost fields cannot be submitted through product updates; V2 manual postings cannot alter inventory/COGS. Source journals remain immutable and voids restore their original cost snapshot, with legacy unknown-cost voids blocked after establishment.

Reconciliation covers stock quantity, carrying values vs cost movements vs inventory GL, cost movement journal links and invoice snapshots vs posted COGS in both books. V2 restore requires the same proof and strict reconciliation, preserves target owner/subscription, and retains V2 activation metadata. Current atomic restore limit remains 350 financial records; larger migration jobs belong to later stages.

Unknown historical cost remains explicit in dated UI and API income reports. Underlying ledger amounts are preserved with costs_complete=false; gross/net profit is hidden in the UI for incomplete periods. This does not retroactively certify the historical books. Fine-grained cost visibility, export masking, professional closing/opening and release-candidate assertions are later PRD stages. Current product cost fields follow existing product visibility; do not claim granular cost hiding before stage D.
