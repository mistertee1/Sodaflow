import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/domain/store';
import { Operations } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import type { Account, JournalEntry } from '../src/types';
import { getDefaultChartOfAccounts, calculateTrialBalance, calculateIncomeStatement, calculateBalanceSheet, calculateCashFlowStatement } from '../src/services/accountingService';
import { classifyAccount } from '../src/domain/accountClassification';
import { journal, journalLine } from '../src/domain/financial';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { defaultPlatformPlans } from '../src/lib/plans';
import { cashForecast } from '../src/domain/managementCashForecast';

const actor = { uid: 'owner', email: 'owner@example.com', emailVerified: true };
const entry = (id: string, date: string, lines: JournalEntry['lines']) => journal(id, 'org', 'owner', date, 'manual', id, id, lines, 2000);
const account = (code: string, type: Account['type'], nature: Account['nature'], metadata: Partial<Account> = {}): Account => ({ code, type, nature, name_ar: code, name_en: code, is_active: true, is_system: false, balance_sdg: 0, balance_usd: 0, org_id: 'org', ...metadata });
async function fixture() {
  const store = new MemoryStore(), org = await new Organizations(store).create(actor, 'متجر', INITIAL_SETTINGS, 'setup', true);
  const ops = new Operations(store, () => new Date('2026-10-05T12:00:00Z'));
  const run = (action: string, data: Record<string, unknown>, operationId: string = crypto.randomUUID()) => ops.execute(org.id, actor, { action, data, operationId });
  return { store, org, ops, run };
}

test('A1 custom revenue uses declared classification regardless of numeric or arbitrary code', () => {
  const chart = [...getDefaultChartOfAccounts('org'), account('consulting', 'REVENUE', 'CREDIT'), account('9999', 'REVENUE', 'CREDIT', { reporting_group: 'other_revenue' })];
  const entries = [entry('sales', '2026-10-02', [journalLine('1110', 'cash', 150, 0, 1.5, 0), journalLine('consulting', 'service', 0, 100, 0, 1), journalLine('9999', 'other', 0, 50, 0, .5)])];
  assert.equal(calculateIncomeStatement(entries, chart).sales_revenue_sdg, 150);
  assert.equal(calculateIncomeStatement(entries, chart).net_profit_usd, 1.5);
  assert.equal(calculateBalanceSheet(chart, entries).is_balanced, true);
});

test('A1 date ranges are inclusive with ledger openings and no duplicated account balance cache', () => {
  const chart = getDefaultChartOfAccounts('org'); chart.find(a => a.code === '1110')!.balance_sdg = 99999;
  const entries = [entry('opening', '2026-09-30', [journalLine('1110', 'cash', 1000, 0, 10, 0), journalLine('3100', 'capital', 0, 1000, 0, 10)]), entry('sale', '2026-10-01T00:00:00Z', [journalLine('1110', 'cash', 100, 0, 1, 0), journalLine('4100', 'sales', 0, 100, 0, 1)]), entry('expense', '2026-10-31T23:59:59Z', [journalLine('5200', 'rent', 20, 0, .2, 0), journalLine('1110', 'cash', 0, 20, 0, .2)]), entry('later', '2026-11-01', [journalLine('1110', 'cash', 900, 0, 9, 0), journalLine('4100', 'sales', 0, 900, 0, 9)])];
  const period = { start: '2026-10-01', end: '2026-10-31' }, trial = calculateTrialBalance(chart, entries, period), cash = trial.items.find(a => a.account_code === '1110')!;
  assert.equal(cash.opening_balance_sdg, 1000); assert.equal(cash.total_debit_sdg, 100); assert.equal(cash.total_credit_sdg, 20); assert.equal(cash.net_balance_sdg, 1080); assert.equal(trial.isBalanced, true);
  assert.equal(calculateIncomeStatement(entries, chart, period).net_profit_sdg, 80);
  assert.equal(calculateBalanceSheet(chart, entries, period).total_assets_sdg, 1080);
  const flow = calculateCashFlowStatement(chart, entries, period);
  assert.equal(flow.beginning_cash_sdg, 1000); assert.equal(flow.net_change_in_cash_sdg, 80); assert.equal(flow.ending_cash_sdg, 1080);
  assert.throws(() => calculateTrialBalance(chart, entries, { start: '2026-11-01', end: '2026-10-01' }), /بداية الفترة/);
  assert.throws(() => calculateIncomeStatement(entries, chart, { end: '2026-02-30' }), /التاريخ/);
});

