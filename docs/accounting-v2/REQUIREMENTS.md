# PRD traceability

All source sections are pending unless a milestone report links evidence. Broad product principles apply to every phase. Phase A is split into A1 and A2, and remains incomplete until both pass acceptance.

| Section | Requirement | Tracking |
| --- | --- | --- |
| 1 | الرؤية | A-E / release gate |
| 2 | أهداف المنتج المالي | A-E / release gate |
| 3 | أوضاع استخدام قسم المحاسبة | A-E / release gate |
| 4 | Financial Owner Dashboard | A-E / release gate |
| 5 | Financial Summary | A-E / release gate |
| 6 | المبدأ الأساسي للترحيل المحاسبي | A-E / release gate |
| 7 | Inventory Costing | A2 — implemented; REPORT_A2.md; CI passed (45 unit/API, 6 rules, 22 UI) |
| 8 | طريقة تقييم المخزون | A2 — WAC and rounding conservation; CI passed (45 unit/API, 6 rules, 22 UI) |
| 9 | Cost of Goods Sold | A2 — atomic COGS with sales; CI passed (45 unit/API, 6 rules, 22 UI) |
| 10 | Inventory Cost Snapshot | A2 — immutable line cost snapshot; CI passed (45 unit/API, 6 rules, 22 UI) |
| 11 | Product Profitability | A-E / release gate |
| 12 | فصل المشتريات عن المصروفات | A1/A2 — expense separation and cash purchase receipt; supplier bills in B |
| 13 | Suppliers | B1 — CI passed (81 unit/API/platform, 7 rules, 23 UI); REPORT_B1.md; returns/tax/policies tracked in B3/C/D |
| 14 | Purchase Bills | B1 — CI passed (81 unit/API/platform, 7 rules, 23 UI); REPORT_B1.md; returns/tax/policies tracked in B3/C/D |
| 15 | Supplier Payments | B1 — CI passed (81 unit/API/platform, 7 rules, 23 UI); REPORT_B1.md; returns/tax/policies tracked in B3/C/D |
| 16 | Accounts Payable | B1 — CI passed (81 unit/API/platform, 7 rules, 23 UI); REPORT_B1.md; returns/tax/policies tracked in B3/C/D |
| 17 | AP Aging | B1 — CI passed (81 unit/API/platform, 7 rules, 23 UI); REPORT_B1.md; returns/tax/policies tracked in B3/C/D |
| 18 | Accounts Receivable Aging | A-E / release gate |
| 19 | Customer Statement | A-E / release gate |
| 20 | Supplier Statement | B1 — CI passed (81 unit/API/platform, 7 rules, 23 UI); REPORT_B1.md; returns/tax/policies tracked in B3/C/D |
| 21 | Cash & Bank Center | A-E / release gate |
| 22 | Bank Accounts | A-E / release gate |
| 23 | Internal Transfers | A-E / release gate |
| 24 | Expense Payment Source | A1 — selected payment account; merged with CI passed |
| 25 | Expense on Credit | A-E / release gate |
| 26 | Expense Categories | A-E / release gate |
| 27 | General Ledger | A-E / release gate |
| 28 | Account Classification | A1 — account metadata; merged with CI passed |
| 29 | Reporting Groups | A1 — metadata reporting groups; merged with CI passed |
| 30 | Income Statement | A1/A2 — dated income, cost completeness; A2 CI passed (45 unit/API, 6 rules, 22 UI) |
| 31 | Gross Margin | A2 — gross profit incomplete when unknown; profitability analysis in D |
| 32 | Balance Sheet | A1 — ledger cumulative BS; merged with CI passed |
| 33 | Cash Flow Statement | A1 — classified ledger cash flow; merged with CI passed |
| 34 | Reporting Periods | A1/A2 — UI and API date ranges; A2 CI passed (45 unit/API, 6 rules, 22 UI) |
| 35 | As-of Reports | A1 — cumulative as-of balances; merged with CI passed |
| 36 | Comparative Reports | A-E / release gate |
| 37 | Accounting Periods | A-E / release gate |
| 38 | Soft Close | A-E / release gate |
| 39 | Hard Close | A-E / release gate |
| 40 | Reopen Period | A-E / release gate |
| 41 | Month-End Close Assistant | A-E / release gate |
| 42 | Opening Balances Wizard | C2.2b.3 — protected preview, equity review, Owner reauthentication and atomic startup/settlement UI; PR31; CI passed: 240 unit/API, 31 rules and 48 UI; Render acceptance pending |
| 43 | Owner Capital | C2.3.2 protected atomic source commands; REPORT_C2_3_2_OWNER_EQUITY_TRANSACTIONS.md; CI passed (260 unit/API, 33 rules, 48 UI regression); Owner UI/Render acceptance pending |
| 44 | Owner Drawings | C2.3.2 historical carrying atomic drawings; REPORT_C2_3_2_OWNER_EQUITY_TRANSACTIONS.md; CI passed (260 unit/API, 33 rules, 48 UI regression); Owner UI/Render acceptance pending |
| 45 | Credit Notes | A-E / release gate |
| 46 | Sales Returns | A-E / release gate |
| 47 | Purchase Returns | A-E / release gate |
| 48 | Refunds | A-E / release gate |
| 49 | Bank Reconciliation | Excel2.3b protected statement upload, explicit manual ledger matching and existing atomic reconciliation save; CI passed; Render acceptance pending |
| 50 | Statement Import | Excel2.3a strict CSV/XLSX parser plus Excel2.3b protected no-write upload UI, SHA-256 evidence and manual matching; CI passed; Render acceptance pending |
| 51 | Cash Reconciliation | A-E / release gate |
| 52 | Multi-Currency Strategy | A-E / release gate |
| 53 | Future Multi-Currency Architecture | A-E / release gate |
| 54 | Realized FX | A-E / release gate |
| 55 | Unrealized FX | A-E / release gate |
| 56 | Branch Accounting | A-E / release gate |
| 57 | Cost Centers | A-E / release gate |
| 58 | Projects | A-E / release gate |
| 59 | Journal Dimensions | A-E / release gate |
| 60 | Branch P&L | A-E / release gate |
| 61 | Customer Profitability | A-E / release gate |
| 62 | Credit Limit | A-E / release gate |
| 63 | Payment Terms | A-E / release gate |
| 64 | Approval Limits | A-E / release gate |
| 65 | Expense Approval | A-E / release gate |
| 66 | Refund Approval | A-E / release gate |
| 67 | Budgeting | A-E / release gate |
| 68 | Budget vs Actual | A-E / release gate |
| 69 | Cash Forecast | A-E / release gate |
| 70 | Profit vs Cash | A-E / release gate |
| 71 | Financial Alerts | A-E / release gate |
| 72 | Accounting Health Center | A-E / release gate |
| 73 | Accounting Health Principle | A-E / release gate |
| 74 | Reconciliation Checks | A1/A2 — AR/inventory/expense/COGS checks; AP and bank reconciliation in B |
| 75 | No Hard Delete | A-E / release gate |
| 76 | Audit Requirements | A2 — actor role, before/after, cost evidence; later-source audit in B–E |
| 77 | Accounting Permissions | A-E / release gate |
| 78 | Sensitive Financial Permissions | A-E / release gate |
| 79 | Simplified Accounting Labels | A-E / release gate |
| 80 | Fixed Assets | A-E / release gate |
| 81 | Depreciation | A-E / release gate |
| 82 | Tax Center | A-E / release gate |
| 83 | Tax Localization | A-E / release gate |
| 84 | Recurring Expenses | A-E / release gate |
| 85 | Recurring Journal Entries | A-E / release gate |
| 86 | Attachments | A-E / release gate |
| 87 | Notes & Evidence | A-E / release gate |
| 88 | Financial Data Source of Truth | A1/A2 — journal source and cost subledger; later subledgers in B–E |
| 89 | Subledger Reconciliation | A2 — current inventory and AR; AP/bank in B |
| 90 | Commercial Readiness Definition | A-E / release gate |
| 91 | Commercial MVP | A-E / release gate |
| 92 | Professional SMB Level | A-E / release gate |
| 93 | Enterprise Level | A-E / release gate |
| 94 | Release Candidate Scenario | A-E / release gate |
| 95 | Release Accounting Assertions | A-E / release gate |
| 96 | Zero Difference Requirement | A-E / release gate |
| 97 | Backup & Restore | A2 — strict V2 cost restore with target ownership; later collections/jobs pending |
| 98 | Accounting Regression Tests | A1/A2 regression coverage; full release suite pending |
| 99 | CFO Acceptance Criteria | A-E / release gate |
| 100 | Accounting V2 Phase A — Financial Integrity | A1 merged CI passed; A2 implemented CI passed (45 unit/API, 6 rules, 22 UI); automated A acceptance passed; user review and release acceptance pending |
| 101 | Accounting V2 Phase B — Operational Accounting | B1 CI passed; B2/B3 pending |
| 102 | Accounting V2 Phase C — Professional Accounting | A-E / release gate |
| 103 | Accounting V2 Phase D — Management Accounting | A-E / release gate |
| 104 | Accounting V2 Phase E — Automation & Intelligence | A-E / release gate |
| 105 | Implementation Priority Rule | A-E / release gate |
| 106 | Critical Accounting Engineering Rules | A-E / release gate |
| 107 | Final Product Goal | A-E / release gate |
| 108 | Commercial Positioning After Completion | A-E / release gate |
| 109 | Next Engineering Step | A-E / release gate |
| 110 | Excel Export & Data Portability | Excel3.1 portability, Excel3.2a protected intake and Excel3.2b private worker artifact delivery implemented; large import/UI remains Excel3.2c |
| 111 | Export Modes | Quick Excel1.1; accountant Excel2.1; direct company Excel3.1; queued large requests Excel3.2a; private temporary artifacts Excel3.2b |
| 112 | Full Company Workbook Structure | Excel 1-4 |
| 113 | Invoice Export Structure | Excel 1-4 |
| 114 | Raw Data vs Report Sheets | Excel2.1 accountant workbook includes journal raw sheets and financial report sheets |
| 115 | Pivot-ready Excel | Excel 1-4 |
| 116 | Excel Numeric Integrity | Excel1.1/Excel2.1 numeric cells and formula-safe exports implemented |
| 117 | Multi-currency Export | Excel2.1 journal lines preserve independent SDG/USD numeric books |
| 118 | Export Summary Sheet | Excel2.1 implemented with schema, tenant, period and counts |
| 119 | Data Dictionary Sheet | Excel2.1 implemented for accountant workbook |
| 120 | Reconciliation Sheet | Excel2.1 includes bank/cash reconciliation evidence |
| 121 | Opening / Movement / Closing Columns | Excel 1-4 |
| 122 | Export Filters | Excel2.1 date period plus Excel3.1 saved accounting/master/company preset scopes implemented; arbitrary column selection remains later |
| 123 | Export Column Selection | Excel 1-4 |
| 124 | Saved Export Presets | Excel3.1 tenant-owned save/delete/reload implemented; company presets restricted to the actual Owner |
| 125 | Accountant Package | Excel2.1 direct and Excel3.2a/b bounded large request, worker generation and protected temporary download implemented |
| 126 | Auditor Package | Excel 1-4 |
| 127 | Export Permissions | Excel1.1 module permissions, Excel2.1 accounting permission, Excel3.1 actual-Owner company permission and Excel3.2a isolated company/accounting job collections implemented |
| 128 | Sensitive Data Masking | Excel 1-4 |
| 129 | Export Audit Log | CREATED plus QUEUED/CANCELLED/RETRIED and Excel3.2b COMPLETED/FAILED/EXPIRED lifecycle audit implemented |
| 130 | Large Export Architecture | Excel3.2a bounded queue and Excel3.2b atomic worker claims, stale recovery, private artifacts and bounded cleanup implemented |
| 131 | Temporary Export Files | Excel3.2b private Storage object, SHA-256 manifest, five-minute signed download, 24-hour expiry and deletion implemented |
| 132 | Data Portability Package | Excel3.1 direct full-company JSON snapshot implemented; Excel3.2a queues oversized company jobs for the actual Owner; worker artifact remains Excel3.2b |
| 133 | Export Schema Version | Excel3.1 full-company package requires schema_version 3 and rejects unsupported versions |
| 134 | Export References | Excel3.1 preserves tenant snapshot references and records preset/schema/size/count evidence in the audit event |
| 135 | Excel Import Center | Excel 1-4 |
| 136 | Import Workflow | Excel 1-4 |
| 137 | Initial Supported Imports | Excel 1-4 |
| 138 | Official Import Templates | Excel 1-4 |
| 139 | Template Structure | Excel 1-4 |
| 140 | Customer Import Template | Excel 1-4 |
| 141 | Supplier Import Template | Excel 1-4 |
| 142 | Product Import Template | Excel 1-4 |
| 143 | Opening Balances Import Principle | Excel2.2a parser/template + Excel2.2b protected UI map into existing preview/Owner commit; upload itself performs no financial write; Render acceptance pending |
| 144 | Opening AR | Excel2.2a official receivables sheet, currency/date/due/source validation and protected preview mapping; commit/UI pending |
| 145 | Opening AP | Excel2.2a official payables sheet, currency/date/due/source validation and protected preview mapping; commit/UI pending |
| 146 | Opening Inventory | Excel2.2a official inventory sheet with product, quantity, native unit-cost precision and duplicate validation; commit/UI pending |
| 147 | Opening Cash & Bank | Excel2.2a official cash sheet with account/currency/date validation and preview mapping; commit/UI pending |
| 148 | Column Mapping | Excel 1-4 |
| 149 | Mapping Presets | Excel 1-4 |
| 150 | Import Validation Levels | Excel1.2 master staging, Excel2.2 opening validation and Excel2.3a strict bank statement preview; warning/auto-fix policy remains later |
| 151 | Blocking Errors | Excel2.3a also blocks bank schema/extension/hash/formula/unsafe-text/date/direction/precision/duplicate/volume violations before matching |
| 152 | Warnings | Excel 1-4 |
| 153 | Auto-fixable Issues | Excel 1-4 |
| 154 | Import Preview | Excel2.2b loads opening workbooks into protected preview; Excel2.3b loads bank rows, totals, closing difference and hash into the reviewable matching draft without writes |
| 155 | Error Export | Excel 1-4 |
| 156 | Duplicate Detection | Excel 1-4 |
| 157 | Duplicate Handling | Excel 1-4 |
| 158 | Import Session | Excel 1-4 |
| 159 | Import Session Metadata | Excel 1-4 |
| 160 | Duplicate File Detection | Excel 1-4 |
| 161 | Import Staging | Excel2.3a/2.3b keep the bank statement in client-local review state until explicit atomic reconciliation save; server staging remains later |
| 162 | Dry Run | Excel2.3a/2.3b compute inflow/outflow/closing difference and populate unmatched rows without financial writes or automatic matching |
| 163 | Large Import Jobs | Excel3.2c.1 reviewed queue, Excel3.2c.2a bounded validation/awaiting_commit, and Excel3.2c.2b atomic commit are implemented |
| 164 | Import Progress | Excel3.2c persists claim-protected progress through awaiting_commit, committed and undone states and reload |
| 165 | Import Idempotency | Request evidence and deterministic commit batch/operation identifiers prevent mismatched replay and double commit |
| 166 | Undo Import | Excel3.2c.2b restores updated records and removes created records atomically from the captured pre-commit backup |
| 167 | Import Rollback Rules | Owner/Admin, recent reauthentication, audited reason, matching operation evidence, and no later record edits; otherwise fail closed |
| 168 | Import Permissions | Live module permission for queue/commit; Viewer hidden; undo restricted to Owner/Admin with recent reauthentication |
| 169 | Opening Balance Import Security | Excel2.2a strict parser plus Excel2.2b session/org guards, review preview and existing Owner reauthentication/atomic commit |
| 170 | Post-import Reconciliation | Excel2.2b hands off to C2 opening journals; Excel2.3b requires explicit row matching then uses existing atomic bank reconciliation save and reload synchronization; Render acceptance pending |
| 171 | Accounting Import Block | Excel4.1b blocks invalid staging; Excel4.1c records post-commit reconciliation blocks and prevents final Period Close until resolved |
| 172 | Historical Invoice Import | Excel4.1d.2 stores complete native party/AR/AP/payment/tax/inventory/COGS evidence in protected staging with an independent SHA-256; atomic native source creation remains Excel4.1d.3 |
| 173 | Advanced Accountant Import | Excel4.1a validates, Excel4.1b securely stages, and Excel4.1c atomically commits historical journals and balanced legacy trial-balance groups |
| 174 | Journal Import Safety | Excel4.1c revalidates live context and SHA-256 evidence, limits atomic commit to 200 rows, uses deterministic journal IDs and reconciles before completion |
| 175 | Onboarding Migration Wizard | Excel 1-4 |
| 176 | Migration Readiness Gate | Excel4.1c requires a clean baseline; Excel4.1d.2 additionally rejects missing, surplus or mismatched native document evidence before staging writes |
| 177 | Import Audit | Excel4.1b records DATA_IMPORT_STARTED and Excel4.1c records DATA_IMPORT_COMPLETED with deterministic commit evidence and reconciliation |
| 178 | Import Audit Metadata | Excel4.1c records actor/org/session, file and row hashes, counts, journal count, completion code and bounded reconciliation evidence |
| 179 | Excel Module Commercial Acceptance Criteria | Excel 1-4 |
| 180 | Excel Module Test Suites | Excel 1-4 |
| 181 | Excel Module Implementation Phases | Excel 1-4 |
| 182 | Updated Commercial Readiness Requirement | Excel 1-4 |
| 183 | Updated Next Engineering Step | Excel 1-4 |
