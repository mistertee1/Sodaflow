import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApi } from '../server/api';
import { MemoryStore } from '../src/domain/store';
import { Organizations } from '../server/organizations';
import { Operations, type Actor } from '../src/domain/operations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { CURRENCIES, currencyDecimals, normalizeWhatsAppPhone, whatsAppUrl } from '../src/lib/currencyCatalog';
import { convertCurrency, formatMoney, invoicePricingBalance } from '../src/lib/currency';
import { fullPaymentAmount } from '../src/domain/financial';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { buildInvoiceHtml, buildInvoiceWhatsAppMessage } from '../src/services/pdfService';
import type { Currency, Invoice } from '../src/types';

// Synthetic rates deliberately do not represent current market prices.
const quotes = { SAR: 4, AED: 4, KWD: .3, QAR: 4, BHD: .4, OMR: .4, EGP: 50 } as const;
const actor: Actor = { uid: 'currency-owner', email: 'currency@example.test', emailVerified: true };
async function fixture(v2 = true) {
  const store = new MemoryStore();
  const org = await new Organizations(store, undefined, undefined, false).create(actor, 'عملات اصطناعية', { ...INITIAL_SETTINGS, default_exchange_rate: 2000, currency_rates: quotes }, 'create', true);
  const root = `organizations/${org.id}`, now = () => new Date('2026-10-22T12:00:00Z');
  const ops = new Operations(store, now, undefined, undefined, false);
  const run = (action: string, data: Record<string, any>, operationId: string = crypto.randomUUID(), who = actor) => ops.execute(org.id, who, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل تجريبي', phone: '50012345', preferred_currency: 'KWD' }, 'customer')).result;
  if (v2) await run('accounting.activate', { reason: 'اختبار اصطناعي' }, 'activate');
  const sale = (currency: Currency, price = 12.345, quantity = 2) => ({ customer_id: customer.id, issue_date: '2026-10-22', currency_mode: 'single_foreign', exchange_rate_used: 2000, discount_type: 'fixed', discount_value: 0, currency_rates_used: { [currency]: quotes[currency as keyof typeof quotes] }, items: [{ description: 'خدمة اختبار', unit: 'ساعة', quantity, unit_price: price, currency, tax_rate: 0, discount_percent: 0 }] });
  const books = async () => { const snapshot = await ops.snapshot(org.id, actor, true); assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings), []); return snapshot; };
  return { store, org, root, ops, run, customer, sale, books };
}

test('all Gulf/Egypt currencies have the correct precision and WhatsApp country code', () => {
  for (const [code, local, international] of [
    ['SDG', '0912345678', '249912345678'], ['SAR', '0501234567', '966501234567'],
    ['AED', '0501234567', '971501234567'], ['KWD', '50012345', '96550012345'],
    ['QAR', '33123456', '97433123456'], ['BHD', '36012345', '97336012345'],
    ['OMR', '92123456', '96892123456'], ['EGP', '01012345678', '201012345678'],
  ]) {
    assert.ok(CURRENCIES.some(row => row.code === code));
    assert.equal(normalizeWhatsAppPhone(local, code), international);
    assert.equal(normalizeWhatsAppPhone('+' + international, 'KWD'), international);
    assert.equal(normalizeWhatsAppPhone('00' + international, 'EGP'), international);
    assert.equal(normalizeWhatsAppPhone(international, 'SAR'), international);
    assert.equal(new URL(whatsAppUrl(local, 'فاتورة + PDF & تفاصيل', code)).searchParams.get('phone'), international);
  }
  assert.equal(normalizeWhatsAppPhone('٠١٠١٢٣٤٥٦٧٨', 'EGP'), '201012345678');
  assert.equal(normalizeWhatsAppPhone('+1 (202) 555-0123', 'SAR'), '12025550123');
  assert.equal(normalizeWhatsAppPhone('50012345 ext 2', 'KWD'), '');
  assert.equal(normalizeWhatsAppPhone('123', 'KWD'), '');
  assert.equal(new URL(whatsAppUrl('', 'رسالة')).searchParams.has('phone'), false);
  for (const currency of ['KWD', 'BHD', 'OMR']) { assert.equal(currencyDecimals(currency), 3); assert.equal(formatMoney(1.234, currency), `1.234 ${currency}`); }
  for (const currency of ['SAR', 'AED', 'QAR', 'EGP']) assert.equal(currencyDecimals(currency), 2);
});

