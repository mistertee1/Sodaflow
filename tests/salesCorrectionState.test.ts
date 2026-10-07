import test from 'node:test';
import assert from 'node:assert/strict';
import BigNumber from 'bignumber.js';
import { quoteSalesLineCorrection, type SalesCorrectionEvent, type SalesCorrectionInput } from '../src/domain/salesCorrectionState';
import { salesCreditLines } from '../src/domain/returnQuotes';
import type { ReturnBasis } from '../src/domain/returnQuotes';
import { validateJournal } from '../src/domain/validation';
const basis: ReturnBasis = { source_id: 'invoice.line-1', quantity: 2, components: { revenue: { sdg: 900, usd: 9 }, tax: { sdg: 100, usd: 1 }, cost: { sdg: 400, usd: 4 } } };
const input = (kind: SalesCorrectionInput['kind'], value: number, date = '2026-10-05'): SalesCorrectionInput => ({ kind, date, ...(kind === 'price_credit' ? { amount: value } : { quantity: value }) });
const run = (source: ReturnBasis, events: SalesCorrectionEvent[], request: SalesCorrectionInput, currency: 'SDG' | 'USD' = 'SDG') => quoteSalesLineCorrection(source, events, request, currency, '2026-10-01');
const record = (quote: ReturnType<typeof run>, id: string): SalesCorrectionEvent => ({ id, sequence: quote.sequence, source_id: quote.source_id, native_currency: quote.native_currency, kind: quote.kind, date: quote.date, ...(quote.kind === 'sales_return' ? { quantity: quote.quantity } : { amount: quote.amount }), allocated: quote.allocated });
const totals = (events: SalesCorrectionEvent[], component: string, book: 'sdg' | 'usd') => events.reduce((n, event) => n.plus(event.allocated[component]?.[book] || 0), new BigNumber(0)).toNumber();

test('B3 price credit followed by physical returns consumes monetary value once and restores original cost independently', () => {
  const events: SalesCorrectionEvent[] = [], before = structuredClone(basis);
  const price = run(basis, events, input('price_credit', 200)); events.push(record(price, 'price'));
  assert.deepEqual(price.total_credit, { sdg: 200, usd: 2 }); assert.equal(price.remaining_quantity, 2); assert.equal('cost' in price.allocated, false);
  const first = run(basis, events, input('sales_return', 1)); events.push(record(first, 'first'));
  assert.deepEqual(first.total_credit, { sdg: 400, usd: 4 }); assert.deepEqual(first.allocated.cost, { sdg: 200, usd: 2 });
  const final = run(basis, events, input('sales_return', 1)); events.push(record(final, 'final'));
  assert.equal(final.remaining_quantity, 0); assert.deepEqual(final.remaining_value, { revenue: { sdg: 0, usd: 0 }, tax: { sdg: 0, usd: 0 } });
  for (const component of ['revenue', 'tax', 'cost']) for (const book of ['sdg', 'usd'] as const) assert.equal(totals(events, component, book), basis.components[component][book]);
  for (const event of events) validateJournal(salesCreditLines(event.allocated.revenue, event.allocated.tax, event.allocated.cost)); assert.deepEqual(basis, before);
});

test('B3 physical return followed by pricing correction and final return keeps all original rounding residuals', () => {
  const source = { source_id: 'small.line-1', quantity: 3, components: { revenue: { sdg: 7, usd: .07 }, tax: { sdg: 1, usd: .01 }, cost: { sdg: 5, usd: .05 } } }, events: SalesCorrectionEvent[] = [];
  events.push(record(run(source, events, input('sales_return', 1)), 'first'));
  events.push(record(run(source, events, input('price_credit', 1)), 'price'));
  const final = run(source, events, input('sales_return', 2)); events.push(record(final, 'final'));
  for (const component of ['revenue', 'tax', 'cost']) for (const book of ['sdg', 'usd'] as const) assert.equal(totals(events, component, book), source.components[component as keyof typeof source.components][book]);
  assert.equal(final.remaining_quantity, 0); assert.throws(() => run(source, events, input('price_credit', 1))); assert.throws(() => run(source, events, input('sales_return', 1)));
});

