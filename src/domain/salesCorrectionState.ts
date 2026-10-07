import BigNumber from 'bignumber.js';
import { dateOnly, ensure, identifier, money } from './validation';
import { quoteReturnAllocation, type BookAmount, type ReturnAllocation, type ReturnBasis } from './returnQuotes';

type Currency = 'SDG' | 'USD';
export interface SalesCorrectionInput { kind: 'sales_return' | 'price_credit'; date: string; quantity?: number; amount?: number; }
export interface SalesCorrectionEvent extends SalesCorrectionInput { id: string; sequence: number; source_id: string; native_currency: Currency; allocated: Record<string, BookAmount>; }
export interface SalesCorrectionQuote extends SalesCorrectionInput { sequence: number; source_id: string; native_currency: Currency; allocated: Record<string, BookAmount>; total_credit: BookAmount; remaining_quantity: number; remaining_value: { revenue: BookAmount; tax: BookAmount }; }
const books = ['sdg', 'usd'] as const;
const sum = (a: BookAmount, b: BookAmount): BookAmount => ({ sdg: new BigNumber(a.sdg).plus(b.sdg).toNumber(), usd: new BigNumber(a.usd).plus(b.usd).toNumber() });
const subtract = (a: BookAmount, b: BookAmount): BookAmount => ({ sdg: new BigNumber(a.sdg).minus(b.sdg).toNumber(), usd: new BigNumber(a.usd).minus(b.usd).toNumber() });
const amount = (value: BookAmount) => { ensure(value && typeof value === 'object' && !Array.isArray(value), 'قيمة التصحيح ناقصة.'); money(value.sdg, 0); money(value.usd, 2); };
const same = (actual: Record<string, BookAmount>, expected: Record<string, BookAmount>) => {
  ensure(actual && typeof actual === 'object' && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()), 'مكونات التصحيح السابق مختلفة.', 409);
  for (const [key, value] of Object.entries(expected)) { amount(actual[key]); for (const book of books) ensure(new BigNumber(actual[key][book]).eq(value[book]), 'قيمة التصحيح السابق لا تطابق تسلسله وأصله.', 409); }
};

/**
 * Replay one source line's immutable correction events before quoting its next event.
 * Price credits consume monetary entitlement only. Physical returns consume original
 * quantity/cost and the monetary value remaining after all preceding corrections.
 * The caller must load source/history from a tenant transaction and enforce authorization.
 */
