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

## B1 supplier/AP design

Phase B is delivered as B1 supplier/AP, B2 AR/GL/cash/reconciliation and B3 returns/refunds; it remains incomplete until all three pass. B1 tenant collections are suppliers, purchase_bills and supplier_payments. Derived supplier balances use source-linked journal lines. A purchase atomically receives product cost and posts inventory/AP or the selected active cash/bank account. Repeated product lines aggregate before writes. Supplier reference indexes prevent duplicate bill numbers and are restored with backups. Supplier payments allocate historical remaining carrying values and recognize cash differences as FX; an increasing per-bill sequence preserves rounding order at identical timestamps. Backdating before the bill or last payment is refused.

New V2 unassigned operating-expense debt uses 2140. Existing expense postings on 2110 remain unchanged and visible as unallocated AP. Control reconciliation includes those legacy expense journals and flags other unexplained differences. AP source documents cannot be hard-deleted or edited; returns/reversals are B3. Purchases require V2 costing and accounting/inventory entitlements. Current Rules are unchanged: new collections are API-only, and direct SDK access remains denied. Server RBAC and subscription checks gate every command, report and backup. CSV/PDF statement export obtains a fresh authorized report and audits the requested period; dangerous CSV text is escaped.

Payable backup/restore validates source links, receipts, cash/settled values, native-currency allocations, journal totals and AP control. Old backups normalize missing new collections to empty, never ignore new source journals. Restored payable financial documents require V2 and server rules proof. The 350-record limit also checks reference-index write overhead. Net acquisition cost is supported in B1; purchase tax handling is C, credit policy D and returns B3.

## B2 operational reports (manual scope implemented and user-merged)

Operational reports use verified membership, live accounting entitlement and separate view permissions. Ledger/cash require journal and account read; AR requires report/customer/invoice/payment read. Sales receive AR source control lines only, never the full journals or cash view. New no-store GET routes reject repeated, empty and unsupported filters; no cloud-to-local fallback is introduced. Merchant-local dates define the default cutoff.

Ledger rows retain journal ID and line index, reference and entry number, inclusive dates, historical opening and running balances. Balances are debit-positive with normal balance metadata; account caches are ignored and inactive accounts with history stay visible. A native currency filter projects only that book, so an omitted local-only movement cannot produce a misleading other-book running balance. Cash aggregates use declared cash/bank classification and net cash movement per journal, excluding transfer inflation.

AR statements and aging use source-linked 1200 lines through the cutoff, independent of today's paid/void status and invoice/customer balance caches. Subsequent payments and reversals do not rewrite dated debt. Positive aging and credit balances are separate. Manual, legacy and orphan-source control lines remain an explicit unallocated balance for review, never silently assigned to a customer. Credit-note and adjustment linkage will be extended in B3/D as those commands are implemented.

CSV preserves stable source identifiers and separate books and escapes formula-like text. PDF uses safe text nodes, fixed A4 layout and row-aware pagination. Exports read fresh authorized reports and audit view, period, account and book; current permissions and entitlement also guard cached retries. The current atomic export response has a 650 KB ceiling so its audit/idempotency record fits Firestore; larger streaming jobs belong to E. The report foundation itself introduces no SDK grants or rule changes. B2's financial-account registry, transfers, manual bank/cash matching, dated status and backup validation are implemented as described below. Branch filters depend on D dimensions and are refused until available.

### B2 financial accounts and internal transfers

Tenant financial_accounts map one cash/bank DEBIT asset to a declared currency and kind (cash/bank/wallet). A unique mapping index prevents duplicate registrations; names/status may change, mapping/currency/kind stay fixed. The SDG and USD treasury system accounts enforce their native currencies. Balances remain GL-derived, never editable registry fields. New collections and mapping indexes remain API-only under unchanged Rules.

Internal same-currency transfers atomically debit the destination and credit the source with its proportional historical SDG/USD carrying values. A final transfer closes both source books exactly; no fresh FX rate or income/expense is introduced. Cross-currency conversion is refused until a dedicated exchange workflow exists. Current/source-at-date funds must suffice; a backdated transfer cannot consume native funds already spent on a later day. Shared organization revision and source registry writes serialize transactions. Operation IDs prevent duplicate source documents/journals. Cash balances may already be negative from legacy operations; transfers do not silently regularize them.

Reconciliation checks mapping uniqueness, sources, original currency, preserved carrying-value evidence, exact two-line posting and orphan transfer journals. Backups normalize absent new groups only if source reconciliation passes; restore recreates mapping indexes and includes index overhead in the atomic write limit. Transfer sources require V2, backend/rules verification, live accounting and native USD entitlement, role and open-period guards. No posted transfer edits/deletes are exposed.

### B2 bank reconciliation and cash counts

Immutable tenant bank_reconciliations and cash_reconciliations capture native-currency statement/count data, one-to-one bank movement matches, actor/time/operation ID, and source-linked opening and period GL rows in both books. Opening source rows prove the captured opening balance. A SHA256 digest of the captured rows is recomputed on reports and restore; map key ordering is canonicalized. New backdated movements change the live digest even when the closing balance is unchanged, exposing stale evidence rather than claiming an old match still applies. A previously matched period ending before the requested current day is pending for current status. Matched/unmatched statement lines and matched/pending GL lines remain visible; balance or opening differences require a reason and produce adjustment_required. Counts and matching never post a money adjustment automatically.

Commands require verified tenant membership, journal:create, active accounting entitlement, V2 server authority and deployed-rules proof; USD accounts also require multi_currency. These checks precede cached reconciliation retries. No edit or delete operation is provided: revised evidence is a new sequence, committed atomically with the account marker, audit and idempotency receipt. Reports require journal/account read, validate source evidence, and use no-store GET with strict asOf filtering; Sales cannot view the cash/reconciliation data. Current unchanged Rules deny SDK reads and writes to the new collections. Backup normalization cannot discard source records and preserves valid stale historical evidence, while rejecting altered source values, opening proof, sequence markers and capture hashes.

The manual MVP supports up to 100 statement rows, 1000 captured GL source lines through period end and 300 KB per evidence record. Larger captures need the later controlled job infrastructure; arbitrary large archives are not claimed supported. Bank CSV/Excel import is PRD 50's later stage and tracked explicitly after the Excel staging prerequisites. UI displays dated per-account daily debit/credit cash flows, last ten source transactions and reconciliation status. Aggregate cash flow continues to exclude internal transfer inflation. Cross-currency exchange, automatic adjustment posting, granular approval permissions and financial closing are separate later workflows.

## B3.1 return/refund calculation contracts (B3 workflows remain pending)

returnQuotes.ts contains pure quotes, not financial commands or permission checks. Original source components are allocated using cumulative returned quantity and rounded cumulative entitlement; each request receives the delta from the preceding cumulative entitlement. Completing the original quantity restores the exact original SDG/USD component totals. Prior allocation history must have contiguous sequence, unique IDs, the same source/components, valid precision and the exact cumulative-derived amounts. Inputs are never mutated. The bounded quote accepts up to 1000 prior allocations and 20 components; later source queries must enforce these limits rather than silently omit history.

Physical sales returns restore the frozen original line cost through receiveCost and recompute WAC; unknown cost is refused. Purchase returns credit the supplier at original acquisition value, remove inventory at current WAC, and expose their signed difference per book. purchaseReturnLines requires an explicit independent variance account; posting must additionally validate its account classification/active state. salesCreditLines reverses sales/tax/AR, and only physical returns also reverse original COGS/restore inventory. Price/discount corrections omit inventory cost. Each generated nonempty posting is validated in both books and excludes zero lines.

Refund quotes allocate the available historical credit using the existing payment carrying-value convention, compute cash at payment FX, and retain independent book gains/losses. Customer refunds debit AR and credit selected cash; supplier reimbursements debit cash and credit AP, reversing the FX direction. Builders reject changed or inflated FX quote components. They do not permit any write or establish that a source or cash account is authorized.

returnSources.ts proves the tenant, original posting reference/date/FX, actual journal balance and cached journal totals, and exact original control/revenue/tax/cost sides. Sales source proof recovers an original rounding rule only if whole-invoice totals and frozen line totals agree; conflicting line bases are refused. Original invoice-level discounts are allocated across fixed original line net weights using cumulative rounding, while original line taxes and known cost snapshots are preserved. Final source components must sum to every original posting amount. Unknown/not-tracked cost is explicitly labelled and omits the cost component; an absent component must never authorize zero-cost physical restock. Purchase source proof recomputes original net acquisition values and verifies the exact original inventory/credit or cash posting. Current paid/remaining caches, current product WAC and today's settings are not source inputs. Length-prefixed document IDs prevent dotted document/line pairs from colliding. Compound source IDs must fit the existing 128-character identifier bound; legacy records outside this or lacking source evidence need a controlled reviewed migration. These functions do not query a database or confer authorization; B3.2 must load their inputs from the tenant transaction, not from the request body.

B3.2 must load tenant sources and original immutable journal evidence, establish frozen line revenue/tax basis including invoice discounts and original rounding, and verify quantity/value limits across credit notes and physical returns together. Do not reconstruct source cost or credit from current retail prices, current FX or remaining-balance caches. Dates must be open, at or after their source and previous allocated event, and satisfy inventory movement chronology. Paid invoices use credit/refund documents, never a direct void. Atomic source documents, journals, stock/value updates, AR/AP and customer credit caches, audit and idempotency receipt must be integrated together. Source-linked reports/reconciliation and backup validation must support these records before exposing commands or UI. Membership/live subscription/V2 server authority/active account mapping, refund cash funds and race protection remain mandatory. No API, collection, UI, rule grant or production migration is introduced by B3.1.

## B3.2a shared sales correction state (transactional B3.2 remains pending)

salesCorrectionState.ts replays a source line's immutable pricing/physical return events to prove the next correction's limits. Price credits consume remaining revenue/tax only. Physical returns consume original quantity/cost independently and credit the monetary components remaining after preceding price corrections. A price correction resets the monetary quantity checkpoint to remaining original physical quantity and remaining monetary components; subsequent physical events use cumulative allocation within that checkpoint. Original cost allocation retains its original quantity basis throughout all price checkpoints. This prevents a discounted item later being returned at its unreduced original price and prevents price corrections changing stock or inventing cost.

Price credit amounts are exact in the original receivable currency. Other-book total carrying value is proportionally allocated from remaining source values; component rounding uses revenue plus tax residual to preserve the exact total. No current FX is accepted. Dates/sequence/IDs/source/currency and every historical component are revalidated. History is limited to fewer than 1000 prior events per line; larger transactional histories need controlled jobs. An unknown cost source has no cost component and cannot quote a physical restock. A fully price-credited valued item can still return its original physical cost without another revenue credit.

