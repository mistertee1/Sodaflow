import type { Account, JournalEntry, JournalEntryLine, IncomeStatementSummary, Expense, Currency } from '../types';
import { safeAdd, safeSub, convertCurrency, validateExchangeRate } from '../lib/currency';
import { classifyAccount } from '../domain/accountClassification';
import { ledgerTrialBalance, ledgerIncomeStatement, ledgerBalanceSheet, ledgerCashFlow, type ReportPeriod } from '../domain/ledgerReports';
import { validateJournal } from '../domain/validation';

/**
 * Standard Chart of Accounts tailored for Sudanese merchants and businesses
 */
export const getDefaultChartOfAccounts = (orgId: string): Account[] => {
  const now = new Date().toISOString();
  return [
    { code: '3900', name_ar: 'مقابل الأرصدة الافتتاحية', name_en: 'Opening Balance Equity', type: 'EQUITY', nature: 'CREDIT', is_system: true, is_active: true, balance_sdg: 0, balance_usd: 0, org_id: orgId, created_at: now },
    { code: '5910', name_ar: 'فرق تكلفة مردود المشتريات', name_en: 'Purchase Return Cost Variance', type: 'EXPENSE', nature: 'DEBIT', reporting_group: 'operating_expense', is_system: true, is_active: true, balance_sdg: 0, balance_usd: 0, org_id: orgId, created_at: now },
    { code: '5900', name_ar: 'فروق تسوية المخزون', name_en: 'Inventory Adjustments', type: 'EXPENSE', nature: 'DEBIT', is_system: true, is_active: true, balance_sdg: 0, balance_usd: 0, org_id: orgId, created_at: now },
    { code: '2130', name_ar: 'ضريبة المبيعات المستحقة', name_en: 'Sales Tax Payable', type: 'LIABILITY', nature: 'CREDIT', is_system: true, is_active: true, balance_sdg: 0, balance_usd: 0, org_id: orgId, created_at: now },
    // 1000s: الأصول (ASSETS)
    {
      code: '1110',
      name_ar: 'النقدية بالخزينة - جنيه سوداني',
      name_en: 'Cash on Hand (SDG)',
      type: 'ASSET',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'السيولة النقدية المتوفرة في درج/خزينة المحل بالجنيه السوداني',
      created_at: now,
    },
    {
      code: '1120',
      name_ar: 'النقدية بالخزينة - دولار أمريكي',
      name_en: 'Cash on Hand (USD)',
      type: 'ASSET',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'السيولة النقدية المتوفرة بالعملة الأجنبية والدولار الأمريكي',
      created_at: now,
    },
    {
      code: '1130',
      name_ar: 'حساب تطبيق بنكك (بنك الخرطوم)',
      name_en: 'Bank of Khartoum (Bankak)',
      type: 'ASSET',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'الرصيد والحركات عبر تطبيق بنكك - بنك الخرطوم',
      created_at: now,
    },
    {
      code: '1140',
      name_ar: 'حساب تطبيق فوري (بنك فيصل)',
      name_en: 'Fawry - Faisal Islamic Bank',
      type: 'ASSET',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'الرصيد والحركات عبر تطبيق فوري - بنك فيصل الإسلامي',
      created_at: now,
    },
    {
      code: '1150',
      name_ar: 'تطبيق أوكاش / حسابات بنكية أخرى',
      name_en: 'O-Cash / Other Bank Accounts',
      type: 'ASSET',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'حسابات البنوك والتطبيقات المصرفية الأخرى (أوكاش، أمبير، إلخ)',
      created_at: now,
    },
    {
      code: '1200',
      name_ar: 'المدينون - ذمم العملاء',
      name_en: 'Accounts Receivable (Customers)',
      type: 'ASSET',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'المبالغ المستحقة على العملاء لقاء فواتير البيع الآجل (الديون)',
      created_at: now,
    },
    {
      code: '1300',
      name_ar: 'المخزون السلعي - بضاعة المحل',
      name_en: 'Merchandise Inventory',
      type: 'ASSET',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'قيمة البضائع والمنتجات المتاحة للبيع في المحل والمخازن',
      created_at: now,
    },

    // 2000s: الخصوم والالتزامات (LIABILITIES)
    {
      code: '2110',
      name_ar: 'الدائنون - ذمم الموردين',
      name_en: 'Accounts Payable (Suppliers)',
      type: 'LIABILITY',
      nature: 'CREDIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'المبالغ المستحقة للموردين وأصحاب البضائع',
      created_at: now,
    },
    {
      code: '2120',
      name_ar: 'أمانات ودفعات مقدمة من العملاء',
      name_en: 'Customer Prepayments',
      type: 'LIABILITY',
      nature: 'CREDIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'المبالغ المدفوعة مقدماً من العملاء قبل استلام البضائع',
      created_at: now,
    },

    { code: '2140', name_ar: 'مصروفات مستحقة غير مرتبطة بمورد', name_en: 'Accrued Operating Expenses', type: 'LIABILITY', nature: 'CREDIT', is_system: true, is_active: true, balance_sdg: 0, balance_usd: 0, org_id: orgId, created_at: now },

    // 3000s: حقوق الملكية (EQUITY)
    {
      code: '3100',
      name_ar: 'رأس مال المنشأة / التاجر',
      name_en: "Owner's Capital",
      type: 'EQUITY',
      nature: 'CREDIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'رأس المال الأساسي المستثمر في النشاط التجاري',
      created_at: now,
    },
    {
      code: '3200',
      name_ar: 'جاري صاحب العمل / المسحوبات الشخصية',
      name_en: "Owner's Drawings",
      type: 'EQUITY',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'مسحوبات المالك الشخصية من الخزينة أو البنك',
      created_at: now,
    },
    {
      code: '3300',
      name_ar: 'الأرباح المحتجزة / المتراكمة',
      name_en: 'Retained Earnings',
      type: 'EQUITY',
      nature: 'CREDIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'صافي الأرباح المحققة المتراكمة من الفترات المالية السابقة',
      created_at: now,
    },

    // 4000s: الإيرادات (REVENUES)
    {
      code: '4100',
      name_ar: 'إيرادات مبيعات البضائع والمنتجات',
      name_en: 'Sales Revenue',
      type: 'REVENUE',
      nature: 'CREDIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'إجمالي المبيعات المحققة من الفواتير والعمليات التجارية',
      created_at: now,
    },
    {
      code: '4200',
      name_ar: 'أرباح فروق أسعار الصرف (FX Gain)',
      name_en: 'Realized FX Gain',
      type: 'REVENUE',
      nature: 'CREDIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'الأرباح الناتجة عن فروق أسعار صرف العملات الأجنبية',
      created_at: now,
    },
    {
      code: '4300',
      name_ar: 'إيرادات أخرى وخصومات مكتسبة',
      name_en: 'Other Revenue',
      type: 'REVENUE',
      nature: 'CREDIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'أي إيرادات إضافية أو خصومات ممنوحة من الموردين',
      created_at: now,
    },
    { code: '4210', name_ar: 'أرباح إعادة تقييم العملة غير المحققة', name_en: 'Unrealized FX Gain', type: 'REVENUE', nature: 'CREDIT', is_system: true, is_active: true, balance_sdg: 0, balance_usd: 0, org_id: orgId, description: 'فروق إعادة تقييم الأرصدة النقدية الأجنبية بسعر إقفال معتمد', created_at: now },

    // 5000s: المصروفات (EXPENSES)
    {
      code: '5100',
      name_ar: 'تكلفة البضاعة المباعة (COGS)',
      name_en: 'Cost of Goods Sold',
      type: 'EXPENSE',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'تكلفة شراء وتوفير المنتجات التي تم بيعها للعملاء',
      created_at: now,
    },
    {
      code: '5200',
      name_ar: 'إيجار المحل والمخازن',
      name_en: 'Rent Expense',
      type: 'EXPENSE',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'إيجارات مقرات العمل والمتاجر والمستودعات',
      created_at: now,
    },
    {
      code: '5300',
      name_ar: 'الرواتب والأجور والعمالة',
      name_en: 'Salaries & Wages',
      type: 'EXPENSE',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'رواتب الموظفين والعمالة اليومية والبدلات',
      created_at: now,
    },
    {
      code: '5400',
      name_ar: 'مصاريف الترحيل والشحن والنقل',
      name_en: 'Shipping & Transportation',
      type: 'EXPENSE',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'تكاليف نقل البضائع والشحن بين الولايات والتوصيل',
      created_at: now,
    },
    {
      code: '5500',
      name_ar: 'خسائر فروق أسعار الصرف (FX Loss)',
      name_en: 'Realized FX Loss',
      type: 'EXPENSE',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'الخسائر الناتجة عن تذبذب وانخفاض أسعار صرف العملات',
      created_at: now,
    },
    {
      code: '5600',
      name_ar: 'رسوم وعمولات التحويلات البنكية (بنكك/فوري)',
      name_en: 'Bank & App Transfer Fees',
      type: 'EXPENSE',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'رسوم التحويلات عبر تطبيق بنكك وفوري وعمولات السحب',
      created_at: now,
    },
    { code: '5510', name_ar: 'خسائر إعادة تقييم العملة غير المحققة', name_en: 'Unrealized FX Loss', type: 'EXPENSE', nature: 'DEBIT', is_system: true, is_active: true, balance_sdg: 0, balance_usd: 0, org_id: orgId, description: 'فروق إعادة تقييم الأرصدة النقدية الأجنبية بسعر إقفال معتمد', created_at: now },
    {
      code: '5700',
      name_ar: 'فواتير الكهرباء والمياه والإنترنت',
      name_en: 'Utilities & Internet',
      type: 'EXPENSE',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'مصاريف تشغيل الكهرباء، باقات الإنترنت، وتزويد الوقود للمولدات',
      created_at: now,
    },
    {
      code: '5800',
      name_ar: 'صيانة ومصروفات تشغيلية متنوعة',
      name_en: 'Maintenance & General Expenses',
      type: 'EXPENSE',
      nature: 'DEBIT',
      is_system: true,
      is_active: true,
      balance_sdg: 0,
      balance_usd: 0,
      org_id: orgId,
      description: 'أي مصروفات نثرية أو صيانة دورية لأجهزة ومعدات المحل',
      created_at: now,
    },
  ].map(account => ({ ...account, ...classifyAccount(account as Account) })) as Account[];
};