test('A1 balance sheet subtracts drawings and contra assets, retaining prior-period income', () => {
  const chart = [...getDefaultChartOfAccounts('org'), account('depreciation', 'ASSET', 'CREDIT', { reporting_group: 'fixed_assets' })];
  const entries = [entry('capital', '2026-09-01', [journalLine('1110', 'cash', 1000, 0, 10, 0), journalLine('3100', 'capital', 0, 1000, 0, 10)]), entry('sales', '2026-09-02', [journalLine('1110', 'cash', 100, 0, 1, 0), journalLine('4100', 'sales', 0, 100, 0, 1)]), entry('drawings', '2026-10-01', [journalLine('3200', 'drawings', 40, 0, .4, 0), journalLine('1110', 'cash', 0, 40, 0, .4)]), entry('depreciation', '2026-10-02', [journalLine('5800', 'expense', 10, 0, .1, 0), journalLine('depreciation', 'contra', 0, 10, 0, .1)])];
  const balance = calculateBalanceSheet(chart, entries, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(balance.total_assets_sdg, 1050); assert.equal(balance.total_equity_sdg, 1050); assert.equal(balance.current_period_profit_sdg, 90); assert.equal(balance.is_balanced, true);
  assert.equal(balance.equity.find(a => a.code === '3200')!.amount_sdg, -40); assert.equal(balance.assets.find(a => a.code === 'depreciation')!.amount_sdg, -10);
});

test('A1 cash flow uses account metadata, ignores internal transfers and separates mixed activity counterparts', () => {
  const chart = [...getDefaultChartOfAccounts('org'), account('wallet', 'ASSET', 'DEBIT', { reporting_group: 'cash_bank' }), account('equipment', 'ASSET', 'DEBIT', { reporting_group: 'fixed_assets' }), account('loan', 'LIABILITY', 'CREDIT', { cash_flow_category: 'financing' })];
  const entries = [entry('funding', '2026-10-01', [journalLine('wallet', 'wallet', 1000, 0, 10, 0), journalLine('loan', 'loan', 0, 1000, 0, 10)]), entry('transfer', '2026-10-02', [journalLine('1110', 'cash', 100, 0, 1, 0), journalLine('wallet', 'wallet', 0, 100, 0, 1)]), entry('mixed', '2026-10-03', [journalLine('equipment', 'asset', 200, 0, 2, 0), journalLine('5200', 'rent', 50, 0, .5, 0), journalLine('wallet', 'wallet', 0, 250, 0, 2.5)])];
  const flow = calculateCashFlowStatement(chart, entries);
  assert.equal(flow.net_cash_financing_sdg, 1000); assert.equal(flow.net_cash_investing_sdg, -200); assert.equal(flow.net_cash_operating_sdg, -50); assert.equal(flow.ending_cash_sdg, 750);
  const ambiguous = entry('ambiguous', '2026-10-04', [journalLine('wallet', 'cash', 100, 0, 1, 0), journalLine('equipment', 'asset', 50, 0, .5, 0), journalLine('3100', 'capital', 0, 150, 0, 1.5)]);
  assert.throws(() => calculateCashFlowStatement(chart, [ambiguous]), /قيد نقدي مختلط/);
});

test('A1 classification and missing accounts fail visibly rather than reporting invented values', () => {
  assert.throws(() => classifyAccount(account('bad', 'ASSET', 'DEBIT', { reporting_group: 'sales' })), /مجموعة التقرير/);
  assert.throws(() => classifyAccount(account('bad', 'REVENUE', 'CREDIT', { cash_flow_category: 'cash' })), /التدفق النقدي/);
  const entries = [entry('missing', '2026-10-01', [journalLine('1110', 'cash', 10, 0, .1, 0), journalLine('missing', 'missing', 0, 10, 0, .1)])];
  assert.throws(() => calculateIncomeStatement(entries), /غير موجود/);
});

test('A1 expenses credit selected bank, USD bank, custom cash or payable with exact journal reconciliation', async () => {
  const f = await fixture();
  await f.run('account.create', { ...account('wallet', 'ASSET', 'DEBIT', { reporting_group: 'cash_bank' }) });
  for (const [method, code, currency] of [['bankak', '1130', 'SDG'], ['fawry', '1140', 'USD'], ['bank_transfer', '1150', 'SDG'], ['custom', 'wallet', 'SDG'], ['on_credit', '2110', 'SDG']] as const) {
    const expense = (await f.run('expense.create', { title: 'إيجار', category: 'إيجار', amount: 10, currency, exchange_rate_used: 2000, date: '2026-10-05', payment_method: method, ...(method === 'custom' ? { payment_account_code: code } : {}) }, `expense-${method}`)).result;
    const snapshot = await f.ops.snapshot(f.org.id, actor), posting = snapshot.collections.journal_entries.find(e => e.reference_id === expense.id)!;
    assert.equal(expense.payment_account_code, code); assert.equal(posting.lines[1].account_code, code); assert.equal(posting.lines[1][currency === 'USD' ? 'credit_usd' : 'credit_sdg'], 10);
    assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings), []);
    await f.run('expense.create', { title: 'إيجار', category: 'إيجار', amount: 10, currency, exchange_rate_used: 2000, date: '2026-10-05', payment_method: method, ...(method === 'custom' ? { payment_account_code: code } : {}) }, `expense-${method}`);
    assert.equal((await f.ops.snapshot(f.org.id, actor)).collections.expenses.length, snapshot.collections.expenses.length);
  }
});