This is a pure state contract, without API/storage/UI integration. B3.2b must persist credit note source IDs, per-source/per-line sequences, reason, actors, operation IDs and journal links atomically. It must validate all event history before commit, not trust quote fields from requests. Refund eligibility is the actual negative source-linked AR/AP carrying balance after payments and corrections, never the gross credit-note amount when that credit merely offsets unpaid debt. Keep positive due and credit balances distinct in source caches while preserving signed control/customer GL totals; dated reports must replay sources rather than use current caches. Block a direct void after any source correction and include credit/refund source journals in subsequent payment checks. Aggregate all selected return lines by product before any stock/value write so repeated product lines cannot overwrite each other. Zero-value physical movements must not invent positive journal lines. Backup/reconciliation/new reference types and protected API/UI must land together before declaring the operational workflow implemented.

## B3.2b sales transaction checkpoint (purchase returns remain pending)

salesCorrections.ts adds immutable credit_notes and customer_refunds through the shared protected Operations transaction. One per-invoice source_sequence covers new receipts, credit notes and refunds; each credit-note line additionally carries its verified correction sequence. The source replay proves original rounding/global discounts/tax/cost, independently recomputes new receipt/correction/refund allocations and exact journal sides, and checks source caches. Legacy receipts without a sequence retain their original immutable settled amounts and matching cash/FX journal, including coincident timestamps; their original native settlement and total remaining source bounds are still validated. New source events cannot predate the original or the last source event. Current limit is 200 events per invoice and 100 selected lines; larger histories require controlled jobs.

Invoice caches preserve positive remaining and credit_balance separately for SDG/USD, plus credited_amount/refunded_amount/paid_amount and source markers. Customer.balance remains signed; receivable_due and credit_balance preserve separate pools across invoices. Issuance, receipt and ordinary void keep these caches consistent. Direct void after a correction/refund is blocked. The refund starts from actual negative linked-source AR, uses the original native credit book and payment-date FX quote, and additionally verifies active unique financial account mapping, COA classification, native funds on the payment date and end-of-day funds through subsequent days. Mixed-sign source balances require reviewed resolution. Neither unpaid invoice reduction nor an overall customer credit independently authorizes a source refund.

Physical returns aggregate selected lines by product before receiveCost, restoring frozen original cost. Known-zero inventory movements may have no journal when all monetary source value was previously credited; unknown original cost remains prohibited. New movement IDs use an ordinal per transaction, so long valid product IDs cannot overflow the identifier bound. Source document ID collisions are rejected independently of idempotency receipts, including restored documents whose original receipt is absent.

Before posting, corrected-source AR reporting or restore reconciliation, the source proof also matches exactly one original V2 SALE movement per valued product to the aggregated original line quantity, dual-book costs, tenant and journal. Missing, duplicate, foreign or altered original movements block the operation atomically. Original SALE movements use their historical created_at schema; no new required movement date is imposed on existing invoices.

The two new collections are part of protected snapshots, backup normalization, strict restore, reconciliation, audited changes and AR source-linked dated reporting/export. They need no new direct SDK grant or deployed rule change: the existing global deny is verified through V2 server authority. Current generic journal:create permission governs posting; source notes/refunds read require journal:read and accounting entitlement. Approval thresholds and more granular permissions remain D. AR reports validate original source evidence and ignore mutable balance caches; same-day new events use source ordering. Historical inventory and COGS checks continue to distinguish original invoice cost from its explicit return reversal.

Invoice preview supplies protected Arabic credit/return/refund forms and immutable source history; context additions reuse the existing API/guest command transport. Independent document PDFs/accountant packages are not included in this checkpoint. B3.2b purchase returns, supplier reimbursements and AP integration remain the next checkpoint; do not mark B3 or commercial readiness complete.

## B3.2b purchase transaction checkpoint (B3 acceptance remains pending)

purchaseCorrections.ts adds immutable purchase_returns and supplier_refunds from tenant transaction inputs. A shared source_sequence orders payments, returns and reimbursements; B1 payment sequence remains the legacy fallback. Replay proves original purchase journal and one aggregate acquisition movement per product, cumulative original-value return allocations, frozen WAC before/after states and movements, historical AP settlement and exact journal sides. Positive remaining and advance_balance are separate in each source book and supplier pool. Dates cannot predate the source, its last event or the product costing chronology.

Supplier return credit retains original acquisition value; inventory is issued at current WAC after repeated products are aggregated. Their signed difference posts to independent EXPENSE/DEBIT operating_expense account 5910. Frozen states are server-generated and checked against movements and journals; general controls additionally reconcile live inventory and GL. Known zero-value physical returns omit empty journals. Reimbursements require actual negative source AP, allocate historical carrying values and recognize received cash at payment FX. Active unique cash mapping, account classification, reason, date, collision and precision checks govern posting. Incoming reimbursements need no pre-existing cash funds.

Sources, journals, stock/cache changes, counters, account markers, audit and idempotency are atomic. Permissions payables:write/read and live membership/subscription/features/period/server authority/deployed-rules proof precede cached retries for corrections and supplier payments. Existing global SDK deny covers new collections; no rules deployment or Super Admin/auth/sync transport replacement occurs. Source histories are capped at 200 and selected lines at 100; larger workloads need controlled jobs.

Dated AP/aging/supplier statements use linked 2110 movements with verified sources, distinct due/advance pools and explicit unallocated AP. Today's cache is not historical evidence. Snapshots/exports/backups include both collections; restore verifies history, postings/movements and counters and refuses missing evidence. Arabic UI exposes saved lines/history, native-account refund inputs, retained errors and immediate duplicate-submit locks. Statement PDF/CSV includes movements; independent correction/refund PDFs and integrated B3 acceptance remain before C.

## B3.3 document evidence and operational acceptance

correctionDocument.export requires current export plus source read permission, live accounting entitlement and V2 server/rules proof before idempotent retry. It reads tenant immutable documents and replays trusted invoice/purchase source evidence, then emits only document/source/business/line/cash-account evidence with schema version 1. No client HTML or posting values are accepted. Audits record DATA_EXPORT_CREATED with document/source IDs. The PDF button uses the existing transport and a duplicate-submit lock; its lazy renderer uses safe text nodes, isolated amounts, canonical book precision, repeated A4 headers/table headings and complete-row pagination. PDF pages use the existing raster engine, without claiming searchable text or PDF/A.

Restore now preserves original audit provenance in API-only audit_archives rather than impersonating old events as destination activity. Compact deterministic IDs bind original organization/event ID; source_hash uses canonical code-unit key ordering to survive map reordering across environments. Original source_event and IDs stay unchanged through repeat restores, while import metadata and target organization remain explicit. Snapshot audit_schema_version 1, event count and archive counter detect missing evidence; snapshots/restore verify archive hashes. Archive records are part of protected backup/reconciliation and the existing 350-record/440-write bound. Individual archive and document export ceiling is 650 KB. Legacy v3 backups without audit metadata remain compatible only without a declared missing archive; no lost old event is invented. Hashes prove stored consistency, not an independent signature authenticating a fabricated external backup.

Integrated B3 acceptance runs purchase/sale corrections with changed FX, partial/final customer/supplier settlements, bank transfer/expense and manual reconciliation, cash count, TB/balance-sheet/source controls and repeated restore. It compares original financial sources and archived audit references while retaining target ownership. This operational acceptance precedes C and does not complete the full commercial release scenario requiring professional closing/opening and later stages.

## C1.1 period lifecycle and backend guard checkpoint (C1 UI pending)

Tenant accounting_periods use immutable inclusive boundaries, nonoverlap, schema version 1, four PRD states and optimistic expected_revision. First configured period enables strict covered-date posting; legacy lock remains additive until an explicitly recent-owner reasoned settings operation relaxes it. All financial dates are checked before cached replies and every actual journal is checked again. Soft close permits only flagged, reasoned manual Owner/Accountant adjustments; hard close blocks every posting. Read-only matching/count evidence can still be captured and creates no journal. Source updates/voids retain conservative original-date protection.

Reopen trusts only verified Actor.authTime forwarded from Firebase auth_time (not issued-at or command data), within five minutes and with actual owner_uid. Lifecycle retries verify their saved revision/status is still current. Period commands enforce live membership/RBAC/subscription/accounting/V2/server-rules proof. Current unchanged Rules keep periods SDK-denied. Audit contains previous/new period state, closure evidence, reopen metadata and recent-auth time; legacy lock changes retain explicit before/after dates.

Hard close uses full tenant financial reconciliation, dual-book balance, explicit manual FX review and latest matched native evidence for every cash-classified account touched through period end. Earlier matches cannot hide a later differing count. Bank evidence must cover the period and every capture must end on period end; changed sources mark old evidence stale. A code-unit canonical journal digest covers entries through end, omitting only tenant org_id to survive controlled restore. Closed-period exports/restores compare ledger hashes and linked bank/cash evidence. Modern backups include period_schema_version 1 and derived period count so declared period evidence cannot silently disappear. Periods join protected financial snapshots/strict restore, with tenant remap and ownership preserved. Current limits are 1200 periods, 366 inclusive days per period and 200 KB per stored evidence; existing 350-record restore and reconciliation limits still apply. This is backend C1.1, not completed C1/month-end UI or automatic FX revaluation.

## C1.2 period UI and close-assistant evidence

The period UI consumes a fresh tenant/session-scoped protected report. It creates nonoverlapping immutable-boundary periods and submits each lifecycle transition with expected_revision and reason. Close is gated visually by a fresh checklist plus explicit FX review, while the transaction independently rechecks every condition. Summary categories use all findings rather than the truncated 100-row display; missing wallets are bank failures and unknown mappings block both bank/cash summaries. Period evidence and prior reopen metadata remain visible; legacy lock is additive and can only be removed through reasoned Owner reauthentication.

Only linked password and Google providers reauthenticate the current verified identity. SDK credential/popup proof precedes token refresh; a pure orchestration port verifies UID before, after proof and after refresh. AppContext additionally checks organization/session identity before dispatch, and operation wrappers require the captured organization. No password persists or enters business commands, and no client auth_time is sent. Only the verified server claim authorizes reopening. Local demonstration confirmation is separate from cloud dispatch. Manual journal adjustments are explicit and reasoned; soft/hard restrictions remain backend-enforced. Production OAuth provider login has not been exercised; port, HTTP, Firestore and guest mobile tests provide the recorded evidence.

## C2.1 opening quote contract (no posting API yet)

