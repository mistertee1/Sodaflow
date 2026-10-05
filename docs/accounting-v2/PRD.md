# SudaFlow Accounting V2
## CFO Product Requirements & Commercial Readiness Plan

**Version:** 1.0  
**Status:** Approved for Product & Engineering Planning  
**Purpose:** تطوير قسم المحاسبة في SudaFlow من أساس محاسبي جيد إلى نظام مالي وتجاري قابل للاستخدام الفعلي من الشركات الصغيرة والمتوسطة.

---

# 1. الرؤية

الهدف من Accounting V2 هو أن يتمكن صاحب العمل من إدارة شركته مالياً بدون الحاجة إلى معرفة محاسبية عميقة، بينما يقوم SudaFlow في الخلفية بتطبيق المحاسبة الصحيحة تلقائياً.

القاعدة الأساسية:

```text
المستخدم ينفذ العملية التجارية
        ↓
SudaFlow ينفذ القيد المحاسبي الصحيح
        ↓
دفتر الأستاذ يصبح مصدر الحقيقة
        ↓
كل التقارير تُستخرج من نفس المصدر
```

لا يجب إجبار صاحب العمل على فهم:

```text
Debit
Credit
Journal Entries
Ledger Posting
```

لكي يستخدم النظام بصورة صحيحة.

---

# 2. أهداف المنتج المالي

يجب أن يستطيع صاحب الشركة معرفة الإجابة بسرعة على الأسئلة التالية:

```text
عندي كم سيولة الآن؟
عندي كم في البنوك؟
العملاء مدينين لي بكم؟
عليّ كم للموردين؟
قيمة المخزون كم؟
بعت كم؟
ربحت كم؟
صرفت كم؟
شنو المتأخر عليّ؟
شنو المتأخر لي؟
أي فرع أربح؟
أي منتج أربح؟
هل في مشكلة في الحسابات؟
```

---

# 3. أوضاع استخدام قسم المحاسبة

يجب تقسيم تجربة المحاسبة إلى وضعين رئيسيين.

## 3.1 Owner View

واجهة مبسطة لصاحب العمل.

تعرض:

```text
Cash
Banks
Sales
Expenses
Receivables
Payables
Inventory Value
Gross Profit
Net Profit
Overdue Receivables
Upcoming Payables
Financial Alerts
```

بدون إغراق المستخدم في المصطلحات المحاسبية.

## 3.2 Accountant Mode

واجهة احترافية للمحاسب.

تعرض:

```text
Chart of Accounts
General Journal
General Ledger
Trial Balance
Adjusting Entries
Opening Balances
Period Close
Reconciliation
Accounting Reports
```

---

# 4. Financial Owner Dashboard

يجب أن تكون أول شاشة مالية مفهومة لصاحب العمل.

مثال:

```text
النقدية المتاحة       4,200,000 SDG
الحسابات البنكية      8,500,000 SDG
مستحقات العملاء       3,100,000 SDG
مستحقات الموردين      1,700,000 SDG
قيمة المخزون          6,300,000 SDG
مبيعات الشهر         12,400,000 SDG
مجمل الربح            3,900,000 SDG
صافي الربح            2,800,000 SDG
```

يجب أن تكون كل قيمة قابلة للضغط للوصول إلى التفاصيل.

---

# 5. Financial Summary

يجب توفير ملخص مفهوم للمستخدم.

مثال:

```text
المبيعات زادت 18% عن الشهر السابق.

لكن التحصيل أقل من المبيعات.

إجمالي المبالغ المستحقة على العملاء:
3,100,000 SDG

منها:
900,000 SDG متأخرة أكثر من 30 يوماً.
```

في البداية يعتمد الملخص على قواعد رقمية واضحة، وليس على استنتاجات غير قابلة للتحقق.

---

# 6. المبدأ الأساسي للترحيل المحاسبي

كل عملية تجارية أساسية يجب أن تنشئ أثرها المحاسبي تلقائياً.

يشمل ذلك:

```text
Sales Invoice
Payment Receipt
Expense
Purchase
Supplier Payment
Sales Return
Purchase Return
Credit Note
Inventory Adjustment
Owner Capital
Owner Drawings
Bank Transfer
FX Settlement
```

القيد اليدوي يبقى متاحاً للمحاسب فقط ولحالات التسوية.

---

# 7. Inventory Costing

هذا من أعلى أولويات Accounting V2.

النظام الحالي يتابع كمية المخزون، لكن النظام التجاري الكامل يحتاج أيضاً إلى تكلفة المخزون.

يجب إضافة حقول مثل:

```text
average_cost_sdg
average_cost_usd

inventory_value_sdg
inventory_value_usd
```

---

# 8. طريقة تقييم المخزون

الإصدار الأول يعتمد:

```text
Weighted Average Cost
```

لأنه:

- مناسب لمعظم الشركات الصغيرة والمتوسطة.
- أبسط في التشغيل.
- واضح في المراجعة.
- أسهل في التنفيذ والاختبار من FIFO.

يمكن إضافة FIFO لاحقاً كخيار متقدم.

---

# 9. Cost of Goods Sold

عند بيع منتج متتبع للمخزون يجب أن ينشأ أثران محاسبيان.

## قيد الإيراد

```text
Dr Accounts Receivable / Cash
    Cr Sales Revenue
    Cr Sales Tax Payable
```

## قيد التكلفة

```text
Dr Cost of Goods Sold
    Cr Inventory
```

تكلفة البضاعة المباعة يجب أن تعتمد على تكلفة المخزون لحظة البيع وليس سعر البيع.

---

# 10. Inventory Cost Snapshot

كل سطر فاتورة لمنتج مخزني يجب أن يحتفظ بنسخة من التكلفة وقت البيع:

```text
unit_cost_snapshot
total_cost_snapshot
cost_method
```

حتى لو تغيرت تكلفة المنتج لاحقاً تظل ربحية الفاتورة التاريخية صحيحة.

---

# 11. Product Profitability

يجب توفير تقرير لكل منتج:

```text
Sales
Quantity Sold
COGS
Gross Profit
Gross Margin %
Current Stock
Inventory Value
Stock Turnover
```

مثال:

```text
Product A

Sales          10,000,000
COGS            7,000,000
Gross Profit    3,000,000
Margin                30%
```