test('A1 backend rejects inventory purchases, invalid expense funding and changing used account classification atomically', async () => {
  const f = await fixture(), base = { title: 'اختبار', category: 'أخرى', amount: 10, currency: 'SDG', date: '2026-10-05' };
  for (const input of [{ category: 'مشتريات بضاعة وتوريدات' }, { kind: 'purchase' }, { payment_method: 'custom', payment_account_code: '1300' }, { expense_account_code: '5100' }, { payment_method: 'on_credit', payment_account_code: '1110' }]) {
    const before = f.store.dump(); await assert.rejects(f.run('expense.create', { ...base, ...input })); assert.deepEqual(f.store.dump(), before);
  }
  await f.run('account.create', { ...account('consulting', 'REVENUE', 'CREDIT') });
  await f.run('journal.create', { reference_type: 'manual', description: 'إيراد', date: '2026-10-05', lines: [journalLine('1110', 'cash', 10, 0, .1, 0), journalLine('consulting', 'service', 0, 10, 0, .1)] });
  const before = f.store.dump();
  await assert.rejects(f.run('account.update', { code: 'consulting', updates: { reporting_group: 'fx_gain' } }), /تصنيف الحساب المُستخدم/);
  assert.deepEqual(f.store.dump(), before);
});

test('D1 dimensions are protected, journal tags require active masters and branch P&L follows tagged lines', async () => {
  const f=await fixture(),root=`organizations/${f.org.id}`,now='2026-10-05T12:00:00.000Z';
  await f.store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'});tx.set('plans/Enterprise',defaultPlatformPlans(now).find(plan=>plan.id==='Enterprise')!);tx.set(`${root}/members/accountant`,{uid:'accountant',role:'Accountant',status:'active'});});
  const branch=(await f.run('dimension.create',{kind:'branch',id:'north',code:'NORTH',name_ar:'الفرع الشمالي'},'branch')).result;
  await f.run('dimension.create',{kind:'cost_center',id:'sales',code:'SALES',name_ar:'المبيعات'},'cost');
  await f.run('dimension.create',{kind:'project',id:'contract-a',code:'A',name_ar:'العقد أ'},'project');
  await assert.rejects(f.ops.execute(f.org.id,{...actor,uid:'accountant'},{action:'dimension.create',operationId:'forbidden',data:{kind:'project',id:'x',code:'X',name_ar:'ممنوع'}}),/صلاحية/);
  await assert.rejects(f.run('dimension.create',{kind:'branch',id:'duplicate',code:'north',name_ar:'مكرر'},'duplicate'),/مستخدم مسبقاً/);
  const dimensions={branch_id:'north',cost_center_id:'sales',project_id:'contract-a'};
  await f.run('journal.create',{reference_type:'manual',description:'بيع الفرع',date:'2026-10-05',lines:[{...journalLine('1110','نقد',100,0,0,0),...dimensions},{...journalLine('4100','مبيعات',0,100,0,0),...dimensions}]},'sale');
  await f.run('journal.create',{reference_type:'manual',description:'مصروف الفرع',date:'2026-10-05',lines:[{...journalLine('5200','مصروف',10,0,0,0),...dimensions},{...journalLine('1110','نقد',0,10,0,0),...dimensions}]},'expense');
  await f.store.transaction(async tx=>tx.set(`${root}/journal_entries/cogs`,entry('cogs','2026-10-05',[{...journalLine('5100','تكلفة',60,0,0,0),branch_id:'north'},{...journalLine('1300','مخزون',0,60,0,0),branch_id:'north'}])));
  const report=await f.ops.branchProfitAndLoss(f.org.id,actor,'north',{start:'2026-10-01',end:'2026-10-31'});assert.equal(report.sales_sdg,100);assert.equal(report.cogs_sdg,60);assert.equal(report.expenses_sdg,10);assert.equal(report.net_profit_sdg,30);assert.equal(report.branch.id,branch.id);
  const taggedExpense=(await f.run('expense.create',{title:'إيجار المشروع',category:'إيجار',amount:25,currency:'SDG',date:'2026-10-05',...dimensions},'tagged-expense')).result;
  const taggedSnapshot=await f.ops.snapshot(f.org.id,actor),taggedPosting=taggedSnapshot.collections.journal_entries.find(row=>row.reference_id===taggedExpense.id)!;
  assert.deepEqual(taggedPosting.lines.map((line:JournalEntry['lines'][number])=>({branch_id:line.branch_id,cost_center_id:line.cost_center_id,project_id:line.project_id})),[dimensions,dimensions]);
  assert.equal(taggedExpense.branch_id,'north');assert.equal(taggedExpense.cost_center_id,'sales');assert.equal(taggedExpense.project_id,'contract-a');
  const customer=(await f.run('customer.create',{name:'عميل الفرع',phone:'',preferred_currency:'SDG'},'dimension-customer')).result;
  const service=(await f.run('product.create',{name:'خدمة الفرع',unit:'خدمة',price_sdg:50,price_usd:0,tax_rate:0,is_active:true,track_inventory:false,stock_quantity:0},'dimension-service')).result;
  const invoice=(await f.run('invoice.create',{customer_id:customer.id,issue_date:'2026-10-05',currency_mode:'single_sdg',exchange_rate_used:0,discount_type:'fixed',discount_value:0,items:[{product_id:service.id,description:'خدمة',unit:'خدمة',quantity:1,unit_price:50,currency:'SDG',tax_rate:0,discount_percent:0}],...dimensions},'dimension-invoice')).result;
  const invoicePosting=(await f.ops.snapshot(f.org.id,actor)).collections.journal_entries.find(row=>row.reference_id===invoice.id)!;
  assert.equal(invoice.branch_id,'north');assert.ok(invoicePosting.lines.every((line:JournalEntry['lines'][number])=>line.branch_id==='north'&&line.cost_center_id==='sales'&&line.project_id==='contract-a'));
  await f.run('dimension.update',{kind:'project',id:'contract-a',expected_revision:1,updates:{status:'inactive'}},'disable-project');
  await assert.rejects(f.run('journal.create',{reference_type:'manual',description:'بعد معطل',date:'2026-10-05',lines:[{...journalLine('1110','نقد',1,0,0,0),project_id:'contract-a'},{...journalLine('4100','مبيعات',0,1,0,0),project_id:'contract-a'}]},'inactive'),/غير موجود أو غير نشط/);
  const before=f.store.dump();await assert.rejects(f.run('expense.create',{title:'مصروف مرفوض',category:'إيجار',amount:1,currency:'SDG',date:'2026-10-05',project_id:'contract-a'},'inactive-expense'),/غير موجود أو غير نشط/);assert.deepEqual(f.store.dump(),before);
  await assert.rejects(f.run('invoice.create',{customer_id:customer.id,issue_date:'2026-10-05',currency_mode:'single_sdg',exchange_rate_used:0,discount_type:'fixed',discount_value:0,items:[{product_id:service.id,description:'مرفوض',unit:'خدمة',quantity:1,unit_price:1,currency:'SDG',tax_rate:0,discount_percent:0}],project_id:'contract-a'},'inactive-invoice'),/غير موجود أو غير نشط/);
  const snapshot=await f.ops.snapshot(f.org.id,{...actor,uid:'accountant'});assert.equal(snapshot.collections.branches.length,1);assert.equal(snapshot.collections.cost_centers.length,1);assert.equal(snapshot.collections.projects.length,1);
});

