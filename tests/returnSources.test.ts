import test from 'node:test';
import assert from 'node:assert/strict';
import BigNumber from 'bignumber.js';
import type { Invoice, MerchantSettings } from '../src/types';
import { invoiceFinancials, journal, journalLine } from '../src/domain/financial';
import { buildSalesReturnBases, buildPurchaseReturnBases } from '../src/domain/returnSources';
import type { PurchaseBill } from '../src/domain/payables';
import { quoteReturnAllocation, salesCreditLines } from '../src/domain/returnQuotes';
import { validateJournal } from '../src/domain/validation';

function source(rule: MerchantSettings['rounding_rule'] = 'round') {
  const settings = { sdg_decimals: 0, usd_decimals: 2, rounding_rule: rule } as MerchantSettings;
  const input = { exchange_rate_used: 2000, discount_type: 'percent', discount_value: 7.25, items: [
    { quantity: 3, unit_price: .37, currency: 'USD', description: 'صنف أ', discount_percent: 10, tax_rate: 15 },
    { quantity: 2, unit_price: 71, currency: 'SDG', description: 'صنف ب', discount_percent: 0, tax_rate: 10 },
  ] } as Partial<Invoice>;
  const financials = invoiceFinancials(input, settings);
  const invoice = { ...input, ...financials, id: 'inv-source', org_id: 'tenant', status: 'paid', issue_date: '2026-10-01', paid_amount_sdg: financials.grand_total_sdg, paid_amount_usd: financials.grand_total_usd, remaining_sdg: 0, remaining_usd: 0, cogs_sdg: 70, cogs_usd: .03, costing_version: 2 } as Invoice;
  Object.assign(invoice.items[0], { product_id: 'p', cost_status: 'valued', total_cost_sdg: 70, total_cost_usd: .03, cost_recorded_at: '2026-10-05T12:00:00Z' });
  Object.assign(invoice.items[1], { cost_status: 'not_tracked' });
  const lines = [journalLine('1200', 'ذمم', invoice.grand_total_sdg, 0, invoice.grand_total_usd, 0), journalLine('4100', 'إيراد', 0, invoice.grand_total_sdg - invoice.tax_total_sdg, 0, new BigNumber(invoice.grand_total_usd).minus(invoice.tax_total_usd).toNumber()), journalLine('2130', 'ضريبة', 0, invoice.tax_total_sdg, 0, invoice.tax_total_usd), journalLine('5100', 'تكلفة', 70, 0, .03, 0), journalLine('1300', 'مخزون', 0, 70, 0, .03)];
  const entry = journal('jv-inv-source', 'tenant', 'owner', invoice.issue_date, 'invoice', invoice.id, 'مصدر مرحّل', lines, invoice.exchange_rate_used);
  return { invoice, entry };
}

test('B3 original issue rounding and global discount are proven from frozen source and each component is conserved in both books', () => {
  for (const rule of ['round', 'ceil', 'floor'] as const) {
    const { invoice, entry } = source(rule), before = structuredClone({ invoice, entry });
    const result = buildSalesReturnBases(invoice, [entry], 'tenant');
    for (const book of ['sdg', 'usd'] as const) for (const component of ['revenue', 'tax', 'cost']) {
      const total = result.bases.reduce((n, basis) => n.plus(basis.components[component]?.[book] || 0), new BigNumber(0));
      const expected = component === 'tax' ? invoice[`tax_total_${book}`] : component === 'cost' ? invoice[`cogs_${book}`] : new BigNumber(invoice[`grand_total_${book}`]).minus(invoice[`tax_total_${book}`]).toNumber();
      assert.equal(total.toNumber(), expected);
    }
    const reversed = result.bases.flatMap(basis => { const full = quoteReturnAllocation(basis, [], basis.quantity); return salesCreditLines(full.components.revenue, full.components.tax, full.components.cost); });
    const total = validateJournal(reversed); assert.equal(total.total_debit_sdg, entry.total_debit_sdg); assert.equal(total.total_debit_usd, entry.total_debit_usd);
    assert.deepEqual({ invoice, entry }, before); assert.equal(result.bases[0].source_id, 'inv-source.line-1');
  }
});

test('B3 source quote ignores today paid/remaining caches and never accepts other-tenant, duplicate or mismatched original postings', () => {
  const { invoice, entry } = source();
  const basis = buildSalesReturnBases(invoice, [entry], 'tenant');
  assert.deepEqual(buildSalesReturnBases({ ...invoice, remaining_sdg: 99999, paid_amount_sdg: 0 }, [entry], 'tenant').bases, basis.bases);
  for (const entries of [[], [entry, entry], [{ ...entry, org_id: 'foreign' }], [{ ...entry, reference_id: 'other' }], [{ ...entry, reference_type: 'payment' }], [{ ...entry, date: '2026-09-30' }], [{ ...entry, is_balanced: false }], [{ ...entry, total_debit_sdg: entry.total_debit_sdg + 1 }], [{ ...entry, exchange_rate_used: 9000 }]]) assert.throws(() => buildSalesReturnBases(invoice, entries as typeof entry[], 'tenant'));
  assert.throws(() => buildSalesReturnBases(invoice, [entry], 'foreign')); assert.throws(() => buildSalesReturnBases({ ...invoice, status: 'void' }, [entry], 'tenant'));
});