openingBalanceQuote is a read-only planning contract for a fresh V2 tenant. Every cash/AR/AP/inventory row retains native currency, explicit source rate and both carrying books; inventory also retains quantity and unit acquisition cost. Referenced tenant masters, immutable cash mappings and classified control accounts are validated. All existing master balances/stock are rejected, even when omitted from the requested rows. Dual-book quotes require explicit rates; declared SDG-only quotes produce no guessed USD. Capital remains explicit; signed Opening Equity residuals require review and opposite-book signs become separate one-direction lines. Source ordering is canonical and the 97-source bound reserves up to three remaining journal lines. Review completion is a quote field, not posting authority.

The future transaction must derive financial_activity_count from actual financial documents, never client counters, and re-quote from the current transaction snapshot. Owner/recent-auth/reason, membership/subscription/features, covered open period, server authority and idempotency still gate writes. Atomic opening_batches plus separate AR/AP opening lots, inventory movements/WAC and journals must be integrated into later receipts/payments, aging/statements, reconciliation and strict backup. No fictitious sales or purchase revenue sources should be used to disguise opening lots. Existing financial history, party credits/advances and corrections remain controlled migration work, not direct overwrite. No opening endpoint or store mutation is introduced by C2.1.


## C2.2a immutable opening source and settlement contracts

openingSources.ts introduces pure evidence factories and replay, with no API/storage registration. deriveOpeningSnapshot requires complete actual financial collection reads and tenant-unique rows. Counters are ignored. Only zero-quantity/zero-value V2 initialization with a tracked valued-zero product, matching manual reference, no journal and valid chronology is neutral. Any financial document, valued movement, journal or unsupported seed prevents opening over history. The future transaction must collect these reads before writes.

Opening evidence has minimal immutable zero-baseline masters and classified account/cash mappings, input/quote, declared capital/equity review, independent dated AR/AP lots, explicit old due dates/references and source-linked WAC initialization. No party PII is replicated. The current master may evolve after posting; historical verification re-quotes the frozen basis rather than today's balances. Reserved journal references remain excluded from manual journal commands.

Settlement evidence freezes native cash input, historical pre-state, used classified accounts/cash mapping and computed dual-book carrying allocation. Final settlement takes both residual books exactly. Payment FX is separate from opening principal, and SDG-only never infers another book. Replay requires contiguous source sequence, nondecreasing dates and exact journals. Complete evidence, including later events, is validated before dated opening/movement/closing/aging views. Current status/balance/stock does not reinterpret original values. Missing parties, altered mappings, lot/movement/posting values and orphan source references fail closed.

The C2.2b integration remains pending. It must supply current verified actor/recent actual owner proof and reason, live subscription/features/RBAC, open covered posting dates, API-only server/rules authority, optimistic fresh data and idempotency before cached responses. Commit must atomically create all evidence, journal, stock/caches/counters/audit then reconcile the proposed data; outgoing cash must prove sufficiency through later affected dates. AR/AP source allocation must be integrated into normal reports and settlement caches, not fabricated invoices. Protected snapshot/restore must include opening schema/count metadata, dropped-source detection, nested tenant remapping and original audit provenance. Source replay is internal consistency, not an independent signature for fabricated external backups. Existing financial history and party credits/advances stay blocked pending migration contracts. Limits: one startup batch, 97 sources/100 journal lines, 200 settlements per lot, 1200 rows per required collection, 650 KB frozen batch, plus existing smaller API restore limits. Tests cover 72 partial/final sequences and past reports with later damaged evidence.


## C2.2b.1 protected opening preview checkpoint

The new POST opening-balances/preview path accepts only input/terms and returns no-store minimal quote/source references/terms plus period revision and a SHA-256 freshness digest. Dedicated opening:preview permits actual Owner or active Accountant, independent of Super Admin claims. Live membership, verified email, tenant status, current catalog subscription/features, V2 and server/deployed-rules proof precede fresh reads. Browser stores are rejected. Read failures cannot become an empty tenant. Dual policy needs multi_currency; inventory sources need inventory_tracking. Existing shared auth, billing and sync behavior stays unchanged.

The pure openingBalancePlan exposes unresolved equity review without fabricating a reason; posting-evidence factory still requires explicit review. Minimal frozen masters use canonical ID/code ordering. A covered OPEN/REOPENED period is mandatory for startup, legacy lock is additive, and a future merchant-day opening is rejected. Digest includes minimal plan, period boundaries/revision/status, legacy lock and ledger precision; it excludes generated time and actor and is not a permission token. No grant or approval is persisted, and no financial writes or idempotency records are created by preview.

C2.2b.2 remains pending: atomic source/journal/stock/cache/counter/audit commands, protected freshness comparison and live gates before retries, actual recent-owner opening confirmation, outgoing cash sufficiency, source-adapted AR/AP/GL reports, reconciliation and metadata/count/nested-tenant/audit safe restore. C2.2b.3 UI must preserve tenant/session identity across reauth and commit and require the returned current preview with separate recent Owner proof. No financial endpoint should be exposed until all source integration and matching tests pass. Full C2 and commercial release acceptance remain pending.


## C2.2b.2.1 opening source integration checkpoint

Opening collections are now part of the financial data, protected snapshot/backup and closing checklist. AR/AP allocate opening control amounts per verified journal line and independent lot, preserving explicit old due dates and dated partial/final settlement carrying values. Aging and statements carry original lot IDs and source references; invoice/bill IDs remain empty for opening sources. Source-specific mobile labels and CSV/PDF references retain provenance. Current customer/supplier caches include verified opening balances alongside invoice/bill pools, so ordinary issuance, receipt and corrections cannot erase opening debt. Fully settled opening customers retain protected source links.

Backup declares opening_schema_version=1 and actual document completeness counts. Original tenant/source replay is checked before remapping; batch.snapshot plus frozen master rows, batch.quote, settlement.account_basis/financial_basis and outer tenant fields are then mapped to the destination. Reconcile the entire destination dataset before any write. Original actors and audit provenance are preserved; destination ownership remains current. Legacy backups without any opening evidence remain supported. This is internal consistency evidence, not an external source authenticity signature. Existing 350-record/440-with-index restore and 450-write server limits stay unchanged; source replay remains bounded by 1200 documents per collection and 200 events per lot.

Leaf openingCollections constants prevent eager report/source circular imports; shared AP verification avoids recomputing immutable history for each supplier. Atomic opening/settlement write commands, fresh owner confirmation, cash sufficiency/chronology, race acceptance and the wizard remain C2.2b.2.2 and C2.2b.3. Test fixtures seed sources only for deterministic/emulator verification and do not expose opening posting. Local full check passed 227 unit/API with strict types/build; one new real Firestore test and one mobile report/export test await this checkpoint's CI. No production deployment, rules publishing, production data or user merges are performed.


## C2.2b.2.2 protected atomic opening/settlement commands (2026-10-08)

opening.commit accepts {input,terms,expected_preview_hash}; only the actual Owner with recent verified auth_time may commit. openingSettlement.create accepts {lot_id,expected_sequence,date,financial_account_id,currency,amount,exchange_rate_used?,reason,reference_number}; only active Owner/Accountant may settle. Server generates immutable event/journal IDs. Both actions use current tenant, live subscription/catalog features, V2 rules authority and covered ordinary open period before cached retries. Preview availability is role/review information, never an authorization token.

openingTransactions proposes a complete FinancialData overlay and requires zero strict costing/source/AR/AP/GL findings plus intact closed-period/cash-session proofs before any submitted writes. It independently verifies physical document paths and financial-account mapping indexes. AP cash checks SDG and USD at transaction date and each later affected daily close; a final settlement closes both historical source books and records FX separately. Cash and party revisions, source counts and bounded audit evidence are transactional.

An idempotent retry requires the same actor/fingerprint, current live grants, exact saved organization counter revision and valid saved source graph. Subsequent legitimate mutations return 409/refresh rather than stale cache changes. Bounds: existing one-batch/97-source/100-line/200-event/1200-row contracts, 650KB audit, 900KB response, at most 450 actual writes. This server milestone adds no startup/settlement wizard; C2.2b.3 remains pending. See REPORT_C2_2B22_OPENING_TRANSACTIONS.md for validation and limits.


## C2.2b.3 protected opening and settlement wizard (2026-10-10)

The accounting tab exposes a read-only opening preview to active Owner/Accountant roles. AppContext reads the dedicated no-store server preview endpoint; it never runs browser-authoritative posting. Local demo uses the same Operations contract with explicit local Owner confirmation. Preview renders each book separately, requires explicit equity-difference review, and is invalidated by form fingerprint or snapshot revision. Late preview responses must match the organization, session, captured form and revision.

Only the actual Owner can confirm opening.commit after existing Firebase password/Google reauthentication. The reusable dialog requires the same reason as the preview and never sends credentials in the business command. The server still checks recent auth_time and the preview digest against current sources and periods; client preview flags confer no authority.

Opening settlement picks an immutable AR/AP lot and an active financial account, passes the current displayed source sequence, explicit transaction currency/rate/date/reason, and uses existing authoritative openingSettlement.create. State shown from cached sources is advisory; the server replays all evidence and rejects stale sequence, overpayment and insufficient dated cash. Mutations lock synchronously against duplicate events; the cloud sender retains request IDs for uncertain retries. No independent balance writes or hard-delete path is introduced.

PR31 is stacked above codex/accounting-v2-c2-opening-ui. Local validation: 240 unit/API tests, TypeScript/core/build, and 48 Playwright tests including 3 new opening flows and previous period/session/sync/platform regressions. CI run 38005624098 passed on code commit 2bfde4630b6ecec292873c56c3729287e316d7b4: 240 unit/API, 31 Firestore emulator and 48 UI tests, with zero production dependency vulnerabilities. User-directed Render staging acceptance is separate and pending connection/service identification; see REPORT_C2_2B3_OPENING_UI.md.

## C2.3.1 owner equity quote contract
`ownerEquityQuote` is a pure, unexposed contract over complete tenant chart, financial mappings, journals, periods and settings. It creates two balanced lines: contribution cash debit/capital credit, drawing drawings debit/cash credit. Contributions require explicit dual rate or SDG-only policy. Drawings consume the cash account's historical carrying pool and final rounding remainder; no expense/FX/new rate. Both-book later daily closes must remain nonnegative. Strict request keys, tenant/source uniqueness, active classified controls, valid source journals and ordinary period guards precede quoting. No role authorization is granted by this function. C2.3.2 must acquire the snapshot in the protected atomic server command, revalidate authority/entitlements/retries, write immutable source/journal/audit/receipt and integrate reconciliation/backup before exposing UI. Render acceptance remains independent and pending.