test('D3.1 protected budgets enforce permissions, revision and source-backed variance',async()=>{
  const f=await fixture(),root=`organizations/${f.org.id}`,now='2026-10-05T12:00:00.000Z';
  await f.store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'});tx.set('plans/Enterprise',defaultPlatformPlans(now).find(plan=>plan.id==='Enterprise')!);tx.set(`${root}/members/accountant`,{uid:'accountant',role:'Accountant',status:'active'});tx.set(`${root}/members/viewer`,{uid:'viewer',role:'Viewer',status:'active'});});
  const created=await f.run('budget.create',{id:'operating-2026',name:'ميزانية التشغيل',start_date:'2026-10-01',end_date:'2026-10-31',status:'active',lines:[{account_code:'5200',amount_sdg:100,amount_usd:10}]},'budget-create'),plan=created.result;
  assert.ok(created.changes.some(change=>change.path===`${root}/budgets/${plan.id}`&&change.value?.name==='ميزانية التشغيل'));
  await f.run('journal.create',{reference_type:'manual',description:'مصروف فعلي',date:'2026-10-05',lines:[journalLine('5200','مصروف',40,0,4,0),journalLine('1110','نقد',0,40,0,4)]},'budget-actual');
  const report=await f.ops.budgetReport(f.org.id,{...actor,uid:'viewer'},plan.id);assert.equal(report.rows[0].actual_sdg,40);assert.equal(report.rows[0].variance_sdg,60);assert.equal(report.rows[0].variance_percent_sdg,60);
  const before=f.store.dump();await assert.rejects(f.ops.execute(f.org.id,{...actor,uid:'accountant'},{action:'budget.update',operationId:'budget-forbidden',data:{id:plan.id,expected_revision:1,name:'مرفوض',start_date:'2026-10-01',end_date:'2026-10-31',status:'active',lines:[{account_code:'5200',amount_sdg:120,amount_usd:0}]}}),/صلاحية/);assert.deepEqual(f.store.dump(),before);
  await f.run('budget.update',{id:plan.id,expected_revision:1,name:'ميزانية التشغيل المعدلة',start_date:'2026-10-01',end_date:'2026-10-31',status:'active',lines:[{account_code:'5200',amount_sdg:120,amount_usd:0}]},'budget-update');
  await assert.rejects(f.run('budget.update',{id:plan.id,expected_revision:1,name:'قديم',start_date:'2026-10-01',end_date:'2026-10-31',status:'active',lines:[{account_code:'5200',amount_sdg:1,amount_usd:0}]},'budget-stale'),/جلسة أخرى/);
});