---

# 12. فصل المشتريات عن المصروفات

شراء البضاعة لا يعتبر مصروفاً تشغيلياً عادياً.

يجب إنشاء Module مستقل:

```text
Purchases
```

ويمنع استخدام:

```text
Expenses → Merchandise Purchase
```

كبديل للمشتريات التجارية.

---

# 13. Suppliers

يجب إنشاء Supplier Master.

```text
suppliers/{supplierId}
```

البيانات:

```text
Name
Phone
Email
Address
Tax Number
Default Currency
Payment Terms
Credit Limit
Current Balance
Status
Notes
```

---

# 14. Purchase Bills

يجب دعم فواتير المشتريات.

Workflow:

```text
Supplier
↓
Purchase Bill
↓
Receive Inventory
↓
Update Inventory Cost
↓
Create Journal
```

إذا الشراء آجل:

```text
Dr Inventory
    Cr Accounts Payable
```

إذا الشراء نقدي:

```text
Dr Inventory
    Cr Cash / Bank
```

---

# 15. Supplier Payments

عند سداد المورد:

```text
Dr Accounts Payable
    Cr Cash / Bank
```

يجب دعم:

```text
Partial Payment
Full Payment
Multiple Payments
Payment Reference
Payment Method
Payment Currency
FX Rate
```

---

# 16. Accounts Payable

يجب أن يصبح حساب:

```text
2110 Accounts Payable
```

مرتبطاً فعلياً بموردين وفواتير مشتريات.

يجب توفير:

```text
Supplier Balance
Purchase History
Payments
Outstanding Bills
Overdue Bills
Supplier Statement
```

---

# 17. AP Aging

تصنيف التزامات الموردين:

```text
Current
1–30 Days
31–60 Days
61–90 Days
90+ Days
```

---

# 18. Accounts Receivable Aging

تصنيف ديون العملاء:

```text
Current
1–30 Days
31–60 Days
61–90 Days
90+ Days
```

ويجب إظهار أكبر العملاء المتأخرين.

---

# 19. Customer Statement

لكل عميل كشف حساب متكامل:

```text
Opening Balance
Invoices
Payments
Credit Notes
Adjustments
Closing Balance
```

مع:

```text
Date Range
PDF
CSV
```

---

# 20. Supplier Statement

نفس مفهوم كشف العميل للمورد:

```text
Opening Balance
Purchase Bills
Payments
Purchase Returns
Adjustments
Closing Balance
```

---

# 21. Cash & Bank Center

إنشاء مركز موحد للسيولة.

يعرض:

```text
Cash SDG
Cash USD
Bankak
Fawry
Bank Accounts
Other Wallets
```

لكل حساب:

```text
Current Balance
Today's Inflows
Today's Outflows
Last Transactions
Reconciliation Status
```

---

# 22. Bank Accounts

بدلاً من الاعتماد على حسابات ثابتة فقط، يجب السماح بإنشاء حسابات مالية مثل:

```text
Bank of Khartoum
Faisal Bank
Bankak
Fawry
O-Cash
Other Bank
Cash Drawer
```

مع Account Mapping إلى Chart of Accounts.

---

# 23. Internal Transfers

يجب دعم التحويل بين الحسابات المالية.

مثال:

```text
Transfer 500,000 SDG

From:
Cash

To:
Bankak
```

القيد:

```text
Dr Bankak
    Cr Cash
```

التحويل ليس مصروفاً وليس إيراداً.

---

# 24. Expense Payment Source

كل مصروف يجب أن يحدد مصدر الدفع.

```text
Cash
Bankak
Fawry
Bank Transfer
Other Financial Account
On Credit
```

مثال:

```text
Rent = 500,000
Paid via Bankak
```

القيد:

```text
Dr Rent Expense
    Cr Bankak
```

---

# 25. Expense on Credit

إذا المصروف لم يُدفع بعد:

```text
Dr Expense
    Cr Payable / Accrued Liability
```

ثم عند الدفع:

```text
Dr Payable
    Cr Cash / Bank
```

---

# 26. Expense Categories

يجب فصل Category عن Account Mapping.

كل Expense Category ترتبط بحساب محاسبي.

مثال:

```text
Rent → 5200
Salaries → 5300
Shipping → 5400
Bank Fees → 5600
Utilities → 5700
Maintenance → 5800
```

ويستطيع Accountant تعديل Mapping المسموح.

---

# 27. General Ledger

إضافة دفتر الأستاذ العام.

لكل حساب:

```text
Opening Balance
Date
Entry Number
Reference
Description
Debit
Credit
Running Balance
```

مع:

```text
Date Filter
Branch Filter
Currency Filter
Export
```

---

# 28. Account Classification

التقارير المالية لا يجب أن تعتمد فقط على رقم الحساب.

كل Account يجب أن يحتوي على Metadata مثل:

```text
type
subtype
reporting_group
cash_flow_category
normal_balance
```

مثال:

```text
type = REVENUE
subtype = OTHER_REVENUE
reporting_group = OTHER_INCOME
```

---

# 29. Reporting Groups

يجب دعم مجموعات تقارير مثل:

```text
CURRENT_ASSET
NON_CURRENT_ASSET

CURRENT_LIABILITY
NON_CURRENT_LIABILITY

EQUITY

SALES_REVENUE
OTHER_REVENUE

COGS

OPERATING_EXPENSE
FINANCE_EXPENSE
OTHER_EXPENSE
```

---

# 30. Income Statement

قائمة الدخل يجب أن تشمل جميع الحسابات حسب Classification وليس Code Prefix فقط.

الهيكل:

```text
Sales Revenue
- Cost of Goods Sold
= Gross Profit

- Operating Expenses
= Operating Profit

+ Other Income
- Other Expenses
+/- FX Gain/Loss

= Net Profit
```

---

# 31. Gross Margin

يجب عرض:

```text
Gross Margin %
```

المعادلة:

```text
Gross Profit / Revenue × 100
```

---

# 32. Balance Sheet

المركز المالي يجب أن يدعم:

```text
Current Assets
Non-current Assets

Current Liabilities
Non-current Liabilities

Owner Capital
Retained Earnings
Current Period Profit
```

---

# 33. Cash Flow Statement

يجب عدم الاعتماد فقط على Account Code Prefix.

