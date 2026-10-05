import BigNumber from 'bignumber.js';
import type { Product, Invoice, JournalEntry } from '../types';
import { dateOnly, ensure, money, text } from './validation';

export const costFields = ['cost_status', 'cost_effective_date', 'cost_last_movement_date', 'average_cost_sdg', 'average_cost_usd', 'inventory_value_sdg', 'inventory_value_usd'] as const;
export interface InventoryCost { stock_quantity: number; cost_status: 'valued'; cost_effective_date: string; cost_last_movement_date: string; average_cost_sdg: number; average_cost_usd: number; inventory_value_sdg: number; inventory_value_usd: number; }
export interface CostInput { unit_cost_sdg?: number; unit_cost_usd?: number; zero_cost_reason?: string; cost_currency?: 'SDG' | 'USD'; unit_cost?: number; exchange_rate_used?: number; }
export interface CostDelta { sdg: number; usd: number; }
export function costState(quantity: number, sdg: number, usd: number, effectiveDate: string, lastMovementDate = effectiveDate): InventoryCost {
  money(quantity, 6); money(sdg, 0); money(usd, 2); dateOnly(effectiveDate); dateOnly(lastMovementDate); ensure(dateOnly(lastMovementDate) >= dateOnly(effectiveDate), 'تاريخ حركة التكلفة يسبق الأساس.');
  ensure(quantity > 0 || sdg === 0 && usd === 0, 'المخزون الصفري يجب أن تكون قيمته صفراً.');
  return { stock_quantity: quantity, cost_status: 'valued', cost_effective_date: dateOnly(effectiveDate), cost_last_movement_date: dateOnly(lastMovementDate), inventory_value_sdg: sdg, inventory_value_usd: usd, average_cost_sdg: quantity ? new BigNumber(sdg).div(quantity).decimalPlaces(12).toNumber() : 0, average_cost_usd: quantity ? new BigNumber(usd).div(quantity).decimalPlaces(12).toNumber() : 0 };
}
export function validateCostState(product: Product): InventoryCost {
  ensure(product.track_inventory && product.cost_status === 'valued', 'تكلفة هذا المخزون غير مؤكدة؛ سجّل أساس تكلفة موثق أولاً.', 409);
  const state = costState(product.stock_quantity ?? 0, product.inventory_value_sdg!, product.inventory_value_usd!, product.cost_effective_date!, product.cost_last_movement_date || product.cost_effective_date!);
  ensure(new BigNumber(state.average_cost_sdg).eq(product.average_cost_sdg!) && new BigNumber(state.average_cost_usd).eq(product.average_cost_usd!), 'متوسط التكلفة لا يطابق قيمة المخزون وكميته.', 409); return state;
}
export function acquisitionCost(quantity: number, input: CostInput): CostDelta {
  money(quantity, 6, true);
  if (input.cost_currency !== undefined) {
    ensure(['SDG', 'USD'].includes(input.cost_currency), 'عملة التكلفة غير مدعومة.'); money(input.unit_cost, 8); money(input.exchange_rate_used || 0, 8);
    const rate = input.exchange_rate_used || 0; ensure(input.cost_currency !== 'USD' || rate > 0, 'التكلفة بالدولار تتطلب سعر صرف موثقاً.');
    const base = new BigNumber(quantity).times(input.unit_cost!).decimalPlaces(input.cost_currency === 'USD' ? 2 : 0, BigNumber.ROUND_HALF_UP);
    const sdg = input.cost_currency === 'SDG' ? base.toNumber() : base.times(rate).decimalPlaces(0, BigNumber.ROUND_HALF_UP).toNumber();
    const usd = input.cost_currency === 'USD' ? base.toNumber() : rate ? base.div(rate).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toNumber() : 0;
    money(sdg, 0); money(usd, 2); if (!sdg && !usd) text(input.zero_cost_reason, 500, true); return { sdg, usd };
  }
  money(input.unit_cost_sdg, 8); money(input.unit_cost_usd, 8);
  const sdg = new BigNumber(quantity).times(input.unit_cost_sdg!).decimalPlaces(0, BigNumber.ROUND_HALF_UP).toNumber(), usd = new BigNumber(quantity).times(input.unit_cost_usd!).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toNumber();
  money(sdg, 0); money(usd, 2);
  if (!sdg && !usd) text(input.zero_cost_reason, 500, true);
  return { sdg, usd };
}
export function issueCost(product: Product, quantity: number, date: string) {
  const before = validateCostState(product); money(quantity, 6, true);
  ensure(dateOnly(date) >= before.cost_last_movement_date, 'تاريخ البيع يسبق آخر حركة تكلفة موثقة؛ لا يمكن اختراع تكلفة تاريخية.', 409);
  ensure(quantity <= before.stock_quantity, 'المخزون غير كافٍ.', 409);
  const remainingQuantity = new BigNumber(before.stock_quantity).minus(quantity).toNumber();
  const sdg = remainingQuantity === 0 ? before.inventory_value_sdg : new BigNumber(before.inventory_value_sdg).times(quantity).div(before.stock_quantity).decimalPlaces(0, BigNumber.ROUND_HALF_UP).toNumber();
  const usd = remainingQuantity === 0 ? before.inventory_value_usd : new BigNumber(before.inventory_value_usd).times(quantity).div(before.stock_quantity).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toNumber();
  return { delta: { sdg, usd }, after: costState(remainingQuantity, before.inventory_value_sdg - sdg, new BigNumber(before.inventory_value_usd).minus(usd).toNumber(), before.cost_effective_date, date), unit_sdg: before.average_cost_sdg, unit_usd: before.average_cost_usd };
}
export function receiveCost(product: Product, quantity: number, delta: CostDelta, date?: string) {
  const before = validateCostState(product); money(quantity, 6); money(delta.sdg, 0); money(delta.usd, 2);
  const movementDate = dateOnly(date || before.cost_last_movement_date); ensure(movementDate >= before.cost_last_movement_date, 'تاريخ الاستلام يسبق آخر حركة تكلفة.');
  return costState(new BigNumber(before.stock_quantity).plus(quantity).toNumber(), new BigNumber(before.inventory_value_sdg).plus(delta.sdg).toNumber(), new BigNumber(before.inventory_value_usd).plus(delta.usd).toNumber(), before.cost_effective_date, movementDate);
}
/** Allocate rounded product-level cost across repeated invoice rows; the final row takes the residual. */
export function allocateCost(total: CostDelta, quantities: number[]) {
  let remainingQuantity = quantities.reduce((sum, quantity) => sum.plus(quantity), new BigNumber(0)), sdg = new BigNumber(total.sdg), usd = new BigNumber(total.usd);
  return quantities.map(quantity => {
    const last = remainingQuantity.eq(quantity), line = { sdg: (last ? sdg : sdg.times(quantity).div(remainingQuantity).decimalPlaces(0, BigNumber.ROUND_HALF_UP)).toNumber(), usd: (last ? usd : usd.times(quantity).div(remainingQuantity).decimalPlaces(2, BigNumber.ROUND_HALF_UP)).toNumber() };
    sdg = sdg.minus(line.sdg); usd = usd.minus(line.usd); remainingQuantity = remainingQuantity.minus(quantity); return line;
  });
}

/** Missing historical cost remains visible for any selected period containing its posting or reversal. */
export function hasIncompleteInvoiceCosts(invoices: Invoice[], products: Product[], entries: JournalEntry[], period: { start?: string; end?: string } = {}) {
  const unknown = new Set(invoices.filter(invoice => invoice.items.some(item => item.cost_status === 'unknown' || item.product_id && item.cost_status !== 'valued' && item.cost_status !== 'not_tracked' && products.find(product => product.id === item.product_id)?.track_inventory !== false)).map(invoice => invoice.id));
  return entries.some(entry => ['invoice', 'void'].includes(entry.reference_type) && unknown.has(entry.reference_id) && (!period.start || dateOnly(entry.date) >= period.start) && (!period.end || dateOnly(entry.date) <= period.end));
}
