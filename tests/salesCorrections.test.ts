import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Operations, type Actor } from '../src/domain/operations';
import { MemoryStore, type Store } from '../src/domain/store';
import { Organizations } from '../server/organizations';
import { createApi } from '../server/api';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
const owner: Actor = { uid: 'correction-owner', email: 'correction@example.com', emailVerified: true };

async function fixture(cost = 20) {
  const store = new MemoryStore(), org = await new Organizations(store).create(owner, 'تصحيحات', INITIAL_SETTINGS, 'setup', true), root = `organizations/${org.id}`;
  await store.transaction(async tx => tx.set(root, { ...await tx.get(root), planId: 'Enterprise', subscriptionEnd: '2027-01-01' }));
  let clock = new Date('2026-10-05T12:00:00Z');
  const ops = new Operations(store, () => clock);
  const run = (action: string, data: Record<string, unknown>, operationId: string = crypto.randomUUID(), actor = owner) => ops.execute(org.id, actor, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل', phone: '', preferred_currency: 'USD' }, 'customer')).result;
  const product = (await run('product.create', { name: 'صنف', unit: 'قطعة', price_sdg: 200000, price_usd: 100, tax_rate: 0, track_inventory: true, is_active: true, stock_quantity: 10 }, 'product')).result;
  await run('product.cost.establish', { id: product.id, cost_currency: 'USD', unit_cost: cost, exchange_rate_used: 2000, ...(cost === 0 ? { zero_cost_reason: 'عينة مجانية موثقة' } : {}), reason: 'افتتاحي موثق' }, 'cost');
  await run('accounting.activate', { reason: 'مطابقة' }, 'activate');
  const line = { product_id: product.id, description: 'صنف', unit: 'قطعة', quantity: 1, unit_price: 100, currency: 'USD', tax_rate: 0, discount_percent: 0 };
  const sale = { customer_id: customer.id, issue_date: '2026-10-05', due_date: '2026-10-06', currency_mode: 'single_usd', exchange_rate_used: 2000, discount_type: 'fixed', discount_value: 0, items: [line, { ...line, quantity: 2 }] };
  const invoice = (await run('invoice.create', sale, 'sale')).result;
  clock = new Date('2026-10-07T12:00:00Z');
  const cash = (await run('financialAccount.create', { name: 'صندوق دولار', account_code: '1120', currency: 'USD', kind: 'cash' }, 'cash')).result;
  const note = (kind = 'price_credit', lines: Record<string, unknown>[] = [{ line_id: 'line-1', amount: 20 }], date = '2026-10-07') => ({ invoice_id: invoice.id, date, kind, reason: 'تصحيح موثق', lines });
  const refund = (amount = 20, date = '2026-10-07') => ({ invoice_id: invoice.id, date, financial_account_id: cash.id, amount, exchange_rate_used: 3000, reason: 'رد مثبت' });
  const pay = (amount = 300) => ({ invoice_id: invoice.id, amount, currency: 'USD', exchange_rate_used: 2000, payment_method: 'cash' });
  const books = async () => { const snapshot = await ops.snapshot(org.id, owner, true); assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings, { requireCosting: true }), []); return snapshot; };
  return { store, org, root, ops, run, customer, product, invoice, cash, sale, note, refund, pay, books };
}

test('B3 transactional price credit offsets unpaid debt without cash or cost; payment consumes corrected carrying value once', async () => {
  const f = await fixture(), result = await f.run('creditNote.create', f.note(), 'credit'); assert.deepEqual(await f.run('creditNote.create', f.note(), 'credit'), result);
  let s = await f.books(); assert.equal(s.collections.invoices[0].remaining_usd, 280); assert.equal(s.collections.invoices[0].credited_amount_usd, 20); assert.equal(s.collections.products[0].stock_quantity, 7); assert.equal(s.collections.products[0].inventory_value_usd, 140);
  const before = f.store.dump(); await assert.rejects(f.run('customerRefund.create', f.refund(), 'unearned'), /رصيد مصدر دائن/); assert.deepEqual(f.store.dump(), before);
  await f.run('payment.create', f.pay(280), 'settle'); s = await f.books(); assert.equal(s.collections.invoices[0].remaining_usd, 0); assert.equal(s.collections.invoices[0].paid_amount_usd, 280); assert.equal(s.collections.credit_notes.length, 1); assert.equal(s.collections.customer_refunds.length, 0);
  const historical = await f.ops.operationalReport(f.org.id, owner, 'receivables', { end: '2026-10-06' }); assert.equal(historical.total_usd, 300);
  const dated = await f.ops.operationalReport(f.org.id, owner, 'receivables', { start: '2026-10-07', end: '2026-10-07' }); assert.equal(dated.total_usd, 0); assert.equal(dated.unallocated_usd, 0); assert.equal(dated.statements[0].opening_usd, 300); assert.equal(dated.statements[0].rows.length, 2);
});