كل حساب أو Transaction Type يجب أن يحمل تصنيف:

```text
OPERATING
INVESTING
FINANCING
```

---

# 34. Reporting Periods

كل تقرير مالي يجب أن يدعم:

```text
Today
This Week
This Month
Last Month
This Quarter
This Year
Custom Range
```

---

# 35. As-of Reports

التقارير مثل Balance Sheet يجب أن تعمل وفق:

```text
As of Date
```

مثال:

```text
Balance Sheet as of 31/12/2026
```

---

# 36. Comparative Reports

يجب دعم المقارنات:

```text
This Month vs Last Month
This Year vs Last Year
Current Period vs Previous Period
```

---

# 37. Accounting Periods

يجب استبدال مفهوم Lock Date الفردي بنظام فترات.

```text
/accounting_periods/{periodId}
```

مثال:

```text
2026-10

startDate
endDate

status:
OPEN
SOFT_CLOSED
CLOSED
REOPENED
```

---

# 38. Soft Close

في:

```text
SOFT_CLOSED
```

يمنع المستخدمون العاديون من التعديل.

يمكن للمحاسب أو Owner بصلاحية مناسبة إضافة Adjusting Entries.

---

# 39. Hard Close

في:

```text
CLOSED
```

لا يسمح بأي Posting جديد داخل الفترة.

أي إعادة فتح تتطلب:

```text
Owner Permission
Re-authentication
Reason
Audit Log
```

---

# 40. Reopen Period

يجب تسجيل:

```text
reopenedBy
reopenedAt
reopenReason
previousStatus
```

---

# 41. Month-End Close Assistant

يجب إنشاء Checklist قبل إقفال الشهر.

مثال:

```text
✓ All sales posted
✓ All expenses posted
✓ Bank reconciled
✓ Cash reconciled
✓ Inventory reconciled
✓ AR reconciled
✓ AP reconciled
✓ No unbalanced journals
✓ No missing journals
✓ FX review completed
```

---

# 42. Opening Balances Wizard

عند إنشاء شركة جديدة يتم سؤال المستخدم بطريقة بسيطة:

```text
كم عندك نقدية؟
كم عندك في بنكك؟
كم في الحسابات البنكية؟
العملاء عليهم ليك كم؟
عليك للموردين كم؟
قيمة المخزون الحالية كم؟
رأس المال كم؟
```

SudaFlow ينشئ Opening Journal متزن.

---

# 43. Owner Capital

إضافة عمليات واضحة:

```text
Capital Contribution
Owner Drawings
```

إيداع المالك:

```text
Dr Cash / Bank
    Cr Owner Capital
```

---

# 44. Owner Drawings

سحب المالك:

```text
Dr Owner Drawings
    Cr Cash / Bank
```

ولا يسجل كمصروف تشغيلي.

---

# 45. Credit Notes

يجب دعم Credit Note بدلاً من حذف أو تعديل الفواتير المالية.

يستخدم في:

```text
Sales Return
Pricing Correction
Discount Correction
Invoice Reduction
```

---

# 46. Sales Returns

عند إرجاع البضاعة:

```text
Reverse Revenue
Reverse Tax where applicable
Reduce Customer Receivable
Restore Inventory
Reverse COGS
```

حسب حالة الفاتورة والدفع.

---

# 47. Purchase Returns

عند إعادة البضاعة للمورد:

```text
Reduce Inventory
Reduce Accounts Payable
```

مع معالجة Cost correctly.

---

# 48. Refunds

الفاتورة المدفوعة لا يتم Void لها مباشرة.

يجب إنشاء Refund Workflow.

```text
Credit Note
↓
Refund Payment
↓
Journal
↓
Audit
```

---

# 49. Bank Reconciliation

إضافة شاشة مطابقة البنك.

يعرض:

```text
SudaFlow Balance
Bank Statement Balance
Difference
```

والحركات:

```text
Matched
Unmatched
Pending
Adjustment Required
```

---

# 50. Statement Import

مرحلة لاحقة تدعم:

```text
CSV
Excel
```

لاستيراد كشف البنك وعمل Matching.

---

# 51. Cash Reconciliation

إضافة Cash Count.

مثال:

```text
System Cash Balance: 1,500,000
Actual Cash Count:   1,480,000

Difference:            -20,000
```

ويحتاج الفرق إلى Adjustment Reason.

---

# 52. Multi-Currency Strategy

في Accounting V2 الأول:

```text
Primary supported accounting currencies:
SDG
USD
```

لا يتم تقديم النظام كـFull Multi-Currency Ledger قبل بناء محرك عام للعملات.

---

# 53. Future Multi-Currency Architecture

المرحلة المستقبلية تدعم:

```text
Transaction Currency
Functional Currency
Reporting Currency
Exchange Rate
Realized FX
Unrealized FX
```

---

# 54. Realized FX

النظام يحتفظ بدعم أرباح وخسائر فروق العملة عند السداد.

```text
Realized FX Gain
Realized FX Loss
```

---

# 55. Unrealized FX

إضافة Period-end FX Revaluation.

مثال:

العميل مدين بالدولار ولم يدفع بعد.

في نهاية الشهر يتم إعادة تقييم الرصيد بسعر الإقفال.

يتم إنشاء:

```text
Unrealized FX Gain/Loss
```

---

# 56. Branch Accounting

كل قيد يجب أن يدعم:

```text
branchId
```

بحيث يمكن استخراج:

```text
Branch P&L
Branch Expenses
Branch Sales
Branch Cash
Branch Inventory
```

---

# 57. Cost Centers

إضافة Dimension:

```text
costCenterId
```

لتحليل المصروفات.

مثال:

```text
Sales Department
Administration
Warehouse
Delivery
Marketing
```

---

# 58. Projects

إضافة Dimension اختياري:

```text
projectId
```

لتحليل مشروع أو عقد معين.

---

# 59. Journal Dimensions

Journal Entry Line يجب أن تدعم مستقبلاً:

```text
accountCode
branchId
costCenterId
projectId
customerId
supplierId
productId
```

---

# 60. Branch P&L

تقرير:

```text
Sales
COGS
Gross Profit
Expenses
Net Profit
```

لكل فرع.

---

# 61. Customer Profitability

لكل عميل:

```text
Sales
COGS
Gross Profit
Outstanding Balance
Average Payment Days
Discounts
Returns
```

---

# 62. Credit Limit

لكل عميل يمكن تحديد:

```text
creditLimit
```

إذا كان:

```text
Existing Balance + New Invoice > Credit Limit
```

يظهر Warning أو Approval Requirement.

---

# 63. Payment Terms

العميل والمورد يمكن أن يكون لديهم:

```text
Due on Receipt
7 Days
15 Days
30 Days
60 Days
Custom
```

---

# 64. Approval Limits

إضافة أساس Approval Workflow.

مثال:

```text
Discount <= 5%
Sales user can approve

5%–15%
Admin approval

> 15%
Owner approval
```

---

# 65. Expense Approval

مثال:

```text
Expense <= 100,000
Accountant

100,001–1,000,000
Admin

> 1,000,000
Owner
```

القيم تكون Configurable.

---

# 66. Refund Approval

أي Refund يمكن أن يحتاج Approval حسب المبلغ والصلاحية.

---

# 67. Budgeting

إضافة Budget.

مثال:

```text
Rent
Salaries
Shipping
Utilities
Marketing
Maintenance
```

---

# 68. Budget vs Actual

يعرض:

```text
Budget
Actual
Variance
Variance %
```

---

# 69. Cash Forecast

توقع مبسط للتدفقات القادمة.

يعتمد على:

```text
Customer Due Dates
Supplier Due Dates
Recurring Expenses
Scheduled Payments
```

مثال:

```text
Expected Inflows 30 days:
4,500,000

Expected Outflows 30 days:
3,200,000

Expected Net Cash:
1,300,000
```

---

# 70. Profit vs Cash

يجب أن تشرح الواجهة الفرق.

مثال:

```text
Net Profit:
5,000,000

Cash Generated:
1,800,000

Reason:
3,200,000 still outstanding from customers
```

---

# 71. Financial Alerts

إضافة Alerts مثل:

```text
Customer overdue
Customer exceeded credit limit
Supplier bill due soon
Bank balance low
Cash discrepancy
Inventory discrepancy
Negative margin sale
Large expense
Unusual discount
Unreconciled bank
Period not closed
```

---

# 72. Accounting Health Center

تحويل محرك Reconciliation إلى واجهة للمستخدم.

يعرض مثلاً:

```text
✓ Journal entries balanced
✓ Customer balances reconciled
✓ Inventory quantities reconciled
⚠ 2 invoices missing journal linkage
⚠ 1 inventory valuation issue
⚠ Bank reconciliation incomplete
```

---

# 73. Accounting Health Principle

لا يتم إعطاء Score مبهم لجودة الشركة أو المحاسب.

الأفضل عرض:

```text
Issues Detected
Warnings
Passed Checks
```

مع تفاصيل قابلة للتنفيذ.

---

# 74. Reconciliation Checks

يشمل على الأقل:

```text
Invoice ↔ Journal
Payment ↔ Journal
Expense ↔ Journal
Purchase ↔ Journal
Customer Balance ↔ AR
Supplier Balance ↔ AP
Inventory Quantity ↔ Movements
Inventory Value ↔ GL
Cash ↔ GL
Bank ↔ GL
Tax ↔ GL
```

---

# 75. No Hard Delete

المعاملات المالية لا تحذف بعد الترحيل.

استخدام:

```text
Void
Reverse
Credit Note
Refund
Archive
```

حسب نوع العملية.

---

# 76. Audit Requirements

كل عملية مالية مهمة تسجل:

```text
Actor
Role
Date
Time
Branch
Action
Before
After
Reference
Reason
```

---

# 77. Accounting Permissions

يجب إضافة Permissions مثل:

```text
accounting.view
accounting.manage

accounts.view
accounts.create
accounts.update

journal.view
journal.create
journal.adjust

reports.financial.view
reports.financial.export

period.close
period.reopen

suppliers.view
suppliers.manage

purchases.view
purchases.create
purchases.approve

banking.view
banking.reconcile

budget.view
budget.manage
```

---

# 78. Sensitive Financial Permissions

يجب أن تكون أكثر تقييداً:

```text
period.reopen
opening_balance.modify
journal.adjust
refund.approve
inventory_cost.adjust
bank_reconciliation.override
```

---

# 79. Simplified Accounting Labels

إضافة شرح مبسط للمصطلحات.

مثال:

```text
Accounts Receivable
قروش ليك عند العملاء

Accounts Payable
قروش عليك للموردين

Gross Profit
ربح البيع قبل مصاريف التشغيل

Net Profit
الربح النهائي بعد المصروفات
```

---

# 80. Fixed Assets

مرحلة Professional Accounting تضيف:

```text
Fixed Asset Register
```

البيانات:

```text
Asset Name
Category
Purchase Date
Purchase Cost
Useful Life
Residual Value
Depreciation Method
Accumulated Depreciation
Book Value
```

---

# 81. Depreciation

يدعم:

```text
Straight Line
```

في الإصدار الأول.

القيد الدوري:

```text
Dr Depreciation Expense
    Cr Accumulated Depreciation
```

---

# 82. Tax Center

إنشاء Tax Configuration منفصلة عن الكود.

يشمل:

```text
Sales Tax
Purchase Tax
Tax Payable
Tax Receivable
Tax Period
Tax Report
```

---

# 83. Tax Localization

قواعد الضرائب تختلف حسب الدولة.

لذلك:

```text
Tax Engine ≠ Hard-coded Country Rules
```

يتم تصميم Configuration قابلة للتخصيص.

---

# 84. Recurring Expenses

دعم:

```text
Rent
Subscriptions
Salaries
Internet
Other recurring expenses
```

مع Reminder أو Draft Generation.

---

# 85. Recurring Journal Entries

يمكن للمحاسب إعداد:

```text
Monthly Accrual
Monthly Depreciation
Prepaid Expense Amortization
```

في مراحل لاحقة.

---

# 86. Attachments

المعاملات المالية تدعم مرفقات:

```text
Invoice
Receipt
Supplier Bill
Bank Statement
Contract
Supporting Document
```

---

# 87. Notes & Evidence

كل Adjustment يدوي حساس يجب أن يحتوي على:

```text
Reason
Notes
Attachment optional
CreatedBy
ApprovedBy optional
```

