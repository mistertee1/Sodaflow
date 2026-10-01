import BigNumber from 'bignumber.js';
import { Currency, MerchantSettings } from '../types';

// Configure BigNumber global precision defaults for financial engine
BigNumber.config({
  DECIMAL_PLACES: 20,
  ROUNDING_MODE: BigNumber.ROUND_HALF_UP,
  EXPONENTIAL_AT: [-10, 20],
});

export const DEFAULT_SETTINGS: MerchantSettings = {
  business_name: 'متجر السلام للتجارة',
  phone: '0912345678',
  address: 'الخرطوم / بورتسودان',
  bank_details: 'بنك الخرطوم (بنكك): 1234567 - باسم: متجر السلام',
  default_exchange_rate: 0, // No hardcoded exchange rate; must be explicitly configured by organization
  primary_currency: 'SDG',
  secondary_currency: 'USD',
  currencies_configured: false,
  sdg_decimals: 0,
  usd_decimals: 2,
  rounding_rule: 'round',
  invoice_prefix: 'INV-',
  default_invoice_notes: 'شكرًا لتعاملكم معنا. يُرجى سداد المبلغ في الموعد المحدد.',
};

/**
 * Validates whether an exchange rate is an explicit, positive, finite, and reasonable number.
 */
export function validateExchangeRate(rate: any): { isValid: boolean; error?: string; rate?: number } {
  if (rate === null || rate === undefined || rate === '' || Number.isNaN(Number(rate))) {
    return { isValid: false, error: 'سعر الصرف مطلوب وغير محدد.' };
  }
  const num = Number(rate);
  if (!Number.isFinite(num)) {
    return { isValid: false, error: 'سعر الصرف يجب أن يكون رقماً محدوداً.' };
  }
  if (num <= 0) {
    return { isValid: false, error: 'سعر الصرف يجب أن يكون رقماً موجباً أكبر من الصفر.' };
  }
  if (num > 10_000_000_000) {
    return { isValid: false, error: 'سعر الصرف يتجاوز الحد المالي المقبول.' };
  }
  return { isValid: true, rate: num };
}

/**
 * Map rounding rule string to BigNumber rounding mode
 */
function getBnRoundingMode(rule: 'round' | 'ceil' | 'floor' = 'round'): BigNumber.RoundingMode {
  if (rule === 'ceil') return BigNumber.ROUND_CEIL;
  if (rule === 'floor') return BigNumber.ROUND_FLOOR;
  return BigNumber.ROUND_HALF_UP;
}

/**
 * Deterministically rounds a number according to the merchant's rounding rules and decimal places
 */
export function applyRounding(
  val: number | string | BigNumber,
  decimals: number = 2,
  rule: 'round' | 'ceil' | 'floor' = 'round'
): number {
  const bn = new BigNumber(val ?? 0);
  if (!bn.isFinite()) return 0;
  const mode = getBnRoundingMode(rule);
  return Number(bn.toFixed(Math.max(0, decimals), mode));
}

/**
 * Scale amount to integer minor units (cents / milliunits) to prevent floating-point drift
 */
export function toMinorUnits(amount: number | string, decimals: number): number {
  const factor = new BigNumber(10).pow(Math.max(0, decimals));
  const bn = new BigNumber(amount ?? 0).times(factor);
  return Number(bn.toFixed(0, BigNumber.ROUND_HALF_UP));
}

/**
 * Convert integer minor units back to decimal currency
 */
export function fromMinorUnits(units: number | string, decimals: number): number {
  const factor = new BigNumber(10).pow(Math.max(0, decimals));
  const bn = new BigNumber(units ?? 0).dividedBy(factor);
  return Number(bn.toFixed(Math.max(0, decimals), BigNumber.ROUND_HALF_UP));
}

/**
 * Safe deterministic addition with arbitrary decimal precision
 */
export function safeAdd(
  a: number | string,
  b: number | string,
  decimals: number = 2,
  rule: 'round' | 'ceil' | 'floor' = 'round'
): number {
  const bnA = new BigNumber(a ?? 0);
  const bnB = new BigNumber(b ?? 0);
  const sum = bnA.plus(bnB);
  return applyRounding(sum, decimals, rule);
}

/**
 * Safe deterministic subtraction with arbitrary decimal precision
 */
export function safeSub(
  a: number | string,
  b: number | string,
  decimals: number = 2,
  rule: 'round' | 'ceil' | 'floor' = 'round'
): number {
  const bnA = new BigNumber(a ?? 0);
  const bnB = new BigNumber(b ?? 0);
  const diff = bnA.minus(bnB);
  return applyRounding(diff, decimals, rule);
}

