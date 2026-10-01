import {
  Account,
  AccountCategory,
  AccountNature,
  JournalEntry,
  JournalEntryLine,
  TrialBalanceItem,
  IncomeStatementSummary,
  BalanceSheetSummary,
  BalanceSheetItem,
  CashFlowSummary,
  Invoice,
  Payment,
  Expense,
  Currency,
} from '../types';
import {
  safeAdd,
  safeSub,
  safeMul,
  safeDiv,
  safeEqual,
  convertCurrency,
  validateExchangeRate,
  applyRounding,
} from '../lib/currency';
import { validateJournal } from '../domain/validation';

/**
 * Standard Chart of Accounts tailored for Sudanese merchants and businesses
 */
export const getDefaultChartOfAccounts = (orgId: string): Account[] => {
  const now = new Date().toISOString();
  return [
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
  ];
};

/**
 * Determine the asset account code for a given payment method
 */
export const getAccountCodeForPaymentMethod = (method: string, currency: Currency): string => {
  if (currency === 'USD') return '1120'; // Cash USD
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
      return '1110';
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

  const expAccountCode = getAccountCodeForExpenseCategory(expense.category);
  const cashAccountCode = expense.currency === 'USD' ? '1120' : '1110';

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
      account_name: expense.currency === 'USD' ? 'النقدية بالخزينة - دولار' : 'النقدية بالخزينة - جنيه',
      debit_sdg: 0,
      credit_sdg: amountSdg,
      debit_usd: 0,
      credit_usd: amountUsd,
      notes: `صرف نقدي لـ: ${expense.title}`,
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

/**
 * Compute Trial Balance (ميزان المراجعة) from Chart of Accounts and Journal Entries
 */
export const calculateTrialBalance = (
  accounts: Account[],
  entries: JournalEntry[]
): {
  items: TrialBalanceItem[];
  totalDebitSdg: number;
  totalCreditSdg: number;
  totalDebitUsd: number;
  totalCreditUsd: number;
  isBalanced: boolean;
} => {
  const map: Record<string, TrialBalanceItem> = {};

  // Initialize from accounts
  for (const acc of accounts) {
    map[acc.code] = {
      account_code: acc.code,
      account_name: acc.name_ar,
      type: acc.type,
      nature: acc.nature,
      opening_balance_sdg: acc.balance_sdg || 0,
      total_debit_sdg: 0,
      total_credit_sdg: 0,
      net_balance_sdg: 0,
      opening_balance_usd: acc.balance_usd || 0,
      total_debit_usd: 0,
      total_credit_usd: 0,
      net_balance_usd: 0,
    };
  }

  // Accumulate movements from journal entries
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (!map[line.account_code]) {
        map[line.account_code] = {
          account_code: line.account_code,
          account_name: line.account_name,
          type: line.account_code.startsWith('1')
            ? 'ASSET'
            : line.account_code.startsWith('2')
            ? 'LIABILITY'
            : line.account_code.startsWith('3')
            ? 'EQUITY'
            : line.account_code.startsWith('4')
            ? 'REVENUE'
            : 'EXPENSE',
          nature: line.account_code.startsWith('1') || line.account_code.startsWith('5') ? 'DEBIT' : 'CREDIT',
          opening_balance_sdg: 0,
          total_debit_sdg: 0,
          total_credit_sdg: 0,
          net_balance_sdg: 0,
          opening_balance_usd: 0,
          total_debit_usd: 0,
          total_credit_usd: 0,
          net_balance_usd: 0,
        };
      }

      map[line.account_code].total_debit_sdg = safeAdd(map[line.account_code].total_debit_sdg, line.debit_sdg || 0, 0);
      map[line.account_code].total_credit_sdg = safeAdd(map[line.account_code].total_credit_sdg, line.credit_sdg || 0, 0);
      map[line.account_code].total_debit_usd = safeAdd(map[line.account_code].total_debit_usd, line.debit_usd || 0, 2);
      map[line.account_code].total_credit_usd = safeAdd(map[line.account_code].total_credit_usd, line.credit_usd || 0, 2);
    }
  }

  // Calculate net balance according to natural balance
  const items: TrialBalanceItem[] = Object.values(map).map((item) => {
    let netSdg = 0;
    let netUsd = 0;
    if (item.nature === 'DEBIT') {
      netSdg = safeSub(safeAdd(item.opening_balance_sdg, item.total_debit_sdg, 0), item.total_credit_sdg, 0);
      netUsd = safeSub(safeAdd(item.opening_balance_usd, item.total_debit_usd, 2), item.total_credit_usd, 2);
    } else {
      netSdg = safeSub(safeAdd(item.opening_balance_sdg, item.total_credit_sdg, 0), item.total_debit_sdg, 0);
      netUsd = safeSub(safeAdd(item.opening_balance_usd, item.total_credit_usd, 2), item.total_debit_usd, 2);
    }

    return {
      ...item,
      net_balance_sdg: netSdg,
      net_balance_usd: netUsd,
    };
  });

  // Sort by code
  items.sort((a, b) => a.account_code.localeCompare(b.account_code));

  const totalDebitSdg = items.reduce((s, i) => safeAdd(s, i.total_debit_sdg, 0), 0);
  const totalCreditSdg = items.reduce((s, i) => safeAdd(s, i.total_credit_sdg, 0), 0);
  const totalDebitUsd = items.reduce((s, i) => safeAdd(s, i.total_debit_usd, 2), 0);
  const totalCreditUsd = items.reduce((s, i) => safeAdd(s, i.total_credit_usd, 2), 0);

  const isBalanced = safeEqual(totalDebitSdg, totalCreditSdg, 0) && safeEqual(totalDebitUsd, totalCreditUsd, 2);

  return {
    items,
    totalDebitSdg,
    totalCreditSdg,
    totalDebitUsd,
    totalCreditUsd,
    isBalanced,
  };
};