test('B3 price then physical return aggregates repeated products, restores original costs after WAC changed, and blocks direct void', async () => {
  const f = await fixture(); await f.run('creditNote.create', f.note(), 'price');
  await f.run('inventory.receive', { id: f.product.id, quantity: 1, cost_currency: 'USD', unit_cost: 50, exchange_rate_used: 2000, payment_method: 'cash', reason: 'شراء لاحق' }, 'receipt');
  const result = await f.run('creditNote.create', f.note('sales_return', [{ line_id: 'line-1', quantity: 1 }, { line_id: 'line-2', quantity: 2 }]), 'return');
  assert.equal(result.result.credit_usd, 280); assert.equal(result.result.restored_cost_usd, 60);
  const s = await f.books(), moves = s.collections.inventory_movements.filter(row => row.reference_type === 'credit_note'); assert.equal(moves.length, 1); assert.equal(moves[0].quantity, 3); assert.equal(moves[0].value_delta_usd, 60); assert.equal(s.collections.products[0].stock_quantity, 11); assert.equal(s.collections.products[0].inventory_value_usd, 250);
  await assert.rejects(f.run('invoice.void', { id: f.invoice.id, reason: 'إبطال غير مسموح' }, 'void'), /المصححة/);
  await assert.rejects(f.run('creditNote.create', f.note('sales_return', [{ line_id: 'line-1', quantity: 1 }]), 'twice'), /الكمية|المتبقية|المصدر/);
});

test('B3 paid invoice credits create distinct source and customer credit; actual refunds relieve historical AR and post payment FX', async () => {
  const f = await fixture(); await f.run('payment.create', f.pay(), 'pay'); await f.run('creditNote.create', f.note(), 'credit');
  let s = await f.books(); assert.equal(s.collections.invoices[0].credit_balance_usd, 20); assert.equal(s.collections.customers[0].balance_usd, -20); assert.equal(s.collections.customers[0].credit_balance_usd, 20);
  const result = await f.run('customerRefund.create', f.refund(), 'refund'); assert.equal(result.result.settled_amount_sdg, 40000); assert.equal(result.result.cash_amount_sdg, 60000); assert.deepEqual(await f.run('customerRefund.create', f.refund(), 'refund'), result);
  s = await f.books(); assert.equal(s.collections.invoices[0].refunded_amount_usd, 20); assert.equal(s.collections.invoices[0].credit_balance_usd, 0); assert.equal(s.collections.customers[0].balance_usd, 0);
  const journal = s.collections.journal_entries.find(row => row.reference_type === 'customer_refund')!; assert.equal(journal.lines.find((line: any) => line.account_code === '5500').debit_sdg, 20000);
  const report = await f.ops.operationalReport(f.org.id, owner, 'receivables', { end: '2026-10-07' }); assert.equal(report.total_usd, 0); assert.equal(report.unallocated_sdg, 0);
  const cash = await f.ops.operationalReport(f.org.id, owner, 'cash', { start: '2026-10-07', end: '2026-10-07' }); assert.equal(cash.outflow_usd, 20); assert.equal(cash.inflow_usd, 300);
  const audit = f.store.dump()[`${f.root}/audit_logs/audit-refund`]; assert.equal(audit.actor_role, 'Owner'); assert.equal(audit.reason, 'رد مثبت'); assert.equal(audit.previous_state[`${f.root}/invoices/${f.invoice.id}`].credit_balance_usd, 20);
});