test('D3.2b cash forecast includes overdue and due balances without inventing unsourced schedules',()=>{
  const report=cashForecast('2026-10-05',30,[
    {id:'ar-overdue',source_id:'invoice-overdue',source_reference:'INV-001',customer_name:'عميل متأخر',due_date:'2026-10-01',remaining_sdg:100,remaining_usd:1},
    {id:'ar-future',source_id:'invoice-future',source_reference:'INV-002',customer_name:'عميل آجل',due_date:'2026-10-20',remaining_sdg:200,remaining_usd:2},
    {id:'ar-outside',source_id:'invoice-outside',source_reference:'INV-003',customer_name:'خارج الأفق',due_date:'2026-11-10',remaining_sdg:900,remaining_usd:9},
  ],[
    {id:'ap-due',source_id:'bill-due',reference:'BILL-001',supplier_name:'مورد',due_date:'2026-10-06',remaining_sdg:80,remaining_usd:.8},
  ]);
  assert.equal(report.end_date,'2026-11-04');
  assert.deepEqual(report.rows.map(row=>[row.date,row.source_type,row.source_id]),[['2026-10-05','customer_due','invoice-overdue'],['2026-10-06','supplier_due','bill-due'],['2026-10-20','customer_due','invoice-future']]);
  assert.deepEqual(report.totals,{inflow_sdg:300,inflow_usd:3,outflow_sdg:80,outflow_usd:.8,net_sdg:220,net_usd:2.2});
  assert.deepEqual(report.coverage,{customer_due_dates:true,supplier_due_dates:true,recurring_expenses:false,scheduled_payments:false});
  assert.throws(()=>cashForecast('2026-10-05',0,[],[]),/فترة التوقع/);
  assert.throws(()=>cashForecast('2026-10-05',366,[],[]),/فترة التوقع/);
});

test('D3.2b cash forecast is enterprise V2 and permission protected',async()=>{
  const f=await fixture(),root=`organizations/${f.org.id}`,now='2026-10-05T12:00:00.000Z';
  await f.store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'});tx.set('plans/Enterprise',defaultPlatformPlans(now).find(plan=>plan.id==='Enterprise')!);tx.set(`${root}/members/viewer`,{uid:'viewer',role:'Viewer',status:'active'});});
  const report=await f.ops.cashForecastReport(f.org.id,actor,{asOf:'2026-10-05',days:30});
  assert.equal(report.horizon_days,30);assert.deepEqual(report.rows,[]);
  await assert.rejects(f.ops.cashForecastReport(f.org.id,{...actor,uid:'viewer'},{asOf:'2026-10-05',days:30}),/صلاحية/);
});