test('currency conversion uses explicit per-USD quotes and rejects missing/invalid cross rates', () => {
  const settings = { currency_rates: quotes };
  assert.equal(convertCurrency(3, 'KWD', 'USD', 2000, settings), 10);
  assert.equal(convertCurrency(10, 'USD', 'KWD', 2000, settings), 3);
  assert.equal(convertCurrency(3, 'KWD', 'EGP', 2000, settings), 500);
  assert.equal(convertCurrency(3, 'KWD', 'SDG', 2000, settings), 20000);
  assert.throws(() => convertCurrency(1, 'KWD', 'USD', 2000), /KWD/);
  assert.throws(() => convertCurrency(1, 'USD', 'KWD', 2000, { currency_rates: { KWD: -1 } }), /KWD/);
});

test('all seven regional currencies post and settle once, preserve native prices and reconcile both books', async () => {
  for (const currency of Object.keys(quotes) as Currency[]) {
    const f = await fixture(), price = currencyDecimals(currency) === 3 ? 12.345 : 12.34;
    const input = f.sale(currency, price), first = await f.run('invoice.create', input, 'sale');
    assert.deepEqual(await f.run('invoice.create', input, 'sale'), first);
    const invoice = first.result as Invoice;
    assert.equal(invoice.pricing?.currency, currency); assert.equal(invoice.pricing?.total, price * 2);
    assert.equal(invoice.customer_phone, '+96550012345');
    assert.equal(invoice.items[0].line_total, price * 2);
    await f.run('settings.update', { updates: { default_transaction_currency: 'EGP', currency_rates: { EGP: 100 }, rounding_rule: 'floor' } }, 'different-settings');
    const payInput = { invoice_id: invoice.id, amount: invoice.pricing!.total, currency, currency_rates_used: { [currency]: quotes[currency as keyof typeof quotes] * 2 }, exchange_rate_used: 3000, payment_method: 'cash' };
    const payment = await f.run('payment.create', payInput, 'pay'); assert.deepEqual(await f.run('payment.create', payInput, 'pay'), payment);
    assert.equal(payment.result.amount, price * 2); assert.equal(payment.result.currency, currency);
    const snapshot = await f.books(); assert.equal(snapshot.collections.payments.length, 1); assert.equal(snapshot.collections.invoices.length, 1);
    const saved = snapshot.collections.invoices[0]; assert.equal(saved.status, 'paid'); assert.equal(saved.remaining_sdg, 0); assert.equal(saved.remaining_usd, 0);
    assert.deepEqual(saved.pricing, invoice.pricing); assert.deepEqual(saved.currency_rates_used, invoice.currency_rates_used);
    assert.equal(snapshot.collections.customers[0].balance_sdg, 0); assert.equal(snapshot.collections.customers[0].balance_usd, 0);
    assert.ok(snapshot.collections.journal_entries.some(row => row.reference_type === 'payment' && row.lines.some((line: any) => line.account_code === '5500')));
    assert.equal(new Operations(f.store, () => new Date('2026-10-22'), undefined, undefined, false).controlsEnabled, false);
  }
});

test('partial KWD receipts use the original native balance after rates change, then close exactly', async () => {
  const f = await fixture(), invoice = (await f.run('invoice.create', f.sale('KWD', 1.234, 3), 'sale')).result as Invoice;
  await f.run('payment.create', { invoice_id: invoice.id, amount: 1.001, currency: 'KWD', currency_rates_used: { KWD: .4 }, exchange_rate_used: 2400, payment_method: 'cash' }, 'part');
  let snapshot = await f.books(), current = snapshot.collections.invoices[0] as Invoice;
  assert.equal(invoicePricingBalance(current), 2.701);
  const due = fullPaymentAmount(current, 'KWD', 4000, { KWD: .6 }); assert.equal(due, 2.701);
  await f.run('payment.create', { invoice_id: invoice.id, amount: due, currency: 'KWD', currency_rates_used: { KWD: .6 }, exchange_rate_used: 4000, payment_method: 'cash' }, 'last');
  snapshot = await f.books(); current = snapshot.collections.invoices[0] as Invoice;
  assert.equal(current.status, 'paid'); assert.equal(invoicePricingBalance(current), 0); assert.equal(current.remaining_sdg, 0); assert.equal(current.remaining_usd, 0);
});