---

# 88. Financial Data Source of Truth

المبدأ:

```text
General Ledger = Financial Source of Truth
```

لا تعتمد التقارير النهائية على تجميع مباشر من:

```text
Invoices
Expenses
Payments
```

إذا كان لها قيود محاسبية.

هذه Documents تعتبر Source Documents.

أما التقارير المالية النهائية فتقرأ من Ledger.

---

# 89. Subledger Reconciliation

كل Subledger يجب مطابقته مع GL.

مثال:

```text
Total Customer Outstanding
=
Accounts Receivable GL Balance
```

و:

```text
Total Supplier Outstanding
=
Accounts Payable GL Balance
```

---

# 90. Commercial Readiness Definition

وجود Features وحده لا يعني أن النظام جاهز تجارياً.

يعتبر Accounting V2 جاهزاً تجارياً فقط عندما يجتاز:

```text
Accounting Correctness
Security
Data Integrity
Operational Stability
Auditability
Backup & Restore
End-to-End Tests
Commercial User Acceptance
```

---

# 91. Commercial MVP

يمكن بيع SudaFlow للشركات الحقيقية بعد اكتمال الحد الأدنى التالي:

```text
Correct Double Entry
Inventory Costing
COGS
Purchases
Suppliers
Accounts Payable
Accounts Receivable
Expense Payment Source
General Ledger
Trial Balance
Income Statement
Balance Sheet
Cash Flow
Period Control
Credit Notes / Returns
Audit Logs
Backup / Restore
Tenant Isolation
Permissions
Reconciliation
```

---

# 92. Professional SMB Level

بعد إضافة:

```text
AR Aging
AP Aging
Bank Reconciliation
Cash Reconciliation
Accounting Period Lifecycle
Branch P&L
Budget vs Actual
Cash Forecast
Month-End Close Assistant
```

يصبح SudaFlow أقرب إلى Professional SMB Accounting Product.

---

# 93. Enterprise Level

Enterprise يتطلب مستوى إضافياً يشمل:

```text
Advanced Approval Workflows
Complex Multi-currency
Advanced Tax Localization
Consolidation
Advanced Fixed Assets
Advanced Audit Controls
SLA
Observability
Disaster Recovery
External Accounting Review
```

---

# 94. Release Candidate Scenario

قبل أي إطلاق تجاري يجب تنفيذ سيناريو كامل.

```text
Create Company
↓
Opening Balances
↓
Create Supplier
↓
Purchase Inventory
↓
Supplier Credit
↓
Sell Inventory
↓
Partial Customer Payment
↓
Final Customer Payment
↓
Expense via Bank
↓
Sales Return
↓
Supplier Payment
↓
Purchase Return
↓
Bank Reconciliation
↓
Inventory Reconciliation
↓
Month-End Close
↓
Financial Statements
↓
Backup
↓
Restore
```

---

# 95. Release Accounting Assertions

بعد السيناريو السابق يجب إثبات:

```text
Trial Balance Balanced

Assets =
Liabilities + Equity

AR Subledger =
AR Control Account

AP Subledger =
AP Control Account

Inventory Valuation =
Inventory GL

Cash & Bank =
Cash/Bank GL

Sales =
Revenue Ledger

COGS =
Inventory Cost Movements

Net Profit =
Income Statement Result
```

---

# 96. Zero Difference Requirement

أي فرق غير مبرر في Reconciliation:

```text
BLOCK COMMERCIAL RELEASE
```

ولا يتم تجاهله يدوياً.

---

# 97. Backup & Restore

يجب إثبات أن:

```text
Backup
↓
Restore
↓
Same balances
Same journals
Same invoices
Same payments
Same inventory
Same audit references
```

بدون تغيير الملكية أو كسر Tenant Isolation.

---

# 98. Accounting Regression Tests

يجب إنشاء Tests لكل:

```text
Invoice Posting
COGS
Inventory Cost
Purchase Posting
Supplier Payment
Customer Payment
FX
Expense
Credit Note
Sales Return
Purchase Return
Opening Balance
Period Close
Period Reopen
Bank Reconciliation
Inventory Reconciliation
```

---

# 99. CFO Acceptance Criteria

القسم المالي يعتبر جاهزاً فقط إذا:

1. كل عملية تجارية لها Posting Rule معروف.
2. لا توجد معاملة مالية يتم حذفها بدون أثر.
3. كل تقرير يمكن ربطه بدفتر الأستاذ.
4. كل Subledger يطابق GL.
5. المخزون الكمي والقيمي متطابق.
6. الربح لا يعتمد على سعر البيع فقط.
7. المشتريات منفصلة عن المصروفات.
8. الموردون مرتبطون بالذمم الدائنة.
9. العملاء مرتبطون بالذمم المدينة.
10. الفترات المقفلة محمية.
11. إعادة فتح الفترة مسجلة.
12. جميع العمليات الحساسة Auditable.
13. العملات لها قواعد واضحة.
14. الفروع قابلة للتحليل المالي.
15. Backup/Restore يحافظ على الأرصدة.
16. النظام يكتشف الفروقات قبل المستخدم.

---

# 100. Accounting V2 Phase A — Financial Integrity

**Priority: P0**

## تنفيذ:

```text
Inventory Cost Model
Weighted Average Cost
COGS Automation
Inventory GL Posting
Purchase vs Expense Separation
Expense Payment Accounts
Account Classification Metadata
Report Date Ranges
Ledger-based Financial Reports
Core Reconciliation Expansion
```

## Acceptance Criteria

```text
COGS posts automatically
Inventory value matches GL
Custom revenue accounts appear correctly
Expense credits selected cash/bank account
Purchases cannot be misclassified as normal expense
Reports honor requested periods
```

---

# 101. Accounting V2 Phase B — Operational Accounting

**Priority: P1**

## تنفيذ:

```text
Suppliers
Purchase Bills
Supplier Payments
Accounts Payable
AP Aging
Customer Statements
AR Aging
General Ledger
Cash & Bank Center
Bank Reconciliation
Cash Reconciliation
Credit Notes
Sales Returns
Purchase Returns
Refund Workflow
```

---

# 102. Accounting V2 Phase C — Professional Accounting

**Priority: P2**

## تنفيذ:

```text
Accounting Periods
Soft Close
Hard Close
Reopen Workflow
Month-End Close Assistant
FX Revaluation
Fixed Assets
Depreciation
Tax Center
Comparative Statements
```

---

# 103. Accounting V2 Phase D — Management Accounting

**Priority: P3**

## تنفيذ:

```text
Branch P&L
Cost Centers
Projects
Product Profitability
Customer Profitability
Budgeting
Budget vs Actual
Cash Forecast
Credit Limits
Approval Limits
```

---

# 104. Accounting V2 Phase E — Automation & Intelligence

## تنفيذ:

```text
Accounting Health Center
Financial Alerts
Auto-reconciliation Assistance
Smart Account Suggestions
Close Checklist Automation
Anomaly Detection
Owner Financial Summary
```

أي Automation يجب أن يكون قابلاً للمراجعة ولا يغير البيانات المالية التاريخية بدون موافقة واضحة.

---

# 105. Implementation Priority Rule

الترتيب الإلزامي:

```text
Financial Integrity
        ↓
Operational Accounting
        ↓
Professional Accounting
        ↓
Management Accounting
        ↓
Automation
```

ممنوع تقديم Dashboard متقدم أو Intelligence فوق بيانات محاسبية غير مكتملة.

---

# 106. Critical Accounting Engineering Rules

## Rule 1

```text
Ledger before dashboard.
```

## Rule 2

```text
No sales profit without inventory cost.
```

## Rule 3

```text
Purchases are not ordinary expenses.
```

## Rule 4

```text
Posted financial records are never silently deleted.
```

## Rule 5

```text
Every subledger must reconcile with GL.
```

## Rule 6

```text
Every report must respect accounting period/date.
```

## Rule 7

```text
Financial reports classify accounts by accounting metadata, not code prefix alone.
```

## Rule 8

```text
Every sensitive accounting action must be auditable.
```

---

# 107. Final Product Goal

بعد اكتمال Accounting V2 يجب أن يكون SudaFlow قادراً على خدمة شركة صغيرة أو متوسطة بحيث:

```text
Owner
يفهم وضع الشركة المالي بدون معرفة محاسبية عميقة

Accountant
يستطيع مراجعة القيود والأستاذ والتسويات

Operations Team
يستخدم الفواتير والمشتريات والمخزون بصورة طبيعية

SudaFlow
يحول كل العمليات إلى محاسبة صحيحة ومراجَعة
```

---

# 108. Commercial Positioning After Completion

بعد اجتياز معايير الجاهزية يمكن تقديم SudaFlow باعتباره:

```text
Business Management + Accounting System
```

للشركات الصغيرة والمتوسطة.

ولا يتم استخدام ادعاءات مثل:

```text
Fully IFRS compliant
Fully GAAP compliant
Enterprise accounting certified
```

إلا بعد مراجعة مستقلة مناسبة حسب الأسواق المستهدفة ومتطلباتها القانونية والمحاسبية.

---

# 109. Next Engineering Step

الخطوة التالية قبل التنفيذ:

```text
Accounting V2 Phase A Technical Design
```

ويشمل:

```text
Inventory Cost Schema
Purchase Schema
Supplier Schema
Journal Posting Rules
Account Classification Schema
Migration Strategy
Reconciliation Rules
Permissions
Firestore Model
Security Rules
Acceptance Tests
Regression Tests
```

بعد اعتماد التصميم يبدأ التنفيذ على الكود الحالي بصورة مرحلية بدون كسر البيانات التاريخية.

---

# 110. Excel Export & Data Portability

Excel Export يعتبر جزءاً أساسياً من الجاهزية التجارية وليس Feature ثانوية.

يجب إنشاء:

```text
Data Export Center
```

بدلاً من زر تصدير واحد فقط.

# 111. Export Modes

يدعم النظام ثلاثة مستويات:

```text
Quick Export
Accounting Export
Full Company Export
```

## Quick Export

تصدير الجدول أو التقرير الحالي فقط.

## Accounting Export

مخصص للمحاسب ويشمل البيانات المالية والتحليلية.

## Full Company Export

تصدير شامل لبيانات المؤسسة، وافتراضياً:

```text
Owner Only
```

# 112. Full Company Workbook Structure

```text
Company
Customers
Suppliers
Products
Invoices
Invoice_Items
Payments
Purchases
Purchase_Items
Expenses
Inventory_Movements
Chart_of_Accounts
Journal_Entries
Journal_Lines
Trial_Balance
AR_Aging
AP_Aging
Cash_Bank
Reconciliation
Data_Dictionary
Export_Summary
```

# 113. Invoice Export Structure

## Invoices Sheet

```text
invoice_id
invoice_number
customer_id
customer_name
issue_date
due_date
currency
subtotal
tax
discount
total
paid
remaining
status
branch_id
```

## Invoice Items Sheet

```text
invoice_id
line_id
product_id
product_name
quantity
unit
unit_price
unit_cost
discount
tax
line_total
line_cost
gross_profit
```

# 114. Raw Data vs Report Sheets

الفصل بين:

```text
Raw Data
Report View
```

Raw Data يكون مناسباً للتحليل وPivot Tables، وReport View يكون منسقاً للمراجعة البشرية.

# 115. Pivot-ready Excel

```text
One record per row
No merged cells
Stable headers
No decorative blank rows
Consistent data types
Filter-ready
Pivot-ready
```

# 116. Excel Numeric Integrity

القيم المالية تُصدّر كـNumbers حقيقية، وليس Text، حتى تعمل:

```text
SUM
AVERAGE
Pivot Tables
Power Query
Formulas
Charts
```

# 117. Multi-currency Export

```text
amount_sdg
amount_usd
transaction_currency
exchange_rate
functional_amount
```

لا يتم خلط أكثر من عملة في عمود مالي واحد.

# 118. Export Summary Sheet

```text
Company Name
Company Code
Export Type
Date Range
Generated At
Generated By
Base Currency
Secondary Currency
Record Counts
Export Schema Version
```

# 119. Data Dictionary Sheet

```text
Field Name
Arabic Label
Description
Data Type
Required / Optional
Source Module
```

# 120. Reconciliation Sheet

```text
Trial Balance Balanced       PASS
AR Subledger = AR GL         PASS
AP Subledger = AP GL         PASS
Inventory Value = GL         PASS
Cash = GL                    PASS
Bank Reconciled              WARNING
```

