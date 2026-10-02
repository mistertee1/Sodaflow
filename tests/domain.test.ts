import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { createDefaultSubscription, getPlanConfig } from '../src/lib/plans';
import { calculateCashFlowStatement, calculateTrialBalance } from '../src/services/accountingService';
import { validateJournal } from '../src/domain/validation';
import { journalLine, paymentQuote } from '../src/domain/financial';
import type { Account, Invoice, JournalEntry, Payment } from '../src/types';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { buildInvoiceHtml } from '../src/services/pdfService';

test('read-only audit detects historical FX balance corruption and validates restoration without changing ownership', async () => {
  const source = await fixture();
  const issued = await source.run('invoice.create', source.invoice(), 'audit-issue');
  await source.run('payment.create', { invoice_id: issued.result.id, amount: 50, currency: 'USD', exchange_rate_used: 3000, payment_method: 'cash' }, 'audit-receipt');
  const backup = await source.ops.snapshot(source.org.id, owner, true);
  assert.deepEqual(reconcileFinancialData(backup.collections as FinancialData, backup.settings), []);
  const corrupted = structuredClone(backup);
  corrupted.collections.invoices[0].remaining_sdg = 50000;
  corrupted.collections.invoices[0].paid_amount_sdg = 150000;
  corrupted.collections.customers[0].balance_sdg = 50000;
  const before = JSON.stringify(corrupted);
  assert.ok(reconcileFinancialData(corrupted.collections as FinancialData, corrupted.settings).some(f => f.collection === 'invoices' && f.field === 'remaining_sdg' && f.expected === 100000 && f.actual === 50000));
  assert.equal(JSON.stringify(corrupted), before);
  await source.store.transaction(async tx => { tx.set(`organizations/${source.org.id}/invoices/${issued.result.id}`, corrupted.collections.invoices[0]); tx.set(`organizations/${source.org.id}/customers/${source.customer.id}`, corrupted.collections.customers[0]); });
  const corruptState = source.store.dump();
  await assert.rejects(source.run('payment.create', { invoice_id: issued.result.id, amount: 10, currency: 'USD', exchange_rate_used: 3000, payment_method: 'cash' }, 'block-corrupt-receipt'), /لا يطابق الذمم/);
  assert.deepEqual(source.store.dump(), corruptState);
  const targetStore = new MemoryStore(), targetActor = { ...owner, uid: 'new-owner' };
  const target = await new Organizations(targetStore).create(targetActor, 'target', INITIAL_SETTINGS, 'target', true);
  const ops = new Operations(targetStore);
  const empty = targetStore.dump();
  await assert.rejects(ops.execute(target.id, targetActor, { action: 'backup.restore', operationId: 'reject-corrupt', data: { backup: corrupted } }), /فروقات مالية/);
  assert.deepEqual(targetStore.dump(), empty);
  await ops.execute(target.id, targetActor, { action: 'backup.restore', operationId: 'restore-valid', data: { backup } });
  const restored = await ops.snapshot(target.id, targetActor, true);
  assert.equal(restored.org.owner_uid, targetActor.uid); assert.equal(restored.subscription.plan, 'Free');
  assert.equal(restored.collections.invoices.length, 1); assert.equal(restored.collections.invoices[0].remaining_sdg, 100000);
  assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData, restored.settings), []);
  await assert.rejects(ops.execute(target.id, targetActor, { action: 'backup.restore', operationId: 'restore-twice', data: { backup } }), /مؤسسة فارغة/);
});

test('invoice HTML escapes stored customer and merchant content and rejects executable image URLs', async () => {
  const f = await fixture(), invoice = (await f.run('invoice.create', f.invoice())).result as Invoice;
  const payload = '<img src=x onerror="window.pwned=1">';
  const html = buildInvoiceHtml({ ...invoice, customer_name: payload, notes: payload, items: invoice.items.map(item => ({ ...item, description: payload })) }, { ...INITIAL_SETTINGS, business_name: payload, logo_url: 'javascript:alert(1)' });
  assert.ok(html.includes('&lt;img')); assert.equal(html.includes('<img src=x'), false); assert.equal(html.includes('javascript:alert'), false);
});

