import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MemoryStore, type Store } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { costState, acquisitionCost, issueCost, allocateCost, hasIncompleteInvoiceCosts } from '../src/domain/inventoryCost';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { calculateTrialBalance, calculateBalanceSheet, calculateIncomeStatement } from '../src/services/accountingService';
import { defaultPlatformPlans } from '../src/lib/plans';
import { journalLine } from '../src/domain/financial';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import type { Account, Invoice, JournalEntry, Product } from '../src/types';

const owner: Actor = { uid: 'cost-owner', email: 'cost@example.com', emailVerified: true };
async function fixture(stock = 10) {
  const store = new MemoryStore(), org = await new Organizations(store).create(owner, 'تكلفة', INITIAL_SETTINGS, 'setup', true), root = `organizations/${org.id}`;
  await store.transaction(async tx => { tx.set(root, { ...await tx.get(root), planId: 'Enterprise', subscriptionEnd: '2027-01-01T00:00:00Z' }); });
  let clock = new Date('2026-10-05T12:00:00Z');
  const ops = new Operations(store, () => clock);
  const run = (action: string, data: Record<string, unknown>, operationId: string = crypto.randomUUID(), actor = owner) => ops.execute(org.id, actor, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل', phone: '', preferred_currency: 'USD' }, 'customer')).result;
  const product = (await run('product.create', { name: 'منتج', unit: 'قطعة', price_sdg: 9000, price_usd: 9, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: stock }, 'product')).result as Product;
  const invoice = (quantity = 1) => ({ customer_id: customer.id, issue_date: clock.toISOString().slice(0, 10), currency_mode: 'single_usd', exchange_rate_used: 2000, discount_type: 'fixed', discount_value: 0, items: [{ product_id: product.id, description: 'منتج', unit: 'قطعة', quantity, unit_price: 10, currency: 'USD', tax_rate: 0, discount_percent: 0 }] });
  const basis = (unit = 2) => run('product.cost.establish', { id: product.id, cost_currency: 'USD', unit_cost: unit, exchange_rate_used: 2000, reason: 'وثيقة شراء افتتاحية' }, 'basis');
  const snapshot = () => ops.snapshot(org.id, owner, true);
  return { store, org, root, ops, run, product, customer, invoice, basis, snapshot, setClock: (date: string) => { clock = new Date(date); } };
}
function assertBooks(s: Awaited<ReturnType<Operations['snapshot']>>) {
  assert.deepEqual(reconcileFinancialData(s.collections as FinancialData, s.settings, { requireCosting: true }), []);
  const chart = s.collections.accounts as Account[], entries = s.collections.journal_entries as JournalEntry[], tb = calculateTrialBalance(chart, entries), bs = calculateBalanceSheet(chart, entries);
  assert.equal(tb.isBalanced, true); assert.equal(bs.is_balanced, true);
  assert.equal(bs.total_assets_sdg, bs.total_liabilities_and_equity_sdg); assert.equal(bs.total_assets_usd, bs.total_liabilities_and_equity_usd);
}

test('A2 source-cost conversion, fractional WAC and line allocations conserve both books without retail-price inference', () => {
  assert.deepEqual(acquisitionCost(3, { cost_currency: 'USD', unit_cost: .33333333, exchange_rate_used: 2000 }), { sdg: 2000, usd: 1 });
  assert.throws(() => acquisitionCost(1, { cost_currency: 'USD', unit_cost: 1 }), /صرف/);
  assert.throws(() => acquisitionCost(1, { unit_cost_sdg: 0, unit_cost_usd: 0 }));
  assert.deepEqual(acquisitionCost(1, { unit_cost_sdg: 0, unit_cost_usd: 0, zero_cost_reason: 'تبرع موثق' }), { sdg: 0, usd: 0 });
  let p = { ...costState(1.5, 7, .07, '2026-10-05'), track_inventory: true } as Product;
  const allocations = allocateCost({ sdg: 7, usd: .07 }, [.5, .5, .5]);
  assert.equal(allocations.reduce((n, a) => n + a.sdg, 0), 7);
  for (let i = 0; i < 3; i++) p = { ...p, ...issueCost(p, .5, '2026-10-05').after };
  assert.equal(p.stock_quantity, 0); assert.equal(p.inventory_value_sdg, 0); assert.equal(p.inventory_value_usd, 0);
  assert.throws(() => issueCost({ ...costState(1, 100, 1, '2026-10-05'), track_inventory: true } as Product, 1, '2026-10-04'), /يسبق/);
});

test('A2 basis, receipt, repeated-line sale, immutable COGS and void at original cost reconcile exactly', async () => {
  const f = await fixture(); await f.basis(); await f.run('accounting.activate', { reason: 'مطابقة موثقة' }, 'activate');
  await f.run('inventory.receive', { id: f.product.id, quantity: 10, cost_currency: 'USD', unit_cost: 4, exchange_rate_used: 2000, payment_method: 'bankak', reason: 'شراء 2' }, 'receipt');
  let s = await f.snapshot(); assert.equal(s.collections.products[0].average_cost_usd, 3); assert.equal(s.collections.products[0].inventory_value_sdg, 120000); assertBooks(s);
  const data = f.invoice(1); data.items.push({ ...data.items[0], quantity: 2 });
  const sale = (await f.run('invoice.create', data, 'sale')).result as Invoice;
  assert.equal(sale.cogs_usd, 9); assert.equal(sale.cogs_sdg, 18000); assert.equal(sale.costing_status, 'complete'); assert.deepEqual(sale.items.map(i => i.total_cost_usd), [3, 6]);
  const original = f.store.dump()[`${f.root}/journal_entries/jv-inv-${sale.id}`];
  await f.run('product.update', { id: f.product.id, updates: { price_sdg: 1000000, price_usd: 1000 } }, 'price');
  await f.run('inventory.receive', { id: f.product.id, quantity: 3, cost_currency: 'USD', unit_cost: 10, exchange_rate_used: 2000, reason: 'شراء 3' }, 'later-receipt');
  await f.run('invoice.void', { id: sale.id, reason: 'فاتورة خاطئة' }, 'void'); await f.run('invoice.void', { id: sale.id, reason: 'فاتورة خاطئة' }, 'void');
  assert.deepEqual(f.store.dump()[`${f.root}/journal_entries/jv-inv-${sale.id}`], original);
  s = await f.snapshot(); assert.equal(s.collections.products[0].stock_quantity, 23); assert.equal(s.collections.products[0].inventory_value_usd, 90);
  const restore = s.collections.inventory_movements.find(m => m.type === 'VOID_REVERSAL')!; assert.equal(restore.value_delta_usd, 9); assertBooks(s);
  const audit = s.collections.audit_logs.find(a => a.action === 'inventory.receive')!; assert.equal(audit.actor_role, 'Owner'); assert.equal(audit.cost_evidence.cost_currency, 'USD'); assert.ok(Object.keys(audit.previous_state).some(p => p.includes('/products/')));
});

test('A2 concurrent sales and repeated retries cannot oversell or duplicate cost journals', async () => {
  const f = await fixture(3); await f.basis(); const data = f.invoice(2);
  const results = await Promise.allSettled([f.run('invoice.create', data, 'sale-a'), f.run('invoice.create', data, 'sale-b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.findIndex(r => r.status === 'fulfilled'); await f.run('invoice.create', data, winner === 0 ? 'sale-a' : 'sale-b');
  const s = await f.snapshot(); assert.equal(s.collections.invoices.length, 1); assert.equal(s.collections.products[0].stock_quantity, 1); assert.equal(s.collections.products[0].inventory_value_usd, 2); assertBooks(s);
});

test('A2 count corrections post value differences and require documented cost for stock increases', async () => {
  const f = await fixture(); await f.basis(); const before = f.store.dump();
  await assert.rejects(f.run('product.stock', { id: f.product.id, newStock: 11, reason: 'زيادة' }, 'missing-cost')); assert.deepEqual(f.store.dump(), before);
  await f.run('product.stock', { id: f.product.id, newStock: 8, reason: 'فاقد موثق' }, 'loss');
  let s = await f.snapshot(); assert.equal(s.collections.products[0].inventory_value_usd, 16); assert.equal(s.collections.journal_entries.find(j => j.id === 'jv-stock-loss')!.lines.find((l: any) => l.account_code === '5900').debit_usd, 4); assertBooks(s);
  await f.run('product.stock', { id: f.product.id, newStock: 10, unit_cost_sdg: 8000, unit_cost_usd: 4, reason: 'جرد بوثيقة' }, 'increase');
  s = await f.snapshot(); assert.equal(s.collections.products[0].inventory_value_usd, 24); assert.equal(s.collections.products[0].average_cost_usd, 2.4); assertBooks(s);
});

test('A2 legacy invoices remain incomplete, backdated sales and legacy void after cost establishment fail atomically', async () => {
  const f = await fixture(); const oldSale = (await f.run('invoice.create', f.invoice(), 'legacy')).result as Invoice;
  assert.equal(oldSale.costing_status, 'incomplete'); await f.basis(); await f.run('accounting.activate', { reason: 'مراجعة المخزون الحالي؛ تكلفة الماضي غير متاحة' }, 'activate');
  let s = await f.snapshot(); assert.equal(hasIncompleteInvoiceCosts(s.collections.invoices as Invoice[], s.collections.products as Product[], s.collections.journal_entries as JournalEntry[]), true);
  assert.equal((await f.ops.advancedReports(f.org.id, owner)).incomeStatement.costs_complete, false);
  const before = f.store.dump(); await assert.rejects(f.run('invoice.void', { id: oldSale.id, reason: 'قديم' }, 'legacy-void'), /تكلفة الفاتورة القديمة/); assert.deepEqual(f.store.dump(), before);
  await assert.rejects(f.run('invoice.create', { ...f.invoice(), issue_date: '2026-10-04' }, 'backdated'), /يسبق/); assert.deepEqual(f.store.dump(), before);
  f.setClock('2026-10-06T12:00:00Z'); await f.run('invoice.create', f.invoice(), 'new-sale');
  const period = await f.ops.advancedReports(f.org.id, owner, { start: '2026-10-06', end: '2026-10-06' }); assert.equal(period.incomeStatement.costs_complete, true); assert.equal(period.incomeStatement.cogs_usd, 2); assertBooks(await f.snapshot());
});

test('A2 activation is Owner-only, period/cost/control gated and protects derived cost and GL from manual changes', async () => {
  const f = await fixture(); const before = f.store.dump(); await assert.rejects(f.run('accounting.activate', { reason: 'تفعيل' }, 'unknown'), /أثبت تكلفة/); assert.deepEqual(f.store.dump(), before);
  const admin = { ...owner, uid: 'admin' }; await f.store.transaction(async tx => tx.set(`${f.root}/members/admin`, { uid: 'admin', role: 'Admin', status: 'active' }));
  await assert.rejects(f.run('product.cost.establish', { id: f.product.id, reason: 'محاولة', unit_cost_sdg: 1, unit_cost_usd: 1 }, 'admin-basis', admin), /للمالك/);
  await f.basis(); await f.run('accounting.activate', { reason: 'مطابقة' }, 'activate');
  await assert.rejects(f.run('product.update', { id: f.product.id, updates: { inventory_value_sdg: 0 } }), /حقول التكلفة/);
  await assert.rejects(f.run('journal.create', { date: '2026-10-05', reference_type: 'manual', description: 'تجاوز المخزون', lines: [journalLine('1300', 'inventory', 10), journalLine('3100', 'capital', 0, 10)] }), /المخزون/);
  await f.run('settings.update', { updates: { period_lock_date: '2026-10-05' } }, 'lock'); const locked = f.store.dump();
  await assert.rejects(f.run('inventory.receive', { id: f.product.id, quantity: 1, unit_cost_sdg: 100, unit_cost_usd: 1, reason: 'مقفلة' }), /مقفلة/); assert.deepEqual(f.store.dump(), locked);
});

test('A2 deployed-rules proof rejects mismatches and missing authority before mutation, including V2 restore', async () => {
  const rules = await readFile('firestore.rules', 'utf8'); assert.doesNotThrow(() => verifyAccountingRulesSource([{ content: rules }])); assert.throws(() => verifyAccountingRulesSource([{ content: rules + '\n// different revision' }]), /لا تطابق/);
  const f = await fixture(), store: Store = { authority: 'server', transaction: work => f.store.transaction(work) }, before = f.store.dump();
  for (const proof of [undefined, async () => verifyAccountingRulesSource([{ content: 'allow write: if true;' }])]) {
    const ops = new Operations(store, undefined, undefined, proof);
    await assert.rejects(ops.execute(f.org.id, owner, { action: 'product.cost.establish', operationId: 'blocked', data: { id: f.product.id, unit_cost_sdg: 10, unit_cost_usd: 1, reason: 'تكلفة' } })); assert.deepEqual(f.store.dump(), before);
  }
  const browser: Store = { authority: 'browser', transaction: work => f.store.transaction(work) };
  await assert.rejects(new Operations(browser).execute(f.org.id, owner, { action: 'accounting.activate', operationId: 'browser', data: { reason: 'تجاوز' } }), /خدمة الخادم/);
  await f.basis(); await f.run('accounting.activate', { reason: 'مطابقة' }, 'activate'); const backup = await f.snapshot();
  const targetOwner = { ...owner, uid: 'target-owner' }, targetStore = new MemoryStore(), target = await new Organizations(targetStore).create(targetOwner, 'استعادة', INITIAL_SETTINGS, 'target', true);
  const targetAuthority: Store = { authority: 'server', transaction: work => targetStore.transaction(work) }, targetBefore = targetStore.dump();
  await assert.rejects(new Operations(targetAuthority).execute(target.id, targetOwner, { action: 'backup.restore', operationId: 'restore', data: { backup } }), /قواعد حماية/); assert.deepEqual(targetStore.dump(), targetBefore);
  const ops = new Operations(targetAuthority, undefined, undefined, async () => verifyAccountingRulesSource([{ content: rules }]));
  await ops.execute(target.id, targetOwner, { action: 'backup.restore', operationId: 'restore', data: { backup } }); const s = await ops.snapshot(target.id, targetOwner, true);
  assert.equal(s.org.owner_uid, targetOwner.uid); assert.equal(s.org.accounting_version, 2); assert.equal(s.org.planId, 'Free'); assertBooks(s);
});

test('A2 audit detects cost corruption read-only and API policies prevent expired or disabled-feature mutations', async () => {
  const f = await fixture(); await f.basis(); const s = await f.snapshot(), corrupt = structuredClone(s.collections) as FinancialData;
  corrupt.products[0].average_cost_usd = 99; assert.ok(reconcileFinancialData(corrupt, s.settings, { requireCosting: true }).some(i => i.code === 'invalid_record'));
  corrupt.products[0] = structuredClone(s.collections.products[0]); corrupt.inventory_movements.find(m => m.costing_version === 2)!.value_delta_usd += 1;
  assert.ok(reconcileFinancialData(corrupt, s.settings, { requireCosting: true }).some(i => i.field === 'inventory_value_usd'));
  assert.deepEqual((await f.snapshot()).collections, s.collections);
  await f.store.transaction(async tx => tx.set(f.root, { ...await tx.get(f.root), subscriptionEnd: '2026-10-04T00:00:00Z' })); const expired = f.store.dump();
  await assert.rejects(f.run('inventory.receive', { id: f.product.id, quantity: 1, unit_cost_sdg: 100, unit_cost_usd: 1, reason: 'انتهى' }), /انتهى الاشتراك/); assert.deepEqual(f.store.dump(), expired);
  await f.store.transaction(async tx => { tx.set(f.root, { ...await tx.get(f.root), subscriptionEnd: '2027-01-01T00:00:00Z' }); const plan = defaultPlatformPlans().find(p => p.id === 'Enterprise')!; tx.set('plans/Enterprise', { ...plan, features: { ...plan.features, inventory_tracking: false } }); });
  const disabled = f.store.dump(); await assert.rejects(f.run('inventory.receive', { id: f.product.id, quantity: 1, unit_cost_sdg: 100, unit_cost_usd: 1, reason: 'معطلة' }), /غير متاحة/); assert.deepEqual(f.store.dump(), disabled);
});


test('A2 moving-average dates forbid using a later receipt cost for a backdated sale', async () => {
  const f = await fixture(); await f.basis(); f.setClock('2026-10-07T12:00:00Z');
  await f.run('inventory.receive', { id: f.product.id, quantity: 1, unit_cost_sdg: 8000, unit_cost_usd: 4, reason: 'شراء لاحق' }, 'later');
  const before = f.store.dump(); await assert.rejects(f.run('invoice.create', { ...f.invoice(), issue_date: '2026-10-06' }, 'backdated'), /آخر حركة تكلفة/); assert.deepEqual(f.store.dump(), before);
  await f.run('invoice.create', f.invoice(), 'dated'); assertBooks(await f.snapshot());
});

test('A2 server report honors periods and custom account metadata after billing integration', async () => {
  const f = await fixture();
  await f.run('account.create', { code: 'consulting', name_ar: 'استشارات', name_en: 'Consulting', type: 'REVENUE', nature: 'CREDIT', is_active: true }, 'account');
  for (const date of ['2026-10-04', '2026-10-05']) await f.run('journal.create', { date, reference_type: 'manual', description: 'استشارات نقدية', lines: [journalLine('1110', 'cash', 100), journalLine('consulting', 'consulting', 0, 100)] }, 'journal-' + date);
  const report = await f.ops.advancedReports(f.org.id, owner, { start: '2026-10-05', end: '2026-10-05' });
  assert.equal(report.incomeStatement.sales_revenue_sdg, 100); assert.equal(report.incomeStatement.net_profit_sdg, 100); assert.equal(report.balanceSheet.total_assets_sdg, 200);
  await assert.rejects(f.ops.advancedReports(f.org.id, owner, { start: '2026-10-06', end: '2026-10-05' }), /بداية الفترة/);
});

test('D2.1 product profitability uses frozen source revenue/cost and reconstructs period turnover',async()=>{
  const f=await fixture(10);await f.basis(2);await f.run('accounting.activate',{reason:'مطابقة موثقة'},'activate-profit');
  const sale=(await f.run('invoice.create',f.invoice(2),'profit-sale')).result as Invoice;
  const report=await f.ops.productProfitability(f.org.id,owner,{start:'2026-10-05',end:'2026-10-05'}),row=report.rows.find(item=>item.product_id===f.product.id)!;
  assert.equal(sale.items[0].total_cost_usd,4);assert.equal(row.quantity_sold,2);assert.equal(row.sales_usd,20);assert.equal(row.cogs_usd,4);assert.equal(row.gross_profit_usd,16);assert.equal(row.gross_margin_usd,80);assert.equal(row.current_stock,8);assert.equal(row.inventory_value_usd,16);assert.equal(row.costs_complete,true);assert.equal(row.stock_turnover_usd,0.5);
  await assert.rejects(f.ops.productProfitability(f.org.id,{...owner,uid:'stranger'},{start:'2026-10-05',end:'2026-10-05'}),/عضوية|صلاحية/);
  await assert.rejects(f.ops.productProfitability(f.org.id,owner,{start:'2026-10-06',end:'2026-10-05'}),/بداية الفترة/);
});

test('C6.1 comparative reports keep independent ranges and cumulative as-of balances',async()=>{
  const f=await fixture();await f.run('account.create',{code:'consulting',name_ar:'استشارات',name_en:'Consulting',type:'REVENUE',nature:'CREDIT',is_active:true},'comparison-account');
  for(const [date,amount] of [['2026-09-10',100],['2026-10-10',160]] as const)await f.run('journal.create',{date,reference_type:'manual',description:'إيراد مقارنة',lines:[journalLine('1110','cash',amount),journalLine('consulting','revenue',0,amount)]},`comparison-${date}`);
  const report=await f.ops.advancedReports(f.org.id,owner,{start:'2026-10-01',end:'2026-10-31'},{start:'2026-09-01',end:'2026-09-30'});
  assert.equal(report.incomeStatement.net_profit_sdg,160);assert.equal(report.comparison?.incomeStatement.net_profit_sdg,100);assert.equal(report.balanceSheet.total_assets_sdg,260);assert.equal(report.comparison?.balanceSheet.total_assets_sdg,100);assert.deepEqual(report.comparison?.period,{start:'2026-09-01',end:'2026-09-30'});
  await assert.rejects(f.ops.advancedReports(f.org.id,owner,{}, {start:'2026-10-02',end:'2026-10-01'}),/بداية الفترة/);
});
