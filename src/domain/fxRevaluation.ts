import BigNumber from 'bignumber.js';
import type { Account, JournalEntry, MerchantSettings } from '../types';
import { classifyAccount } from './accountClassification';
import { accountLedger } from './operationalReports';
import { assertPeriodPosting, validatePeriods } from './periodContracts';
import { assertOpenPeriod, dateOnly, ensure, identifier, money, text, validateJournal } from './validation';

export interface FxRevaluationInput { date:string; closing_rate:number; account_codes:string[]; reason:string; rate_source:string }
export interface FxRevaluationSnapshot { org_id:string; accounts:Account[]; journal_entries:JournalEntry[]; accounting_periods:Record<string,unknown>[]; settings:Partial<MerchantSettings> }

/** Pure reviewed period-end quote. It never fetches a rate, persists, closes a period, or grants authority. */
export function fxRevaluationQuote(input:FxRevaluationInput,snapshot:FxRevaluationSnapshot) {
  ensure(input && typeof input==='object' && !Array.isArray(input),'صيغة إعادة التقييم غير صالحة.');
  ensure(Object.keys(input).every(k=>['date','closing_rate','account_codes','reason','rate_source'].includes(k)),'حقول إعادة التقييم غير مسموحة.');
  const org=identifier(snapshot.org_id),date=dateOnly(input.date),rate=money(input.closing_rate,8,true);
  ensure(date===input.date,'استخدم تاريخ إقفال يومياً دون وقت.');
  const reason=text(input.reason,1000,true),rateSource=text(input.rate_source,500,true);
  const periods=validatePeriods(snapshot.accounting_periods as any,org),period=periods.find(p=>p.start_date<=date&&p.end_date>=date);
  ensure(period?.end_date===date,'إعادة التقييم تكون في آخر يوم من فترة محاسبية مغطاة.');
  assertOpenPeriod(date,snapshot.settings);
  assertPeriodPosting(periods,date,'Owner',true,reason);
  ensure(Array.isArray(input.account_codes)&&input.account_codes.length>0&&input.account_codes.length<=100,'اختر من 1 إلى 100 حساب نقدي لإعادة التقييم.');
  const codes=input.account_codes.map(identifier); ensure(new Set(codes).size===codes.length,'حسابات إعادة التقييم مكررة.');
  const chart=new Map<string,Account>(); for(const account of snapshot.accounts){identifier(account.code);ensure(account.org_id===org&&!chart.has(account.code),'دليل الحسابات مكرر أو أجنبي.');chart.set(account.code,account);}
  const gain=chart.get('4210'),loss=chart.get('5510');
  ensure(gain?.is_active&&gain.type==='REVENUE'&&gain.nature==='CREDIT'&&classifyAccount(gain).reporting_group==='fx_gain','حساب أرباح إعادة التقييم 4210 غير صالح.');
  ensure(loss?.is_active&&loss.type==='EXPENSE'&&loss.nature==='DEBIT'&&classifyAccount(loss).reporting_group==='fx_loss','حساب خسائر إعادة التقييم 5510 غير صالح.');
  const lines:any[]=[],items:any[]=[];
  for(const code of codes){
    const account=chart.get(code); ensure(account?.is_active,'حساب إعادة التقييم مفقود أو غير نشط.');
    const group=classifyAccount(account).reporting_group; ensure(['cash_bank','receivables','payables'].includes(group),'إعادة التقييم تقبل النقدية والذمم النقدية فقط.');
    const closing=accountLedger(snapshot.accounts,snapshot.journal_entries,{accountCode:code,end:date},date).closing as any;
    const current=new BigNumber(closing.SDG),usd=new BigNumber(closing.USD); ensure(!usd.isZero(),'لا يوجد رصيد USD لإعادة تقييم الحساب.');
    const target=usd.times(rate).decimalPlaces(0,BigNumber.ROUND_HALF_UP),adjustment=target.minus(current); ensure(!adjustment.isZero(),'الحساب مقيم فعلياً بسعر الإقفال المحدد.');
    const amount=money(adjustment.abs().toNumber(),0,true);
    if(adjustment.gt(0)) lines.push({account_code:code,account_name:account.name_ar,debit_sdg:amount,credit_sdg:0,debit_usd:0,credit_usd:0},{account_code:'4210',account_name:gain.name_ar,debit_sdg:0,credit_sdg:amount,debit_usd:0,credit_usd:0});
    else lines.push({account_code:'5510',account_name:loss.name_ar,debit_sdg:amount,credit_sdg:0,debit_usd:0,credit_usd:0},{account_code:code,account_name:account.name_ar,debit_sdg:0,credit_sdg:amount,debit_usd:0,credit_usd:0});
    items.push({account_code:code,reporting_group:group,before_sdg:current.toNumber(),balance_usd:usd.toNumber(),target_sdg:target.toNumber(),adjustment_sdg:adjustment.toNumber()});
  }
  return {schema_version:1 as const,org_id:org,date,period_id:period!.id,closing_rate:rate,rate_source:rateSource,reason,items,lines,...validateJournal(lines)};
}
