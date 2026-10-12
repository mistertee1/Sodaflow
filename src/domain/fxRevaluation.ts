import BigNumber from 'bignumber.js';
import type { Account, JournalEntry, MerchantSettings } from '../types';
import { classifyAccount } from './accountClassification';
import { nativeCurrencyExposure } from './fxExposure';
import type { NativeSourceAllocation } from './fxExposure';
import { deriveNativeSourceAllocations, type FxSourceSnapshot } from './fxSourceAllocations';
import { assertPeriodPosting, validatePeriods } from './periodContracts';
import { assertOpenPeriod, dateOnly, ensure, identifier, money, text, validateJournal } from './validation';

export interface FxRevaluationInput { date:string; closing_rate:number; account_codes:string[]; reason:string; rate_source:string }
export interface FxRevaluationSnapshot extends FxSourceSnapshot { accounting_periods:Record<string,unknown>[]; settings:Partial<MerchantSettings> }

/** Pure reviewed period-end quote. It never fetches a rate, persists, closes a period, or grants authority. */
export function fxRevaluationQuote(input:FxRevaluationInput,snapshot:FxRevaluationSnapshot) {
  return quote(input,snapshot);
}
/** Replay-only entry point. Callers must first establish immutable server-derived proof. */
export function fxRevaluationQuoteFromProof(input:FxRevaluationInput,snapshot:FxRevaluationSnapshot,proof:NativeSourceAllocation[]) {
  return quote(input,snapshot,proof);
}
function quote(input:FxRevaluationInput,snapshot:FxRevaluationSnapshot,proof?:NativeSourceAllocation[]) {
  ensure(input && typeof input==='object' && !Array.isArray(input),'صيغة إعادة التقييم غير صالحة.');
  ensure(Object.keys(input).every(k=>['date','closing_rate','account_codes','reason','rate_source'].includes(k)),'حقول إعادة التقييم غير مسموحة.');
  const org=identifier(snapshot.org_id),date=dateOnly(input.date),rate=money(input.closing_rate,8,true);
  ensure(date===input.date,'استخدم تاريخ إقفال يومياً دون وقت.');
  const reason=text(input.reason,1000,true),rateSource=text(input.rate_source,500,true);
  const periods=validatePeriods(snapshot.accounting_periods as any,org),period=periods.find(p=>p.start_date<=date&&p.end_date>=date);
  ensure(period?.end_date===date,'إعادة التقييم تكون في آخر يوم من فترة محاسبية مغطاة.');
  assertOpenPeriod(date,snapshot.settings);
  assertPeriodPosting(periods,date,'Owner',true,reason);
  ensure(Array.isArray(input.account_codes)&&input.account_codes.length>0&&input.account_codes.length<=50,'اختر من 1 إلى 50 حساب نقدي لإعادة التقييم.');
  for (const entry of snapshot.journal_entries) ensure(entry.org_id===org,'قيد إعادة التقييم تابع لمؤسسة أخرى.');
  const codes=input.account_codes.map(identifier); ensure(new Set(codes).size===codes.length,'حسابات إعادة التقييم مكررة.');
  const allocations=proof || deriveNativeSourceAllocations(snapshot,codes,date);
  const chart=new Map<string,Account>(); for(const account of snapshot.accounts){identifier(account.code);ensure(account.org_id===org&&!chart.has(account.code),'دليل الحسابات مكرر أو أجنبي.');chart.set(account.code,account);}
  const gain=chart.get('4210'),loss=chart.get('5510');
  ensure(gain?.is_active&&gain.type==='REVENUE'&&gain.nature==='CREDIT'&&classifyAccount(gain).reporting_group==='fx_gain','حساب أرباح إعادة التقييم 4210 غير صالح.');
  ensure(loss?.is_active&&loss.type==='EXPENSE'&&loss.nature==='DEBIT'&&classifyAccount(loss).reporting_group==='fx_loss','حساب خسائر إعادة التقييم 5510 غير صالح.');
  const lines:any[]=[],items:any[]=[];
  for(const code of codes){
    const account=chart.get(code); ensure(account?.is_active,'حساب إعادة التقييم مفقود أو غير نشط.');
    const group=classifyAccount(account).reporting_group; ensure(['cash_bank','receivables','payables'].includes(group),'إعادة التقييم تقبل النقدية والذمم النقدية فقط.');
    const exposure=nativeCurrencyExposure(org,date,code,snapshot.journal_entries,allocations);
    const current=new BigNumber(exposure.foreign.sdg),usd=new BigNumber(exposure.foreign.usd); ensure(!usd.isZero(),'لا يوجد رصيد أصلي بعملة USD لإعادة تقييم الحساب.');
    const target=usd.times(rate).decimalPlaces(0,BigNumber.ROUND_HALF_UP),adjustment=target.minus(current); ensure(!adjustment.isZero(),'الحساب مقيم فعلياً بسعر الإقفال المحدد.');
    const amount=money(adjustment.abs().toNumber(),0,true);
    if(adjustment.gt(0)) lines.push({account_code:code,account_name:account.name_ar,debit_sdg:amount,credit_sdg:0,debit_usd:0,credit_usd:0},{account_code:'4210',account_name:gain.name_ar,debit_sdg:0,credit_sdg:amount,debit_usd:0,credit_usd:0});
    else lines.push({account_code:'5510',account_name:loss.name_ar,debit_sdg:amount,credit_sdg:0,debit_usd:0,credit_usd:0},{account_code:code,account_name:account.name_ar,debit_sdg:0,credit_sdg:amount,debit_usd:0,credit_usd:0});
    items.push({account_code:code,reporting_group:group,foreign_before_sdg:current.toNumber(),foreign_balance_usd:usd.toNumber(),local_excluded_sdg:exposure.local.sdg,local_excluded_reporting_usd:exposure.local.usd,target_sdg:target.toNumber(),adjustment_sdg:adjustment.toNumber()});
  }
  return {schema_version:1 as const,org_id:org,date,period_id:period!.id,closing_rate:rate,rate_source:rateSource,reason,items,lines,...validateJournal(lines)};
}
