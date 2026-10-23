import type { Invoice, InvoiceItem, JournalEntry, JournalEntryLine, MerchantSettings, Payment, Currency, CurrencyRates } from '../types';
import BigNumber from 'bignumber.js';
import { applyRounding, calculateInvoiceFinancials, calculateLineItem, convertCurrency, safeAdd, safeDiv, safeMul, safeSub, validateExchangeRate } from '../lib/currency';
import { currencyDecimals, isForeignCurrency, isSupportedCurrency } from '../lib/currencyCatalog';
import { ensure, money, text, validateCurrencyRates, validateJournal } from './validation';

export function invoiceFinancials(data: Partial<Invoice>, settings: MerchantSettings) {
  ensure(Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 100, 'الفاتورة تتطلب بنوداً، بحد أقصى 100 بند.');
  ensure(data.items.every(item => item && typeof item === 'object' && !Array.isArray(item)), 'بند الفاتورة غير صالح.');
  validateCurrencyRates(data.currency_rates_used);
  const foreign = data.items.find(item => isForeignCurrency(item.currency));
  ensure(!foreign || data.currency_mode === 'single_foreign' && data.items.every(item => item.currency === foreign.currency), 'عملة البند غير مدعومة في هذا النمط؛ الفاتورة الأجنبية تتطلب عملة تسعير واحدة.');
  ensure(data.currency_mode !== 'single_foreign' || !!foreign, 'اختر عملة تسعير أجنبية.');
  const rates = data.currency_rates_used ?? settings.currency_rates;
  if (foreign) { validateCurrencyRates(rates); ensure(validateExchangeRate(rates?.[foreign.currency]).isValid, 'حدد سعر عملة التسعير لكل دولار.'); }
  const usedRates = foreign ? { [foreign.currency]: rates![foreign.currency]! } : undefined;
  const effectiveSettings = { ...settings, currency_rates: usedRates };
  const items = data.items.map((item, i): InvoiceItem => {
    ensure(item && isSupportedCurrency(item.currency), 'عملة البند غير مدعومة.');
    money(item.quantity, 6, true); money(item.unit_price, currencyDecimals(item.currency));
    money(item.discount_percent ?? 0, 4); money(item.tax_rate ?? 0, 4);
    ensure((item.discount_percent ?? 0) <= 100 && (item.tax_rate ?? 0) <= 100, 'نسبة الخصم أو الضريبة غير صالحة.');
    return { id: `line-${i + 1}`, ...(item.product_id ? { product_id: item.product_id } : {}), description: text(item.description, 500, true), unit: text(item.unit || 'قطعة', 50), quantity: item.quantity, unit_price: item.unit_price, currency: item.currency, tax_rate: item.tax_rate ?? 0, discount_percent: item.discount_percent ?? 0, line_total: calculateLineItem(item.quantity, item.unit_price, item.discount_percent, item.tax_rate, currencyDecimals(item.currency), settings.rounding_rule).total };
  });
  ensure(['fixed', 'percent'].includes(data.discount_type || 'fixed'), 'نوع الخصم غير صالح.');
  money(data.discount_value ?? 0, data.discount_type === 'percent' ? 4 : foreign ? currencyDecimals(foreign.currency) : 0);
  ensure(data.discount_type !== 'percent' || (data.discount_value ?? 0) <= 100, 'نسبة الخصم تتجاوز 100%.');
  const rate = data.exchange_rate_used ?? 0;
  ensure(rate === 0 || validateExchangeRate(rate).isValid, 'سعر الصرف غير صالح.');
  const totals = calculateInvoiceFinancials(items, rate, data.discount_type, data.discount_value ?? 0, 0, 0, effectiveSettings);
  ensure(totals.grand_total_sdg > 0 || totals.grand_total_usd > 0, 'إجمالي الفاتورة يجب أن يكون أكبر من صفر.');
  ensure(!foreign || totals.pricing!.total > 0 && totals.grand_total_sdg > 0 && totals.grand_total_usd > 0, 'قيمة العملة الأجنبية أقل من دقة الدفاتر المحاسبية.');
  return { items, ...totals, exchange_rate_used: rate, ...(usedRates ? { currency_rates_used: usedRates, pricing_remaining: totals.pricing!.total, pricing_paid: 0, pricing_credit_balance: 0 } : {}) };
}
export function receivableCurrency(invoice: Pick<Invoice, 'currency_mode' | 'items'> & { receivable_currency?: 'SDG' | 'USD' }): 'SDG' | 'USD' {
  return invoice.receivable_currency || (invoice.currency_mode === 'single_foreign' || invoice.currency_mode === 'single_usd' || invoice.items.every(i => i.currency === 'USD') ? 'USD' : 'SDG');
}
export function fullPaymentAmount(invoice: Invoice, currency: Currency, rate: number, rates?: CurrencyRates) {
  const native = receivableCurrency(invoice), remaining = native === 'USD' ? invoice.remaining_usd : invoice.remaining_sdg;
  if (currency === invoice.pricing?.currency) {
    return invoice.pricing_remaining ?? applyRounding(new BigNumber(invoice.pricing.total).times(invoice.remaining_usd).div(invoice.grand_total_usd), currencyDecimals(currency));
  }
  return currency === native ? remaining : convertCurrency(remaining, native, currency, rate, { currency_rates: rates });
}
export function paymentQuote(invoice: Invoice, amount: number, currency: Currency, rate: number, rates?: CurrencyRates) {
  const native = receivableCurrency(invoice);
  ensure(isSupportedCurrency(currency), 'عملة التحصيل غير مدعومة.');
  money(amount, currencyDecimals(currency), true);
  if (isForeignCurrency(currency)) { validateCurrencyRates(rates); ensure(validateExchangeRate(rates?.[currency]).isValid, 'حدد سعر عملة التحصيل لكل دولار.'); }
  const needsRate = currency !== 'SDG' || native === 'USD' || invoice.grand_total_usd > 0;
  ensure(!needsRate || validateExchangeRate(rate).isValid, 'التحصيل بين العملات يتطلب سعر صرف موجباً.');
  const cashSdg = currency === 'SDG' ? amount : convertCurrency(amount, currency, 'SDG', rate, { currency_rates: rates });
  const cashUsd = currency === 'USD' ? amount : rate > 0 ? convertCurrency(amount, currency, 'USD', rate, { currency_rates: rates }) : 0;
  const remaining = native === 'USD' ? invoice.remaining_usd : invoice.remaining_sdg;
  let units = native === 'USD' ? cashUsd : cashSdg;
  if (isForeignCurrency(currency)) {
    const full = fullPaymentAmount(invoice, currency, rate, rates);
    ensure(full > 0 && amount <= full, 'الدفعة تتجاوز المتبقي أو تقل عن وحدة العملة المسموحة.');
    if (amount === full) units = remaining;
    else if (currency === invoice.pricing?.currency) units = applyRounding(new BigNumber(remaining).times(amount).div(full), native === 'USD' ? 2 : 0);
  }
  ensure(units > 0 && units <= remaining, 'الدفعة تتجاوز المتبقي أو تقل عن وحدة العملة المسموحة.');
  // Allocate the historical carrying value proportionally. The final receipt closes both ledgers exactly.
  const settledSdg = units === remaining ? invoice.remaining_sdg : applyRounding(new BigNumber(invoice.remaining_sdg).times(units).dividedBy(remaining), 0);
  const settledUsd = units === remaining ? invoice.remaining_usd : applyRounding(new BigNumber(invoice.remaining_usd).times(units).dividedBy(remaining), 2);
  ensure(!isForeignCurrency(currency) || cashSdg > 0 && cashUsd > 0, 'قيمة التحصيل أقل من دقة الدفاتر المحاسبية.');
  const pricingDue = invoice.pricing ? fullPaymentAmount(invoice, invoice.pricing.currency, rate, rates) : 0;
  const settledPricing = !invoice.pricing ? undefined : units === remaining ? pricingDue : currency === invoice.pricing.currency ? amount : applyRounding(new BigNumber(pricingDue).times(units).div(remaining), currencyDecimals(invoice.pricing.currency));
  return { cashSdg, cashUsd, settledSdg, settledUsd, ...(settledPricing === undefined ? {} : { settledPricing }) };
}
export function journal(id: string, orgId: string, actor: string, date: string, referenceType: JournalEntry['reference_type'], referenceId: string, description: string, lines: JournalEntryLine[], rate = 0): JournalEntry {
  return { id, org_id: orgId, created_by: actor, created_at: date, date, entry_number: `JV-${referenceId}`, reference_type: referenceType, reference_id: referenceId, description, lines, exchange_rate_used: rate, ...validateJournal(lines) };
}
export function journalLine(code: string, name: string, ds = 0, cs = 0, du = 0, cu = 0): JournalEntryLine {
  return { account_code: code, account_name: name, debit_sdg: ds, credit_sdg: cs, debit_usd: du, credit_usd: cu };
}
export function receiptJournal(payment: Payment, invoice: Invoice, orgId: string, actor: string): JournalEntry {
  const quote = paymentQuote(invoice, payment.amount, payment.currency, payment.exchange_rate_used, payment.currency_rates_used);
  const cash = payment.payment_method === 'bankak' ? '1130' : payment.payment_method === 'fawry' ? '1140' : ['bank_transfer', 'other'].includes(payment.payment_method) ? '1150' : payment.currency !== 'SDG' ? '1120' : '1110';
  const lines = [journalLine(cash, 'النقد والبنوك', quote.cashSdg, 0, quote.cashUsd, 0), journalLine('1200', 'ذمم العملاء', 0, quote.settledSdg, 0, quote.settledUsd)];
  const deltaSdg = safeSub(quote.cashSdg, quote.settledSdg, 0), deltaUsd = safeSub(quote.cashUsd, quote.settledUsd, 2);
  if (deltaSdg > 0 || deltaUsd > 0) lines.push(journalLine('4200', 'أرباح فروق العملة', 0, Math.max(0, deltaSdg), 0, Math.max(0, deltaUsd)));
  if (deltaSdg < 0 || deltaUsd < 0) lines.push(journalLine('5500', 'خسائر فروق العملة', Math.max(0, -deltaSdg), 0, Math.max(0, -deltaUsd), 0));
  return journal(`jv-pay-${payment.id}`, orgId, actor, payment.payment_date, 'payment', payment.id, `تحصيل الفاتورة ${invoice.invoice_number}`, lines, payment.exchange_rate_used);
}
export function reverseJournal(original: JournalEntry, id: string, date: string, reason: string, actor: string) {
  const lines = original.lines.map(l => ({ ...l, debit_sdg: l.credit_sdg, credit_sdg: l.debit_sdg, debit_usd: l.credit_usd, credit_usd: l.debit_usd }));
  return journal(id, original.org_id, actor, date, 'void', original.reference_id, reason, lines, original.exchange_rate_used);
}