/**
 * Compute Income Statement (قائمة الدخل / الأرباح والخسائر)
 */
export const calculateIncomeStatement = (entries: JournalEntry[]): IncomeStatementSummary => {
  let salesSdg = 0;
  let salesUsd = 0;
  let cogsSdg = 0;
  let cogsUsd = 0;
  let expSdg = 0;
  let expUsd = 0;
  let fxGainSdg = 0;
  let fxGainUsd = 0;
  let fxLossSdg = 0;
  let fxLossUsd = 0;

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.account_code.startsWith('4100')) {
        salesSdg = safeAdd(salesSdg, safeSub(line.credit_sdg || 0, line.debit_sdg || 0, 0), 0);
        salesUsd = safeAdd(salesUsd, safeSub(line.credit_usd || 0, line.debit_usd || 0, 2), 2);
      } else if (line.account_code.startsWith('5100')) {
        cogsSdg = safeAdd(cogsSdg, safeSub(line.debit_sdg || 0, line.credit_sdg || 0, 0), 0);
        cogsUsd = safeAdd(cogsUsd, safeSub(line.debit_usd || 0, line.credit_usd || 0, 2), 2);
      } else if (line.account_code.startsWith('4200')) {
        fxGainSdg = safeAdd(fxGainSdg, safeSub(line.credit_sdg || 0, line.debit_sdg || 0, 0), 0);
        fxGainUsd = safeAdd(fxGainUsd, safeSub(line.credit_usd || 0, line.debit_usd || 0, 2), 2);
      } else if (line.account_code.startsWith('5500')) {
        fxLossSdg = safeAdd(fxLossSdg, safeSub(line.debit_sdg || 0, line.credit_sdg || 0, 0), 0);
        fxLossUsd = safeAdd(fxLossUsd, safeSub(line.debit_usd || 0, line.credit_usd || 0, 2), 2);
      } else if (line.account_code.startsWith('5')) {
        expSdg = safeAdd(expSdg, safeSub(line.debit_sdg || 0, line.credit_sdg || 0, 0), 0);
        expUsd = safeAdd(expUsd, safeSub(line.debit_usd || 0, line.credit_usd || 0, 2), 2);
      }
    }
  }

  const grossProfitSdg = safeSub(salesSdg, cogsSdg, 0);
  const grossProfitUsd = safeSub(salesUsd, cogsUsd, 2);
  const netOperatingProfitSdg = safeSub(grossProfitSdg, expSdg, 0);
  const netOperatingProfitUsd = safeSub(grossProfitUsd, expUsd, 2);
  const netFxSdg = safeSub(fxGainSdg, fxLossSdg, 0);
  const netFxUsd = safeSub(fxGainUsd, fxLossUsd, 2);
  const netProfitSdg = safeAdd(netOperatingProfitSdg, netFxSdg, 0);
  const netProfitUsd = safeAdd(netOperatingProfitUsd, netFxUsd, 2);

  return {
    sales_revenue_sdg: salesSdg,
    sales_revenue_usd: salesUsd,
    cogs_sdg: cogsSdg,
    cogs_usd: cogsUsd,
    gross_profit_sdg: grossProfitSdg,
    gross_profit_usd: grossProfitUsd,
    total_operating_expenses_sdg: expSdg,
    total_operating_expenses_usd: expUsd,
    net_operating_profit_sdg: netOperatingProfitSdg,
    net_operating_profit_usd: netOperatingProfitUsd,
    fx_gain_loss_sdg: netFxSdg,
    fx_gain_loss_usd: netFxUsd,
    net_profit_sdg: netProfitSdg,
    net_profit_usd: netProfitUsd,
  };
};