# 121. Opening / Movement / Closing Columns

```text
Opening Balance
Debit Movement
Credit Movement
Net Movement
Closing Balance
```

# 122. Export Filters

```text
Date Range
Branch
Cost Center
Project
Customer
Supplier
Account
Currency
Status
User
```

# 123. Export Column Selection

المستخدم يختار الأعمدة، مع إمكانية إبقاء IDs التقنية كأعمدة مخفية للمطابقة.

# 124. Saved Export Presets

```text
Monthly Accountant Package
Owner Monthly Review
Auditor Package
Branch Performance Export
```

# 125. Accountant Package

زر واحد ينتج Workbook يحتوي:

```text
Trial Balance
General Ledger
Journal Entries
AR Aging
AP Aging
Inventory Valuation
Cash & Bank Movements
Income Statement
Balance Sheet
Cash Flow
Reconciliation Summary
```

# 126. Auditor Package

مرحلة لاحقة تشمل:

```text
Trial Balance
General Ledger
Journal Entries
Source References
Adjustments
Period Close History
Reopen History
Audit References
Reconciliation Results
```

# 127. Export Permissions

```text
export.invoices
export.customers
export.suppliers
export.inventory
export.accounting
export.audit
export.full_company
```

# 128. Sensitive Data Masking

حسب الصلاحية، يمكن إخفاء:

```text
Product Cost
Gross Margin
Customer Phone
Customer Email
Internal Notes
Audit Security Metadata
```

# 129. Export Audit Log

```text
DATA_EXPORT_CREATED
```

مع:

```text
actorId
organizationId
exportType
filters
modules
recordCount
createdAt
```

# 130. Large Export Architecture

```text
User Requests Export
↓
Permission Check
↓
Create Export Job
↓
Generate Server-side
↓
Store Temporary File
↓
Secure Download
↓
Automatic Expiry
```

# 131. Temporary Export Files

مثال:

```text
Expires after 24 hours
```

# 132. Data Portability Package

```text
ZIP
├── company_export.xlsx
├── customers.csv
├── suppliers.csv
├── products.csv
├── invoices.csv
├── journal_entries.csv
├── attachments_index.csv
└── manifest.json
```

# 133. Export Schema Version

كل Export يحتوي:

```text
export_schema_version
```

# 134. Export References

```text
invoice_id
journal_entry_id
customer_id
supplier_id
product_id
branch_id
```

# 135. Excel Import Center

الاستيراد لا يكتب مباشرة في Production Collections.

يجب إنشاء:

```text
Excel Import Center
```

يعتمد على Staging + Validation + Preview.

# 136. Import Workflow

```text
Upload Excel
↓
Choose Import Type
↓
Read Workbook
↓
Map Columns
↓
Validate
↓
Detect Duplicates
↓
Preview
↓
Dry Run
↓
User Confirmation
↓
Server-side Import Job
↓
Reconciliation
↓
Import Report
```

# 137. Initial Supported Imports

Phase 1:

```text
Customers
Suppliers
Products
```

ثم:

```text
Opening Inventory
Opening AR
Opening AP
Opening Cash & Banks
Opening Capital
```

# 138. Official Import Templates

```text
customers_import_template.xlsx
suppliers_import_template.xlsx
products_import_template.xlsx
inventory_opening_template.xlsx
opening_balances_template.xlsx
```

# 139. Template Structure

```text
Instructions
Data
Examples
```

# 140. Customer Import Template

```text
customer_code
name
phone
email
address
currency
credit_limit
opening_balance
payment_terms
```

# 141. Supplier Import Template

```text
supplier_code
name
phone
email
address
currency
opening_balance
payment_terms
tax_number
```

# 142. Product Import Template

```text
sku
product_name
category
unit
selling_price_sdg
selling_price_usd
opening_quantity
unit_cost
track_inventory
tax_rate
```

# 143. Opening Balances Import Principle

ممنوع تعديل الأرصدة مباشرة. يتم إنشاء Opening Journal Entries متزنة.

# 144. Opening AR

```text
Dr Accounts Receivable
    Cr Opening Balance Equity
```

# 145. Opening AP

```text
Dr Opening Balance Equity
    Cr Accounts Payable
```

# 146. Opening Inventory

```text
Dr Inventory
    Cr Opening Balance Equity
```

مع:

```text
Quantity
Unit Cost
Inventory Value
```

# 147. Opening Cash & Bank

```text
Dr Cash / Bank
    Cr Opening Balance Equity
```

# 148. Column Mapping

مثال:

```text
اسم الزبون → customer_name
رقم الموبايل → phone
الرصيد → opening_balance
```

# 149. Mapping Presets

```text
My Old ERP Customer File
My Accountant Product Template
```

# 150. Import Validation Levels

```text
Blocking Errors
Warnings
Auto-fixable Issues
```

# 151. Blocking Errors

```text
Missing Required Name
Invalid Currency
Invalid Date
Duplicate SKU
Unknown Account
Broken Supplier Reference
Invalid Negative Quantity
Invalid Opening Balance Structure
```

# 152. Warnings

```text
Phone Missing
Email Missing
Tax Number Missing
Zero Selling Price
Old Transaction Date
Potential Duplicate Customer
```

# 153. Auto-fixable Issues

```text
Trim Spaces
Normalize Email
Normalize Phone
Normalize Currency Codes
Normalize Date Format
Normalize Boolean Values
```

أي Auto-fix يظهر في Preview.

# 154. Import Preview

```text
Rows Detected: 2,430
Valid: 2,380
Warnings: 32
Errors: 18
Duplicates: 14
```

# 155. Error Export

```text
row_number
record_key
error_code
error_message
suggested_fix
```

# 156. Duplicate Detection

حسب النوع:

```text
customer_code
supplier_code
SKU
email
tax_number
external_id
```

ولا يعتمد النظام على الاسم فقط.

# 157. Duplicate Handling

```text
Skip
Update Existing
Create New
Review Manually
```

# 158. Import Session

مثال:

```text
IMP-2026-000145
```

# 159. Import Session Metadata

```text
fileName
fileHash
importType
createdBy
createdAt
rowsTotal
rowsValid
rowsFailed
rowsImported
rowsSkipped
status
schemaVersion
```

