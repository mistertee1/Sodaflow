import BigNumber from 'bignumber.js';
import type {Account} from '../types';
import {classifyAccount} from './accountClassification';
import {clean} from './store';
import {dateOnly, ensure, identifier, money, text} from './validation';

export interface TaxConfiguration {
  schema_version: 1; id: string; org_id: string; revision: number; name: string; jurisdiction: string;
  direction: 'sales' | 'purchases'; rate: number; calculation: 'exclusive' | 'inclusive';
  rounding: 'half_up' | 'half_even' | 'floor'; recoverable: boolean; tax_account_code: string | null;
  effective_from: string; effective_to: string | null; active: boolean;
}
export interface TaxQuoteInput {
  configuration_id: string; expected_configuration_revision: number; date: string;
  direction: 'sales' | 'purchases'; amount: number; currency: 'SDG' | 'USD';
  currency_policy: 'sdg_only' | 'dual'; exchange_rate_used?: number;
}
export interface TaxSnapshot {org_id: string; configurations: TaxConfiguration[]; accounts: Account[];}
const configurationKeys = ['schema_version','id','org_id','revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active'];
const inputKeys = ['configuration_id','expected_configuration_revision','date','direction','amount','currency','currency_policy','exchange_rate_used'];

/** Configurable policy only: country/rate labels never imply statutory compliance or permission. */
export function validateTaxConfiguration(input: TaxConfiguration, orgId: string): TaxConfiguration {
  ensure(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => configurationKeys.includes(key)), 'حقول إعداد الضريبة غير صالحة.');
  identifier(input.id); identifier(input.org_id); identifier(orgId);
  ensure(input.schema_version === 1 && input.org_id === orgId, 'إعداد الضريبة أجنبي أو بإصدار غير مدعوم.');
  ensure(Number.isSafeInteger(input.revision) && input.revision > 0, 'إصدار إعداد الضريبة غير صالح.');
  const name = text(input.name, 200, true), jurisdiction = text(input.jurisdiction, 100, true);
  ensure(['sales','purchases'].includes(input.direction) && ['exclusive','inclusive'].includes(input.calculation) && ['half_up','half_even','floor'].includes(input.rounding), 'نوع أو حساب أو تقريب الضريبة غير صالح.');
  money(input.rate, 4); ensure(input.rate <= 100, 'نسبة الضريبة تتجاوز 100%.');
  ensure(typeof input.recoverable === 'boolean' && typeof input.active === 'boolean', 'حالة إعداد الضريبة غير صالحة.');
  ensure(input.direction === 'purchases' || !input.recoverable, 'ضريبة المبيعات لا تصنف كضريبة قابلة للاسترداد.');
  if (input.direction === 'sales' || input.recoverable) identifier(input.tax_account_code);
  else ensure(input.tax_account_code === null, 'ضريبة الشراء غير القابلة للاسترداد تحمل على التكلفة، دون حساب ضريبة مستردة.');
  const start = dateOnly(input.effective_from);
  ensure(start === input.effective_from, 'تاريخ بدء إعداد الضريبة غير صالح.');
  ensure(input.effective_to === null || dateOnly(input.effective_to) === input.effective_to && input.effective_to >= start, 'تاريخ نهاية إعداد الضريبة غير صالح.');
  return {...clean(input), name, jurisdiction};
}