## C2.3.2 protected owner equity transactions
`ownerEquity.create` requires actual recent Owner (`equity:write`), V2 server authority and verified Rules, active accounting entitlement, dual-book feature when requested, a covered ordinary open period, a nonfuture merchant day and active mapped cash. These gates run before retry receipts. The transaction reads complete financial collections, verifies existing sources/reconciliation/closed proofs, builds immutable `owner_equity_events` + reserved `owner_equity` journal, validates a full buffered-write overlay and physical document paths, and writes event/journal/cash revision/counters/audit/receipt atomically. Both-book daily cash and monetary limits are checked; drawings do not post operating expense or FX.

Evidence stores the strict input/quote, minimal classified chart/financial basis, actual prior journal IDs and contiguous owner source sequence. Verification re-quotes from referenced actual journals, checks each matching immutable journal and rejects missing/orphan/duplicate sources or earlier/later owner sequence substitutions. Current names/active flags can evolve without rewriting historic evidence. Source completeness is consistent proof, not an external signature. Backup exports declare `owner_equity_schema_version:1` and event count; restore validates original tenant sources and nested tenant remap before persistence, preserving actor provenance. Legacy backups without these sources remain supported. Financial collection reads remain server-only; no new Rules grant or migration. C2.3.3 UI/Render acceptance and financial correction workflow remain outstanding.

C2.3.2 engineering evidence: source commit 7d5131a3be5ecaa5a53875c02bee1ab4cef47642 passed CI run38013814001 with 260 unit/API, 33 real Firestore Emulator and 48 UI regression tests and zero production dependency audit findings. PR33 is stacked above PR32. Owner UI and independent Render acceptance remain C2.3.3.

## C3.1 period-end FX revaluation quote
`fxRevaluationQuote` is a pure unexposed calculation over the complete chart, journal history, accounting periods and settings. A reviewed explicit closing rate, source and reason are mandatory; it never fetches or infers a rate. Selection is bounded, unique and limited to active cash/bank, receivable and payable monetary accounts with nonzero USD balances. The exact period end must be covered and open. Target SDG carrying value is the signed USD balance multiplied by the closing rate and rounded once to whole SDG; the USD book remains unchanged. Delta postings use separate system accounts 4210/5510 for unrealized gain/loss, never realized 4200/5500. Zero deltas, foreign/duplicate charts, nonmonetary accounts and unavailable controls fail visibly. This stage grants no permission and creates no source, journal, close evidence, reversal, API, UI, Rule or migration; those remain C3.2+.

## C4.3 — Fixed asset register and protected review

- The register links one unique debit source line from an existing fixed-asset purchase journal. Registration never posts the acquisition again; all cost/schedule fields come from the server quote.
- `POST /organizations/:orgId/fixed-assets/preview` accepts only an action and its input. Membership, Owner/Accountant permissions, live accounting entitlement, V2 and rules attestation precede the read-only quote. Depreciation additionally requires a due scheduled date in a covered ordinary open/reopened period; soft/final close and the legacy lock remain enforced at execution.
- UI commands carry `expected_quote_hash`, which is regenerated within the atomic transaction before writes. The existing direct command contract remains supported without that optional field; it still derives all financial amounts from the trusted source and validates revision/sequence. No client cost or depreciation amount is accepted.
- Registration and depreciation previews are distinct; edits, current organization revisions, permission changes and session/organization switches discard a review. Submission uses a synchronous lock and the existing persistent transport request IDs. Confirmed command changes flow through AppContext's snapshot/revision cache, including register, depreciation events and journals.
- Source verification now requires the original purchase journal to match its stored basis. Depreciation also validates current active control accounts. Read-only reconciliation and tenant-remapped backups retain both original acquisition and subsequent depreciation evidence.
- Low-value rounding caps each regular installment by the remaining depreciable amount. This preserves existing valid schedules while preventing a negative final installment. A zero installment produces an immutable monthly event and sequence/revision advance, with `journal_id: null` and no all-zero financial journal. Verification and backup replay explicitly prove this case.
- `FixedAssetsCenter` shows category, purchase/service dates, source/reference, cost, useful life, residual value, straight-line schedule, accumulated depreciation, book value, status and linked posted journals. The protected forms are available only to Owner/Accountant; authorized journal readers retain read-only history.
- Authenticated Render acceptance requires a deployment matching this code and remains pending; CI and local guest tests do not stand in for live cloud acceptance. No deployment or production data migration is performed here.

## C5.1 — Configurable tax policy and pure quotes

- `TaxConfiguration` is a tenant-owned, versioned policy with a name/jurisdiction label, sales/purchases direction, 0–100% rate (four fractional digits), inclusive/exclusive calculation, configurable native rounding, recovery treatment, control account, date validity and activation. No jurisdiction rates or statutory rules are embedded.
- `configuredTaxQuote` receives one current configuration ID and expected revision, date, direction, native amount/currency and explicit currency policy/rate. The amount is the document line amount **after document-level discounts**; it is a pure numerical input in this foundation. Later protected callers must derive it from document source calculations and load policy/accounts themselves, never trust client computed tax, account or ledger balances.
- A sales policy uses an active `tax_payable` credit liability; recoverable purchase tax uses a distinct active `other_assets` debit account. Nonrecoverable purchase tax has no receivable account and is explicitly marked `cost`. The quote does not create journal entries, cost movements, receivables or payables.
- Inclusive amounts are split once into base/tax; exclusive amounts add rounded tax to base. Native SDG precision is zero and USD two decimals, consistent with the existing books. Policy rounding applies to native tax; reporting conversion uses existing half-up precision. The converted document total and tax are preserved, with any minor-unit conversion remainder assigned to base and disclosed in the quote. Each book preserves base + tax = total.
- Rules cannot be applied outside their date range, while inactive, across tenants/directions, with stale revisions, duplicate IDs/charts, missing/inactive/wrong control accounts, invalid FX or invented request fields. The copied policy basis is deterministic evidence and does not mutate the supplied source.
- **Not an activated tax center:** this module is not exposed to clients or connected to existing invoice/purchase posting yet. Existing tax-rate behavior is unchanged. C5.2a must add server-authorized versioned configuration persistence/audit; C5.2b/c must integrate sales/purchase source evidence, inventory costing, AR/AP, correction/reversal lifecycle, reconciliation and restore before C5.3 UI/period reports.
- Historical documents must retain their original applied policy/amount evidence and never be retaxed from a changed current configuration. Unclassified legacy tax activity must remain visible in reconciliation/report acceptance, rather than infer zero tax or invent proof.

## Excel1.2 — قوالب واستيراد البيانات الرئيسية إلى staging

- يولّد العميل قوالب XLSX فعلية للعملاء والموردين والمنتجات بأوراق `Instructions` و`Data` و`Examples` وعناوين ثابتة وخلايا أمثلة رقمية حقيقية، من دون دمج خلايا داخل جداول البيانات. يحمّل ExcelJS ديناميكياً عند فتح مركز الاستيراد حتى لا يدخل محرك المصنف في حزمة المحاسبة الأساسية.
- القراءة محلية للملف قبل الإرسال ومحدودة بـ2MB و10 أوراق و40 عموداً و2000 صف. تحفظ الصيغة كدليل وترفض في التحقق؛ كما ترفض النصوص التي تبدأ بعلامات قابلة للتفسير كصيغة. بصمة SHA-256 للملف جزء من الجلسة وتظهر إعادة رفع الملف السابق كتحذير واضح.
- أمر `masterImport.stage` محمي بصلاحيات مستقلة `import:customers|suppliers|products` للمالك والمدير والمحاسب. يتحقق الخادم من العضوية والاشتراك والدور والمستأجر وidempotency ثم يكتب فقط `import_sessions` و`import_staging` وسجل `DATA_IMPORT_STARTED`. لا يمنح Firestore وصول عميل جديداً لهذه المجموعات ولا يكتب في `customers` أو `suppliers` أو `products`.
- خريطة الأعمدة لا تسمح بحقل مجهول أو عنوان مفقود أو إعادة استخدام العمود نفسه. التطبيع يغطي المسافات والبريد والهاتف والعملات والأرقام والقيم المنطقية ويعرض كل تصحيح في المعاينة. الأخطاء المانعة والتحذيرات والتصحيحات والتكرارات لها رموز مستقرة وأرقام صفوف المصدر.
- كشف التكرار يستخدم مفاتيح الأعمال (`customer_code` و`email`، `supplier_code` و`email` و`tax_number`، و`sku`) داخل الملف وضد البيانات القائمة؛ الاسم وحده لا يعد مفتاحاً. سياسة Skip/Update/Create/Review والاعتماد الفعلي مؤجلان إلى مرحلة commit المنفصلة.
- أي رصيد افتتاحي أو كمية افتتاحية أو تكلفة بداية غير صفرية تُمنع في Excel1.2 وتوجّه صراحة إلى Excel2، حيث يجب إنشاء المصادر والقيود والمطابقة. لا زر اعتماد أو مسار كتابة تاريخية في هذه المرحلة. سجل staging محدود بـ620KB والنتيجة تعرض أول 50 صفاً فقط.

## Excel2.1 — حزمة المحاسب المتطابقة

- ينشئ الأمر المحمي `accountingExport.create` مصنف Excel XML محدد الفترة من القيود الفعلية ودفتر الحسابات وأدلة مطابقة البنك والنقد. لا يقبل مبالغ أو تقارير محسوبة من العميل ولا يغيّر أي سجل مالي.
- يتطلب التنفيذ صلاحيات `export:accounting` و`journal:read` و`reports:advanced` مع عضوية حية وAccounting V2 وميزات `accounting` و`advanced_reports`. الصلاحية متاحة للمالك والمدير والمحاسب، بينما لا تظهر الواجهة للمشاهد.
- الأوراق هي `Journal_Entries` و`Journal_Lines` و`Trial_Balance` و`Income_Statement` و`Balance_Sheet` و`Cash_Flow` و`Reconciliation` و`Data_Dictionary` و`Export_Summary`. تحفظ السطور SDG وUSD كخلايا رقمية مستقلة وتحتفظ بمراجع المصدر وأبعاد الفرع ومركز التكلفة والمشروع.
- يسجل كل إنشاء ناجح حدث `DATA_EXPORT_CREATED` بمخطط التصدير والفترة وعدد القيود والسطور. يعيد `operationId` نفسه النتيجة نفسها، وتتحقق العملية من حدود المستأجر قبل الإنشاء.
- التصدير المباشر محدود بـ5000 قيد و900KB؛ التصدير الكبير والملفات المؤقتة مؤجلان إلى Excel3.2. لا توجد صيغ قابلة للتنفيذ داخل المصنف، ولا فتح جديد لقواعد Firestore أو كتابة إنتاجية.
- الواجهة تلتقط فترة اختيارية وتمنع الفترة المعكوسة وتنزل الملف وتعرض عدد القيود والسطور. اختبار القبول يغطي صلاحية المحاسب، حجب المشاهد، التنزيل، الأدلة، التدقيق وإعادة التحميل. قبول Render المصادق عليه يبقى مستقلاً ويتطلب staging مطابقاً للالتزام.