/**
 * Compute Balance Sheet (الميزانية العمومية / المركز المالي)
 * Formula: Total Assets = Total Liabilities + Total Equity
 */
export const calculateBalanceSheet = (
  accounts: Account[],
  entries: JournalEntry[]
): BalanceSheetSummary => {
  const trial = calculateTrialBalance(accounts, entries);
  const income = calculateIncomeStatement(entries);

  const assets: BalanceSheetItem[] = [];
  const liabilities: BalanceSheetItem[] = [];
  const equityItems: BalanceSheetItem[] = [];

  let totalAssetsSdg = 0;
  let totalAssetsUsd = 0;
  let totalLiabilitiesSdg = 0;
  let totalLiabilitiesUsd = 0;
  let totalEquitySdg = 0;
  let totalEquityUsd = 0;

  for (const item of trial.items) {
    if (item.type === 'ASSET') {
      if (Math.abs(item.net_balance_sdg) > 0.01 || Math.abs(item.net_balance_usd) > 0.01) {
        assets.push({
          code: item.account_code,
          name: item.account_name,
          amount_sdg: item.net_balance_sdg,
          amount_usd: item.net_balance_usd,
          account_code: item.account_code,
          account_name: item.account_name,
          balance_sdg: item.net_balance_sdg,
          balance_usd: item.net_balance_usd,
        });
        totalAssetsSdg = safeAdd(totalAssetsSdg, item.net_balance_sdg, 0);
        totalAssetsUsd = safeAdd(totalAssetsUsd, item.net_balance_usd, 2);
      }
    } else if (item.type === 'LIABILITY') {
      if (Math.abs(item.net_balance_sdg) > 0.01 || Math.abs(item.net_balance_usd) > 0.01) {
        liabilities.push({
          code: item.account_code,
          name: item.account_name,
          amount_sdg: item.net_balance_sdg,
          amount_usd: item.net_balance_usd,
          account_code: item.account_code,
          account_name: item.account_name,
          balance_sdg: item.net_balance_sdg,
          balance_usd: item.net_balance_usd,
        });
        totalLiabilitiesSdg = safeAdd(totalLiabilitiesSdg, item.net_balance_sdg, 0);
        totalLiabilitiesUsd = safeAdd(totalLiabilitiesUsd, item.net_balance_usd, 2);
      }
    } else if (item.type === 'EQUITY') {
      if (Math.abs(item.net_balance_sdg) > 0.01 || Math.abs(item.net_balance_usd) > 0.01) {
        equityItems.push({
          code: item.account_code,
          name: item.account_name,
          amount_sdg: item.net_balance_sdg,
          amount_usd: item.net_balance_usd,
          account_code: item.account_code,
          account_name: item.account_name,
          balance_sdg: item.net_balance_sdg,
          balance_usd: item.net_balance_usd,
        });
        totalEquitySdg = safeAdd(totalEquitySdg, item.net_balance_sdg, 0);
        totalEquityUsd = safeAdd(totalEquityUsd, item.net_balance_usd, 2);
      }
    }
  }

  // Current period net profit flows into equity
  const currentProfitSdg = income.net_profit_sdg;
  const currentProfitUsd = income.net_profit_usd;
  totalEquitySdg = safeAdd(totalEquitySdg, currentProfitSdg, 0);
  totalEquityUsd = safeAdd(totalEquityUsd, currentProfitUsd, 2);

  const totalLiabAndEquitySdg = safeAdd(totalLiabilitiesSdg, totalEquitySdg, 0);
  const totalLiabAndEquityUsd = safeAdd(totalLiabilitiesUsd, totalEquityUsd, 2);
  const varianceSdg = Math.abs(safeSub(totalAssetsSdg, totalLiabAndEquitySdg, 0));
  const isBalanced = safeEqual(totalAssetsSdg, totalLiabAndEquitySdg, 0);

  return {
    assets,
    total_assets_sdg: totalAssetsSdg,
    total_assets_usd: totalAssetsUsd,
    liabilities,
    total_liabilities_sdg: totalLiabilitiesSdg,
    total_liabilities_usd: totalLiabilitiesUsd,
    equity_items: equityItems,
    equity: equityItems,
    current_period_profit_sdg: currentProfitSdg,
    current_period_profit_usd: currentProfitUsd,
    total_equity_sdg: totalEquitySdg,
    total_equity_usd: totalEquityUsd,
    total_liabilities_and_equity_sdg: totalLiabAndEquitySdg,
    total_liabilities_and_equity_usd: totalLiabAndEquityUsd,
    is_balanced: isBalanced,
    variance_sdg: varianceSdg,
    difference_sdg: varianceSdg,
  };
};

