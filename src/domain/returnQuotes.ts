import BigNumber from 'bignumber.js';
import type { Invoice, InvoiceItem, Product } from '../types';
import type { PurchaseLine } from './payables';
import { issueCost, receiveCost } from './inventoryCost';
import { paymentQuote, journalLine } from './financial';
import type { JournalEntryLine } from '../types';
import { validateExchangeRate } from '../lib/currency';
import { dateOnly, ensure, identifier, money, validateJournal } from './validation';

export interface BookAmount { sdg: number; usd: number; }
export interface ReturnBasis { source_id: string; quantity: number; components: Record<string, BookAmount>; }
export interface ReturnAllocation { id: string; sequence: number; source_id: string; quantity: number; components: Record<string, BookAmount>; }
const books = ['sdg', 'usd'] as const;
const decimals = (book: typeof books[number]) => book === 'sdg' ? 0 : 2;
const validateAmount = (amount: BookAmount) => { ensure(amount && typeof amount === 'object' && !Array.isArray(amount), 'القيمة الدفترية ناقصة.'); for (const book of books) money(amount[book], decimals(book)); };
const entitlement = (value: number, quantity: BigNumber, total: number, book: typeof books[number]) => quantity.eq(total) ? new BigNumber(value) : new BigNumber(value).times(quantity).div(total).decimalPlaces(decimals(book), BigNumber.ROUND_HALF_UP);

/**
 * Allocate from a server-loaded original source basis. Cumulative allocation is independent
 * of grouping and conserves every component in both books when the final quantity returns.
 * This is a quote only: callers must validate the original journal, tenant and open period.
 */
export function quoteReturnAllocation(basis: ReturnBasis, previous: ReturnAllocation[], quantity: number) {
  ensure(basis && typeof basis === 'object', 'أساس المردود ناقص.');
  identifier(basis.source_id); money(basis.quantity, 6, true); money(quantity, 6, true);
  ensure(basis.components && typeof basis.components === 'object' && !Array.isArray(basis.components), 'مكونات أساس المردود ناقصة.');
  const keys = Object.keys(basis.components).sort(); ensure(keys.length > 0 && keys.length <= 20, 'عدد مكونات المردود غير صالح.');
  for (const key of keys) { identifier(key); validateAmount(basis.components[key]); }
  ensure(Array.isArray(previous) && previous.length <= 1000, 'سجل المردودات غير صالح.');
  const ids = new Set<string>(); let returned = new BigNumber(0), sequence = 0;
  ensure(previous.every(row => row && typeof row === 'object' && Number.isSafeInteger(row.sequence) && row.sequence > 0), 'ترتيب سجل المردودات غير صالح.');
  for (const row of [...previous].sort((a, b) => a.sequence - b.sequence)) {
    identifier(row.id); ensure(!ids.has(row.id), 'مردود سابق مكرر.'); ids.add(row.id);
    ensure(row.source_id === basis.source_id && row.sequence === ++sequence, 'مصدر أو ترتيب المردود السابق مختلف.');
    money(row.quantity, 6, true); const next = returned.plus(row.quantity); ensure(next.lte(basis.quantity), 'المردود السابق يتجاوز كمية المصدر.');
    ensure(row.components && JSON.stringify(Object.keys(row.components).sort()) === JSON.stringify(keys), 'مكونات المردود السابق مختلفة.');
    for (const key of keys) {
      validateAmount(row.components[key]);
      for (const book of books) {
        const expected = entitlement(basis.components[key][book], next, basis.quantity, book).minus(entitlement(basis.components[key][book], returned, basis.quantity, book));
        ensure(expected.eq(row.components[key][book]), 'قيمة المردود السابق لا تطابق أساسه وترتيبه.', 409);
      }
    }
    returned = next;
  }
  const after = returned.plus(quantity); ensure(after.lte(basis.quantity), 'كمية المردود تتجاوز المتبقي من المصدر.', 409);
  const components: Record<string, BookAmount> = {};
  for (const key of keys) {
    const allocated = (book: typeof books[number]) => entitlement(basis.components[key][book], after, basis.quantity, book).minus(entitlement(basis.components[key][book], returned, basis.quantity, book)).toNumber();
    components[key] = { sdg: allocated('sdg'), usd: allocated('usd') };
  }
  return { source_id: basis.source_id, sequence: sequence + 1, quantity, returned_before: returned.toNumber(), returned_after: after.toNumber(), remaining_quantity: new BigNumber(basis.quantity).minus(after).toNumber(), components };
}