test('B3 concurrent overreturns and overrefunds serialize; identical retries never duplicate source, stock or journal', async () => {
  const f = await fixture(); await f.run('payment.create', f.pay(), 'pay');
  const returns = await Promise.allSettled(['a', 'b'].map(id => f.run('creditNote.create', f.note('sales_return', [{ line_id: 'line-1', quantity: 1 }]), `return-${id}`))); assert.equal(returns.filter(row => row.status === 'fulfilled').length, 1);
  const refunds = await Promise.allSettled(['a', 'b'].map(id => f.run('customerRefund.create', f.refund(80), `refund-${id}`))); assert.equal(refunds.filter(row => row.status === 'fulfilled').length, 1);
  const winner = refunds[0].status === 'fulfilled' ? 'refund-a' : 'refund-b'; await f.run('customerRefund.create', f.refund(80), winner);
  const s = await f.books(); assert.equal(s.collections.credit_notes.length, 1); assert.equal(s.collections.customer_refunds.length, 1); assert.equal(s.collections.invoices[0].credit_balance_usd, 20); assert.equal(s.collections.products[0].stock_quantity, 8);
});

test('B3 zero original cost and exhausted price produce physical-only evidence without an invented zero-value journal', async () => {
  const f = await fixture(0); await f.run('creditNote.create', f.note('price_credit', [{ line_id: 'line-1', amount: 100 }]), 'all-price');
  const before = (await f.books()).collections.journal_entries.length;
  const result = await f.run('creditNote.create', f.note('sales_return', [{ line_id: 'line-1', quantity: 1 }]), 'zero-return'); assert.equal(result.result.journal_id, undefined);
  const s = await f.books(); assert.equal(s.collections.journal_entries.length, before); assert.equal(s.collections.products[0].stock_quantity, 8); assert.equal(s.collections.inventory_movements.at(-1)!.value_delta_usd, 0);
});

test('B3 other-invoice customer credits do not prevent payment of a separate debt; void keeps due/credit pools reconciled', async () => {
  const f = await fixture(); await f.run('payment.create', f.pay(), 'pay'); await f.run('creditNote.create', f.note('price_credit', [{ line_id: 'line-1', amount: 100 }]), 'credit');
  const second = (await f.run('invoice.create', { ...f.sale, items: [{ ...f.sale.items[0], unit_price: 50 }] }, 'second')).result;
  let s = await f.books(); assert.equal(s.collections.customers[0].balance_usd, -50); assert.equal(s.collections.customers[0].receivable_due_usd, 50); assert.equal(s.collections.customers[0].credit_balance_usd, 100);
  await f.run('payment.create', { ...f.pay(50), invoice_id: second.id }, 'separate-payment'); await f.books();
  const third = (await f.run('invoice.create', { ...f.sale, items: [{ ...f.sale.items[0], quantity: 1 }] }, 'third')).result;
  await f.run('invoice.void', { id: third.id, reason: 'إبطال غير محصل' }, 'void'); s = await f.books(); assert.equal(s.collections.customers[0].balance_usd, -100); assert.equal(s.collections.customers[0].receivable_due_usd, 0);
});

test('B3 strict source/history/tenant/date/line limits reject tampering atomically and retain original issue rounding', async () => {
  const f = await fixture();
  for (const patch of [{ lines: [{ line_id: 'missing', amount: 1 }] }, { lines: [{ line_id: 'line-1', amount: 101 }] }, { lines: [{ line_id: 'line-1', amount: 1 }, { line_id: 'line-1', amount: 1 }] }, { lines: [{ line_id: 'line-1', amount: 1, allocated: { revenue: 1 } }] }, { invoice_id: 'foreign' }, { date: '2026-10-04' }, { credit_usd: 1 }, { kind: 'sales_return', lines: [{ line_id: 'line-1', quantity: 2 }] }]) { const before = f.store.dump(); await assert.rejects(f.run('creditNote.create', { ...f.note(), ...patch })); assert.deepEqual(f.store.dump(), before); }
  await f.run('creditNote.create', f.note(), 'credit');
  await f.store.transaction(async tx => { const path = `${f.root}/credit_notes/cn-credit`, row = await tx.get(path); tx.set(path, { ...row, lines: [{ ...row!.lines[0], allocated: { revenue: { sdg: 40001, usd: 20 }, tax: { sdg: 0, usd: 0 } } }] }); });
  const before = f.store.dump(); await assert.rejects(f.run('creditNote.create', f.note(), 'tampered'), /توزيع/); assert.deepEqual(f.store.dump(), before);
});

