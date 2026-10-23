import BigNumber from 'bignumber.js';
import { isForeignCurrency, isSupportedCurrency } from '../lib/currencyCatalog';
import type { JournalEntryLine, MerchantSettings } from '../types';

export class BusinessError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid_operation') { super(message); }
}
export function ensure(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new BusinessError(message, status);
}
export function identifier(value: unknown): string {
  ensure(typeof value === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(value), 'معرّف العملية أو السجل غير صالح.');
  return value;
}
export function money(value: unknown, decimals: number, positive = false): number {
  ensure(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e14, 'المبلغ يجب أن يكون رقماً محدوداً وغير سالب.');
  const n = new BigNumber(value);
  ensure(n.decimalPlaces()! <= decimals, `المبلغ يتجاوز الدقة المسموحة (${decimals}).`);
  ensure(!positive || value > 0, 'المبلغ يجب أن يكون أكبر من صفر.');
  return value;
}
export function text(value: unknown, max = 500, required = false): string {
  ensure(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0), 'النص المطلوب غير صالح أو طويل جداً.');
  return value.trim();
}
export function dateOnly(value: unknown): string {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value), 'التاريخ غير صالح.');
  const day = value.slice(0, 10);
  if (value.includes('T')) ensure(Number.isFinite(Date.parse(value)), 'التاريخ والوقت غير صالحين.');
  const parsed = new Date(`${day}T00:00:00Z`);
  ensure(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day, 'التاريخ غير صالح.');
  return day;
}
export function assertOpenPeriod(value: unknown, settings: Partial<MerchantSettings>) {
  const day = dateOnly(value);
  if (settings.period_lock_date) ensure(day > settings.period_lock_date, 'الفترة المحاسبية مقفلة. اختر تاريخاً بعد تاريخ الإقفال.', 409);
}
export function validateJournal(lines: JournalEntryLine[], settings: Partial<MerchantSettings> = {}) {
  const sd = settings.sdg_decimals ?? 0, ud = settings.usd_decimals ?? 2;
  ensure(Array.isArray(lines) && lines.length >= 2 && lines.length <= 100, 'القيد يتطلب طرفين على الأقل، وبحد أقصى 100 طرف.');
  let ds = new BigNumber(0), cs = new BigNumber(0), du = new BigNumber(0), cu = new BigNumber(0);
  for (const line of lines) {
    ensure(line && typeof line === 'object', 'طرف القيد غير صالح.');
    identifier(line.account_code);
    money(line.debit_sdg, sd); money(line.credit_sdg, sd); money(line.debit_usd, ud); money(line.credit_usd, ud);
    const debit = line.debit_sdg > 0 || line.debit_usd > 0, credit = line.credit_sdg > 0 || line.credit_usd > 0;
    ensure(debit !== credit, 'كل طرف يجب أن يكون مديناً أو دائناً بمبلغ موجب، ولا يجمع الاثنين.');
    ds = ds.plus(line.debit_sdg); cs = cs.plus(line.credit_sdg); du = du.plus(line.debit_usd); cu = cu.plus(line.credit_usd);
  }
  ensure(ds.eq(cs) && du.eq(cu), 'القيد غير متزن: مجموع المدين يجب أن يساوي مجموع الدائن في كل عملة.');
  return { total_debit_sdg: ds.toNumber(), total_credit_sdg: cs.toNumber(), total_debit_usd: du.toNumber(), total_credit_usd: cu.toNumber(), is_balanced: true };
}
export function validateSettings(settings: MerchantSettings): MerchantSettings {
  text(settings.business_name, 200); text(settings.phone, 100); text(settings.invoice_prefix, 40, true);
  ensure(['SDG', 'USD'].includes(settings.primary_currency) && ['SDG', 'USD'].includes(settings.secondary_currency), 'المحاسبة تدعم الجنيه والدولار حالياً.');
  if (settings.default_transaction_currency !== undefined) ensure(isSupportedCurrency(settings.default_transaction_currency), 'عملة التعامل غير مدعومة.');
  validateCurrencyRates(settings.currency_rates);
  if (settings.display_currency !== undefined) {
    const quote = settings.display_currency;
    ensure(!!quote && typeof quote === 'object' && !Array.isArray(quote) && Object.keys(quote).every(key => ['currency', 'units_per_usd', 'sdg_per_usd'].includes(key)), 'إعداد عملة العرض غير صالح.');
    ensure(isSupportedCurrency(quote.currency), 'عملة العرض غير مدعومة.');
    money(quote.units_per_usd, 8, true); money(quote.sdg_per_usd, 8, true);
    ensure(quote.units_per_usd <= 10_000_000_000 && quote.sdg_per_usd <= 10_000_000_000, 'سعر العرض يتجاوز الحد المقبول.');
    ensure(quote.currency !== 'USD' || quote.units_per_usd === 1, 'الدولار هو مرجع التحويل: سعره واحد.');
    ensure(quote.currency !== 'SDG' || quote.units_per_usd === quote.sdg_per_usd, 'سعر عرض الجنيه يجب أن يطابق سعر الجنيه لكل دولار.');
  }
  // The ledger uses whole SDG and USD cents; changing precision would reinterpret historical postings.
  ensure(settings.sdg_decimals === 0 && settings.usd_decimals === 2, 'دقة الدفاتر: الجنيه بدون كسور والدولار بدقتين عشريتين.');
  ensure(['round', 'ceil', 'floor'].includes(settings.rounding_rule), 'قاعدة التقريب غير صالحة.');
  money(settings.default_exchange_rate, 8);
  if (settings.manual_exchange_rate !== undefined && settings.manual_exchange_rate !== null) {
    money(settings.manual_exchange_rate, 8);
  }
  if (settings.freeze_exchange_rate !== undefined && settings.freeze_exchange_rate !== null) {
    ensure(typeof settings.freeze_exchange_rate === 'boolean', 'خيار تجميد سعر الصرف يجب أن يكون قيمة منطقية.');
  }
  if (settings.freeze_invoice_exchange_rate !== undefined && settings.freeze_invoice_exchange_rate !== null) {
    ensure(typeof settings.freeze_invoice_exchange_rate === 'boolean', 'خيار تجميد سعر الصرف للفواتير يجب أن يكون قيمة منطقية.');
  }
  if (settings.period_lock_date) dateOnly(settings.period_lock_date);
  try { new Intl.DateTimeFormat('en', { timeZone: settings.timezone || 'Africa/Khartoum' }); } catch { throw new BusinessError('المنطقة الزمنية غير صالحة.'); }
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'string') ensure(value.length <= (key === 'logo_url' ? 300000 : 5000), 'قيمة الإعداد طويلة جداً.');
  }
  return settings;
}

export function validateCurrencyRates(rates: unknown): asserts rates is import('../types').CurrencyRates | undefined {
  if (rates === undefined) return;
  ensure(!!rates && typeof rates === 'object' && !Array.isArray(rates) && Object.keys(rates).length <= 9, 'أسعار العملات غير صالحة.');
  for (const [code, value] of Object.entries(rates as object)) {
    ensure(isForeignCurrency(code), 'عملة سعر الصرف غير مدعومة.');
    money(value, 8, true);
    ensure(value <= 10_000_000_000, 'سعر العملة يتجاوز الحد المقبول.');
  }
}
