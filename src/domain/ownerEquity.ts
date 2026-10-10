import BigNumber from 'bignumber.js';
import type { Account, JournalEntry, MerchantSettings } from '../types';
import type { Document } from './store';
import { classifyAccount } from './accountClassification';
import { validateFinancialAccount, transferCarryingValue } from './cashManagement';
import { journalLine } from './financial';
import { accountLedger } from './operationalReports';
import { assertPeriodPosting, validatePeriods } from './periodContracts';
import { assertOpenPeriod, dateOnly, ensure, identifier, money, text, validateJournal } from './validation';

export interface OwnerEquityInput {
  kind: 'contribution' | 'drawing'; date: string; financial_account_id: string;
  amount: number; currency_policy: 'dual' | 'sdg_only'; exchange_rate_used?: number;
  reason: string; reference_number: string;
}
/** Must be loaded from the tenant's complete live records by the future protected command. */
export interface OwnerEquitySnapshot {
  org_id: string; accounts: Account[]; financial_accounts: Document[];
  journal_entries: JournalEntry[]; accounting_periods: Document[]; settings: Partial<MerchantSettings>;
}
/** Pure financial contract: no permission grant, persistence or HTTP endpoint. */
export function ownerEquityQuote(input: OwnerEquityInput, snapshot: OwnerEquitySnapshot) {
  ensure(input && typeof input === 'object' && !Array.isArray(input), 'صيغة عملية المالك غير صالحة.');
  ensure(Object.keys(input).every(key => ['kind','date','financial_account_id','amount','currency_policy','exchange_rate_used','reason','reference_number'].includes(key)), 'حقول عملية المالك غير مسموحة.');
  ensure(['contribution','drawing'].includes(input.kind), 'نوع عملية المالك غير صالح.');
  ensure(['dual','sdg_only'].includes(input.currency_policy), 'سياسة عملة عملية المالك غير صالحة.');
  const orgId = identifier(snapshot.org_id), date = dateOnly(input.date);
  ensure(date === input.date, 'استخدم تاريخاً يومياً دون وقت.');
  const reason = text(input.reason,1000,true), reference = text(input.reference_number,200);
  assertOpenPeriod(date,snapshot.settings);
  assertPeriodPosting(validatePeriods(snapshot.accounting_periods,orgId),date,'Owner',false,reason);
  const id = identifier(input.financial_account_id);
  const matches = snapshot.financial_accounts.filter(row => row.id === id);
  ensure(matches.length === 1 && matches[0].org_id === orgId && matches[0].status === 'active', 'حساب عملية المالك مفقود أو مكرر أو غير نشط أو أجنبي.');
  const cash = matches[0];
  ensure(snapshot.financial_accounts.filter(row => row.account_code === cash.account_code).length === 1, 'ربط حساب النقدية مكرر.');
  validateFinancialAccount(cash,snapshot.accounts);
  const codes = new Set<string>();
  for (const account of snapshot.accounts) {
    identifier(account.code);
    ensure(account.org_id === orgId && !codes.has(account.code), 'دليل الحسابات مكرر أو أجنبي.'); codes.add(account.code);
  }
  const cashChart = snapshot.accounts.find(row => row.code === cash.account_code)!;
  ensure(cashChart.is_active === true,'حساب النقدية في الدليل غير نشط.');
  const equityCode = input.kind === 'contribution' ? '3100' : '3200';
  const equity = snapshot.accounts.find(row => row.code === equityCode);
  ensure(equity && equity.is_active === true && equity.type === 'EQUITY' && equity.nature === (input.kind === 'contribution' ? 'CREDIT' : 'DEBIT') && classifyAccount(equity).reporting_group === (input.kind === 'contribution' ? 'capital' : 'drawings'), 'حساب رأس المال أو المسحوبات غير صالح.');
  const journalIds = new Set<string>();
  for (const entry of snapshot.journal_entries) {
    identifier(entry.id); dateOnly(entry.date);
    ensure(entry.org_id === orgId && !journalIds.has(entry.id), 'قيد مصدر مكرر أو أجنبي.'); journalIds.add(entry.id);
    validateJournal(entry.lines);
    ensure(entry.lines.every(line => codes.has(line.account_code)), 'قيد المصدر يتضمن حساباً مفقوداً.');
  }
  money(input.amount,cash.currency === 'SDG' ? 0 : 2,true);
  if (input.currency_policy === 'sdg_only') ensure(cash.currency === 'SDG' && (input.exchange_rate_used === undefined || input.exchange_rate_used === 0), 'الوضع السوداني فقط لا يتضمن عملة أو سعر صرف أجنبي.');
  let amounts: {sdg:number;usd:number}, rate = 0;
  let sourceBalance: {SDG:number;USD:number} | null = null;
  if (input.kind === 'contribution') {
    if (input.currency_policy === 'sdg_only') amounts = {sdg:input.amount,usd:0};
    else {
      rate = money(input.exchange_rate_used,8,true);
      amounts = cash.currency === 'SDG' ? {sdg:input.amount,usd:money(new BigNumber(input.amount).dividedBy(rate).decimalPlaces(2,BigNumber.ROUND_HALF_UP).toNumber(),2)} : {usd:input.amount,sdg:money(new BigNumber(input.amount).times(rate).decimalPlaces(0,BigNumber.ROUND_HALF_UP).toNumber(),0)};
    }
  } else {
    // A personal withdrawal consumes historical cash basis; it is neither operating expense nor FX realization.
    ensure(input.exchange_rate_used === undefined || input.exchange_rate_used === 0, 'المسحوبات تستخدم القيمة الدفترية؛ لا تقبل سعر صرف جديداً.');
    const closing = accountLedger(snapshot.accounts,snapshot.journal_entries,{accountCode:cash.account_code,end:date},date).closing;
    sourceBalance = {SDG:closing.SDG,USD:closing.USD};
    amounts = transferCarryingValue(input.amount,cash.currency,sourceBalance);
    if (input.currency_policy === 'sdg_only') ensure(sourceBalance.USD === 0, 'لا يمكن إسقاط القيمة الدفترية بالدولار من المسحوبات.');
    const full = accountLedger(snapshot.accounts,snapshot.journal_entries,{accountCode:cash.account_code},'9999-12-31');
    const daily = new Map<string,Document>();
    for (const row of full.rows) if (row.date > date) daily.set(row.date,row);
    for (const row of daily.values()) ensure(new BigNumber(row.balance.SDG).gte(amounts.sdg) && new BigNumber(row.balance.USD).gte(amounts.usd), 'المسحوبات بتاريخ قديم تسبب عجزاً في دفتر أو يوم لاحق.',409);
  }
  const contribution = input.kind === 'contribution';
  const lines = contribution ? [journalLine(cashChart.code,cashChart.name_ar,amounts.sdg,0,amounts.usd,0),journalLine(equity.code,equity.name_ar,0,amounts.sdg,0,amounts.usd)] : [journalLine(equity.code,equity.name_ar,amounts.sdg,0,amounts.usd,0),journalLine(cashChart.code,cashChart.name_ar,0,amounts.sdg,0,amounts.usd)];
  return {schema_version:1 as const,org_id:orgId,kind:input.kind,date,reason,reference_number:reference,financial_account_id:id,account_code:cash.account_code,equity_account_code:equityCode,currency:cash.currency as 'SDG'|'USD',currency_policy:input.currency_policy,native_amount:input.amount,exchange_rate_used:rate,amount_sdg:amounts.sdg,amount_usd:amounts.usd,source_balance:sourceBalance,lines,...validateJournal(lines)};
}