## Excel2.2a — عقد مصنف الأرصدة الافتتاحية الآمن

- ينشئ `openingImportWorkbook` قالب XLSX ثابتاً بأوراق `Instructions` و`Cash` و`Receivables` و`Payables` و`Inventory` و`Capital`. يقرأ الملف محلياً بحد 2MB وحدود ثابتة للصفوف والأعمدة، ويتطلب أسماء الأوراق والعناوين الرسمية حرفياً.
- لا يرحّل المحلل أي قيد ولا يكتب في Firestore. يحول الصفوف إلى `OpeningInput` و`OpeningTerms` الموجودين كي تمر المرحلة اللاحقة عبر معاينة الأرصدة الافتتاحية المحمية، ثم أمر المالك الذري القائم فقط بعد التحقق وإعادة المصادقة.
- يرفض الصيغ في جميع خلايا البيانات، العملات أو التواريخ غير المدعومة، تواريخ الاستحقاق السابقة للمصدر، الدقة الأصلية الزائدة، المفاتيح المكررة، تعدد صف رأس المال، والمصادر الأقل من 1 أو الأكثر من 97. يحتفظ باسم الملف وبصمة SHA-256 ضمن مصدر المعاينة.
- يحافظ التحويل على فصل النقدية والعملاء والموردين والمخزون ورأس المال، وعلى العملات الأصلية وشروط الاستحقاق وكمية/تكلفة المخزون. لا يخمن FX أو حسابات أو أرصدة مقابلة ولا يعد نتيجة parser دليلاً على قبول Render.
- هذه مرحلة تأسيسية للمعاينة فقط. Excel2.2b يجب أن يضيف واجهة الاستيراد المحمية، صلاحياتها، التسليم إلى preview/commit القائم، المزامنة وإعادة التحميل والمطابقة اللاحقة؛ ولا يجوز اعتماد ملف تاريخي مباشرة من العميل.

## Excel2.2b — واجهة استيراد الأرصدة المحمية

- تظهر أدوات تنزيل القالب ورفع XLSX داخل مركز الأرصدة فقط لمن يملك `opening:preview` ومع اشتراك Accounting V2 صالح؛ المشاهد لا يستطيع اكتشاف مركز المحاسبة أو أداة الرفع.
- يقرأ المتصفح الملف محلياً عبر عقد Excel2.2a، ثم يملأ نفس مسودة C2 اليدوية للنقدية والعملاء والموردين والمخزون ورأس المال وشروط الاستحقاق. لا ينشئ الرفع staging مالي أو قيداً أو مصدراً.
- تعرض الواجهة اسم الملف وعدد المصادر وبادئة بصمة SHA-256، وتطلب مراجعة البنود قبل استدعاء `opening.preview`. الحفظ يظل حصرياً للمالك بعد إعادة المصادقة ويستعمل `opening.commit` الذري الموجود؛ لم يُضف مسار كتابة بديل.
- حراس المؤسسة والجلسة وبصمة المسودة ومراجعة المصدر تمنع قبول نتيجة متأخرة أو معاينة قديمة. المزامنة وإعادة التحميل بعد الاعتماد تستمران عبر بيانات الدفعة والمصادر القائمة.
- المطابقة المالية بعد الاعتماد تعتمد على فحوص C2 للقيود والمخزون والعملاء والموردين والنقدية. قبول Render يبقى مستقلاً ويتطلب نسخة staging مصادق عليها ومطابقة للالتزام.

## Excel2.3a — عقد معاينة كشف البنك CSV/XLSX

- يستخدم CSV وورقة XLSX المسماة `Statement` العقد نفسه والعناوين الثابتة `id,date,direction,amount,reference,description`. يقرأ المتصفح الملف محلياً، يحتفظ ببصمة SHA-256، ويحد الحجم بـ2MB والصفوف بـ500.
- يرفض أي صيغة XLSX، عنواناً متغيراً، امتداداً غير مطابق، معرّفاً مكرراً، تاريخاً خارج الفترة، اتجاهاً غير `inflow|outflow`، مبلغاً غير موجب أو أدق من عملة الحساب، ونصاً يبدأ بعلامة صيغة خطرة.
- تعيد المعاينة الصفوف المطبعة ومجموع الوارد والصادر والختامي المحسوب والفرق مع ختامي الكشف. الفرق لا يُصحح ولا ينشئ قيداً؛ يبقى ظاهراً للمراجعة.
- العقد محلي فقط ويصرّح بأنه لا يكتب بيانات مالية ويتطلب مطابقة يدوية. لا توجد مجموعة Firestore أو API أو Rules أو صلاحية جديدة، ولا يُستدعى `bankReconciliation.create` في هذه المرحلة.
- Excel2.3b يجب أن يضيف الواجهة المحمية وربط الحساب والفترة والعملة وحركات الدفتر، يمنع المطابقة المزدوجة، ويحفظ فقط عبر أمر المطابقة الذري القائم بعد مراجعة المستخدم. قبول Render يبقى مستقلاً ومعلقاً حتى deployment مطابق ومصادقة ببيانات اصطناعية.

## Excel2.3b — واجهة استيراد كشف البنك والمطابقة اليدوية

- تضيف نافذة المطابقة البنكية المحمية تنزيل قالب CSV ورفع CSV/XLSX، وتربط التحليل المحلي بحساب البنك وفترته وعملته والرصيدين الافتتاحي والختامي قبل قبول الملف.
- لا يكتب الرفع أي بيانات مالية ولا ينشئ مطابقة تلقائية. يعرض اسم الملف وعدد الصفوف والفرق الختامي وبادئة SHA-256، ويملأ صفوف الكشف بمطابقة فارغة كي يراجع المستخدم كل حركة ويختار حركة الدفتر يدوياً.
- تبقى قيود منع تكرار حركة الدفتر داخل المسودة، ومراجعة الفرق الختامي، والتحقق من الفترة والمبلغ، جزءاً من واجهة المطابقة القائمة. الحفظ الوحيد هو أمر `bankReconciliation.create` الذري الموجود بعد المراجعة؛ لم يُضف API أو مجموعة Firestore أو Rule جديدة.
- حارس النطاق يهمل نتيجة قراءة متأخرة إذا تغيرت المؤسسة أو المستخدم أو الحساب أو الفترة أو الأرصدة أثناء التحليل. ويستمر الحجب القائم للمشاهد وصلاحية المحاسب دون توسيع صلاحيات أو كشف أدوات مالية غير مخولة.
- يغطي اختبار الواجهة قالب XLSX والرفع والصفوف والفرق الصفري وعدم تغير التخزين قبل الحفظ، ثم المطابقة اليدوية والحفظ وإعادة التحميل. قبول Render يبقى مستقلاً حتى staging مصادق عليه ومطابق للالتزام وببيانات اصطناعية.

## Excel3.1 — حزمة الشركة وقابلية نقل البيانات

- ينشئ `createCompanyExport` لقطة JSON كاملة من مسار النسخ الاحتياطي المحمي والمتحقق نفسه، بعد تثبيت المؤسسة والجلسة وإعادة فحصهما قبل التسجيل والتنزيل. الحزمة تحمل `schema_version: 3` وهوية المؤسسة والمجموعات المرجعية ولا تعدّل السجلات المالية.
- التصدير الكامل وإعداداته من نوع `company` محصوران في المالك الفعلي للمؤسسة عبر الصلاحية المستقلة `export:company`، مع عضوية واشتراك وميزة accounting نشطة. يظل تصدير المحاسب والبيانات الرئيسية متاحاً فقط وفق صلاحياتهما السابقة، والمشاهد محجوب.
- التصدير المباشر محدود بـ900KB، ومخطط عدّ المجموعات محدود ومتحقق منه على الخادم. تجاوز الحد يعيد 413 ويوجه إلى Excel3.2؛ لا تُنشأ ملفات مؤقتة أو مهام خلفية أو روابط عامة في هذه المرحلة.
- تحفظ `export_presets` داخل نطاق المستأجر مع الاسم والنوع والفترة أو وحدة البيانات الرئيسية وفق قواعد النوع. أوامر الحفظ والحذف idempotent، ولا يسمح بإعداد شركة لمستخدم غير المالك الفعلي.
- يسجل كل تصدير شركة ناجح `DATA_EXPORT_CREATED` مع الإصدار والحجم وعدد المجموعات والإعداد المختار، ويعرض مركز التصدير سجل أحداث التصدير/الاستيراد المصرح به. تثبت اختبارات الواجهة بقاء الإعداد والسجل بعد إعادة التحميل.
- تستخدم الحزمة أسماء ومراجع النسخة الاحتياطية المتوافقة مع الاستعادة، لكن Excel3.1 لا ينفذ استيراداً أو استعادة تلقائية ولا يفتح Firestore Rules. Excel3.2 مسؤول عن التصدير الكبير، التخزين المؤقت، انتهاء الروابط، التقدم واسترداد الفشل.
- نجح CI على commit `a6f3aff6d38c8e82afac5ed0888c78a5359fc34a`: 373 وحدة/API، و35 Firestore Emulator، و90 UI، وصفر ثغرات production. قبول Render يبقى مستقلاً حتى نشر staging مصادق عليه ومطابق لهذا الالتزام؛ لم يحدث نشر أو كتابة إنتاجية.

## Excel3.2a — أساس مهام التصدير الكبيرة