test('native invoices retain source proof for sales corrections and validated backup/restore', async () => {
  const f = await fixture(), invoice = (await f.run('invoice.create', f.sale('KWD', 3, 2), 'sale')).result;
  await f.run('creditNote.create', { invoice_id: invoice.id, date: '2026-10-22', kind: 'price_credit', reason: 'تصحيح تجريبي', lines: [{ line_id: 'line-1', amount: 5 }] }, 'credit');
  let snapshot = await f.books(); assert.equal(snapshot.collections.invoices[0].remaining_usd, 15);
  const payment = { invoice_id: invoice.id, amount: 4.5, currency: 'KWD', currency_rates_used: { KWD: .5 }, exchange_rate_used: 2500, payment_method: 'cash' };
  await f.run('payment.create', payment, 'settle'); snapshot = await f.books();
  const target = await fixture(false);
  // Restore requires an empty company. Use a new verified actor/company, not existing financial records.
  const targetOrg = await new Organizations(target.store, undefined, undefined, false).create({ ...actor, uid: 'restore-owner' }, 'استعادة تجريبية', INITIAL_SETTINGS, 'restore-company', true);
  const targetOps = new Operations(target.store, () => new Date('2026-10-22T12:00:00Z'), undefined, undefined, false);
  await targetOps.execute(targetOrg.id, { ...actor, uid: 'restore-owner' }, { action: 'backup.restore', operationId: 'restore', data: { backup: snapshot } });
  const restored = await targetOps.snapshot(targetOrg.id, { ...actor, uid: 'restore-owner' }, true);
  assert.deepEqual(restored.collections.invoices[0].pricing, invoice.pricing);
  assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData, restored.settings), []);
});

test('invalid currencies, precision, quotes, mixed native prices and overpayment never partially write', async () => {
  const f = await fixture();
  for (const mutate of [
    (sale: any) => { sale.items[0].currency = 'XXX'; },
    (sale: any) => { sale.currency_rates_used.KWD = 0; },
    (sale: any) => { sale.currency_rates_used.KWD = -1; },
    (sale: any) => { sale.items[0].unit_price = 1.0001; },
    (sale: any) => { sale.items.push({ ...sale.items[0], currency: 'USD' }); },
    (sale: any) => { sale.currency_mode = 'dual'; },
  ]) {
    const sale = f.sale('KWD'); mutate(sale); const before = f.store.dump();
    await assert.rejects(f.run('invoice.create', sale)); assert.deepEqual(f.store.dump(), before);
  }
  const invoice = (await f.run('invoice.create', f.sale('KWD', 1, 1))).result;
  const before = f.store.dump();
  await assert.rejects(f.run('payment.create', { invoice_id: invoice.id, amount: 1.001, currency: 'KWD', currency_rates_used: { KWD: .3 }, exchange_rate_used: 2000, payment_method: 'cash' }), /تتجاوز/);
  await assert.rejects(f.run('invoice.create', f.sale('SAR', 1, 1), 'foreign', { ...actor, uid: 'foreign' }), (error: any) => error.status === 403);
  assert.deepEqual(f.store.dump(), before);
});

test('PDF and WhatsApp use the frozen native quote, including milliunits, after settings change', async () => {
  const f = await fixture(), invoice = (await f.run('invoice.create', f.sale('KWD', 1.234, 1))).result as Invoice;
  const settings = { ...INITIAL_SETTINGS, default_transaction_currency: 'EGP' as Currency, currency_rates: { EGP: 999 }, business_name: 'اختبار' };
  const html = buildInvoiceHtml(invoice, settings), text = buildInvoiceWhatsAppMessage(invoice, settings);
  assert.match(html, /1\.234 KWD/); assert.match(text, /1\.234 KWD/); assert.match(html, /1 USD = 0\.3 KWD/);
  assert.doesNotMatch(html, /999 EGP/);
});