/**
 * Safe deterministic multiplication with arbitrary decimal precision
 */
export function safeMul(
  a: number | string,
  b: number | string,
  decimals: number = 2,
  rule: 'round' | 'ceil' | 'floor' = 'round'
): number {
  const bnA = new BigNumber(a ?? 0);
  const bnB = new BigNumber(b ?? 0);
  const prod = bnA.times(bnB);
  return applyRounding(prod, decimals, rule);
}

/**
 * Safe deterministic division with arbitrary decimal precision and zero-divisor guarding
 */
export function safeDiv(
  a: number | string,
  b: number | string,
  decimals: number = 2,
  rule: 'round' | 'ceil' | 'floor' = 'round'
): number {
  const bnB = new BigNumber(b ?? 0);
  if (bnB.isZero() || !bnB.isFinite()) return 0;
  const bnA = new BigNumber(a ?? 0);
  const quot = bnA.dividedBy(bnB);
  return applyRounding(quot, decimals, rule);
}

/**
 * Safe percentage calculation: base * percent / 100
 */
export function safePercentage(
  base: number | string,
  percent: number | string,
  decimals: number = 2,
  rule: 'round' | 'ceil' | 'floor' = 'round'
): number {
  const bnBase = new BigNumber(base ?? 0);
  const bnPct = new BigNumber(percent ?? 0);
  const val = bnBase.times(bnPct).dividedBy(100);
  return applyRounding(val, decimals, rule);
}

/**
 * Compare two financial amounts under defined decimal precision
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function safeCompare(a: number | string, b: number | string, decimals: number = 2): -1 | 0 | 1 {
  const bnA = new BigNumber(applyRounding(a, decimals));
  const bnB = new BigNumber(applyRounding(b, decimals));
  return bnA.comparedTo(bnB) as -1 | 0 | 1;
}

/**
 * Check if two financial amounts are strictly equal under defined decimal precision
 */
export function safeEqual(a: number | string, b: number | string, decimals: number = 2): boolean {
  return safeCompare(a, b, decimals) === 0;
}

/**
 * Returns the localized or standard currency symbol for any currency code
 */
export function getCurrencySymbol(currency: Currency | string): string {
  switch (currency) {
    case 'SDG':
      return 'ج.س';
    case 'USD':
      return '$';
    case 'SAR':
      return 'ر.س';
    case 'AED':
      return 'د.إ';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'EGP':
      return 'ج.م';
    default:
      return currency || '';
  }
}

/**
 * Format money as one LTR unit with an explicit currency code (manual p. 8).
 * The institution's precision and rounding settings remain authoritative.
 */
export function formatMoney(
  amount: number | undefined | null,
  currency: Currency | string,
  settings?: Partial<MerchantSettings>
): string {
  const num = amount ?? 0;
  const decimals =
    currency === 'SDG'
      ? settings?.sdg_decimals ?? DEFAULT_SETTINGS.sdg_decimals
      : currency === 'USD'
      ? settings?.usd_decimals ?? DEFAULT_SETTINGS.usd_decimals
      : 2;

  const rule = settings?.rounding_rule ?? DEFAULT_SETTINGS.rounding_rule;
  const rounded = applyRounding(num, decimals, rule);

  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rounded);

  return `${formatted} ${currency}`.trim();
}

/**
 * Converts amount from one currency to another using the validated exchange rate
 * Throws explicit error if an exchange rate is required but invalid/missing
 */
export function convertCurrency(
  amount: number | string,
  from: Currency | string,
  to: Currency | string,
  exchangeRate: number | undefined | null,
  settings?: Partial<MerchantSettings>
): number {
  const num = Number(amount ?? 0);
  if (num === 0) return 0;
  if (from === to) return num;

  const validation = validateExchangeRate(exchangeRate);
  if (!validation.isValid || !validation.rate) {
    throw new Error(
      `التحويل بين العملات (${from} إلى ${to}) يتطلب سعر صرف صالح وموجب. ${validation.error || ''}`
    );
  }

  const rate = validation.rate;
  const decimals =
    to === 'SDG'
      ? settings?.sdg_decimals ?? DEFAULT_SETTINGS.sdg_decimals
      : to === 'USD'
      ? settings?.usd_decimals ?? DEFAULT_SETTINGS.usd_decimals
      : 2;

  const rule = settings?.rounding_rule ?? DEFAULT_SETTINGS.rounding_rule;

  if (from === 'USD' && to === 'SDG') {
    return safeMul(num, rate, decimals, rule);
  } else if (from === 'SDG' && to === 'USD') {
    return safeDiv(num, rate, decimals, rule);
  }

  // Cross conversion where rate represents units of 'to' per 1 unit of 'from'
  return safeMul(num, rate, decimals, rule);
}