- يضيف `largeExport.request|cancel|retry` داخل معاملة Operations المحمية. يعيد الخادم اشتقاق النوع والصيغة والفترة والإعداد، ويثبت المؤسسة والعضوية والاشتراك والميزات والصلاحية قبل الاستفادة من idempotency.
- مهمة الشركة JSON محصورة بالمالك الفعلي وتخزن في `company_export_jobs` المحمية بـ`export:company`. مهمة المحاسب XLSX تخزن في `accounting_export_jobs` المحمية بـ`export:accounting`. هذا الفصل يمنع ظهور metadata الخاصة بحزمة الشركة في snapshot المحاسب.
- لا تتجاوز المؤسسة ثلاث مهام `queued|running`. يبدأ الطلب بمحاولة 1 من 3 وتقدم صفر و`artifact/failure/expires_at = null`. لا يقبل العميل status أو progress أو attempt أو artifact أو expiry.
- الإلغاء متاح للمنشئ أو المالك للمهمة النشطة فقط. إعادة المحاولة متاحة للمهمة الفاشلة فقط وقبل نفاد المحاولات، وتمسح failure/artifact/expiry والتقدم القديم قبل إعادتها إلى queued.
- تسجل أوامر دورة الحياة أحداث QUEUED/CANCELLED/RETRIED. Excel3.2a لا يشغّل worker ولا ينشئ ملفات أو روابط أو storage grants؛ worker والتقدم والملف المؤقت الموقع وانتهاء الصلاحية والتنظيف والفشل النهائي تتبع Excel3.2b، والاستيراد الكبير يتبع جزءاً مستقلاً لاحقاً.
- لا Firestore Rules جديدة ولا migration ولا نشر أو كتابة إنتاجية. قبول Render المصادق عليه لا يُستنتج من CI ويبقى مستقلاً لنسخة staging مطابقة للالتزام.

## Excel3.2b — عامل التصدير والـartifact المؤقت

- يكتب طلب Excel3.2a مؤشراً خادمياً في `large_export_queue`. يقرأ العامل أقدم 25 مؤشراً فقط، ويطالب المهمة داخل transaction قبل أي توليد. الإلغاء يحذف المؤشر، وإعادة المحاولة تعيده idempotently.
- claim يحمل معرف عامل ووقت بدء. claim الذي ظل `running` أكثر من 15 دقيقة قابل للاسترداد بمحاولة جديدة حتى `max_attempts`، ثم يتحول إلى failed مغلقاً. لا يستخدم العامل `ResilientStore` كي لا يحول مهمة سحابية إلى ملف محلي عند فشل IAM؛ Firestore/Storage failure يبقى ظاهراً.
- يعيد builder الخادمي تحميل snapshot بالهوية المنشئة الحالية؛ حزمة الشركة تستلزم Owner فعلياً، وحزمة المحاسب تستلزم accounting/advanced_reports. سقف العامل 50 ألف قيد و25MB، بينما تبقى حدود المسار المباشر كما هي.
- يحفظ Firebase Storage object خاصاً بلا download token دائم. مستند المهمة لا يحتوي URL بل manifest: path وfilename وMIME والحجم وعدد السجلات وSHA-256. endpoint التنزيل يعيد التحقق من العضوية والاشتراك والميزة والصلاحية والمنشئ/المالك ويصدر signed URL لا يتجاوز خمس دقائق.
- عند الإكمال يضاف `large_export_expiry` وينتهي artifact بعد 24 ساعة. عامل التنظيف يقرأ أول 25 حسب وقت الانتهاء، يحذف object ثم يمسح manifest ويكتب EXPIRED. الإلغاء المتزامن بعد الرفع يجعل claim غير صالح ويحذف object دون نشر نجاح.
- failure المخزن يحمل رمزاً ورسالة عامة فقط؛ لا يحفظ stack أو bucket/IAM detail. تسجل دورة العامل COMPLETED/FAILED/EXPIRED في audit. runner يدعم SIGTERM/SIGINT وpolling خفيف ويمكن تكوينه كـRender Background Worker، لكن لم يُنشأ أو يُنشر هنا.

## Excel3.2c.1 — مراجعة وجدولة الاستيراد الكبير

- أوامر `largeImport.request|cancel|retry` تعمل داخل Operations المحمية وتعيد التحقق من المؤسسة والعضوية والاشتراك وصلاحية الاستيراد الخاصة بالوحدة. لا تُقبل مهمة Viewer ولا تظهر له في snapshot.
- يتطلب الطلب جلسة `import_sessions` بمعاينة ناجحة وstaging مطابقاً، وبصمة ملف وإصدار مخطط محفوظين، وإقرار مراجعة صريحاً وسياسة تكرار `skip|update`. تربط idempotency هذه الأدلة كاملة وترفض إعادة استعمال المفتاح لطلب مختلف.
- يمنع الطلب الأخطاء المانعة وعدم تطابق الصفوف والحجم خارج 1–12000 صف. حد المؤسسة مهمتان نشطتان وحد المهمة ثلاث محاولات؛ الإلغاء وإعادة المحاولة idempotent ويسجلان audit.
- يكتب الطلب فقط مهمة `large_import_jobs` ومؤشر `large_import_queue` ودليل المراجعة. لا يكتب سجلات العملاء أو الموردين أو المنتجات ولا قيوداً مالية، ولا ينفذ worker أو اعتماداً ضمن هذه المرحلة.
- تعرض الواجهة السياسة والمراجعة والتحذير من عدم الاعتماد، ثم الحالة والتقدم والإلغاء وإعادة المحاولة. تعيد snapshot الحالة المصرح بها بعد إعادة التحميل.
- Excel3.2c.2 مسؤول عن worker المتقطع، وإعادة التحقق من staging، وحالة `awaiting_commit`، والاعتماد الذري، وundo/rollback. قبول Render منفصل ومعلق لنسخة staging مطابقة ومصادق عليها.

## Excel3.2c.2a — عامل التحقق المتقطع

- يطالب العامل أقدم مؤشر من `large_import_queue` داخل transaction ويثبت claim وحالة `running`. يعيد تحميل جلسة المعاينة وstaging ويقارن المؤسسة والبصمة وإصدار المخطط وعدد الصفوف قبل أي تقدم.
- التحقق يجري في دفعات 1–500 صف، ويحفظ `processed_rows` وتقدماً أقصاه 99 أثناء التشغيل. claim المتغير أو الإلغاء يمنع نتيجة متأخرة.
- claim الأقدم من 15 دقيقة قابل للاسترداد ضمن `max_attempts`؛ الاستنفاد أو خطأ التحقق يفشل مغلقاً برسالة عامة ويحذف مؤشر queue.
- النجاح ينقل المهمة إلى `awaiting_commit` و`review_commit` ويسجل `DATA_IMPORT_VALIDATED`. لا يكتب العامل سجلات العملاء/الموردين/المنتجات أو قيوداً مالية ولا يغير staging.
- الاعتماد الذري وسياسة `skip|update` وundo/rollback تبقى حصراً في Excel3.2c.2b؛ لا يجوز اعتبار `awaiting_commit` اعتماداً.

## Excel3.2c.2b — الاعتماد الذري والتراجع

- يقبل `largeImport.commit` حالة `awaiting_commit` فقط ويعيد داخل transaction إثبات الجلسة وstaging والبصمة والمخطط والصفوف وسياسة `skip|update`؛ القيم المفقودة أو الفاسدة تفشل مغلقاً.
- تستخدم الكتابات معرفات حتمية ودليل batch/operation، وتحفظ snapshots قبل التحديث. سقف المعاملة 400 صف منعاً للتجاوز أو النجاح الجزئي.
- ينقل النجاح المهمة إلى `committed` ويربط دليل الاعتماد والنسخة الاحتياطية والتدقيق. إعادة الأمر لا تعيد تطبيق السجلات.
- `largeImport.undo` مقيد بالمالك/المدير وإعادة مصادقة حديثة وسبب. يعيد التحقق من hashes/versions الحالية ويرفض إذا وقع تعديل لاحق، ثم يعكس المنشأ والمحدث في معاملة واحدة وينقل المهمة إلى `undone`.
- الواجهة تعرض الاعتماد والتراجع وفق الحالة والصلاحية، وتستعيد الأدلة من snapshot بعد المزامنة وإعادة التحميل. قبول Render يبقى بوابة مستقلة على staging مطابق.

## Excel4.1a — تحقق الاستيراد التاريخي

- `validateHistoricalImport` عقد نقي بلا كتابة يقبل `journal|invoice|purchase|trial_balance` حتى 5000 صف.
- يعيد التحقق من المراجع والفترات المقفلة والعملات والفروع والأبعاد والحسابات، ويفرض توازن القيود وصحة جهة الطرف.
- الفواتير والمشتريات تتطلب الطرف المقابل وتمنع سداداً يتجاوز الإجمالي.
- النتيجة تفصل `can_stage` و`accounting_block` وتعيد الأخطاء مع رقم الصف؛ لا تنشئ staging أو مستندات أو قيوداً في هذه المرحلة.

## Excel4.1b — staging المحمي

- `historicalImport.stage` يعيد التحقق داخل المعاملة من العضوية والاشتراك وصلاحية `import:accounting`، ثم يشتق الحسابات والفترات والعملات والفروع والأبعاد والمراجع من مخزن المؤسسة.
- تحفظ الجلسة في `historical_import_sessions` والصفوف في `historical_import_staging` مع بصمات SHA-256 للسجلات والسياق وحد 620KB.
- Viewer والحقول المحمية محجوبة. الحزمة غير المتزنة تنتقل إلى `staged_accounting_block` ولا يجوز اعتمادها مالياً.
- يسجل `DATA_IMPORT_STARTED` فقط؛ لا مستندات أو قيود أو دفعات أو مخزون في هذه المرحلة.

## Excel4.1c — الاعتماد الذري والمطابقة

- `historicalImport.commit` يقبل جلسة `staged` بلا accounting block، ويعيد داخل المعاملة مقارنة بصمتي الصفوف وسياق التحقق مع staging ثم يعيد التحقق من سياق المؤسسة الحي.
- سقف الاعتماد 200 صف. تتحول صفوف القيود إلى قيود مستقلة، وتجمع صفوف ميزان المراجعة حسب التاريخ والعملة والفرع والأبعاد في مجموعات متزنة لا تتجاوز 100 طرف. معرفات القيود حتمية وتحمل معرف الجلسة وأرقام الصفوف وبصمة المصدر.
- يلزم baseline خالٍ من نتائج `reconcileFinancialData`. بعد بناء الخطة تجرى مطابقة ثانية؛ إن ظهرت فروق تحفظ الجلسة `completed_accounting_block` مع `IMPORT_COMPLETED_WITH_ACCOUNTING_BLOCK` ودليل bounded، ويمنع `closeChecklist` الإغلاق النهائي حتى التسوية.
- الفواتير والمشتريات ترفض قبل أي كتابة لأن staging الحالي لا يحمل أدلة كافية لإنشاء المستندات الفرعية والدفعات والمخزون وCOGS والضريبة. توسعة Excel4.1d يجب أن تضيف هذه العقود الأصلية بدلاً من اختلاق أرصدة تاريخية.
- الأمر محمي بصلاحية `import:accounting` وV2/الاشتراك/الميزة والخادم فقط، وتغطي idempotency إعادة الطلب. يسجل `DATA_IMPORT_COMPLETED` الصفوف والقيود والبصمات والحالة ونتيجة المطابقة.