# 160. Duplicate File Detection

يحسب النظام:

```text
File Hash
```

ويحذر عند استيراد نفس الملف سابقاً.

# 161. Import Staging

البيانات تدخل أولاً إلى:

```text
Import Staging
```

ولا تصبح Production Data قبل:

```text
Validation
Dry Run
Confirmation
```

# 162. Dry Run

يعرض بدون حفظ:

```text
Records to Create
Records to Update
Records to Skip
Accounting Entries to Create
Expected Opening Balances
Warnings
Blocking Errors
```

# 163. Large Import Jobs

```text
Upload
↓
Import Job
↓
Chunk Processing
↓
Progress
↓
Validation
↓
Commit
```

# 164. Import Progress

```text
Processing 3,000 / 12,000 rows
```

مع:

```text
Current Stage
Valid Rows
Failed Rows
Estimated Remaining Records
```

# 165. Import Idempotency

```text
idempotencyKey
fileHash
schemaVersion
```

# 166. Undo Import

يسمح فقط عندما:

```text
Imported Records Have No Dependent Transactions
```

# 167. Import Rollback Rules

إذا دخل Record في معاملات لاحقة:

```text
No Hard Undo
```

ويستخدم:

```text
Archive
Correction
Reversal
Controlled Migration Fix
```

# 168. Import Permissions

```text
import.customers
import.suppliers
import.products
import.inventory
import.opening_balances
import.accounting
import.full_company
```

# 169. Opening Balance Import Security

```text
Opening AR
Opening AP
Opening Inventory
Opening Cash
Opening Bank
Opening Capital
```

تتطلب Permission خاصة.

# 170. Post-import Reconciliation

```text
Trial Balance Check
AR Reconciliation
AP Reconciliation
Inventory Reconciliation
Cash Reconciliation
```

# 171. Accounting Import Block

إذا ظهر فرق:

```text
IMPORT_COMPLETED_WITH_ACCOUNTING_BLOCK
```

ويمنع Period Close حتى المعالجة.

# 172. Historical Invoice Import

لا يُطلق في Phase 1.

يحتاج Rules واضحة لـ:

```text
Invoice
Payment
AR
Inventory
COGS
Tax
Journal
```

# 173. Advanced Accountant Import

```text
Historical Journal Entries
Historical Invoices
Historical Purchases
Legacy Trial Balance
```

# 174. Journal Import Safety

```text
Balanced Entry
Valid Accounts
Valid Period
Valid Currency
Valid Branch
Valid Dimensions
No Duplicate Reference
```

# 175. Onboarding Migration Wizard

```text
Customers
↓
Suppliers
↓
Products
↓
Inventory
↓
Customer Balances
↓
Supplier Balances
↓
Cash & Banks
↓
Opening Capital
↓
Reconciliation
↓
Ready to Start
```

# 176. Migration Readiness Gate

الشركة لا تعتبر Accounting Ready حتى تمر:

```text
Trial Balance Balanced
AR Reconciled
AP Reconciled
Inventory Reconciled
Opening Equity Validated
```

# 177. Import Audit

```text
DATA_IMPORT_STARTED
DATA_IMPORT_COMPLETED
DATA_IMPORT_FAILED
DATA_IMPORT_ROLLED_BACK
```

# 178. Import Audit Metadata

```text
actorId
organizationId
importSessionId
importType
fileHash
rowsTotal
rowsImported
rowsFailed
createdAt
```

# 179. Excel Module Commercial Acceptance Criteria

يعتبر Excel Import/Export جاهزاً تجارياً عندما:

1. المستخدم يصدّر البيانات المسموحة فقط.
2. القيم الرقمية تخرج كـNumbers.
3. Full Company Export قابل للمطابقة مع SudaFlow.
4. كل Export حساس مسجل في Audit.
5. Import لا يكتب مباشرة قبل Validation.
6. Dry Run لا يغيّر Production Data.
7. Duplicate Detection يمنع التكرار غير المقصود.
8. Opening Balances تنشئ قيوداً متزنة.
9. Inventory Opening يطابق Inventory GL.
10. AR Opening يطابق AR GL.
11. AP Opening يطابق AP GL.
12. Undo لا يكسر التاريخ المالي.
13. الملفات الكبيرة تتم Server-side.
14. Import failures لا تترك Partial Financial State.
15. كل Import مالي يتبعه Reconciliation.

# 180. Excel Module Test Suites

```text
excelExport.spec
excelImport.spec
excelMapping.spec
excelValidation.spec
excelDuplicates.spec
excelOpeningBalances.spec
excelInventoryOpening.spec
excelRollback.spec
excelPermissions.spec
excelLargeJobs.spec
```

# 181. Excel Module Implementation Phases

## Excel Phase 1

```text
Quick Export
Customers Export
Suppliers Export
Products Export
Customers Import
Suppliers Import
Products Import
Templates
Column Mapping
Validation
Preview
```

## Excel Phase 2

```text
Accounting Export
Opening Inventory Import
Opening AR Import
Opening AP Import
Opening Cash & Banks
Opening Capital
Post-import Reconciliation
```

## Excel Phase 3

```text
Full Company Export
Accountant Package
Saved Export Presets
Large Export Jobs
Large Import Jobs
Import History
Export History
```

## Excel Phase 4

```text
Historical Invoice Import
Historical Purchase Import
Journal Import
Legacy Migration Package
Auditor Package
Scheduled Exports
```

# 182. Updated Commercial Readiness Requirement

قبل إطلاق SudaFlow كمنتج محاسبي تجاري، تعتبر:

```text
Excel Export
Data Portability
Safe Master-data Import
Safe Opening Balance Import
```

جزءاً من الجاهزية التجارية الأساسية.

# 183. Updated Next Engineering Step

الخطوة التالية:

```text
Accounting V2 Phase A Technical Design
+
Excel Import/Export Technical Design
```

وتشمل:

```text
Inventory Cost Schema
Supplier & Purchase Schema
Posting Rules
Account Classification
Excel Export Schema
Import Staging Schema
Import Job Model
File Hashing
Column Mapping
Validation Engine
Opening Balance Posting
Reconciliation Rules
Rollback Strategy
Permissions
Audit Events
Firestore Security
Automated Tests
```