export function quoteSalesLineCorrection(basis: ReturnBasis, previous: SalesCorrectionEvent[], input: SalesCorrectionInput, nativeCurrency: Currency, sourceDate: string): SalesCorrectionQuote {
  identifier(basis.source_id); money(basis.quantity, 6, true); amount(basis.components.revenue); amount(basis.components.tax);
  if (basis.components.cost !== undefined) amount(basis.components.cost);
  ensure(['SDG', 'USD'].includes(nativeCurrency), 'عملة رصيد التصحيح غير صالحة.');
  ensure(Array.isArray(previous) && previous.length < 1000, 'سجل التصحيحات يتطلب مساراً أكبر مضبوطاً.', 409);
  ensure(previous.every(event => event && typeof event === 'object' && Number.isSafeInteger(event.sequence) && event.sequence > 0), 'تسلسل التصحيحات غير صالح.');
  let lastDate = dateOnly(sourceDate), remainingQuantity = basis.quantity, sequence = 0;
  let remaining = { revenue: { ...basis.components.revenue }, tax: { ...basis.components.tax } };
  let checkpoint: ReturnBasis = { source_id: basis.source_id, quantity: basis.quantity, components: remaining };
  let checkpointHistory: ReturnAllocation[] = [];
  const costHistory: ReturnAllocation[] = [], ids = new Set<string>();
  const process = (request: SalesCorrectionInput, id?: string) => {
    const date = dateOnly(request.date); ensure(date >= lastDate, 'تاريخ التصحيح يسبق المصدر أو آخر تصحيح.', 409);
    ensure(['sales_return', 'price_credit'].includes(request.kind), 'نوع التصحيح غير صالح.');
    let allocated: Record<string, BookAmount>;
    if (request.kind === 'sales_return') {
      ensure(request.amount === undefined, 'المردود الكمي لا يقبل قيمة مالية بديلة.');
      money(request.quantity, 6, true);
      ensure(basis.components.cost !== undefined, 'تكلفة المصدر غير موثقة لاستعادة مخزون فعلي.', 409);
      const monetary = quoteReturnAllocation(checkpoint, checkpointHistory, request.quantity!);
      const cost = quoteReturnAllocation({ source_id: basis.source_id, quantity: basis.quantity, components: { cost: basis.components.cost } }, costHistory, request.quantity!);
      allocated = { ...monetary.components, cost: cost.components.cost };
      remainingQuantity = new BigNumber(remainingQuantity).minus(request.quantity!).toNumber();
      if (id) {
        checkpointHistory.push({ id, sequence: monetary.sequence, source_id: basis.source_id, quantity: request.quantity!, components: monetary.components });
        costHistory.push({ id, sequence: cost.sequence, source_id: basis.source_id, quantity: request.quantity!, components: cost.components });
      }
    } else {
      ensure(request.quantity === undefined, 'تصحيح السعر لا يغير كمية المخزون.');
      const nativeBook = nativeCurrency === 'SDG' ? 'sdg' : 'usd'; money(request.amount, nativeCurrency === 'SDG' ? 0 : 2, true);
      const available = sum(remaining.revenue, remaining.tax);
      ensure(available[nativeBook] > 0 && request.amount! <= available[nativeBook], 'التصحيح يتجاوز قيمة المصدر المتبقية.', 409);
      const revenue: BookAmount = { sdg: 0, usd: 0 }, tax: BookAmount = { sdg: 0, usd: 0 };
      for (const book of books) {
        const total = book === nativeBook ? new BigNumber(request.amount!) : request.amount === available[nativeBook] ? new BigNumber(available[book]) : new BigNumber(available[book]).times(request.amount!).div(available[nativeBook]).decimalPlaces(book === 'sdg' ? 0 : 2, BigNumber.ROUND_HALF_UP);
        revenue[book] = !available[book] ? 0 : total.eq(available[book]) ? remaining.revenue[book] : total.times(remaining.revenue[book]).div(available[book]).decimalPlaces(book === 'sdg' ? 0 : 2, BigNumber.ROUND_HALF_UP).toNumber();
        tax[book] = total.minus(revenue[book]).toNumber();
      }
      allocated = { revenue, tax };
    }
    for (const [key, value] of Object.entries(allocated)) amount(value);
    remaining = { revenue: subtract(remaining.revenue, allocated.revenue), tax: subtract(remaining.tax, allocated.tax) };
    amount(remaining.revenue); amount(remaining.tax);
    if (request.kind === 'price_credit') {
      ensure(remainingQuantity > 0, 'لا توجد كمية أصلية تحمل قيمة التصحيح المتبقية.', 409);
      checkpoint = { source_id: basis.source_id, quantity: remainingQuantity, components: structuredValues(remaining) }; checkpointHistory = [];
    }
    lastDate = date;
    return { allocated, date };
  };
  for (const event of [...previous].sort((a, b) => a.sequence - b.sequence)) {
    identifier(event.id); ensure(!ids.has(event.id), 'تصحيح سابق مكرر.', 409); ids.add(event.id);
    ensure(event.source_id === basis.source_id && event.native_currency === nativeCurrency && event.sequence === ++sequence, 'مصدر/عملة/تسلسل التصحيح السابق مختلف.', 409);
    const quote = process(event, event.id); same(event.allocated, quote.allocated);
  }
  const next = process(input);
  return { sequence: sequence + 1, source_id: basis.source_id, native_currency: nativeCurrency, kind: input.kind, date: next.date, ...(input.kind === 'sales_return' ? { quantity: input.quantity } : { amount: input.amount }), allocated: next.allocated, total_credit: sum(next.allocated.revenue, next.allocated.tax), remaining_quantity: remainingQuantity, remaining_value: structuredValues(remaining) };
}

const structuredValues = (value: { revenue: BookAmount; tax: BookAmount }) => ({ revenue: { ...value.revenue }, tax: { ...value.tax } });