## Excel4.1d.1 — عقد أدلة الفواتير والمشتريات التاريخية

- `validateHistoricalDocumentEvidence` عقد نقي بلا كتابة يربط صف invoice/purchase بطرف موجود، وتاريخ استحقاق، وسعر صرف، والحساب الرقابي 1200/2110، وبنود أصلية ودفعات موثقة.
- إجمالي المستند يساوي صافي البنود والضريبة، والمدفوع يساوي مجموع أدلة السداد. دفعات الدولار تحمل سعر صرف مستقلاً ولا تسبق المصدر أو تتراجع زمنياً.
- بند البيع المرتبط بالمخزون يحتاج COGS مثبتاً، وبند الشراء يحتاج product وقيمة مخزون أصلية تطابق صافي الشراء. لا يستنتج العقد التكلفة أو يعيد تقييم التاريخ تلقائياً.
- الضريبة غير الصفرية تحتاج حساباً موجوداً وبصمة إصدار إعداد من 64 خانة. نقص أي دليل يفشل مغلقاً قبل staging أو الكتابة.
- Excel4.1d.2 يربط العقد بسياق الخادم وstaging والاعتماد الذري؛ هذه المرحلة لا تنشئ مستنداً أو دفعة أو حركة مخزون أو قيداً.


## Excel4.1d.2 — staging محمي لأدلة المستندات التاريخية

- أمر `historicalImport.stage` يشتق العملاء والموردين والمنتجات والحسابات الحية من المؤسسة داخل معاملة الخادم؛ لا يقبل سياق مطابقة موثوقاً من العميل.
- كل صف `invoice` أو `purchase` يحتاج دليلاً أصلياً كاملاً مطابقاً لرقم الصف قبل إنشاء جلسة staging. الدليل المفقود أو الزائد أو غير المطابق يرفض العملية كلها دون كتابة جزئية.
- تحفظ نسخة مستقلة من `document_evidence` داخل staging مع `document_evidence_sha256`، إضافة إلى بصمات الصفوف وسياق التحقق الموجودة، كي يستطيع الاعتماد التالي كشف أي تغيير.
- هذه المرحلة لا تنشئ فواتير أو مشتريات أو دفعات أو حركات مخزون أو قيوداً. Excel4.1d.3 مسؤول عن الاعتماد الذري وإعادة المطابقة.


## Excel4.1d.3a — ربط دليل المستندات بالاعتماد

- تضيف جلسة staging بصمة `document_evidence_sha256` إلى نتيجة المراجعة؛ لا يحتاج المراجع إلى قراءة أو إعادة إرسال تفاصيل مالية مشتقة.
- اعتماد جلسة تحتوي invoice/purchase يتطلب `expected_document_evidence_sha256`، ويطابقها مع بصمتي الجلسة وstaging ثم يعيد حسابها من الدليل المحفوظ.
- أي بصمة مفقودة أو دليل معدل يرفض المعاملة قبل إنشاء مستند أو دفعة أو حركة مخزون أو قيد.
- هذا حارس سلامة فقط. Excel4.1d.3b ينفذ خطة الإنشاء الذرية والمطابقة، وتظل الكتابة الأصلية معطلة حتى ذلك الجزء.

## Excel4.1d.3b.1 — خطة المبيعات التاريخية

- تبني دالة نقية خطة فواتير البيع والتحصيلات وحركات المخزون وقيود AR/الإيراد/الضريبة/COGS من الدليل المثبت، دون أي كتابة.
- تخصص التحصيلات القيمة الدفترية بالتتابع وتفصل النقد بالسعر التاريخي للدفعة عن AR المجمد، فتظهر فروق العملة صراحة.
- ترتب الصفوف بالتاريخ ثم رقم الصف، وتمنع نفاد المخزون أو تصادم المعرفات وأرقام الفواتير قبل الالتزام.
- تبقى الكتابة الذرية وإعادة المطابقة وخطة المشتريات ضمن الأجزاء التالية من Excel4.1d.3b.

## Excel4.1d.3b.2 — الاعتماد الذري للمبيعات التاريخية

- يحول الاعتماد خطة البيع المثبتة إلى فواتير وتحصيلات وحركات مخزون ومصادر تكلفة V2 أصلية؛ لا تُستنتج تكلفة أو ضريبة أو سعر صرف خارج دليل staging المراجع.
- يلزم baseline صفري النتائج في `reconcileFinancialData`، ثم تبنى حالة مقترحة تشمل المستندات والقيود وتحديثات المنتج والعميل وتخضع لمطابقة ثانية قبل أي كتابة. أي finding للمبيعات يرفض المعاملة كاملة بدلاً من حفظ مستند فرعي مع accounting block.
- تحفظ الفاتورة ورقمها المحجوز والتحصيلات والحركات وقيود AR/الإيراد/الضريبة/COGS والمخزون وتحديثات الأرصدة والعدادات والجلسة والتدقيق في معاملة واحدة، بمعرفات حتمية وسقف 400 كتابة مالية.
- يعاد إثبات إصدار الضريبة المجمد من سلسلة `tax_configuration_versions`، ويعاد اشتقاق الاقتباس الضريبي من السياسة المحفوظة. الحسابات غير النظامية أو التصنيفات غير المتوافقة تفشل مغلقاً.
- تجمع البنود المتكررة للمنتج في حركة مخزون واحدة مرتبطة بقيد الإصدار مع الاحتفاظ بلقطات تكلفة كل بند، حتى تبقى مصادر المردودات والمطابقة قابلة لإعادة التشغيل.
- تظل المشتريات التاريخية محجوبة؛ الجزء التالي يبني خطة AP/الاستلام/التكلفة المتوسطة قبل السماح بحفظها.

## Excel4.1d.3b.3 — خطة المشتريات التاريخية

- تبني `buildHistoricalPurchaseImportPlan` خطة نقية وحتمية لفواتير الموردين ودفعات AP وحركات الاستلام وقيود المخزون/الضريبة/ذمم الموردين وفروق العملة، من دون أي كتابة.
- ترتب الفواتير بالتاريخ ثم رقم الصف، وتجمع البنود المتكررة للصنف في حركة استلام واحدة، ثم تعيد حساب كمية وقيمة ومتوسط تكلفة المخزون في الدفترين لكل حركة بالتتابع.
- لا تقبل الخطة استلاماً يسبق آخر حركة تكلفة موثقة للصنف؛ إعادة إدخال شراء أقدم من مبيعات أو حركات لاحقة تحتاج replay كاملاً، وإلا سيتغير WAC وCOGS اللاحقان بصمت.
- تثبت دفعات المورد قيمة AP الدفترية بسعر الفاتورة وتفصلها عن النقد بسعر الدفعة، فتسجل أرباح أو خسائر العملة صراحة وفق اتجاه السداد.
- ترفض قبل الالتزام المنتج غير النشط أو غير المقيم، الحساب غير 1300، سياق 1300/2110 الناقص، تكلفة الوحدة غير القابلة لإعادة إنتاج قيمة المصدر، وتصادم المعرف أو مرجع المورد.
- الضريبة التاريخية غير الصفرية في هذا العقد منفصلة عن قيمة المخزون الصافية، لذلك تخطط كضريبة مشتريات مستردة بالحساب المثبت. التحقق من إصدار الضريبة المجمد وتصنيفات الحسابات والحفظ الذري والمطابقة يبقى للجزء التالي.
- هذه المرحلة read-only فقط؛ اعتماد مشتريات `historicalImport.commit` يبقى محجوباً حتى Excel4.1d.3b.4.

## Excel4.1d.3b.4 — الاعتماد الذري للمشتريات التاريخية

- يتحول دليل staging المراجع إلى purchase_bills وsupplier_payments وحركات PURCHASE وقيود AP/المخزون/الضريبة/FX وحجز رقم المورد وتحديث المورد والمنتج والجلسة والتدقيق في معاملة واحدة، بسقف 400 كتابة مالية.
- يلزم baseline صفري ومطابقة حالة مقترحة صفرية قبل الالتزام؛ أي تصادم أو فرق أو إصدار ضريبة غير مثبت يرفض المعاملة كاملة. إعادة الطلب لها idempotency العملية الأصلي.
- يعاد اقتباس الضريبة من الإصدار التاريخي المحفوظ وإثبات hash chain، وتطابق تكلفة كل بند مع توزيع السياسة الأصلي. الضريبة المنفصلة المدعومة مستردة؛ الضريبة المحملة على التكلفة تحتاج عقد دليل آخر ولا تُستنتج.
- أعيد دمج C5.2c المتكامل من PR #53 بدمج Git حقيقي لمعالجة مصادر ضريبة الشراء ومردوداتها والاستعادة. حُفظت أبعاد D1 وحواجز موافقات D4 ومسار Excel الأحدث؛ لم تُستبدل ملفات بتلك النسخ الأقدم.
- مصادر البنود تحفظ supplier_credit مستقلاً عن inventory value، وتنعكس الضريبة المستردة خارج فرق WAC. اختبار تاريخي USD شامل يثبت إصدار الضريبة القديم بعد تغيير السياسة، ودفعات FX، وتجميع الاستلام، والمردود والاستعادة دون فروقات.
- تبقى جلسات البيع والشراء المختلطة، أبعاد المستندات غير المدعومة، والشراء السابق لآخر حركة تكلفة محجوبة حتى عقد replay مستقل. ليست هذه المرحلة قبولاً تجارياً لبقية Excel4 أو Render.

## Excel4.1e.1 — مصنف أدلة المستندات التاريخية

- قالب XLSX بخمس أوراق Instructions/Examples/Documents/Lines/Payments؛ الأمثلة نص إرشادي فقط ولا تنتج سجلات. المستندات تدعم invoice أو purchase في الملف الواحد.
- row_number مفتاح فريد يربط المستند ببنوده ودفعاته، وline_number/payment_number متتالية من 1 بلا فجوات. الارتباط اليتيم أو المكرر يرفض الملف كله.
- القارئ لا يحفظ staging أو مصدراً مالياً. يعيد طلباً قانونياً لـhistoricalImport.stage مع SHA-256 لبايتات الملف ونتيجة تحقق محلية فقط؛ الخادم يعيد اشتقاق السياق والصلاحيات والتحقق.
- العناوين وأسماء الأوراق ثابتة؛ ترفض الأوراق المالية المخفية والصيغ ولو لها cached result والخلايا المدمجة وكائنات hyperlinks والأرقام المالية النصية. التواريخ نص YYYY-MM-DD ثابت.
- الحدود: 2MB و200 مستند و100 بند/دفعة لكل مستند. تبقى حدود staging والحفظ الذري الأصغر مفروضة لاحقاً؛ القالب لا يعد بأن كل ملف مقروء يصلح للاعتماد.
- Excel4.1e.2 يربط القالب بالواجهة ومعاينة الخادم واعتماد البصمات؛ هذه الخطوة وحدها لا تكمل واجهة الترحيل ولا Excel4.

