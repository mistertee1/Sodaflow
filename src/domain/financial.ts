import type { Invoice, InvoiceItem, JournalEntry, JournalEntryLine, MerchantSettings, Payment } from '../types';
import BigNumber from 'bignumber.js';
import { applyRounding, calculateInvoiceFinancials, calculateLineItem, safeAdd, safeDiv, safeMul, safeSub, validateExchangeRate } from '../lib/currency';
import { ensure, money, text, validateJournal } from './validation';

export function invoiceFinancials(data: Partial<Invoice>, settings: MerchantSettings) {
  ensure(Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 100, 'الفاتورة تتطلب بنوداً، بحد أقصى 100 بند.');
  const items = data.items.map((item, i): InvoiceItem => {
    ensure(item && ['SDG', 'USD'].includes(item.currency), 'عملة البند غير مدعومة.');
    money(item.quantity, 6, true); money(item.unit_price, item.currency === 'USD' ? 2 : 0);
    money(item.discount_percent ?? 0, 4); money(item.tax_rate ?? 0, 4);
    ensure((item.discount_percent ?? 0) <= 100 && (item.tax_rate ?? 0) <= 100, 'نسبة الخصم أو الضريبة غير صالحة.');
    return { id: `line-${i + 1}`, ...(item.product_id ? { product_id: item.product_id } : {}), description: text(item.description, 500, true), unit: text(item.unit || 'قطعة', 50), quantity: item.quantity, unit_price: item.unit_price, currency: item.currency, tax_rate: item.tax_rate ?? 0, discount_percent: item.discount_percent ?? 0, line_total: calculateLineItem(item.quantity, item.unit_price, item.discount_percent, item.tax_rate, item.currency === 'USD' ? 2 : 0, settings.rounding_rule).total };
  });
  ensure(['fixed', 'percent'].includes(data.discount_type || 'fixed'), 'نوع الخصم غير صالح.');
  money(data.discount_value ?? 0, data.discount_type === 'percent' ? 4 : 0);
  ensure(data.discount_type !== 'percent' || (data.discount_value ?? 0) <= 100, 'نسبة الخصم تتجاوز 100%.');
  const rate = data.exchange_rate_used ?? 0;
  ensure(rate === 0 || validateExchangeRate(rate).isValid, 'سعر الصرف غير صالح.');
  const totals = calculateInvoiceFinancials(items, rate, data.discount_type, data.discount_value ?? 0, 0, 0, settings);
  ensure(totals.grand_total_sdg > 0 || totals.grand_total_usd > 0, 'إجمالي الفاتورة يجب أن يكون أكبر من صفر.');
  return { items, ...totals, exchange_rate_used: rate };
}
export function receivableCurrency(invoice: Pick<Invoice, 'currency_mode' | 'items'> & { receivable_currency?: 'SDG' | 'USD' }): 'SDG' | 'USD' {
  return invoice.receivable_currency || (invoice.currency_mode === 'single_usd' || invoice.items.every(i => i.currency === 'USD') ? 'USD' : 'SDG');
}
export function paymentQuote(invoice: Invoice, amount: number, currency: 'SDG' | 'USD', rate: number) {
  const native = receivableCurrency(invoice);
  money(amount, currency === 'USD' ? 2 : 0, true);
  const needsRate = currency === 'USD' || native === 'USD' || invoice.grand_total_usd > 0;
  ensure(!needsRate || validateExchangeRate(rate).isValid, 'التحصيل بين العملات يتطلب سعر صرف موجباً.');
  const cashSdg = currency === 'SDG' ? amount : safeMul(amount, rate, 0);
  const cashUsd = currency === 'USD' ? amount : rate > 0 ? safeDiv(amount, rate, 2) : 0;
  const units = native === 'USD' ? cashUsd : cashSdg;
  const remaining = native === 'USD' ? invoice.remaining_usd : invoice.remaining_sdg;
  ensure(units > 0 && units <= remaining, 'الدفعة تتجاوز المتبقي أو تقل عن وحدة العملة المسموحة.');
  // Allocate the historical carrying value proportionally. The final receipt closes both ledgers exactly.
  const settledSdg = units === remaining ? invoice.remaining_sdg : applyRounding(new BigNumber(invoice.remaining_sdg).times(units).dividedBy(remaining), 0);
  const settledUsd = units === remaining ? invoice.remaining_usd : applyRounding(new BigNumber(invoice.remaining_usd).times(units).dividedBy(remaining), 2);
  return { cashSdg, cashUsd, settledSdg, settledUsd };
}
export function journal(id: string, orgId: string, actor: string, date: string, referenceType: JournalEntry['reference_type'], referenceId: string, description: string, lines: JournalEntryLine[], rate = 0): JournalEntry {
  return { id, org_id: orgId, created_by: actor, created_at: date, date, entry_number: `JV-${referenceId}`, reference_type: referenceType, reference_id: referenceId, description, lines, exchange_rate_used: rate, ...validateJournal(lines) };
}
export function journalLine(code: string, name: string, ds = 0, cs = 0, du = 0, cu = 0): JournalEntryLine {
  return { account_code: code, account_name: name, debit_sdg: ds, credit_sdg: cs, debit_usd: du, credit_usd: cu };
}
export function receiptJournal(payment: Payment, invoice: Invoice, orgId: string, actor: string): JournalEntry {
  const quote = paymentQuote(invoice, payment.amount, payment.currency as 'SDG' | 'USD', payment.exchange_rate_used);
  const cash = payment.payment_method === 'bankak' ? '1130' : payment.payment_method === 'fawry' ? '1140' : ['bank_transfer', 'other'].includes(payment.payment_method) ? '1150' : payment.currency === 'USD' ? '1120' : '1110';
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