test('B3 consecutive physical returns remain grouping-independent after a monetary price checkpoint', () => {
  const source = { source_id: 'split.line-1', quantity: 3, components: { revenue: { sdg: 7, usd: .07 }, tax: { sdg: 1, usd: .01 }, cost: { sdg: 5, usd: .05 } } };
  const price = record(run(source, [], input('price_credit', 1)), 'price'), first = run(source, [price], input('sales_return', 1));
  const second = run(source, [price, record(first, 'first')], input('sales_return', 1)), combined = run(source, [price], input('sales_return', 2));
  for (const component of ['revenue', 'tax', 'cost']) for (const book of ['sdg', 'usd'] as const) assert.equal(new BigNumber(first.allocated[component][book]).plus(second.allocated[component][book]).toNumber(), combined.allocated[component][book]);
});

test('B3 credit event replay rejects duplicated, foreign, altered or skipped events and invalid dates without mutating inputs', () => {
  const first = record(run(basis, [], input('price_credit', 200)), 'first'), before = structuredClone(first);
  for (const events of [[first, first], [{ ...first, source_id: 'other' }], [{ ...first, native_currency: 'USD' }], [{ ...first, sequence: 2 }], [{ ...first, date: '2026-09-30' }], [{ ...first, allocated: { ...first.allocated, cost: { sdg: 1, usd: 0 } } }], [{ ...first, allocated: { revenue: { sdg: 181, usd: 1.8 }, tax: first.allocated.tax } }]]) assert.throws(() => run(basis, events as SalesCorrectionEvent[], input('sales_return', 1)));
  assert.throws(() => run(basis, [first], input('sales_return', 1, '2026-10-04'))); assert.throws(() => run(basis, [], input('price_credit', 1, '2026-02-30'))); assert.deepEqual(first, before);
});

test('B3 monetary exhaustion leaves physical cost available, while missing original cost never permits stock restoration', () => {
  const price = record(run(basis, [], input('price_credit', 1000)), 'all-price');
  const physical = run(basis, [price], input('sales_return', 2)); assert.deepEqual(physical.total_credit, { sdg: 0, usd: 0 }); assert.deepEqual(physical.allocated.cost, { sdg: 400, usd: 4 }); validateJournal(salesCreditLines(physical.allocated.revenue, physical.allocated.tax, physical.allocated.cost));
  const unknown = { ...basis, components: { revenue: basis.components.revenue, tax: basis.components.tax } };
  assert.throws(() => run(unknown, [], input('sales_return', 1)), /غير موثقة/); assert.equal(run(unknown, [], input('price_credit', 200)).remaining_quantity, 2);
});

test('B3 each price request consumes the exact native amount and last correction preserves cross-book residuals', () => {
  const source = { source_id: 'usd.line-1', quantity: 2, components: { revenue: { sdg: 5, usd: .01 }, tax: { sdg: 0, usd: .01 }, cost: { sdg: 1, usd: 0 } } };
  const first = run(source, [], input('price_credit', .01), 'USD'), final = run(source, [record(first, 'first')], input('price_credit', .01), 'USD');
  assert.equal(first.total_credit.usd, .01); assert.equal(final.total_credit.usd, .01); assert.equal(first.total_credit.sdg + final.total_credit.sdg, 5); assert.equal(first.allocated.revenue.usd + final.allocated.revenue.usd, .01); assert.equal(first.allocated.tax.usd + final.allocated.tax.usd, .01); assert.equal(final.remaining_quantity, 2);
});

test('B3 quotes reject over-credit, over-return, mixed request fields, nonfinite values and malformed history', () => {
  for (const request of [input('price_credit', 1001), input('price_credit', 0), input('price_credit', .01), input('price_credit', Infinity), input('sales_return', 3), input('sales_return', 0), input('sales_return', .0000001), { ...input('sales_return', 1), amount: 1 }, { ...input('price_credit', 1), quantity: 1 }]) assert.throws(() => run(basis, [], request));
  for (const events of [[null], [{ id: 'bad', sequence: NaN }], [{ id: 'bad', sequence: 1.5 }]]) assert.throws(() => run(basis, events as SalesCorrectionEvent[], input('price_credit', 1)));
});