/** Pure line quote. Protected callers must derive amount from document sources and read current policy from the server. */
export function configuredTaxQuote(input: TaxQuoteInput, snapshot: TaxSnapshot) {
  ensure(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => inputKeys.includes(key)), 'حقول حساب الضريبة غير صالحة؛ المبلغ الضريبي مشتق من الإعداد.');
  const orgId = identifier(snapshot.org_id), id = identifier(input.configuration_id), date = dateOnly(input.date);
  ensure(date === input.date && ['sales','purchases'].includes(input.direction), 'تاريخ أو اتجاه الضريبة غير صالح.');
  ensure(Array.isArray(snapshot.configurations) && snapshot.configurations.length <= 1200 && Array.isArray(snapshot.accounts) && snapshot.accounts.length <= 1200, 'دليل الضريبة يتجاوز حد التحقق.');
  const ids = new Set<string>(), configurations = snapshot.configurations.map(row => {
    const configuration = validateTaxConfiguration(row, orgId); ensure(!ids.has(configuration.id), 'معرف إعداد الضريبة مكرر.'); ids.add(configuration.id); return configuration;
  });
  const configuration = configurations.find(row => row.id === id);
  ensure(configuration && configuration.active && configuration.direction === input.direction, 'إعداد الضريبة غير متاح لهذا النوع.');
  ensure(Number.isSafeInteger(input.expected_configuration_revision) && input.expected_configuration_revision === configuration.revision, 'إعداد الضريبة تغير؛ أعد المعاينة.', 409);
  ensure(configuration.effective_from <= date && (configuration.effective_to === null || date <= configuration.effective_to), 'التاريخ خارج صلاحية إعداد الضريبة.');
  const codes = new Set<string>();
  for (const account of snapshot.accounts) {identifier(account.code); ensure(account.org_id === orgId && !codes.has(account.code), 'دليل حسابات الضريبة أجنبي أو مكرر.'); codes.add(account.code);}
  if (configuration.tax_account_code) {
    const account = snapshot.accounts.find(row => row.code === configuration.tax_account_code);
    ensure(account?.is_active, 'حساب الضريبة غير متاح.');
    const group = classifyAccount(account).reporting_group;
    if (configuration.direction === 'sales') ensure(account.type === 'LIABILITY' && account.nature === 'CREDIT' && group === 'tax_payable', 'حساب ضريبة المبيعات يجب أن يكون التزاماً ضريبياً دائناً.');
    else ensure(account.type === 'ASSET' && account.nature === 'DEBIT' && group === 'other_assets', 'حساب الضريبة القابلة للاسترداد يجب أن يكون أصلاً مديناً منفصلاً عن النقد والمخزون والذمم.');
  }
  ensure(['SDG','USD'].includes(input.currency) && ['sdg_only','dual'].includes(input.currency_policy), 'عملة أو سياسة الضريبة غير مدعومة.');
  ensure(input.currency_policy === 'dual' || input.currency === 'SDG', 'الدولار يتطلب سياسة الدفترين.');
  const rate = input.currency_policy === 'dual' ? money(input.exchange_rate_used, 8, true) : 0;
  ensure(input.currency_policy === 'dual' || input.exchange_rate_used === undefined || input.exchange_rate_used === 0, 'الجنيه فقط لا يقبل سعر صرف جديداً.');
  const decimals = input.currency === 'USD' ? 2 : 0, amount = new BigNumber(money(input.amount, decimals));
  const rounding = {half_up: BigNumber.ROUND_HALF_UP, half_even: BigNumber.ROUND_HALF_EVEN, floor: BigNumber.ROUND_FLOOR}[configuration.rounding];
  const tax = (configuration.calculation === 'inclusive' ? amount.times(configuration.rate).dividedBy(new BigNumber(100).plus(configuration.rate)) : amount.times(configuration.rate).dividedBy(100)).decimalPlaces(decimals, rounding);
  const base = configuration.calculation === 'inclusive' ? amount.minus(tax) : amount, total = base.plus(tax);
  const convert = (number: BigNumber, currency: 'SDG' | 'USD') => currency === input.currency ? number : currency === 'SDG' ? number.times(rate).decimalPlaces(0, BigNumber.ROUND_HALF_UP) : number.dividedBy(rate).decimalPlaces(2, BigNumber.ROUND_HALF_UP);
  const sdgTotal = convert(total, 'SDG'), sdgTax = convert(tax, 'SDG');
  const usdTotal = input.currency_policy === 'dual' ? convert(total, 'USD') : new BigNumber(0), usdTax = input.currency_policy === 'dual' ? convert(tax, 'USD') : new BigNumber(0);
  const native = {base: base.toNumber(), tax: tax.toNumber(), total: total.toNumber()};
  const sdg = {base: sdgTotal.minus(sdgTax).toNumber(), tax: sdgTax.toNumber(), total: sdgTotal.toNumber()};
  const usd = {base: usdTotal.minus(usdTax).toNumber(), tax: usdTax.toNumber(), total: usdTotal.toNumber()};
  for (const v of Object.values(native)) money(v, decimals);
  for (const v of Object.values(sdg)) money(v, 0);
  for (const v of Object.values(usd)) money(v, 2);
  return {schema_version: 1 as const, org_id: orgId, date, configuration: clean(configuration), currency: input.currency, currency_policy: input.currency_policy, exchange_rate_used: rate,
    native, sdg, usd, tax_account_code: configuration.tax_account_code,
    tax_treatment: configuration.direction === 'sales' ? 'payable' as const : configuration.recoverable ? 'receivable' as const : 'cost' as const,
    // Convert the document total and tax, assigning any minor-unit conversion difference to base.
    conversion_base_adjustment_sdg: sdgTotal.minus(sdgTax).minus(convert(base, 'SDG')).toNumber(),
    conversion_base_adjustment_usd: input.currency_policy === 'dual' ? usdTotal.minus(usdTax).minus(convert(base, 'USD')).toNumber() : 0};
}