test('native invoicing works before accounting activation and keeps valid source evidence when V2 is activated', async () => {
  const f = await fixture(false), invoice = (await f.run('invoice.create', f.sale('BHD', 1.111, 2), 'sale')).result;
  await f.run('payment.create', { invoice_id: invoice.id, amount: .111, currency: 'BHD', currency_rates_used: { BHD: .5 }, exchange_rate_used: 2100, payment_method: 'cash' }, 'pay');
  await f.run('accounting.activate', { reason: 'اختبار حفظ المصدر بعد الترقية' }, 'activate-after-sale');
  const snapshot = await f.books(); assert.equal(snapshot.org.accounting_version, 2);
  assert.equal(snapshot.collections.invoices[0].pricing_remaining, 2.111);
});

test('HTTP commands enforce authentication/tenant isolation and compute native totals on the server', async () => {
  const f = await fixture(), app = express(); app.use(express.json());
  app.use('/api', createApi({ operations: f.ops, verify: async token => { if (token !== 'owner' && token !== 'foreign') throw Error('Invalid synthetic token'); return token === 'owner' ? actor : { ...actor, uid: 'foreign' }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/operations`;
  const command = { action: 'invoice.create', operationId: 'http-sale', data: { ...f.sale('KWD', 3, 1), pricing: { currency: 'KWD', total: .001 }, grand_total_usd: .01 } };
  try {
    const post = (token?: string) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(command) });
    assert.equal((await post()).status, 401); assert.equal((await post('foreign')).status, 403);
    const response = await post('owner'); assert.equal(response.status, 200);
    const result = (await response.json()).result; assert.equal(result.pricing.total, 3); assert.equal(result.grand_total_usd, 10);
    const duplicate = await post('owner'); assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).result.id, result.id);
    assert.equal((await f.books()).collections.invoices.length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('native inventory sales and physical returns preserve original WAC costs and exact carrying values', async () => {
  const f = await fixture(false);
  const product = (await f.run('product.create', { name: 'صنف دينار', unit: 'قطعة', price_sdg: 20000, price_usd: 10, tax_rate: 0, track_inventory: true, is_active: true, stock_quantity: 10 }, 'product')).result;
  await f.run('product.cost.establish', { id: product.id, cost_currency: 'USD', unit_cost: 1, exchange_rate_used: 2000, reason: 'تكلفة تجريبية' }, 'cost');
  await f.run('accounting.activate', { reason: 'اختبار المخزون' }, 'activate');
  const sale = f.sale('KWD', 3, 2); (sale.items[0] as any).product_id = product.id;
  const invoice = (await f.run('invoice.create', sale, 'sale')).result;
  await f.run('creditNote.create', { invoice_id: invoice.id, date: '2026-10-22', kind: 'sales_return', reason: 'مردود تجريبي', lines: [{ line_id: 'line-1', quantity: 1 }] }, 'return');
  const snapshot = await f.books();
  assert.equal(snapshot.collections.products[0].stock_quantity, 9);
  assert.equal(snapshot.collections.products[0].inventory_value_usd, 9);
  assert.equal(snapshot.collections.invoices[0].pricing_remaining, 3);
  assert.equal(snapshot.collections.invoices[0].remaining_usd, 10);
});

test('voiding a native invoice clears both native and accounting due balances without changing the original quote', async () => {
  const f = await fixture(), invoice = (await f.run('invoice.create', f.sale('OMR', 2.345, 1), 'sale')).result;
  await f.run('invoice.void', { id: invoice.id, reason: 'اختبار إبطال' }, 'void');
  const snapshot = await f.books(), saved = snapshot.collections.invoices[0];
  assert.equal(saved.status, 'void'); assert.equal(saved.pricing_remaining, 0); assert.equal(saved.remaining_usd, 0);
  assert.deepEqual(saved.pricing, invoice.pricing);
});