/** Restore a physical sales return at its immutable original line cost, never today's WAC/retail price. */
export function quoteSalesReturnCost(sourceId: string, item: InvoiceItem, product: Product, previous: ReturnAllocation[], quantity: number, date: string) {
  ensure(item.product_id === product.id && product.track_inventory, 'المنتج لا يطابق بند المخزون المباع.');
  ensure(item.cost_status === 'valued', 'تكلفة البيع الأصلية غير مؤكدة؛ لا يمكن اختراع تكلفة المردود.', 409);
  dateOnly(item.cost_recorded_at); dateOnly(date);
  const allocation = quoteReturnAllocation({ source_id: sourceId, quantity: item.quantity, components: { cost: { sdg: item.total_cost_sdg!, usd: item.total_cost_usd! } } }, previous, quantity);
  const after = receiveCost(product, quantity, allocation.components.cost, date);
  return { ...allocation, inventory_in: allocation.components.cost, inventory_after: after };
}

/**
 * Purchase return credit uses the original bill; inventory leaves at current carrying WAC.
 * Their difference is an explicit signed purchase-return variance, not a hidden stock rewrite.
 */
export function quotePurchaseReturnCost(sourceId: string, item: PurchaseLine, product: Product, previous: ReturnAllocation[], quantity: number, date: string) {
  ensure(item.product_id === product.id && product.track_inventory, 'المنتج لا يطابق استلام فاتورة الشراء.');
  const allocation = quoteReturnAllocation({ source_id: sourceId, quantity: item.quantity, components: { supplier_credit: { sdg: item.value_sdg, usd: item.value_usd } } }, previous, quantity);
  const issued = issueCost(product, quantity, date), credit = allocation.components.supplier_credit;
  return { ...allocation, supplier_credit: credit, inventory_out: issued.delta, inventory_after: issued.after, variance: { sdg: new BigNumber(credit.sdg).minus(issued.delta.sdg).toNumber(), usd: new BigNumber(credit.usd).minus(issued.delta.usd).toNumber() } };
}

/** Refund an available original credit at payment-date FX while relieving its historical carrying value. */
export function quoteCreditRefund(availableCredit: BookAmount, creditCurrency: 'SDG' | 'USD', amount: number, paymentCurrency: 'SDG' | 'USD', rate: number) {
  validateAmount(availableCredit); ensure(['SDG', 'USD'].includes(creditCurrency) && ['SDG', 'USD'].includes(paymentCurrency), 'عملة الرد غير مدعومة.');
  money(rate, 8);
  ensure(rate === 0 || validateExchangeRate(rate).isValid, 'سعر صرف الرد غير صالح.');
  ensure(availableCredit[creditCurrency === 'SDG' ? 'sdg' : 'usd'] > 0, 'لا يوجد رصيد دائن أصلي متاح للرد.', 409);
  const quote = paymentQuote({ receivable_currency: creditCurrency, remaining_sdg: availableCredit.sdg, remaining_usd: availableCredit.usd, grand_total_usd: availableCredit.usd } as Invoice, amount, paymentCurrency, rate);
  const cash = { sdg: quote.cashSdg, usd: quote.cashUsd }, settled = { sdg: quote.settledSdg, usd: quote.settledUsd };
  const remaining = { sdg: new BigNumber(availableCredit.sdg).minus(settled.sdg).toNumber(), usd: new BigNumber(availableCredit.usd).minus(settled.usd).toNumber() };
  const gain: BookAmount = { sdg:0, usd:0 }, loss: BookAmount = { sdg:0, usd:0 };
  for (const book of books) {
    const delta = new BigNumber(cash[book]).minus(settled[book]);
    if (delta.gte(0)) loss[book] = delta.toNumber(); else gain[book] = delta.negated().toNumber();
    validateAmount({ sdg: book === 'sdg' ? cash[book] : 0, usd: book === 'usd' ? cash[book] : 0 });
    ensure(new BigNumber(settled[book]).plus(loss[book]).eq(new BigNumber(cash[book]).plus(gain[book])), 'رد غير متوازن.');
  }
  return { cash, settled, remaining_credit: remaining, fx_gain: gain, fx_loss: loss };
}

