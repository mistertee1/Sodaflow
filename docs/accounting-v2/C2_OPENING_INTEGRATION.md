# C2.2b.2 implementation handoff

Status: C2.2b.2.1 validated in PR28; C2.2b.2.2 server commands implemented on the protected-transactions branch, awaiting its full CI. **PR27 itself only supplies the protected read-only preview**. Use the newest Accounting V2 branch and fresh PROGRESS/lease before starting. Base: protected-preview branch, stacked on PR26/25/C1; user alone integrates the full chain into main.

Update 2026-10-08: C2.2b.2.1 implements opening-source AR/AP allocation, live cache preservation, financial reconciliation, protected backup counts and nested tenant restore, plus source-specific report/export labels. See REPORT_C2_2B21_OPENING_INTEGRATION.md. Atomic opening/settlement write commands, fresh-owner approval, cash/race acceptance and the wizard remain planned below. Test fixtures are not a posting endpoint.

Update 2026-10-08: opening.commit and openingSettlement.create now apply the contracts below, with live authority before idempotency, explicit staged-data reconciliation, physical path/index collision checks, both-book AP cash checks, bounded evidence and 13 local acceptance tests. Three new Firestore race/rollback tests await CI. See REPORT_C2_2B22_OPENING_TRANSACTIONS.md. Remaining implementation: C2.2b.3 protected wizard/settlement UI and C2.3 capital/drawings. The integration table below records the original traps; source/report/cache/restore integration is already validated in PR28.

## Existing contracts

- openingBalances.ts: fresh startup quote, native currencies/rates, explicit capital and reviewed signed residual, 97 sources/100 lines.
- openingSources.ts: actual-document startup eligibility, minimal immutable basis, independent opening_lots, inventory WAC movements, payment carrying allocation and complete source replay. One startup batch, 200 settlements/lot, 1200 rows/collection, 650KB batch. Future API restore remains bounded by its smaller existing 350-record/440-write limit.
- openingPreview.ts: fresh read-only plan, covered OPEN/REOPENED period, additive legacy lock, merchant-day future-date denial, SHA-256 freshness comparison basis. Hash is not auth/approval. opening:preview permits verified actual Owner/active Accountant; live catalog features and server/rules proof already gate it.

## Atomic operation contract

opening.commit should accept only input, terms, expected_preview_hash and reason/review fields already inside the input. Actor/auth_time/tenant/COA/source counters/journal values come exclusively from verified services and current transaction reads. Require actual owner_uid, recent verified Firebase auth_time, explicit reason, dedicated opening:write, active membership/subscription, accounting and conditional multi_currency/inventory_tracking, V2 server/rules proof and covered open date before idempotent retries. Recompute the same preview basis and hash in the transaction; changed master/mapping/period/date/precision or real financial activity rejects stale confirmation. Inspect cached retries against current authority/source invariants; never return an obsolete success after suspension or closure.

Re-derive eligibility from every actual collection. Legitimate zero-valued product seeds are neutral, not spendable history. Existing positive stock, zero-counter financial documents, legacy account balances, unknown movements and any posted journal block startup. No overwrites of old financial history. Startup metadata and unique batch/journal/source IDs must be collision-checked independently of idempotency key. Two racing commits may produce exactly one batch. All actual store reads finish before Firestore writes; use existing buffered changes/post validation.

Create batch, immutable lots, journal and opening inventory movement together, then update live quantity/value/WAC/cost chronology, party due caches, financial account revision, source counters and before/after audit. Apply existing per-command write bound; reject rather than partially writing an oversized batch. Overlay proposed changes into complete tenant financial data and run strict costing plus opening/AR/AP/GL/cash checks before any writes commit. There is no separate best-effort balance update.

openingSettlement.create should accept only lot_id, native amount/currency, active mapped financial account, explicit payment rate for dual policy, date, reason and external reference. Generate event and journal IDs on the server. It must replay the entire existing source chain and compare current cache/source state before using openingSettlementEvidence. Source sequence/revision must conflict under races. AR receives cash; AP spends cash. AP payments prove native and both-book cash sufficiency at the transaction date and each later affected balance so a backdated payment cannot consume already spent funds. Final payment closes both carrying books. Ordinary invoice/purchase payment endpoints must not pretend an opening lot is a real invoice/bill.

## Integration points and discovered traps