/**
 * Determine the asset account code for a given payment method
 */
export const getAccountCodeForPaymentMethod = (method: string, currency: Currency): string => {
  switch (method) {
    case 'bankak':
      return '1130';
    case 'fawry':
      return '1140';
    case 'other':
    case 'bank_transfer':
      return '1150';
    case 'cash':
    default:
      return currency === 'USD' ? '1120' : '1110';
  }
};

/**
 * Map expense category to expense account code
 */
export const getAccountCodeForExpenseCategory = (category: string): string => {
  const cat = (category || '').toLowerCase();
  if (cat.includes('إيجار') || cat.includes('ايجار') || cat.includes('rent')) return '5200';
  if (cat.includes('رواتب') || cat.includes('أجور') || cat.includes('اجور') || cat.includes('عمال') || cat.includes('salary'))
    return '5300';
  if (cat.includes('نقل') || cat.includes('ترحيل') || cat.includes('شحن') || cat.includes('transport') || cat.includes('shipping'))
    return '5400';
  if (cat.includes('بنك') || cat.includes('عمولة') || cat.includes('رسوم') || cat.includes('تحويل') || cat.includes('fee'))
    return '5600';
  if (cat.includes('كهرباء') || cat.includes('ماء') || cat.includes('إنترنت') || cat.includes('نت') || cat.includes('وقود') || cat.includes('utility'))
    return '5700';
  return '5800';
};