test('B3 original per-product sale quantity, cost and source links must be proven before posting or reporting a correction', async () => {
  const f = await fixture(), snapshot = await f.books();
  const movement = snapshot.collections.inventory_movements.find(row => row.type === 'SALE' && row.reference_id === f.invoice.id)!;
  await f.run('creditNote.create', f.note(), 'seed-credit');
  const path = `${f.root}/inventory_movements/${movement.id}`;
  for (const patch of [{ quantity: -2 }, { value_delta_usd: -61 }, { value_delta_sdg: -120001 }, { org_id: 'foreign' }, { journal_id: 'wrong' }, { product_id: 'wrong' }]) {
    await f.store.transaction(async tx => tx.set(path, { ...movement, ...patch }));
    const before = f.store.dump();
    await assert.rejects(f.run('creditNote.create', f.note('sales_return', [{ line_id: 'line-1', quantity: 1 }]), crypto.randomUUID()), /حركة البيع الأصلية/);
    await assert.rejects(f.ops.operationalReport(f.org.id, owner, 'receivables', { end: '2026-10-07' }), /حركة البيع الأصلية/);
    assert.deepEqual(f.store.dump(), before);
  }
  await f.store.transaction(async tx => { tx.set(path, movement); tx.set(`${f.root}/inventory_movements/duplicate`, { ...movement, id: 'duplicate' }); });
  const duplicated = f.store.dump(); await assert.rejects(f.run('creditNote.create', f.note(), 'duplicate'), /ناقصة أو مكررة/); assert.deepEqual(f.store.dump(), duplicated);
  await f.store.transaction(async tx => { tx.delete(`${f.root}/inventory_movements/duplicate`); tx.delete(path); });
  const missing = f.store.dump(); await assert.rejects(f.run('payment.create', f.pay(280), 'missing'), /ناقصة أو مكررة/); assert.deepEqual(f.store.dump(), missing);
  await f.store.transaction(async tx => tx.set(path, movement));
  await f.run('creditNote.create', f.note(), 'valid'); await f.books();
});

test('B3 cash funds, account state, later cash spending and source chronology protect refunds', async () => {
  const f = await fixture(); await f.run('payment.create', f.pay(), 'pay'); await f.run('creditNote.create', f.note(), 'credit');
  await f.run('expense.create', { title: 'صرف', amount: 290, currency: 'USD', exchange_rate_used: 2000, date: '2026-10-08', payment_method: 'cash' }, 'later');
  await assert.rejects(f.run('customerRefund.create', f.refund(), 'backdated'), /يوم لاحق/);
  await f.run('financialAccount.update', { id: f.cash.id, updates: { status: 'inactive' } }, 'inactive'); await assert.rejects(f.run('customerRefund.create', f.refund(5), 'inactive-refund'), /نشط/);
  await f.run('financialAccount.update', { id: f.cash.id, updates: { status: 'active' } }, 'active');
  await assert.rejects(f.run('customerRefund.create', f.refund(20, '2026-10-08'), 'insufficient'), /غير كاف/);
  await assert.rejects(f.run('customerRefund.create', f.refund(5, '2026-10-06'), 'past-source'), /آخر حركة/);
  await f.books();
});

test('B3 role, live entitlement, closed period and verified server rules checks precede cached correction retries', async () => {
  const f = await fixture(); await f.run('creditNote.create', f.note(), 'credit');
  const sales = { ...owner, uid: 'sales' }; await f.store.transaction(async tx => tx.set(`${f.root}/members/sales`, { uid: 'sales', role: 'Sales', status: 'active' })); await assert.rejects(f.run('creditNote.create', f.note(), 'sales-credit', sales), /صلاحية/); assert.deepEqual((await f.ops.snapshot(f.org.id, sales)).collections.credit_notes, []);
  const browser: Store = { authority: 'browser', transaction: work => f.store.transaction(work) }, server: Store = { authority: 'server', transaction: work => f.store.transaction(work) };
  for (const store of [browser, server]) await assert.rejects(new Operations(store).execute(f.org.id, owner, { action: 'creditNote.create', data: f.note(), operationId: 'credit' }), /الخادم|قواعد/);
  await f.run('settings.update', { updates: { period_lock_date: '2026-10-07' } }, 'lock'); await assert.rejects(f.run('creditNote.create', f.note(), 'credit'), /مقفلة/);
  await f.store.transaction(async tx => tx.set(f.root, { ...await tx.get(f.root), subscriptionEnd: '2026-10-01' })); await assert.rejects(f.run('creditNote.create', f.note(), 'credit'), /انتهى|منتهي|الاشتراك/);
});