## Excel4.1e — إلزام عقد المراجعة الخادمية

- كل استدعاء عام لـhistoricalImport.commit يتطلب expected_review_sha256 وخدمة خادم بعد التحقق من العضوية والصلاحية، وقبل قراءة إيصال idempotency أو أي كتابة. غياب البصمة يعيد409 historical_review_required، ويطلب إعادة المعاينة حتى للعميل القديم.
- محاكاة المعاينة تعبر دالة JavaScript خاصة #executeCommand على محول معاملات لا يكتب. لا يوجد حقل طلب أو وسيط عام لتفعيل تجاوز المعاينة. يبقى باني الخطة الداخلي صالحاً للأدلة غير المعتمدة، ولا يفتح ذلك مسار حفظ عام.
- يعيد الخادم اشتقاق بصمة المراجعة من الحالة المقروءة في المعاملة نفسها ويرفض تغير الأدلة أو المؤسسة أو الفاعل أو النية أو معرف العملية. إعادة الطلب المعتمد نفسها ترجع الإيصال المحفوظ دون تكرار المستندات أو التدقيق. يسجل الحدث المالي review_sha256 المراجعة.
- استرداد الجلسة والإيصال بعد إعادة تحميل الشاشة ما زال عملاً مستقلاً؛ لا يُحفظ payload مالي في تخزين المتصفح ولا يُدّعى اكتمال Excel4 أو القبول التجاري بهذه الخطوة.

## Excel4.1e — الاسترداد المحمي من السحابة

- قارئ GET للجلسة والإيصال لا يعيد تنفيذ أمر مالي. يثبت بصمات staging وطلب الاعتماد الأصلي والتدقيق والمستندات؛ سجل حديث حُذفت بصمة مراجعته ليس سجلاً قديماً سليماً. الرفض409 عند فقد الدليل، وno-store للنجاح والخطأ.
- بعد reload تحتاج الجلسة غير المعتمدة معاينة جديدة وموافقة صريحة. لا payload مالي أو approval token في تخزين المتصفح، ورد المؤسسة السابقة لا يغير الجلسة الجديدة. قبول هذا العقد موثق في PR141/CI40067157901.

## Excel4.2a — حزمة المراجع

- auditorExport.create أمر تصدير فقط، عبر خدمة الخادم وصلاحيات الدور الفعلي export:accounting/audit_logs:view وقراءة الدفاتر والمصادر والفترات. يعاد فحص البريد والعضوية وV2 والاشتراك وميزات المحاسبة والتقارير المتقدمة والتدقيق قبل إيصال retry. يظل دور غير مالي محجوباً عن حزمة التدقيق عند توقف الضوابط التجارية.
- القراءة وبناء الحزمة وإثبات المصدر وتسجيل التصدير وإيصال إعادة المحاولة ضمن معاملة واحدة. لا كتابة للمصادر المالية، ولا ملف مؤكد عند فشل commit. سقوف مباشرة صريحة5000 سجل/5MB بيانات/20000 سطر قيد/50000 صف و600KB XLSX؛ لا قطع صامت أو رفع لحد العامل الكبير.
-14 ورقة بقيم scalar أصلية: TB مفصل وGL debit-positive بأرصدة افتتاحية/ختامية، قيود وسطـورها وSource References وتسويات وإغلاق/إعادة فتح وفترات وتدقيق ومطابقة وأدلة نقد/بنك محفوظة وملخص ودليل. تتبع كل قيمة دفترها SDG أوUSD. فترة الدفتر لا تغير نطاق المطابقة الحالية بكل التواريخ. تُدرج الفروقات وإخفاقات إثبات hash ولا تُعد صفراً.
- Audit References whitelist دون بيانات الاتصال وcredentials وحالات before/after الخام أو موافقات الاستيراد. الأرشيف المستعاد يثبت بالـhash ويعرض مؤسسة المصدر بوصفها provenance. النص خلايا string لا formulas أو hyperlinks. يسجل التدقيق SHA-256 لبايتات الملف والمصادر والفترة والعدادات.
- التصدير المجدول وصلاحيات تشغيله وتنزيله وانتهاؤه مرحلة تابعة؛ هذه الحزمة لا تمنح تلقائياً إذناً لتشغيل عامل أو إرسال ملفات أو نشره.

## Excel4.2b.2a — إدارة سياسة الجدولة

- خدمة ScheduledExportManagement الخادمية تثبت Auth الفعلي وRules والدور المالي والميزات، وتحفظ السياسة وإصدارها وفهرس الاستحقاق الخاص وعدد السياسات والتدقيق وإيصال idempotency في معاملة واحدة. لا يغير تعديل المالك منشئ السياسة أو نوعها.
- معرف فهرس scheduled_export_due هو SHA256 للمؤسسة والسياسة. الإيقاف يحذفه والاستئناف يحسب أول موعد مستقبلي حسب IANA، دون تنفيذ الفائت. سقف20 سياسة للمؤسسة و120 تغييراً ناجحاً للدقيقة للمستخدم؛ إعادة الطلب القديم بعد تغير الإصدار ترفض409.
- GET/POST /organizations/:orgId/export-schedules وPOST /:scheduleId كلها no-store، وتعيد execution_enabled:false. حفظ سياسة active لا يعني تشغيل عامل أو timer. القبول المثبت للمصدر b04e65ff: CI40092180614 وNode22 40092180619.

## Excel4.2b.2b.1 — التحقق الحي حول العامل والملف

- LiveExportAuthorization يثبت سلطة الخادم وRules وAdmin getUser. عضوية المؤسسة ودورها الفعلي وV2 والاشتراك/الميزات تقرأ مع المصادر داخل معاملة بناء الملف، وتكرر بعد الرفع داخل معاملة إعلان الاكتمال. يرفض انتهاء الحق قبل تصدير مجموعات مالية مرشحة إلى الفراغ.
- العامل يثبت هوية ونطاق المهمة ومحاولتها قبل إعلان manifest وأثر التدقيق وفهرس الانتهاء. فشل التحقق يحذف الملف غير المعلن، ولا يحفظ completed. linked policy تحتاج المنشئ/النوع/الإصدار/النشاط والموعد الصحيح؛ مدة الاحتفاظ من السياسة.
- مسار التنزيل يثبت الحق الحالي للمنشئ والمنزّل، والمالك الحقيقي وحده يستطيع تنزيل ملف منشئ آخر. مسار الكائن يطابق org/job/attempt/filename وحجمه وصيغة hash ووقت انتهائه. يوقع رابطاً لا يتجاوز خمس دقائق أو انتهاء الاحتفاظ داخل المعاملة نفسها؛ لا يمكن إلغاء رابط سابق بواسطة فحص قاعدة البيانات وحده.
- التخزين الفعلي يحتفظ بآلية العامل القائمة؛ الاختبارات تستبدله بذاكرة اصطناعية ولا تثبت IAM لحاوية إنتاج. ليس هنا due claim أو timer أو واجهة جدولة؛ execution_enabled:false باقٍ.

## Excel4.2b.2b.2 — صرف الاستحقاق واسترداد الرفع

- ScheduledExportDispatcher المعتمد فيad78eb3c يصرف occurrence حتمياً في معاملة تحفظ المهمة والطابور والإيصال والتدقيق والموعد المستقبلي التالي. يثبت هوية المنشئ والحق والسياسة الحية، ويشارك الطلب اليدوي حد3 مهام. السحب الدائم يتخطى الموعد بدليل، والعطل المؤقت يبقيه للإعادة؛ لا يعاد إنشاء مهمة خلف إيصال مفقود الدليل.
- large_export_uploads يثبت المسار والمحاولة وclaim قبلPUT. تراجع المهلة والنطاق قبل النشر، وإعلان الاكتمال يحذف إثبات الرفع ذرياً. commit ناجح بلا استجابة يسترد نتيجته قبل أي حذف. cleaning يفصل النشر عن الحذف، وPUT المجهول يحتفظ بـmarker لإعادة المسح بدلاً من افتراض انتهاء خطر الرفع المتأخر. runner مرة واحدة معطل افتراضياً ولا يهيئ Firebase قبل flag تشغيل صريح.

## Excel4.2b.2b.3 — الإدارة والسجل والروابط في الواجهة

- DTO فيsrc/types/exportSchedules.ts بلا SDK/Node. policy list تعيد allowed_kinds من الدور الفعلي والميزات. GET export-job-history يجلب100 لكل نوع مسموح مع where على requested_by للموظف قبل limit، ثم يدمج أحدث100؛ المالك الحقيقي يرى أنواعه المسموحة لكل المنشئين. direction اختياري وasc الافتراضي محفوظان فيStore/MemoryStore/FirestoreStore.
- فهرسا accounting_export_jobs(kind ASC,created_at DESC) و(requested_by ASC,kind ASC,created_at DESC) ضمن مصدر الفهارس ولم ينشرا. يتطلب القبول التشغيلي تطبيقهما في البيئة المستهدفة. السجل whitelist بلا مسار أو token أو claim أو failure خام، ويؤكد المؤسسة وno-store ولا يوقع روابط بمجرد القراءة.
- organizationMutation يربط intent الخادمي بالمؤسسة والمسار والبيانات. يفحص سياق الشركة والجلسة بعد العمليات غير المتزامنة وقبل fetch بعد token refresh. AppContext يرفض الرد المخالف للنطاق. lock فوري يمنع إرسال الضغطتين، و409 يعرض الإصدار الجديد للمراجعة دون إعادة تعديل تلقائي.
- ScheduledExportsCenter داخلDataExportCenter يتيح المواعيد والاحتفاظ والإيقاف والاستئناف والسجل. يصرح بأن التنفيذ التلقائي غير مفعل. رابط https مؤقت يعاد طلبه من endpoint المحمي، ويُمحى بتبدل الشركة أو الحق أو انتهاء مدته؛ لا يعد ذلك إبطالاً لرابط سبق إصداره. لا تفعيل runner أو خدمة أو بيئة أو بيانات مالية إنتاجية.
