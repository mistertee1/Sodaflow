import BigNumber from 'bignumber.js';
import type { Account, JournalEntry, TrialBalanceItem, IncomeStatementSummary, BalanceSheetSummary, BalanceSheetItem, CashFlowSummary } from '../types';
import { classifyAccount } from './accountClassification';
import { dateOnly, ensure, validateJournal } from './validation';

export interface ReportPeriod { start?: string; end?: string; }
type Amounts = { sdg: BigNumber; usd: BigNumber };
const zero = (): Amounts => ({ sdg: new BigNumber(0), usd: new BigNumber(0) });
const add = (to: Amounts, value: Amounts, sign = 1) => { to.sdg = to.sdg.plus(value.sdg.times(sign)); to.usd = to.usd.plus(value.usd.times(sign)); };
const movement = (line: JournalEntry['lines'][number]): Amounts => ({ sdg: new BigNumber(line.debit_sdg).minus(line.credit_sdg), usd: new BigNumber(line.debit_usd).minus(line.credit_usd) });
function periodBounds(period: ReportPeriod) {
  const start = period.start ? dateOnly(period.start) : undefined, end = period.end ? dateOnly(period.end) : undefined;
  ensure(!start || !end || start <= end, 'بداية الفترة يجب أن تسبق نهايتها.'); return { start, end };
}
function chartIndex(accounts: Account[]) {
  const index = new Map<string, Account>();
  for (const account of accounts) { ensure(!index.has(account.code), 'رمز حساب مكرر في الدليل.'); classifyAccount(account); index.set(account.code, account); }
  return index;
}
function ledger(accounts: Account[], entries: JournalEntry[], period: ReportPeriod) {
  const index = chartIndex(accounts), bounds = periodBounds(period), opening = new Map<string, Amounts>(), debits = new Map<string, Amounts>(), credits = new Map<string, Amounts>();
  for (const code of index.keys()) { opening.set(code, zero()); debits.set(code, zero()); credits.set(code, zero()); }
  for (const entry of entries) {
    const date = dateOnly(entry.date); validateJournal(entry.lines);
    if (bounds.end && date > bounds.end) continue;
    for (const line of entry.lines) {
      ensure(index.has(line.account_code), `الحساب ${line.account_code} غير موجود؛ راجع الدليل قبل إصدار التقرير.`);
      if (bounds.start && date < bounds.start) add(opening.get(line.account_code)!, movement(line));
      else { add(debits.get(line.account_code)!, { sdg: new BigNumber(line.debit_sdg), usd: new BigNumber(line.debit_usd) }); add(credits.get(line.account_code)!, { sdg: new BigNumber(line.credit_sdg), usd: new BigNumber(line.credit_usd) }); }
    }
  }
  return { index, opening, debits, credits, bounds };
}
export function ledgerTrialBalance(accounts: Account[], entries: JournalEntry[], period: ReportPeriod = {}) {
  const data = ledger(accounts, entries, period), debit = zero(), credit = zero(), closing = zero();
  const items: TrialBalanceItem[] = accounts.map(account => {
    const open = data.opening.get(account.code)!, dr = data.debits.get(account.code)!, cr = data.credits.get(account.code)!;
    add(debit, dr); add(credit, cr); add(closing, open); add(closing, dr); add(closing, cr, -1);
    const sign = classifyAccount(account).normal_balance === 'DEBIT' ? 1 : -1;
    return { account_code: account.code, account_name: account.name_ar, type: account.type, nature: account.nature,
      opening_balance_sdg: open.sdg.times(sign).toNumber(), opening_balance_usd: open.usd.times(sign).toNumber(),
      total_debit_sdg: dr.sdg.toNumber(), total_credit_sdg: cr.sdg.toNumber(), total_debit_usd: dr.usd.toNumber(), total_credit_usd: cr.usd.toNumber(),
      net_balance_sdg: open.sdg.plus(dr.sdg).minus(cr.sdg).times(sign).toNumber(), net_balance_usd: open.usd.plus(dr.usd).minus(cr.usd).times(sign).toNumber() };
  }).sort((a, b) => a.account_code.localeCompare(b.account_code));
  return { items, totalDebitSdg: debit.sdg.toNumber(), totalCreditSdg: credit.sdg.toNumber(), totalDebitUsd: debit.usd.toNumber(), totalCreditUsd: credit.usd.toNumber(), isBalanced: debit.sdg.eq(credit.sdg) && debit.usd.eq(credit.usd) && closing.sdg.isZero() && closing.usd.isZero() };
}
export function ledgerIncomeStatement(accounts: Account[], entries: JournalEntry[], period: ReportPeriod = {}): IncomeStatementSummary {
  const data = ledger(accounts, entries, period), sales = zero(), cogs = zero(), expense = zero(), fx = zero();
  for (const account of accounts) {
    if (!['REVENUE', 'EXPENSE'].includes(account.type)) continue;
    const dr = data.debits.get(account.code)!, cr = data.credits.get(account.code)!, net = { sdg: dr.sdg.minus(cr.sdg), usd: dr.usd.minus(cr.usd) }, group = classifyAccount(account).reporting_group;
    if (group === 'fx_gain' || group === 'fx_loss') add(fx, net, -1);
    else if (account.type === 'REVENUE') add(sales, net, -1);
    else if (group === 'cogs') add(cogs, net); else add(expense, net);
  }
  const gross = { sdg: sales.sdg.minus(cogs.sdg), usd: sales.usd.minus(cogs.usd) }, operating = { sdg: gross.sdg.minus(expense.sdg), usd: gross.usd.minus(expense.usd) };
  return { sales_revenue_sdg: sales.sdg.toNumber(), sales_revenue_usd: sales.usd.toNumber(), cogs_sdg: cogs.sdg.toNumber(), cogs_usd: cogs.usd.toNumber(), gross_profit_sdg: gross.sdg.toNumber(), gross_profit_usd: gross.usd.toNumber(), total_operating_expenses_sdg: expense.sdg.toNumber(), total_operating_expenses_usd: expense.usd.toNumber(), net_operating_profit_sdg: operating.sdg.toNumber(), net_operating_profit_usd: operating.usd.toNumber(), fx_gain_loss_sdg: fx.sdg.toNumber(), fx_gain_loss_usd: fx.usd.toNumber(), net_profit_sdg: operating.sdg.plus(fx.sdg).toNumber(), net_profit_usd: operating.usd.plus(fx.usd).toNumber() };
}
export function ledgerBalanceSheet(accounts: Account[], entries: JournalEntry[], period: ReportPeriod = {}): BalanceSheetSummary {
  periodBounds(period);
  // Balance sheet is cumulative: prior income stays in equity until a closing journal is posted.
  const trial = ledgerTrialBalance(accounts, entries, { end: period.end }), income = ledgerIncomeStatement(accounts, entries, { end: period.end });
  const assets: BalanceSheetItem[] = [], liabilities: BalanceSheetItem[] = [], equity: BalanceSheetItem[] = [], totals = { ASSET: zero(), LIABILITY: zero(), EQUITY: zero() };
  for (const item of trial.items) {
    if (!['ASSET', 'LIABILITY', 'EQUITY'].includes(item.type)) continue;
    const category = item.type as keyof typeof totals, sign = (item.nature === 'DEBIT' ? 1 : -1) * (category === 'ASSET' ? 1 : -1);
    const amountSdg = item.net_balance_sdg * sign, amountUsd = item.net_balance_usd * sign;
    add(totals[category], { sdg: new BigNumber(amountSdg), usd: new BigNumber(amountUsd) });
    if (amountSdg || amountUsd) (category === 'ASSET' ? assets : category === 'LIABILITY' ? liabilities : equity).push({ code: item.account_code, name: item.account_name, amount_sdg: amountSdg, amount_usd: amountUsd, account_code: item.account_code, account_name: item.account_name, balance_sdg: amountSdg, balance_usd: amountUsd });
  }
  const totalEquity = { sdg: totals.EQUITY.sdg.plus(income.net_profit_sdg), usd: totals.EQUITY.usd.plus(income.net_profit_usd) }, right = { sdg: totals.LIABILITY.sdg.plus(totalEquity.sdg), usd: totals.LIABILITY.usd.plus(totalEquity.usd) }, variance = { sdg: totals.ASSET.sdg.minus(right.sdg), usd: totals.ASSET.usd.minus(right.usd) };
  return { assets, liabilities, equity_items: equity, equity, total_assets_sdg: totals.ASSET.sdg.toNumber(), total_assets_usd: totals.ASSET.usd.toNumber(), total_liabilities_sdg: totals.LIABILITY.sdg.toNumber(), total_liabilities_usd: totals.LIABILITY.usd.toNumber(), current_period_profit_sdg: income.net_profit_sdg, current_period_profit_usd: income.net_profit_usd, total_equity_sdg: totalEquity.sdg.toNumber(), total_equity_usd: totalEquity.usd.toNumber(), total_liabilities_and_equity_sdg: right.sdg.toNumber(), total_liabilities_and_equity_usd: right.usd.toNumber(), is_balanced: variance.sdg.isZero() && variance.usd.isZero(), variance_sdg: variance.sdg.abs().toNumber(), difference_sdg: variance.sdg.abs().toNumber(), variance_usd: variance.usd.abs().toNumber() };
}
export function ledgerCashFlow(accounts: Account[], entries: JournalEntry[], period: ReportPeriod = {}): CashFlowSummary {
  const { index, bounds } = ledger(accounts, entries, period), beginning = zero(), ending = zero(), flows = { operating: zero(), investing: zero(), financing: zero() }, inflows = zero(), outflows = zero();
  for (const entry of entries) {
    const date = dateOnly(entry.date); if (bounds.end && date > bounds.end) continue;
    const cash = zero(), counterparts: { value: Amounts; category: 'operating' | 'investing' | 'financing' }[] = [];
    for (const line of entry.lines) {
      const classification = classifyAccount(index.get(line.account_code)!), value = movement(line);
      if (classification.cash_flow_category === 'cash') add(cash, value);
      else counterparts.push({ value, category: classification.cash_flow_category });
    }
    add(ending, cash);
    if (bounds.start && date < bounds.start) { add(beginning, cash); continue; }
    for (const currency of ['sdg', 'usd'] as const) {
      if (cash[currency].isZero()) continue; // A cash-to-bank transfer is not revenue or expense.
      const categories = new Set(counterparts.filter(c => !c.value[currency].isZero()).map(c => c.category));
      if (categories.size <= 1) {
        const category = [...categories][0] || 'operating'; flows[category][currency] = flows[category][currency].plus(cash[currency]);
        if (category === 'operating') { if (cash[currency].isPositive()) inflows[currency] = inflows[currency].plus(cash[currency]); else outflows[currency] = outflows[currency].minus(cash[currency]); }
      } else {
        // Mixed noncash offsets cannot reliably identify which activity received the cash.
        ensure(counterparts.every(c => c.value[currency].isZero() || c.value[currency].isPositive() !== cash[currency].isPositive()), 'قيد نقدي مختلط يحتاج فصل الحركات قبل تصنيف التدفقات.');
        for (const c of counterparts) {
          flows[c.category][currency] = flows[c.category][currency].minus(c.value[currency]);
          if (c.category === 'operating') { if (c.value[currency].isNegative()) inflows[currency] = inflows[currency].minus(c.value[currency]); else outflows[currency] = outflows[currency].plus(c.value[currency]); }
        }
      }
    }
  }
  const net = { sdg: ending.sdg.minus(beginning.sdg), usd: ending.usd.minus(beginning.usd) };
  return { operating_activities: [{ title: 'المقبوضات التشغيلية', amount_sdg: inflows.sdg.toNumber(), amount_usd: inflows.usd.toNumber() }, { title: 'المدفوعات التشغيلية', amount_sdg: -outflows.sdg.toNumber(), amount_usd: -outflows.usd.toNumber() }], net_cash_operating_sdg: flows.operating.sdg.toNumber(), net_cash_operating_usd: flows.operating.usd.toNumber(), net_operating_sdg: flows.operating.sdg.toNumber(), net_operating_usd: flows.operating.usd.toNumber(), operating_inflows_sdg: inflows.sdg.toNumber(), operating_outflows_sdg: outflows.sdg.toNumber(), investing_activities: [{ title: 'التدفقات الاستثمارية', amount_sdg: flows.investing.sdg.toNumber(), amount_usd: flows.investing.usd.toNumber() }], net_cash_investing_sdg: flows.investing.sdg.toNumber(), net_cash_investing_usd: flows.investing.usd.toNumber(), net_investing_sdg: flows.investing.sdg.toNumber(), net_investing_usd: flows.investing.usd.toNumber(), financing_activities: [{ title: 'التدفقات التمويلية', amount_sdg: flows.financing.sdg.toNumber(), amount_usd: flows.financing.usd.toNumber() }], net_cash_financing_sdg: flows.financing.sdg.toNumber(), net_cash_financing_usd: flows.financing.usd.toNumber(), net_financing_sdg: flows.financing.sdg.toNumber(), net_financing_usd: flows.financing.usd.toNumber(), net_change_in_cash_sdg: net.sdg.toNumber(), net_change_in_cash_usd: net.usd.toNumber(), beginning_cash_sdg: beginning.sdg.toNumber(), beginning_cash_usd: beginning.usd.toNumber(), ending_cash_sdg: ending.sdg.toNumber(), ending_cash_usd: ending.usd.toNumber() };
}
