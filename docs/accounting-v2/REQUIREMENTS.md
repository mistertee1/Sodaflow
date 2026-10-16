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
| 110 | Excel Export & Data Portability | Excel1.1/Excel2.1 implemented; full portability remains Excel3 |
| 111 | Export Modes | Quick exports Excel1.1; accountant package Excel2.1; remaining modes Excel3-4 |
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
| 122 | Export Filters | Excel2.1 date period implemented; column selection/presets remain Excel3 |
| 123 | Export Column Selection | Excel 1-4 |
| 124 | Saved Export Presets | Excel 1-4 |
| 125 | Accountant Package | Excel2.1 implemented; large-job delivery remains Excel3.2 |
| 126 | Auditor Package | Excel 1-4 |
| 127 | Export Permissions | Excel1.1 module permissions and Excel2.1 accounting permission implemented |
| 128 | Sensitive Data Masking | Excel 1-4 |
| 129 | Export Audit Log | Excel1.1/Excel2.1 DATA_EXPORT_CREATED implemented |
| 130 | Large Export Architecture | Excel 1-4 |
| 131 | Temporary Export Files | Excel 1-4 |
| 132 | Data Portability Package | Excel 1-4 |
| 133 | Export Schema Version | Excel 1-4 |
| 134 | Export References | Excel 1-4 |
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
| 163 | Large Import Jobs | Excel 1-4 |
| 164 | Import Progress | Excel 1-4 |
| 165 | Import Idempotency | Excel 1-4 |
| 166 | Undo Import | Excel 1-4 |
| 167 | Import Rollback Rules | Excel 1-4 |
| 168 | Import Permissions | Excel1.2 master permissions; Excel2.2b requires opening:preview; Excel2.3b reuses protected bank reconciliation access and hides accounting/import from Viewer |
| 169 | Opening Balance Import Security | Excel2.2a strict parser plus Excel2.2b session/org guards, review preview and existing Owner reauthentication/atomic commit |
| 170 | Post-import Reconciliation | Excel2.2b hands off to C2 opening journals; Excel2.3b requires explicit row matching then uses existing atomic bank reconciliation save and reload synchronization; Render acceptance pending |
| 171 | Accounting Import Block | Excel 1-4 |
| 172 | Historical Invoice Import | Excel 1-4 |
| 173 | Advanced Accountant Import | Excel 1-4 |
| 174 | Journal Import Safety | Excel 1-4 |
| 175 | Onboarding Migration Wizard | Excel 1-4 |
| 176 | Migration Readiness Gate | Excel 1-4 |
| 177 | Import Audit | Excel 1-4 |
| 178 | Import Audit Metadata | Excel 1-4 |
| 179 | Excel Module Commercial Acceptance Criteria | Excel 1-4 |
| 180 | Excel Module Test Suites | Excel 1-4 |
| 181 | Excel Module Implementation Phases | Excel 1-4 |
| 182 | Updated Commercial Readiness Requirement | Excel 1-4 |
| 183 | Updated Next Engineering Step | Excel 1-4 |