/**
 * Compute Cash Flow Statement (قائمة التدفقات النقدية)
 * Categorized into Operating, Investing, and Financing
 */
export const calculateCashFlowStatement = (
  accounts: Account[],
  entries: JournalEntry[]
): CashFlowSummary => {
  let operatingInflowSdg = 0, operatingInflowUsd = 0, operatingOutflowSdg = 0, operatingOutflowUsd = 0;
  let financingInflowSdg = 0, financingInflowUsd = 0, financingOutflowSdg = 0, financingOutflowUsd = 0;
  let investingSdg = 0, investingUsd = 0;
  for (const entry of entries) {
    const cashLines = entry.lines.filter(l => l.account_code.startsWith('11'));
    const cashSdg = cashLines.reduce((sum, l) => safeAdd(sum, safeSub(l.debit_sdg, l.credit_sdg, 0), 0), 0);
    const cashUsd = cashLines.reduce((sum, l) => safeAdd(sum, safeSub(l.debit_usd, l.credit_usd, 2), 2), 0);
    const otherLines = entry.lines.filter(l => !l.account_code.startsWith('11'));
    if (otherLines.some(l => l.account_code.startsWith('3') || l.account_code.startsWith('22'))) {
      financingInflowSdg = safeAdd(financingInflowSdg, Math.max(0, cashSdg), 0);
      financingOutflowSdg = safeAdd(financingOutflowSdg, Math.max(0, -cashSdg), 0);
      financingInflowUsd = safeAdd(financingInflowUsd, Math.max(0, cashUsd), 2);
      financingOutflowUsd = safeAdd(financingOutflowUsd, Math.max(0, -cashUsd), 2);
    } else if (otherLines.some(l => l.account_code.startsWith('14') || l.account_code.startsWith('15'))) {
      investingSdg = safeAdd(investingSdg, cashSdg, 0); investingUsd = safeAdd(investingUsd, cashUsd, 2);
    } else {
      operatingInflowSdg = safeAdd(operatingInflowSdg, Math.max(0, cashSdg), 0);
      operatingOutflowSdg = safeAdd(operatingOutflowSdg, Math.max(0, -cashSdg), 0);
      operatingInflowUsd = safeAdd(operatingInflowUsd, Math.max(0, cashUsd), 2);
      operatingOutflowUsd = safeAdd(operatingOutflowUsd, Math.max(0, -cashUsd), 2);
    }
  }

  const netOperatingSdg = operatingInflowSdg - operatingOutflowSdg;
  const netOperatingUsd = operatingInflowUsd - operatingOutflowUsd;

  const netFinancingSdg = financingInflowSdg - financingOutflowSdg;
  const netFinancingUsd = financingInflowUsd - financingOutflowUsd;

  const netChangeSdg = safeAdd(safeAdd(netOperatingSdg, netFinancingSdg, 0), investingSdg, 0);
  const netChangeUsd = safeAdd(safeAdd(netOperatingUsd, netFinancingUsd, 2), investingUsd, 2);

  let beginningCashSdg = 0;
  let beginningCashUsd = 0;
  for (const acc of accounts) {
    if (acc.code.startsWith('11')) {
      beginningCashSdg += acc.balance_sdg || 0;
      beginningCashUsd += acc.balance_usd || 0;
    }
  }

  const endingCashSdg = beginningCashSdg + netChangeSdg;
  const endingCashUsd = beginningCashUsd + netChangeUsd;

  return {
    operating_activities: [
      {
        title: 'المقبوضات النقدية المحصلة من العملاء وفواتير المبيعات',
        amount_sdg: operatingInflowSdg,
        amount_usd: operatingInflowUsd,
      },
      {
        title: 'المدفوعات النقدية للمصروفات التشغيلية والعمومية',
        amount_sdg: -operatingOutflowSdg,
        amount_usd: -operatingOutflowUsd,
      },
    ],
    net_cash_operating_sdg: netOperatingSdg,
    net_cash_operating_usd: netOperatingUsd,
    net_operating_sdg: netOperatingSdg,
    net_operating_usd: netOperatingUsd,
    operating_inflows_sdg: operatingInflowSdg,
    operating_outflows_sdg: operatingOutflowSdg,

    investing_activities: [{ title: 'صافي النقد المرتبط بالأصول طويلة الأجل', amount_sdg: investingSdg, amount_usd: investingUsd }],
    net_cash_investing_sdg: investingSdg,
    net_cash_investing_usd: investingUsd,
    net_investing_sdg: investingSdg,
    net_investing_usd: investingUsd,

    financing_activities: [
      {
        title: 'إيداعات رأس المال والمساهمات التمويلية',
        amount_sdg: financingInflowSdg,
        amount_usd: financingInflowUsd,
      },
      {
        title: 'مسحوبات صاحب العمل والشركاء',
        amount_sdg: -financingOutflowSdg,
        amount_usd: -financingOutflowUsd,
      },
    ],
    net_cash_financing_sdg: netFinancingSdg,
    net_cash_financing_usd: netFinancingUsd,
    net_financing_sdg: netFinancingSdg,
    net_financing_usd: netFinancingUsd,

    net_change_in_cash_sdg: netChangeSdg,
    net_change_in_cash_usd: netChangeUsd,

    beginning_cash_sdg: beginningCashSdg,
    beginning_cash_usd: beginningCashUsd,
    ending_cash_sdg: endingCashSdg,
    ending_cash_usd: endingCashUsd,
  };
};