test('B3 signed-credit backup and restore retains immutable source history, sequences and original costs, rejects dropped or altered sources', async () => {
  const f = await fixture(); await f.run('payment.create', f.pay(), 'pay'); await f.run('creditNote.create', f.note('sales_return', [{ line_id: 'line-1', quantity: 1 }]), 'return'); await f.run('customerRefund.create', f.refund(20), 'refund');
  const backup = await f.books(), actor = { ...owner, uid: 'restorer' }, org = await new Organizations(f.store).create(actor, 'استعادة', INITIAL_SETTINGS, 'restore', true);
  await f.store.transaction(async tx => tx.set(`organizations/${org.id}`, { ...await tx.get(`organizations/${org.id}`), planId: 'Enterprise', subscriptionEnd: '2027-01-01' }));
  for (const mutate of [(b: any) => { delete b.collections.credit_notes; }, (b: any) => { b.collections.credit_notes[0].lines[0].quantity = 2; }, (b: any) => { b.collections.customer_refunds[0].available_credit_usd++; }, (b: any) => { b.collections.inventory_movements.find((r: any) => r.reference_type === 'credit_note').value_delta_usd++; }, (b: any) => { b.collections.invoices[0].source_event_sequence++; }]) {
    const bad = structuredClone(backup); mutate(bad); const before = f.store.dump(); await assert.rejects(f.ops.execute(org.id, actor, { action: 'backup.restore', operationId: crypto.randomUUID(), data: { backup: bad } }), /فروقات/); assert.deepEqual(f.store.dump(), before);
  }
  await f.ops.execute(org.id, actor, { action: 'backup.restore', operationId: 'restore', data: { backup } });
  const restored = await f.ops.snapshot(org.id, actor, true); assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData, restored.settings, { requireCosting: true }), []); assert.equal(restored.collections.customers[0].balance_usd, -80); assert.equal(restored.counters.credit_note_count, 1);
  await f.ops.execute(org.id, actor, { action: 'customerRefund.create', operationId: 'after-restore', data: { ...f.refund(10), exchange_rate_used: 2000 } });
  const final = await f.ops.snapshot(org.id, actor, true); assert.deepEqual(reconcileFinancialData(final.collections as FinancialData, final.settings, { requireCosting: true }), []); assert.equal(final.collections.invoices[0].credit_balance_usd, 70);
});

