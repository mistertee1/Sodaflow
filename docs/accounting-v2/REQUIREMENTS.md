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
| 42 | Opening Balances Wizard | A-E / release gate |
| 43 | Owner Capital | A-E / release gate |
| 44 | Owner Drawings | A-E / release gate |
| 45 | Credit Notes | A-E / release gate |
| 46 | Sales Returns | A-E / release gate |
| 47 | Purchase Returns | A-E / release gate |
| 48 | Refunds | A-E / release gate |
| 49 | Bank Reconciliation | A-E / release gate |
| 50 | Statement Import | A-E / release gate |
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
| 110 | Excel Export & Data Portability | Excel 1-4 |
| 111 | Export Modes | Excel 1-4 |
| 112 | Full Company Workbook Structure | Excel 1-4 |
| 113 | Invoice Export Structure | Excel 1-4 |
| 114 | Raw Data vs Report Sheets | Excel 1-4 |
| 115 | Pivot-ready Excel | Excel 1-4 |
| 116 | Excel Numeric Integrity | Excel 1-4 |
| 117 | Multi-currency Export | Excel 1-4 |
| 118 | Export Summary Sheet | Excel 1-4 |
| 119 | Data Dictionary Sheet | Excel 1-4 |
| 120 | Reconciliation Sheet | Excel 1-4 |
| 121 | Opening / Movement / Closing Columns | Excel 1-4 |
| 122 | Export Filters | Excel 1-4 |
| 123 | Export Column Selection | Excel 1-4 |
| 124 | Saved Export Presets | Excel 1-4 |
| 125 | Accountant Package | Excel 1-4 |
| 126 | Auditor Package | Excel 1-4 |
| 127 | Export Permissions | Excel 1-4 |
| 128 | Sensitive Data Masking | Excel 1-4 |
| 129 | Export Audit Log | Excel 1-4 |
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
| 143 | Opening Balances Import Principle | Excel 1-4 |
| 144 | Opening AR | Excel 1-4 |
| 145 | Opening AP | Excel 1-4 |
| 146 | Opening Inventory | Excel 1-4 |
| 147 | Opening Cash & Bank | Excel 1-4 |
| 148 | Column Mapping | Excel 1-4 |
| 149 | Mapping Presets | Excel 1-4 |
| 150 | Import Validation Levels | Excel 1-4 |
| 151 | Blocking Errors | Excel 1-4 |
| 152 | Warnings | Excel 1-4 |
| 153 | Auto-fixable Issues | Excel 1-4 |
| 154 | Import Preview | Excel 1-4 |
| 155 | Error Export | Excel 1-4 |
| 156 | Duplicate Detection | Excel 1-4 |
| 157 | Duplicate Handling | Excel 1-4 |
| 158 | Import Session | Excel 1-4 |
| 159 | Import Session Metadata | Excel 1-4 |
| 160 | Duplicate File Detection | Excel 1-4 |
| 161 | Import Staging | Excel 1-4 |
| 162 | Dry Run | Excel 1-4 |
| 163 | Large Import Jobs | Excel 1-4 |
| 164 | Import Progress | Excel 1-4 |
| 165 | Import Idempotency | Excel 1-4 |
| 166 | Undo Import | Excel 1-4 |
| 167 | Import Rollback Rules | Excel 1-4 |
| 168 | Import Permissions | Excel 1-4 |
| 169 | Opening Balance Import Security | Excel 1-4 |
| 170 | Post-import Reconciliation | Excel 1-4 |
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