| File | Required integration |
| --- | --- |
| operations.ts | register only complete commands; gates before cache; startup/retry/period protection; readPermissions and feature gating for opening collections; counters/audit/source snapshot/backup/restore bounds |
| reconciliation.ts | opening collections in FinancialData; verifyOpeningSources; add remaining opening AR to customer totals and AR-control, without replacing invoice totals; inventory source movement/1300 checks and orphan references |
| salesCorrections.ts saveSalesCustomer | current implementation verifies/rebuilds invoice-only due/credit pools: add verified remaining opening AR, or the first normal invoice/payment/refund will reject/erase the opening cache |
| payables.ts and purchaseCorrections.ts saveSupplier | supplier due/advance pools currently use purchase bills only: include positive opening AP independently while preserving existing advance pools |
| operationalReports.ts receivableReports | ordinary GL-based AR already counts all 1200 control lines: allocate opening lines by lot.line_index; never assign a multi-party opening journal wholesale to one customer |
| payables.ts payableReports | AP currently aggregates every 2110 line per journal and locates one bill: allocate opening journal lines per lot and settlement instead; preserve ordinary bill correction semantics |
| cash reconciliation and period close | source-complete opening/cash references and close checklist must agree; opening sources cannot disappear from reconciliation or weaken closed-period checks |
| export/report UI and PDF/CSV types | add source_kind/lot_id/reference for opening rows; do not fabricate invoice_id/bill_id or create fictitious sales/purchases; preserve source visibility in statements/aging |

Dated AR/AP allocated totals must equal their GL controls in both books, with current sources verified even for past dates. Merge opening and ordinary statement rows chronologically and recalculate party running balances. Real historical due dates remain explicit and may precede startup; zero outstanding lots should not be presented as payable/receivable aging. Do not count the same opening control lines again when merging allocated and GL totals. Current balance fields are caches, not report evidence.

## Protected backup/restore

Add opening_schema_version=1 and derived exact batch/lot/settlement counts, including empty modern sets. Missing modern metadata or declared lost source/evidence rejects restore; legacy v3 backups without opening sources remain compatible under existing rules. Snapshot and reconciliation must include all three opening collections and linked inventory movements. Restore must verify the original source graph and reject missing/extra/altered journals/lots/movements/settlements before writes.

Remap the tenant explicitly in batch.org_id, snapshot.org_id, every frozen master/account org_id, quote.org_id, lot/movement org_id, event.org_id and its financial_basis/account_basis. Preserve source IDs, actor history and archived original audit provenance, while destination owner/members stay unchanged. Rebuild the expected evidence with mapped identity and verify it again. Existing digest/count/audit/period hash checks stay additive. Internal replay and hashes do not authenticate a completely fabricated external backup; no independent signing claim is allowed.

Account/party/product deletion or incompatible mapping changes must remain blocked by immutable opening history even after lot settlement/stock depletion. No hard delete of source evidence or source history rewriting. Restrict manual journals from both reserved reference types.

## Required acceptance before opening UI

1. Fresh startup with cash SDG/USD, old-due AR/AP, tracked inventory and explicit capital/residual yields balanced TB, Assets=Liabilities+Equity, no fictitious sales/purchase, zero AR/AP/Inventory/cash differences.
2. Partial/final AR/AP at changed FX close both source books; actual cash insufficiency, backdated later-day shortage, currency mismatch and raced overpayment reject atomically.
3. First normal invoice/customer payment/credit/refund and purchase/supplier payment/return/refund after opening retain opening due pools and reconcile all caches/GL.
4. Changed source mapping/period revision, newly added financial activity and reused differing operation IDs reject old preview confirmation without any partial writes.
5. Owner/Accountant/Admin/Viewer/Sales/Cashier, forged member Owner and unrelated Super Admin, stale/missing verified auth_time, suspended/expired membership/subscription/features, browser/server/rules failure and direct SDK writes are tested.
6. Idempotent retry rechecks live feature/membership/period/authority; closed period or soft ordinary posting cannot be bypassed by cache.
7. Financial persistence failure leaves no batch/journal/lots/movement/cache/counter/audit drift. Race-close versus opening or settlement has one valid serial result.
8. Dated mixed-source statements/aging reconcile both books, ignore mutable caches, retain source references in PDF/CSV and reject later damaged source evidence.
9. Backup/restore twice preserves balances/journals/source/cost/audit references and destination ownership; stripped collections/counts/events/nested tenant proof fail atomically.
10. Complete Firestore emulator and existing mobile UI suites remain green. Then C2.2b.3 adds the protected wizard/reauth/session guards; C2.3 capital/drawings follows. C/D/E/Excel and full commercial RC remain incomplete until their own acceptance passes.
