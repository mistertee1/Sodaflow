import BigNumber from 'bignumber.js';
import type { Invoice, JournalEntry, MerchantSettings } from '../types';
import { calculateLineItem, convertCurrency } from '../lib/currency';
import { invoiceFinancials } from './financial';
import { dateOnly, ensure, identifier, money, validateJournal } from './validation';
import type { BookAmount, ReturnBasis } from './returnQuotes';
import type { PurchaseBill } from './payables';
import { acquisitionCost } from './inventoryCost';

const books = ['sdg', 'usd'] as const;
const fields = ['subtotal_sdg', 'subtotal_usd', 'discount_total_sdg', 'discount_total_usd', 'tax_total_sdg', 'tax_total_usd', 'grand_total_sdg', 'grand_total_usd'] as const;
const rules = ['round', 'ceil', 'floor'] as const;

/** Recover only a source-proven original rounding policy; today's settings are never an input. */
export function buildSalesReturnBases(invoice: Invoice, originals: JournalEntry[], expectedOrgId: string) {
  identifier(expectedOrgId); identifier(invoice.id);
  ensure(invoice.org_id === expectedOrgId, 'مصدر المردود يتبع مؤسسة أخرى.', 403);
  ensure(['sent', 'paid', 'partially_paid', 'overdue'].includes(invoice.status), 'الفاتورة ليست مصدراً مرحّلاً صالحاً للمردود.', 409);
  const issueDate = dateOnly(invoice.issue_date);
  ensure(Array.isArray(invoice.items) && invoice.items.length > 0 && invoice.items.length <= 100, 'بنود مصدر المردود غير صالحة.');
  const ids = new Set<string>();
  for (const item of invoice.items) {
    identifier(item.id); ensure(!ids.has(item.id), 'معرف بند الفاتورة الأصلية مكرر.'); ids.add(item.id);
    money(item.line_total, item.currency === 'USD' ? 2 : 0);
  }
  for (const field of fields) money(invoice[field], field.endsWith('_usd') ? 2 : 0);
  ensure(Array.isArray(originals) && originals.length === 1, 'قيد إصدار الفاتورة ناقص أو مكرر.', 409);
  const original = originals[0];
  ensure(original.org_id === expectedOrgId && original.reference_type === 'invoice' && original.reference_id === invoice.id && dateOnly(original.date) === issueDate, 'قيد الإصدار لا يطابق مصدر المردود.', 409);
  money(original.exchange_rate_used, 8); ensure(original.exchange_rate_used === invoice.exchange_rate_used, 'سعر صرف مصدر المردود لا يطابق قيد الإصدار.', 409);
  const checked = validateJournal(original.lines);
  ensure(original.is_balanced === true && (Object.keys(checked) as (keyof typeof checked)[]).every(key => checked[key] === original[key]), 'إجماليات قيد الإصدار لا تطابق أطرافه.', 409);
  const cogs: BookAmount = { sdg: 0, usd: 0 };
  for (const item of invoice.items) {
    ensure(['valued', 'unknown', 'not_tracked'].includes(item.cost_status || ''), 'حالة تكلفة المصدر غير موثقة.', 409);
    if (item.cost_status === 'valued') {
      dateOnly(item.cost_recorded_at); money(item.total_cost_sdg, 0); money(item.total_cost_usd, 2);
      cogs.sdg = new BigNumber(cogs.sdg).plus(item.total_cost_sdg!).toNumber();
      cogs.usd = new BigNumber(cogs.usd).plus(item.total_cost_usd!).toNumber();
    }
  }
  for (const book of books) {
    money(invoice[`cogs_${book}`], book === 'sdg' ? 0 : 2);
    ensure(new BigNumber(cogs[book]).eq(invoice[`cogs_${book}`]!), 'تكلفة المصدر لا تطابق لقطات البنود.', 409);
  }
  const expected: Record<string, { debit: BookAmount; credit: BookAmount }> = {
    '1200': { debit: { sdg: invoice.grand_total_sdg, usd: invoice.grand_total_usd }, credit: { sdg: 0, usd: 0 } },
    '4100': { debit: { sdg: 0, usd: 0 }, credit: { sdg: new BigNumber(invoice.grand_total_sdg).minus(invoice.tax_total_sdg).toNumber(), usd: new BigNumber(invoice.grand_total_usd).minus(invoice.tax_total_usd).toNumber() } },
    '2130': { debit: { sdg: 0, usd: 0 }, credit: { sdg: invoice.tax_total_sdg, usd: invoice.tax_total_usd } },
    '5100': { debit: cogs, credit: { sdg: 0, usd: 0 } },
    '1300': { debit: { sdg: 0, usd: 0 }, credit: cogs },
  };
  ensure(original.lines.every(line => expected[line.account_code]), 'قيد الإصدار يحتوي على حساب غير معتمد لأساس المردود.', 409);
  for (const [code, amounts] of Object.entries(expected)) for (const side of ['debit', 'credit'] as const) for (const book of books) {
    money(amounts[side][book], book === 'sdg' ? 0 : 2);
    const posted = original.lines.filter(line => line.account_code === code).reduce((n, line) => n.plus(line[`${side}_${book}`]), new BigNumber(0));
    ensure(posted.eq(amounts[side][book]), 'القيمة الأصلية لا تطابق الإيراد/الضريبة/التكلفة في قيد الإصدار.', 409);
  }
  const candidates: { rule: typeof rules[number]; bases: ReturnBasis[] }[] = [];
  for (const rule of rules) {
    const settings = { sdg_decimals: 0, usd_decimals: 2, rounding_rule: rule } as MerchantSettings;
    const computed = invoiceFinancials(invoice, settings);
    if (!fields.every(field => computed[field] === invoice[field]) || !computed.items.every((item, index) => item.line_total === invoice.items[index].line_total)) continue;
    const components = invoice.items.map(item => {
      const source = calculateLineItem(item.quantity, item.unit_price, item.discount_percent, item.tax_rate, item.currency === 'USD' ? 2 : 0, rule);
      const translated = (amount: number, book: typeof books[number]) => item.currency === (book === 'sdg' ? 'SDG' : 'USD') ? amount : invoice.exchange_rate_used > 0 ? convertCurrency(amount, item.currency, book === 'sdg' ? 'SDG' : 'USD', invoice.exchange_rate_used, settings) : 0;
      return { net: { sdg: translated(source.net, 'sdg'), usd: translated(source.net, 'usd') }, tax: { sdg: translated(source.tax, 'sdg'), usd: translated(source.tax, 'usd') } };
    });
    const cumulative: BookAmount = { sdg: 0, usd: 0 };
    const bases = invoice.items.map((item, index): ReturnBasis => {
      const revenue: BookAmount = { sdg: 0, usd: 0 };
      for (const book of books) {
        const before = new BigNumber(cumulative[book]), after = before.plus(components[index].net[book]), total = invoice[`subtotal_${book}`], posted = expected['4100'].credit[book];
        const entitlement = (value: BigNumber) => total ? value.eq(total) ? new BigNumber(posted) : new BigNumber(posted).times(value).div(total).decimalPlaces(book === 'sdg' ? 0 : 2, BigNumber.ROUND_HALF_UP) : new BigNumber(0);
        revenue[book] = entitlement(after).minus(entitlement(before)).toNumber(); cumulative[book] = after.toNumber();
      }
      const sourceId = `${invoice.id}.${item.id}`; identifier(sourceId);
      return { source_id: sourceId, quantity: item.quantity, components: { revenue, tax: components[index].tax, ...(item.cost_status === 'valued' ? { cost: { sdg: item.total_cost_sdg!, usd: item.total_cost_usd! } } : {}) } };
    });
    for (const book of books) {
      ensure(new BigNumber(cumulative[book]).eq(invoice[`subtotal_${book}`]), 'أساس بنود المصدر لا يطابق إجماليه.', 409);
      for (const [component, target] of [['revenue', expected['4100'].credit[book]], ['tax', invoice[`tax_total_${book}`]], ['cost', cogs[book]]] as const) {
        ensure(bases.reduce((n, base) => n.plus(base.components[component]?.[book] || 0), new BigNumber(0)).eq(target), 'توزيع مصدر المردود لا يحفظ القيمة الأصلية.', 409);
      }
    }
    candidates.push({ rule, bases });
  }
  ensure(candidates.length > 0, 'سياسة التقريب الأصلية لا تطابق الفاتورة والقيد؛ يلزم مراجعة المصدر.', 409);
  ensure(candidates.every(candidate => JSON.stringify(candidate.bases) === JSON.stringify(candidates[0].bases)), 'سياسة التقريب الأصلية ملتبسة لبنود المردود؛ يلزم أساس موثق.', 409);
  return { invoice_id: invoice.id, journal_id: original.id, issue_date: issueDate, org_id: expectedOrgId, rounding_rule: candidates[0].rule, bases: candidates[0].bases, cost_statuses: Object.fromEntries(invoice.items.map(item => [`${invoice.id}.${item.id}`, item.cost_status])) };
}