/**
 * Translates currency code to Arabic label
 */
export function getCurrencyLabel(currency: Currency | string): string {
  if (currency === 'SDG') return 'جنيه سوداني (ج.س)';
  if (currency === 'USD') return 'دولار أمريكي ($)';
  if (currency === 'SAR') return 'ريال سعودي (ر.س)';
  if (currency === 'AED') return 'درهم إماراتي (د.إ)';
  if (currency === 'EUR') return 'يورو (€)';
  return currency || '';
}

/**
 * Translates payment method
 */
export function getPaymentMethodLabel(method: string): string {
  switch (method) {
    case 'bankak':
      return 'تطبيق بنكك (بنك الخرطوم)';
    case 'fawry':
      return 'تطبيق فوري (بنك فيصل)';
    case 'cash':
      return 'نقدًا (كاش)';
    case 'bank_transfer':
      return 'تحويل بنكي';
    default:
      return 'أخرى';
  }
}

/**
 * Translates invoice status
 */
export function getInvoiceStatusInfo(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'paid':
      return { label: 'مسددة', color: 'text-sf-success', bg: 'bg-sf-success-bg border-sf-success' };
    case 'partially_paid':
      return { label: 'مسددة جزئياً', color: 'text-sf-warning', bg: 'bg-sf-warning-bg border-sf-warning' };
    case 'sent':
      return { label: 'مرسلة', color: 'text-sf-info', bg: 'bg-sf-info-bg border-sf-info' };
    case 'draft':
      return { label: 'مسودة', color: 'text-sf-neutral', bg: 'bg-sf-neutral-bg border-sf-neutral' };
    case 'overdue':
      return { label: 'متأخرة', color: 'text-sf-danger', bg: 'bg-sf-danger-bg border-sf-danger' };
    case 'cancelled':
      return { label: 'ملغاة', color: 'text-sf-neutral', bg: 'bg-sf-neutral-bg border-sf-neutral' };
    case 'void':
      return { label: 'مبطلة', color: 'text-sf-neutral', bg: 'bg-sf-neutral-bg border-sf-neutral' };
    default:
      return { label: status, color: 'text-sf-neutral', bg: 'bg-sf-neutral-bg border-sf-neutral' };
  }
}

export interface InvoiceFinancials {
  subtotal_sdg: number;
  subtotal_usd: number;
  discount_total_sdg: number;
  discount_total_usd: number;
  tax_total_sdg: number;
  tax_total_usd: number;
  grand_total_sdg: number;
  grand_total_usd: number;
  remaining_sdg: number;
  remaining_usd: number;
}

/**
 * Calculates a single invoice line item with strict deterministic precision
 */
export function calculateLineItem(
  quantity: number | string,
  unitPrice: number | string,
  discountPercent: number | string = 0,
  taxRate: number | string = 0,
  decimals: number = 2,
  rule: 'round' | 'ceil' | 'floor' = 'round'
): { gross: number; discount: number; net: number; tax: number; total: number } {
  const qty = Math.max(0, Number(quantity) || 0);
  const price = Math.max(0, Number(unitPrice) || 0);
  const discPct = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  const taxPct = Math.max(0, Number(taxRate) || 0);

  const gross = safeMul(qty, price, decimals, rule);
  const discount = discPct > 0 ? safePercentage(gross, discPct, decimals, rule) : 0;
  const net = safeSub(gross, discount, decimals, rule);
  const tax = taxPct > 0 ? safePercentage(net, taxPct, decimals, rule) : 0;
  const total = safeAdd(net, tax, decimals, rule);

  return { gross, discount, net, tax, total };
}

/**
 * Deterministically calculates all invoice financial totals with controlled precision.
 * Guarantees arithmetic invariants:
 *   subtotal - discount_total + tax_total === grand_total
 *   paid + remaining === grand_total (when paid <= grand_total)
 */