/**
 * Validate that a journal entry's debits equal its credits within floating tolerance
 */
export const validateJournalEntryBalance = (lines: JournalEntryLine[]): { isValid: boolean; diffSdg: number; diffUsd: number } => {
  const diffSdg = Math.abs(lines.reduce((sum, l) => safeAdd(sum, l.debit_sdg || 0, 0), 0) - lines.reduce((sum, l) => safeAdd(sum, l.credit_sdg || 0, 0), 0));
  const diffUsd = Math.abs(safeSub(lines.reduce((sum, l) => safeAdd(sum, l.debit_usd || 0, 2), 0), lines.reduce((sum, l) => safeAdd(sum, l.credit_usd || 0, 2), 0), 2));
  try { validateJournal(lines); return { isValid: true, diffSdg, diffUsd }; }
  catch { return { isValid: false, diffSdg, diffUsd }; }
};

/**
 * Automatically generate a double-entry Journal Voucher for an Expense
 */
export const generateExpenseJournalEntry = (
  expense: Expense,
  orgId: string,
  actorUid?: string
): JournalEntry => {
  const now = new Date().toISOString();
  const entryId = `jv-exp-${expense.id}`;

  let amountSdg = 0;
  let amountUsd = 0;
  let rateUsed = expense.exchange_rate_used;

  if (expense.currency === 'USD') {
    amountUsd = safeAdd(expense.amount, 0, 2);
    const rateVal = validateExchangeRate(expense.exchange_rate_used);
    if (!rateVal.isValid || !rateVal.rate) {
      throw new Error('تسجيل المصروف بالدولار يتطلب تحديد سعر صرف صالح.');
    }
    rateUsed = rateVal.rate;
    amountSdg = convertCurrency(amountUsd, 'USD', 'SDG', rateUsed, { sdg_decimals: 0 });
  } else {
    amountSdg = safeAdd(expense.amount, 0, 0);
    if (expense.exchange_rate_used && expense.exchange_rate_used > 0) {
      amountUsd = convertCurrency(amountSdg, 'SDG', 'USD', expense.exchange_rate_used, { usd_decimals: 2 });
    } else {
      amountUsd = 0;
    }
  }

  const expAccountCode = expense.expense_account_code || getAccountCodeForExpenseCategory(expense.category);
  const cashAccountCode = expense.payment_account_code || (expense.payment_method === 'on_credit' ? '2110' : getAccountCodeForPaymentMethod(expense.payment_method || 'cash', expense.currency));

  const lines: JournalEntryLine[] = [
    // Dr: Expense
    {
      id: `line-${Date.now()}-1`,
      account_code: expAccountCode,
      account_name: `مصروفات - ${expense.category || expense.title}`,
      debit_sdg: amountSdg,
      credit_sdg: 0,
      debit_usd: amountUsd,
      credit_usd: 0,
      notes: expense.notes || expense.title,
    },
    // Cr: Cash / Treasury
    {
      id: `line-${Date.now()}-2`,
      account_code: cashAccountCode,
      account_name: expense.payment_method === 'on_credit' ? 'ذمم دائنة للمصروفات' : 'حساب سداد المصروف',
      debit_sdg: 0,
      credit_sdg: amountSdg,
      debit_usd: 0,
      credit_usd: amountUsd,
      notes: `سداد / استحقاق لـ: ${expense.title}`,
    },
  ];

  return {
    id: entryId,
    entry_number: `JV-EXP-${expense.id.substring(expense.id.length - 6)}`,
    date: expense.date || now,
    reference_type: 'expense',
    reference_id: expense.id,
    description: `قيد إثبات مصروف: ${expense.title} (${expense.category})`,
    lines,
    total_debit_sdg: amountSdg,
    total_credit_sdg: amountSdg,
    total_debit_usd: amountUsd,
    total_credit_usd: amountUsd,
    is_balanced: true,
    exchange_rate_used: rateUsed || 0,
    org_id: orgId,
    created_by: actorUid,
    created_at: now,
  };
};

/** Ledger reports ignore balance caches; openings are journal movements. */
export const calculateTrialBalance = ledgerTrialBalance;
export const calculateIncomeStatement = (entries: JournalEntry[], accounts: Account[] = getDefaultChartOfAccounts(''), period: ReportPeriod = {}): IncomeStatementSummary => ledgerIncomeStatement(accounts, entries, period);
export const calculateBalanceSheet = ledgerBalanceSheet;
export const calculateCashFlowStatement = ledgerCashFlow;