test('B3 even balanced account substitutions or altered frozen financial and cost fields fail source proof', () => {
  const { invoice, entry } = source();
  const wrongAccount = structuredClone(entry); wrongAccount.lines.find(line => line.account_code === '4100')!.account_code = '4200'; validateJournal(wrongAccount.lines);
  assert.throws(() => buildSalesReturnBases(invoice, [wrongAccount], 'tenant'));
  const altered = structuredClone(invoice); altered.items[0].total_cost_sdg = 71; assert.throws(() => buildSalesReturnBases(altered, [entry], 'tenant'));
  for (const update of [{ grand_total_sdg: invoice.grand_total_sdg + 1 }, { subtotal_usd: invoice.subtotal_usd + .01 }, { discount_value: 50 }, { exchange_rate_used: 9000 }]) assert.throws(() => buildSalesReturnBases({ ...invoice, ...update }, [entry], 'tenant'));
  const duplicated = structuredClone(invoice); duplicated.items[1].id = duplicated.items[0].id; assert.throws(() => buildSalesReturnBases(duplicated, [entry], 'tenant'));
});

test('B3 original monetary source can retain explicitly unknown cost but does not certify physical cost restoration', () => {
  const { invoice, entry } = source();
  invoice.items[0].cost_status = 'unknown'; delete invoice.items[0].total_cost_sdg; delete invoice.items[0].total_cost_usd; invoice.cogs_sdg = 0; invoice.cogs_usd = 0;
  entry.lines = entry.lines.filter(line => !['1300', '5100'].includes(line.account_code)); Object.assign(entry, validateJournal(entry.lines));
  const result = buildSalesReturnBases(invoice, [entry], 'tenant'); assert.equal(result.cost_statuses['inv-source.line-1'], 'unknown'); assert.equal('cost' in result.bases[0].components, false);
  assert.throws(() => buildSalesReturnBases({ ...invoice, items: invoice.items.map(item => ({ ...item, cost_status: undefined })) }, [entry], 'tenant'));
});

function purchase(settlement: 'credit' | 'cash' = 'credit') {
  const bill = { id: 'bill-source', org_id: 'tenant', supplier_id: 'supplier', issue_date: '2026-10-01', currency: 'USD', exchange_rate_used: 2000, settlement, payment_account_code: settlement === 'credit' ? '2110' : 'bank', journal_id: 'jv-purchase-source', grand_total_sdg: 12000, grand_total_usd: 6, remaining_sdg: 0, remaining_usd: 0, paid_amount_sdg: 12000, paid_amount_usd: 6, status: 'paid', items: [{ id: 'line-1', product_id: 'p', product_name: 'صنف', quantity: 3, unit_cost: 2, value_sdg: 12000, value_usd: 6 }] } as PurchaseBill & { payment_account_code: string };
  const entry = journal(bill.journal_id, 'tenant', 'owner', bill.issue_date, 'purchase_bill', bill.id, 'شراء أصل موثق', [journalLine('1300', 'مخزون', 12000, 0, 6, 0), journalLine(bill.payment_account_code, 'استحقاق', 0, 12000, 0, 6)], 2000);
  return { bill, entry };
}

test('B3 purchase return basis remains at original acquisition value after cash settlement and credit bill payment', () => {
  for (const settlement of ['cash', 'credit'] as const) {
    const { bill, entry } = purchase(settlement), before = structuredClone({ bill, entry }), result = buildPurchaseReturnBases(bill, [entry], 'tenant');
    assert.deepEqual(result.bases[0], { source_id: 'bill-source.line-1', quantity: 3, components: { supplier_credit: { sdg: 12000, usd: 6 } } });
    assert.deepEqual(buildPurchaseReturnBases({ ...bill, remaining_sdg: 99999, paid_amount_sdg: 0 }, [entry], 'tenant').bases, result.bases);assert.deepEqual({ bill, entry }, before);
  }
});

test('B3 purchase source proof rejects changed acquisition, paid-account mapping, journals, tenant and duplicate lines', () => {
  const { bill, entry } = purchase();
  const changed = structuredClone(bill); changed.items[0].unit_cost = 3; assert.throws(() => buildPurchaseReturnBases(changed, [entry], 'tenant'));
  const repeated = structuredClone(bill); repeated.items.push({ ...repeated.items[0] }); assert.throws(() => buildPurchaseReturnBases(repeated, [entry], 'tenant'));
  for (const update of [{ payment_account_code: 'bank' }, { org_id: 'foreign' }, { grand_total_usd: 7 }, { journal_id: 'missing' }, { exchange_rate_used: 0 }]) assert.throws(() => buildPurchaseReturnBases({ ...bill, ...update }, [entry], 'tenant'));
  for (const originals of [[], [entry, entry], [{ ...entry, reference_id: 'other' }], [{ ...entry, org_id: 'foreign' }], [{ ...entry, date: '2026-09-30' }], [{ ...entry, total_credit_sdg: 1 }], [{ ...entry, exchange_rate_used: 9000 }]]) assert.throws(() => buildPurchaseReturnBases(bill, originals, 'tenant'));
});