export function calculateInvoiceFinancials(
  items: Array<{
    quantity: number;
    unit_price: number;
    currency: Currency | string;
    discount_percent?: number;
    tax_rate?: number;
  }>,
  exchangeRate: number | undefined | null,
  discountType: 'percent' | 'fixed' = 'fixed',
  discountValue: number = 0,
  paidSdg: number = 0,
  paidUsd: number = 0,
  settings?: Partial<MerchantSettings>
): InvoiceFinancials {
  const sdgDecimals = settings?.sdg_decimals ?? DEFAULT_SETTINGS.sdg_decimals;
  const usdDecimals = settings?.usd_decimals ?? DEFAULT_SETTINGS.usd_decimals;
  const rule = settings?.rounding_rule ?? DEFAULT_SETTINGS.rounding_rule;

  // Validate exchange rate if needed for multi-currency or dual totals
  const rateValidation = validateExchangeRate(exchangeRate);
  const hasRate = rateValidation.isValid && typeof rateValidation.rate === 'number';
  const validRate = hasRate ? rateValidation.rate! : 0;

  // Check if foreign items exist without a valid exchange rate
  const hasForeignItems = items.some((it) => it.currency === 'USD');
  if (hasForeignItems && !hasRate) {
    throw new Error('الفاتورة تحتوي على بنود بالدولار تتطلب تحديد سعر صرف صالح.');
  }

  let subtotalSdg = 0;
  let subtotalUsd = 0;
  let itemTaxesSdg = 0;
  let itemTaxesUsd = 0;

  for (const item of items) {
    if (item.currency === 'USD') {
      const line = calculateLineItem(item.quantity, item.unit_price, item.discount_percent, item.tax_rate, usdDecimals, rule);
      subtotalUsd = safeAdd(subtotalUsd, line.net, usdDecimals, rule);
      itemTaxesUsd = safeAdd(itemTaxesUsd, line.tax, usdDecimals, rule);

      if (hasRate) {
        const netSdg = convertCurrency(line.net, 'USD', 'SDG', validRate, settings);
        const taxSdg = convertCurrency(line.tax, 'USD', 'SDG', validRate, settings);
        subtotalSdg = safeAdd(subtotalSdg, netSdg, sdgDecimals, rule);
        itemTaxesSdg = safeAdd(itemTaxesSdg, taxSdg, sdgDecimals, rule);
      }
    } else {
      const line = calculateLineItem(item.quantity, item.unit_price, item.discount_percent, item.tax_rate, sdgDecimals, rule);
      subtotalSdg = safeAdd(subtotalSdg, line.net, sdgDecimals, rule);
      itemTaxesSdg = safeAdd(itemTaxesSdg, line.tax, sdgDecimals, rule);

      if (hasRate) {
        const netUsd = convertCurrency(line.net, 'SDG', 'USD', validRate, settings);
        const taxUsd = convertCurrency(line.tax, 'SDG', 'USD', validRate, settings);
        subtotalUsd = safeAdd(subtotalUsd, netUsd, usdDecimals, rule);
        itemTaxesUsd = safeAdd(itemTaxesUsd, taxUsd, usdDecimals, rule);
      }
    }
  }

  // Invoice-level discount calculation
  let globalDiscSdg = 0;
  let globalDiscUsd = 0;
  const dVal = Math.max(0, Number(discountValue) || 0);

  if (discountType === 'percent') {
    const pct = Math.min(100, dVal);
    globalDiscSdg = safePercentage(subtotalSdg, pct, sdgDecimals, rule);
    globalDiscUsd = safePercentage(subtotalUsd, pct, usdDecimals, rule);
  } else {
    // Fixed discount in SDG
    globalDiscSdg = Math.min(subtotalSdg, applyRounding(dVal, sdgDecimals, rule));
    globalDiscUsd = hasRate ? convertCurrency(globalDiscSdg, 'SDG', 'USD', validRate, settings) : 0;
  }

  const taxableSdg = safeSub(subtotalSdg, globalDiscSdg, sdgDecimals, rule);
  const taxableUsd = safeSub(subtotalUsd, globalDiscUsd, usdDecimals, rule);

  const grandTotalSdg = safeAdd(taxableSdg, itemTaxesSdg, sdgDecimals, rule);
  const grandTotalUsd = safeAdd(taxableUsd, itemTaxesUsd, usdDecimals, rule);

  const cleanPaidSdg = Math.max(0, applyRounding(paidSdg || 0, sdgDecimals, rule));
  const cleanPaidUsd = Math.max(0, applyRounding(paidUsd || 0, usdDecimals, rule));

  const remainingSdg = Math.max(0, safeSub(grandTotalSdg, cleanPaidSdg, sdgDecimals, rule));
  const remainingUsd = Math.max(0, safeSub(grandTotalUsd, cleanPaidUsd, usdDecimals, rule));

  return {
    subtotal_sdg: subtotalSdg,
    subtotal_usd: subtotalUsd,
    discount_total_sdg: globalDiscSdg,
    discount_total_usd: globalDiscUsd,
    tax_total_sdg: itemTaxesSdg,
    tax_total_usd: itemTaxesUsd,
    grand_total_sdg: grandTotalSdg,
    grand_total_usd: grandTotalUsd,
    remaining_sdg: remainingSdg,
    remaining_usd: remainingUsd,
  };
}