const sum = (a: BookAmount, b: BookAmount): BookAmount => ({ sdg: new BigNumber(a.sdg).plus(b.sdg).toNumber(), usd: new BigNumber(a.usd).plus(b.usd).toNumber() });
const zero: BookAmount = { sdg: 0, usd: 0 };
const debit = (code: string, name: string, value: BookAmount) => journalLine(code, name, value.sdg, 0, value.usd, 0);
const credit = (code: string, name: string, value: BookAmount) => journalLine(code, name, 0, value.sdg, 0, value.usd);
const balanced = (lines: JournalEntryLine[]) => {
  const result = lines.filter(line => line.debit_sdg || line.debit_usd || line.credit_sdg || line.credit_usd);
  validateJournal(result); return result;
};

/** Source components come from the original posting; a price-only credit omits physical cost. */
export function salesCreditLines(revenue: BookAmount, tax: BookAmount, restoredCost: BookAmount = zero, taxAccountCode = '2130'): JournalEntryLine[] {
  for (const value of [revenue, tax, restoredCost]) validateAmount(value);
  identifier(taxAccountCode);
  return balanced([
    debit('4100', 'مردود إيراد المبيعات', revenue), debit(taxAccountCode, 'مردود ضريبة المبيعات', tax),
    credit('1200', 'ذمم العملاء', sum(revenue, tax)),
    debit('1300', 'المخزون المرتجع', restoredCost), credit('5100', 'مردود تكلفة المبيعات', restoredCost),
  ]);
}

/** Both books retain the full original credit; current inventory carrying difference is explicit. */
export function purchaseReturnLines(supplierCredit: BookAmount, inventoryOut: BookAmount, varianceAccountCode: string): JournalEntryLine[] {
  validateAmount(supplierCredit); validateAmount(inventoryOut); identifier(varianceAccountCode);
  ensure(!['2110', '1300'].includes(varianceAccountCode), 'حساب فرق المردود يجب أن يكون منفصلاً عن المخزون وذمم الموردين.');
  const gain: BookAmount = { sdg: 0, usd: 0 }, loss: BookAmount = { sdg: 0, usd: 0 };
  for (const book of books) {
    const delta = new BigNumber(supplierCredit[book]).minus(inventoryOut[book]);
    if (delta.gte(0)) gain[book] = delta.toNumber(); else loss[book] = delta.negated().toNumber();
  }
  return balanced([debit('2110', 'ذمم الموردين', supplierCredit), credit('1300', 'المخزون المرتجع للمورد', inventoryOut), debit(varianceAccountCode, 'فرق تكلفة المردود', loss), credit(varianceAccountCode, 'فرق تكلفة المردود', gain)]);
}

/** Quotes are not permission grants: posting must also verify an active mapped cash account and funds. */
export function creditRefundLines(quote: ReturnType<typeof quoteCreditRefund>, cashAccountCode: string, direction: 'customer' | 'supplier' = 'customer'): JournalEntryLine[] {
  identifier(cashAccountCode); ensure(['customer', 'supplier'].includes(direction), 'اتجاه رد المبلغ غير صالح.');
  ensure(!['1200', '2110', '4200', '5500'].includes(cashAccountCode), 'حساب رد المبلغ يجب أن يكون نقدياً/بنكياً منفصلاً.');
  for (const value of [quote.cash, quote.settled, quote.fx_gain, quote.fx_loss]) validateAmount(value);
  for (const book of books) {
    const delta = new BigNumber(quote.cash[book]).minus(quote.settled[book]);
    ensure(new BigNumber(quote.fx_loss[book]).eq(BigNumber.maximum(delta, 0)) && new BigNumber(quote.fx_gain[book]).eq(BigNumber.maximum(delta.negated(), 0)), 'فروق صرف الرد لا تطابق القيمة الدفترية والنقدية.');
  }
  const customer = direction === 'customer';
  const lines = customer ? [debit('1200', 'رد رصيد العميل الدائن', quote.settled), credit(cashAccountCode, 'رد نقدي للعميل', quote.cash)] : [debit(cashAccountCode, 'استرداد من المورد', quote.cash), credit('2110', 'رد رصيد المورد المدين', quote.settled)];
  lines.push(debit('5500', 'خسائر فروق العملة', customer ? quote.fx_loss : quote.fx_gain), credit('4200', 'أرباح فروق العملة', customer ? quote.fx_gain : quote.fx_loss));
  return balanced(lines);
}