test('B3 HTTP correction API returns committed documents only and rejects unauthenticated/foreign/protected payload requests', async () => {
  const f = await fixture(), app = express(); app.use(express.json()); app.use('/api', createApi({ operations: f.ops, verify: async token => { if (token !== 'valid') throw Error('invalid'); return owner; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/organizations/${f.org.id}/operations`;
  const send = (token: string, data: Record<string, unknown>, id: string) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'creditNote.create', operationId: id, data }) });
  try { assert.equal((await send('', f.note(), 'unauth')).status, 401); assert.equal((await send('valid', { ...f.note(), invoice_id: 'foreign' }, 'foreign')).status, 404); assert.equal((await send('valid', { ...f.note(), credit_usd: 1 }, 'forged')).status, 400);
    const response = await send('valid', f.note(), 'http'); assert.equal(response.status, 200); assert.equal((await response.json()).result.credit_usd, 20); assert.equal((await send('valid', f.note(), 'http')).status, 200); await f.books();
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('B3 legacy same-timestamp receipt rounding is preserved; a forged native currency or tenant is rejected', async () => {
  const f = await fixture(), invoice = (await f.run('invoice.create', { ...f.sale, exchange_rate_used: 33, items: [{ ...f.sale.items[0], unit_price: .03 }] }, 'tiny-sale')).result;
  for (const id of ['z-first', 'a-second', 'b-third']) await f.run('payment.create', { ...f.pay(.01), invoice_id: invoice.id, exchange_rate_used: 33 }, id);
  await f.store.transaction(async tx => {
    for (const payment of await tx.find(`${f.root}/payments`, 'invoice_id', invoice.id)) { delete payment.source_sequence; tx.set(`${f.root}/payments/${payment.id}`, payment); }
    const path = `${f.root}/invoices/${invoice.id}`, row = (await tx.get(path))!; delete row.source_event_sequence; tx.set(path, row);
  });
  await f.run('creditNote.create', { ...f.note('price_credit', [{ line_id: 'line-1', amount: .01 }]), invoice_id: invoice.id }, 'legacy-credit'); await f.books();
  const current = f.store.dump()[`${f.root}/invoices/${invoice.id}`];
  for (const changed of [{ receivable_currency: 'SDG' }, { org_id: 'foreign' }]) {
    await f.store.transaction(async tx => tx.set(`${f.root}/invoices/${invoice.id}`, { ...current, ...changed }));
    const before = f.store.dump(); await assert.rejects(f.run('creditNote.create', { ...f.note(), invoice_id: invoice.id }, 'forged-source')); assert.deepEqual(f.store.dump(), before);
  }
});

test('B3 original invoice discount/tax/rounding survives later settings and final fractional return; dated AR ignores mutable caches', async () => {
  const f = await fixture(), invoice = (await f.run('invoice.create', { ...f.sale, discount_type: 'percent', discount_value: 7.25, items: [{ ...f.sale.items[0], quantity: .3, unit_price: .37, tax_rate: 15 }] }, 'rounding-sale')).result;
  await f.run('settings.update', { updates: { rounding_rule: 'floor' } }, 'today-rounding');
  const credit = (await f.run('creditNote.create', { ...f.note('sales_return', [{ line_id: 'line-1', quantity: .1 }]), invoice_id: invoice.id }, 'fraction-1')).result;
  const final = (await f.run('creditNote.create', { ...f.note('sales_return', [{ line_id: 'line-1', quantity: .2 }]), invoice_id: invoice.id }, 'fraction-2')).result;
  assert.equal(credit.credit_sdg + final.credit_sdg, invoice.grand_total_sdg); assert.equal(Number((credit.credit_usd + final.credit_usd).toFixed(2)), invoice.grand_total_usd); assert.equal(credit.restored_cost_usd + final.restored_cost_usd, invoice.cogs_usd);
  await f.books();
  await f.store.transaction(async tx => { const path = `${f.root}/invoices/${invoice.id}`, row = await tx.get(path); tx.set(path, { ...row, remaining_sdg: 999999, remaining_usd: 999, credit_balance_usd: 999 }); });
  const report = await f.ops.operationalReport(f.org.id, owner, 'receivables', { end: '2026-10-07' }); assert.equal(report.total_usd, 300); assert.equal(report.unallocated_usd, 0); assert.equal(report.aging.some(row => row.invoice_id === invoice.id), false);
});

test('B3 failed persistence and restored source ID collisions do not overwrite or partially post a financial document', async () => {
  const f = await fixture(), before = f.store.dump(), failure = new MemoryStore(before, () => { throw Error('storage offline'); });
  await assert.rejects(new Operations(failure, () => new Date('2026-10-07T12:00:00Z')).execute(f.org.id, owner, { action: 'creditNote.create', operationId: 'no-save', data: f.note('sales_return', [{ line_id: 'line-1', quantity: 1 }]) }), /storage offline/); assert.deepEqual(failure.dump(), before);
  await f.run('creditNote.create', f.note(), 'existing');
  await f.store.transaction(async tx => tx.delete(`${f.root}/idempotency/existing`));
  const saved = f.store.dump(); await assert.rejects(f.run('creditNote.create', f.note('price_credit', [{ line_id: 'line-2', amount: 10 }]), 'existing'), /استبدال مستند مالي/); assert.deepEqual(f.store.dump(), saved);
});