export const owner: Actor = { uid: 'owner', email: 'owner@example.com', emailVerified: true };
export async function fixture(options: { stock?: number; free?: boolean; persist?: () => void } = {}) {
  const store = new MemoryStore({}, options.persist), orgs = new Organizations(store, saved => saved as any);
  const org = await orgs.create(owner, 'متجر الاختبار', { ...INITIAL_SETTINGS, invoice_prefix: 'INV-', default_exchange_rate: 2000 }, 'setup', true);
  await store.transaction(async tx => { const plan = getPlanConfig(options.free ? 'Free' : 'Enterprise'); tx.set(`organizations/${org.id}/meta/subscription`, { ...createDefaultSubscription(org.id), ...plan, plan: plan.name }); });
  let clock = new Date('2026-10-01T12:00:00Z');
  const ops = new Operations(store, () => clock, saved => saved as any);
  const run = (action: string, data: Record<string, unknown>, operationId: string = crypto.randomUUID(), actor = owner) => ops.execute(org.id, actor, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل', phone: '', preferred_currency: 'USD', balance_sdg: 0, balance_usd: 0 }, 'customer')).result;
  const product = (await run('product.create', { name: 'منتج', unit: 'قطعة', price_sdg: 2000, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: options.stock ?? 100 }, 'product')).result;
  const invoice = (amount = 100, quantity = 1, currency = 'USD') => ({ customer_id: customer.id, issue_date: clock.toISOString().slice(0, 10), currency_mode: currency === 'USD' ? 'single_usd' : 'single_sdg', exchange_rate_used: currency === 'USD' ? 2000 : 0, discount_type: 'fixed', discount_value: 0, items: [{ product_id: product.id, description: 'منتج', unit: 'قطعة', quantity, unit_price: amount, currency, tax_rate: 0, discount_percent: 0 }] });
  return { store, org, orgs, ops, run, customer, product, invoice, setClock: (date: string) => { clock = new Date(date); } };
}

test('historical receivable stays aligned with AR for an appreciating USD receipt', async () => {
  const f = await fixture(); const inv = (await f.run('invoice.create', f.invoice(), 'issue')).result as Invoice;
  const pay = (await f.run('payment.create', { invoice_id: inv.id, amount: 50, currency: 'USD', exchange_rate_used: 3000, payment_method: 'cash' }, 'receipt')).result as Payment;
  const s = await f.ops.snapshot(f.org.id, owner);
  assert.equal(s.collections.invoices[0].remaining_sdg, 100000); assert.equal(s.collections.invoices[0].remaining_usd, 50);
  assert.equal(s.collections.customers[0].balance_sdg, 100000); assert.equal(pay.cash_amount_sdg, 150000); assert.equal(pay.settled_amount_sdg, 100000);
  const entries = s.collections.journal_entries as JournalEntry[], chart = s.collections.accounts as Account[];
  assert.equal(calculateTrialBalance(chart, entries).items.find(i => i.account_code === '1200')?.net_balance_sdg, 100000);
  assert.equal(calculateCashFlowStatement(chart, entries).operating_inflows_sdg, 150000);
  assert.equal(entries.find(e => e.reference_type === 'payment')?.lines.find(l => l.account_code === '4200')?.credit_sdg, 50000);
});

test('FX loss is not a cash inflow; final receipt closes both currencies', async () => {
  const f = await fixture(); const inv = (await f.run('invoice.create', f.invoice(), 'issue')).result as Invoice;
  await f.run('payment.create', { invoice_id: inv.id, amount: 50, currency: 'USD', exchange_rate_used: 1500, payment_method: 'cash' }, 'pay-1');
  let s = await f.ops.snapshot(f.org.id, owner);
  assert.equal(calculateCashFlowStatement(s.collections.accounts as Account[], s.collections.journal_entries as JournalEntry[]).operating_inflows_sdg, 75000);
  await f.run('payment.create', { invoice_id: inv.id, amount: 50, currency: 'USD', exchange_rate_used: 2500, payment_method: 'cash' }, 'pay-2');
  s = await f.ops.snapshot(f.org.id, owner); assert.equal(s.collections.invoices[0].status, 'paid'); assert.equal(s.collections.customers[0].balance_sdg, 0); assert.equal(s.collections.customers[0].balance_usd, 0);
  await assert.rejects(f.run('payment.create', { invoice_id: inv.id, amount: 1, currency: 'USD', exchange_rate_used: 2500, payment_method: 'cash' }), /تحصيل/);
});

test('concurrent invoices aggregate repeated product lines, assign distinct numbers and reject overselling atomically', async () => {
  const f = await fixture({ stock: 10 }); const data = f.invoice(1, 2); data.items.push({ ...data.items[0], quantity: 1 });
  const results = await Promise.all([f.run('invoice.create', data, 'sale-a'), f.run('invoice.create', data, 'sale-b')]);
  assert.notEqual(results[0].result.invoice_number, results[1].result.invoice_number);
  const s = await f.ops.snapshot(f.org.id, owner); assert.equal(s.collections.products[0].stock_quantity, 4); assert.equal(s.collections.inventory_movements.filter(m => m.type === 'SALE').length, 2);
  const before = f.store.dump(); await assert.rejects(f.run('invoice.create', f.invoice(1, 5), 'oversell'), /المخزون/); assert.deepEqual(f.store.dump(), before);
});

test('retry is exactly once, including counters, inventory, audit and receipts; changed payload cannot reuse ID', async () => {
  const f = await fixture(); const data = f.invoice(); const first = await f.run('invoice.create', data, 'same');
  assert.deepEqual(await f.run('invoice.create', data, 'same'), first);
  const payment = { invoice_id: first.result.id, amount: 25, currency: 'USD', exchange_rate_used: 2000, payment_method: 'bankak' };
  await Promise.all([f.run('payment.create', payment, 'retry-pay'), f.run('payment.create', payment, 'retry-pay')]);
  await assert.rejects(f.run('payment.create', { ...payment, amount: 30 }, 'retry-pay'), /طلب مختلف/);
  const s = await f.ops.snapshot(f.org.id, owner); assert.equal(s.collections.payments.length, 1); assert.equal(s.counters.invoice_count, 1); assert.equal(s.counters.payment_count, 1); assert.equal(s.collections.invoices[0].remaining_usd, 75);
  assert.equal(s.collections.audit_logs.filter(a => a.action === 'payment.create').length, 1);
});

test('cashier can sell and collect dependent customer/stock updates without reading expenses or journals', async () => {
  const f = await fixture(), cashier: Actor = { uid: 'cashier', email: 'c@example.com', emailVerified: true };
  await f.store.transaction(async tx => { tx.set(`organizations/${f.org.id}/members/cashier`, { uid: 'cashier', org_id: f.org.id, role: 'Cashier', status: 'active' }); });
  const inv = await f.run('invoice.create', f.invoice(), 'cashier-sale', cashier); await f.run('payment.create', { invoice_id: inv.result.id, amount: 10, currency: 'USD', exchange_rate_used: 2000, payment_method: 'cash' }, 'cashier-pay', cashier);
  const s = await f.ops.snapshot(f.org.id, cashier); assert.equal(s.collections.invoices.length, 1); assert.deepEqual(s.collections.journal_entries, []); assert.deepEqual(s.collections.expenses, []);
  await assert.rejects(f.run('journal.create', { lines: [] }, 'forged-journal', cashier), /صلاحية/); await assert.rejects(f.ops.snapshot(f.org.id, cashier, true), /غير مسموح/);
});

test('suspended and foreign actors fail closed; ID prefix does not confer ownership', async () => {
  const f = await fixture(); await assert.rejects(f.ops.snapshot(f.org.id, { ...owner, uid: 'other' }), /عضوية/);
  await f.store.transaction(async tx => { tx.set(`organizations/${f.org.id}/members/other`, { uid: 'other', role: 'Owner', status: 'suspended' }); });
  await assert.rejects(f.run('invoice.create', f.invoice(), 'unauthorized', { ...owner, uid: 'other' }), /عضوية/);
  await f.store.transaction(async tx => { tx.set(`organizations/${f.org.id}/members/other`, { uid: 'other', role: 'Owner', status: 'active' }); });
  await assert.rejects(f.ops.snapshot(f.org.id, { ...owner, uid: 'other' }), /مالك المؤسسة الفعلي/);
});

test('invitation requires verified authenticated recipient and atomically consumes invite, membership and index', async () => {
  const f = await fixture(), recipient = { uid: 'recipient', email: 'invitee@example.com', emailVerified: true };
  const invite = await f.run('invitation.create', { email: recipient.email, role: 'Cashier' }, 'invitation');
  await assert.rejects(f.orgs.accept({ ...recipient, emailVerified: false }, f.org.id, invite.result.id), /أكّد/);
  await assert.rejects(f.orgs.accept({ ...recipient, email: 'attacker@example.com' }, f.org.id, invite.result.id), /بريد آخر/);
  await Promise.all([f.orgs.accept(recipient, f.org.id, invite.result.id), f.orgs.accept(recipient, f.org.id, invite.result.id)]);
  const dump = f.store.dump(); assert.equal(dump[`organizations/${f.org.id}/invitations/${invite.result.id}`].status, 'accepted'); assert.equal(dump[`user_organizations/${recipient.uid}/orgs/${f.org.id}`].role, 'Cashier');
  await assert.rejects(f.orgs.accept({ ...recipient, uid: 'another' }, f.org.id, invite.result.id), /مستخدمة/);
});

test('manual journal rejects empty accounts, zero lines, NaN, precision drift and locked period', async () => {
  for (const lines of [[{}, {}], [journalLine('1110', 'cash'), journalLine('4100', 'sales')], [journalLine('1110', 'cash', 0, 0, 1), journalLine('4100', 'sales', 0, 0, 0, .99)], [journalLine('1110', 'cash', NaN), journalLine('4100', 'sales', 0, 1)]]) assert.throws(() => validateJournal(lines as any));
  const f = await fixture(); const lines = [journalLine('1110', 'cash', 100), journalLine('3100', 'capital', 0, 100)];
  await f.run('settings.update', { updates: { period_lock_date: '2026-10-01' } }, 'lock');
  await assert.rejects(f.run('journal.create', { lines, date: '2026-10-01', reference_type: 'manual', description: 'test' }), /مقفلة/);
  await assert.rejects(f.run('invoice.create', f.invoice()), /مقفلة/);
});

test('unpaid void reverses the actual original journal and restores stock exactly once; paid void refuses fabricated refunds', async () => {
  const f = await fixture(); const inv = await f.run('invoice.create', f.invoice(), 'sale');
  await f.run('invoice.void', { id: inv.result.id, reason: 'خطأ' }, 'void'); await f.run('invoice.void', { id: inv.result.id, reason: 'خطأ' }, 'void');
  let s = await f.ops.snapshot(f.org.id, owner); assert.equal(s.collections.products[0].stock_quantity, 100); assert.equal(s.collections.customers[0].balance_usd, 0);
  assert.equal(calculateTrialBalance(s.collections.accounts as Account[], s.collections.journal_entries as JournalEntry[]).items.find(i => i.account_code === '1200')?.net_balance_sdg, 0);
  const second = await f.run('invoice.create', f.invoice(), 'sale2'); await f.run('payment.create', { invoice_id: second.result.id, amount: 10, currency: 'USD', exchange_rate_used: 2000, payment_method: 'cash' }); await assert.rejects(f.run('invoice.void', { id: second.result.id }), /ردّ مبلغ/);
});

test('monthly quota resets at organization month boundary; client cannot self-upgrade', async () => {
  const f = await fixture({ free: true }); for (let i = 0; i < 100; i++) await f.run('invoice.create', f.invoice(1, 1, 'SDG'), `oct-${i}`);
  await f.run('subscription.request', { plan: 'Enterprise' }, 'request'); assert.equal((await f.ops.snapshot(f.org.id, owner)).subscription.plan, 'Free');
  await assert.rejects(f.run('invoice.create', f.invoice(1, 1, 'SDG')), /حد الفواتير/);
  f.setClock('2026-11-01T12:00:00Z'); await f.run('invoice.create', f.invoice(1, 1, 'SDG'), 'nov-1');
  const s = await f.ops.snapshot(f.org.id, owner); assert.equal(s.counters.invoice_count, 101); assert.equal(s.counters.monthly_invoice_count, 1);
});

test('backup and reports include 100 of 100 records independently of display pages', async () => {
  const f = await fixture(); await f.store.transaction(async tx => { for (let i = 0; i < 100; i++) tx.set(`organizations/${f.org.id}/invoices/seed-${i}`, { id: `seed-${i}`, amount: i, customer_id: f.customer.id }); });
  const s = await f.ops.snapshot(f.org.id, owner, true); assert.equal(s.collections.invoices.length, 100);
});

test('persistence failure rolls back all state; cash-only SDG requires no invented FX; invalid currencies fail', async () => {
  const f = await fixture(); const seed = f.store.dump(); const store = new MemoryStore(seed, () => { throw new Error('storage quota'); }), ops = new Operations(store);
  await assert.rejects(ops.execute(f.org.id, owner, { action: 'invoice.create', operationId: 'failure', data: f.invoice() }), /storage quota/); assert.deepEqual(store.dump(), seed);
  const inv = (await f.run('invoice.create', f.invoice(100, 1, 'SDG'), 'sdg')).result as Invoice; assert.equal(paymentQuote(inv, 50, 'SDG', 0).cashSdg, 50);
  await assert.rejects(f.run('invoice.create', f.invoice(100, 1, 'SAR')), /غير مدعومة/);
});

test('tax liability is separated from revenue, and expense reversal preserves immutable original', async () => {
  const f = await fixture(), data = f.invoice(); data.items[0].tax_rate = 15;
  await f.run('invoice.create', data, 'tax'); const expense = await f.run('expense.create', { title: 'إيجار', category: 'إيجار', amount: 100, currency: 'SDG', date: '2026-10-01' }, 'expense');
  const original = f.store.dump()[`organizations/${f.org.id}/journal_entries/jv-exp-${expense.result.id}`]; await f.run('expense.void', { id: expense.result.id }, 'expense-void');
  assert.deepEqual(f.store.dump()[`organizations/${f.org.id}/journal_entries/jv-exp-${expense.result.id}`], original);
  const s = await f.ops.snapshot(f.org.id, owner), entry = s.collections.journal_entries.find(e => e.reference_type === 'invoice')!; assert.equal(entry.lines.find((l: any) => l.account_code === '4100').credit_usd, 100); assert.equal(entry.lines.find((l: any) => l.account_code === '2130').credit_usd, 15);
});

test('historical client-written subscriptions confer no paid rights; only signed server billing is trusted', async () => {
  const { resolveSubscription, signSubscription } = await import('../server/subscriptions');
  const f = await fixture(), untrusted = new Operations(f.store); assert.equal((await untrusted.snapshot(f.org.id, owner)).subscription.plan, 'Free');
  const before = process.env.BILLING_SIGNING_SECRET; process.env.BILLING_SIGNING_SECRET = 'test-only-signing-secret-32-characters-long';
  try {
    const tier = getPlanConfig('Professional'), signed = signSubscription({ ...createDefaultSubscription(f.org.id), ...tier, plan: tier.name, updated_at: '2026-10-01' }, process.env.BILLING_SIGNING_SECRET);
    assert.equal(resolveSubscription(signed, f.org.id).plan, 'Professional'); assert.equal(resolveSubscription({ ...signed, plan: 'Enterprise' }, f.org.id).plan, 'Free'); assert.equal(resolveSubscription(signed, 'another-org').plan, 'Free');
  } finally { if (before === undefined) delete process.env.BILLING_SIGNING_SECRET; else process.env.BILLING_SIGNING_SECRET = before; }
});