/** Purchase returns use original net acquisition values even after payment or stock WAC changes. */
export function buildPurchaseReturnBases(bill: PurchaseBill & { payment_account_code: string }, originals: JournalEntry[], expectedOrgId: string) {
  identifier(expectedOrgId); identifier(bill.id); identifier(bill.supplier_id); identifier(bill.payment_account_code);
  ensure(bill.org_id === expectedOrgId, 'مصدر مردود الشراء يتبع مؤسسة أخرى.', 403);
  const issueDate = dateOnly(bill.issue_date);
  ensure(['SDG', 'USD'].includes(bill.currency) && ['credit', 'cash'].includes(bill.settlement), 'مصدر مردود الشراء غير صالح.');
  ensure(['open', 'partially_paid', 'paid'].includes(bill.status), 'حالة مصدر مردود الشراء غير صالحة.');
  ensure(bill.settlement !== 'credit' || bill.payment_account_code === '2110', 'حساب ذمم مصدر الشراء مختلف.');
  ensure(bill.settlement !== 'cash' || !['2110', '1300'].includes(bill.payment_account_code), 'حساب السداد النقدي الأصلي غير صالح.');
  money(bill.exchange_rate_used, 8);
  ensure(Array.isArray(bill.items) && bill.items.length > 0 && bill.items.length <= 100, 'بنود مصدر مردود الشراء غير صالحة.');
  const ids = new Set<string>();
  const bases = bill.items.map((item): ReturnBasis => {
    identifier(item.id); identifier(item.product_id); ensure(!ids.has(item.id), 'معرف بند الشراء الأصلي مكرر.'); ids.add(item.id);
    const value = acquisitionCost(item.quantity, { cost_currency: bill.currency, unit_cost: item.unit_cost, exchange_rate_used: bill.exchange_rate_used, zero_cost_reason: item.zero_cost_reason });
    ensure(new BigNumber(value.sdg).eq(item.value_sdg) && new BigNumber(value.usd).eq(item.value_usd), 'قيمة بند الشراء لا تطابق تكلفة الاستلام الأصلية.', 409);
    const sourceId = `${bill.id}.${item.id}`; identifier(sourceId);
    return { source_id: sourceId, quantity: item.quantity, components: { supplier_credit: value } };
  });
  const total: BookAmount = { sdg: 0, usd: 0 };
  for (const book of books) {
    money(bill[`grand_total_${book}`], book === 'sdg' ? 0 : 2);
    total[book] = bases.reduce((n, base) => n.plus(base.components.supplier_credit[book]), new BigNumber(0)).toNumber();
    ensure(new BigNumber(total[book]).eq(bill[`grand_total_${book}`]), 'إجمالي الشراء لا يطابق البنود الأصلية.', 409);
  }
  ensure(total.sdg > 0 || total.usd > 0, 'مصدر الشراء يجب أن يكون ذا قيمة مالية.');
  ensure(Array.isArray(originals) && originals.length === 1, 'قيد الشراء ناقص أو مكرر.', 409);
  const original = originals[0];
  ensure(original.id === bill.journal_id && original.org_id === expectedOrgId && original.reference_type === 'purchase_bill' && original.reference_id === bill.id && dateOnly(original.date) === issueDate, 'قيد الشراء لا يطابق المصدر.', 409);
  money(original.exchange_rate_used, 8); ensure(original.exchange_rate_used === bill.exchange_rate_used, 'سعر صرف الشراء لا يطابق قيد المصدر.', 409);
  const checked = validateJournal(original.lines);
  ensure(original.is_balanced === true && (Object.keys(checked) as (keyof typeof checked)[]).every(key => checked[key] === original[key]), 'إجماليات قيد الشراء لا تطابق أطرافه.', 409);
  ensure(original.lines.every(line => ['1300', bill.payment_account_code].includes(line.account_code)), 'قيد الشراء يتضمن حساباً مختلفاً.', 409);
  for (const book of books) for (const [code, side] of [['1300', 'debit'], [bill.payment_account_code, 'credit']] as const) {
    const opposite = side === 'debit' ? 'credit' : 'debit';
    const matching = original.lines.filter(line => line.account_code === code);
    ensure(matching.reduce((n, line) => n.plus(line[`${side}_${book}`]), new BigNumber(0)).eq(total[book]) && matching.every(line => line[`${opposite}_${book}`] === 0), 'قيمة الشراء لا تطابق مخزونه/سداد مصدره.', 409);
  }
  return { bill_id: bill.id, journal_id: original.id, issue_date: issueDate, org_id: expectedOrgId, bases };
}
