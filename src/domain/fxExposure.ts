import BigNumber from 'bignumber.js';
import type { JournalEntry } from '../types';
import { dateOnly, ensure, identifier, validateJournal } from './validation';

export interface NativeSourceAllocation {
  journal_id: string; line_index: number; source_id: string; native_currency: 'SDG' | 'USD';
}
/** Server-derived source allocations only. Every selected GL line must have exactly one native source. */
export function nativeCurrencyExposure(orgId: string, asOf: string, accountCode: string, entries: JournalEntry[], allocations: NativeSourceAllocation[]) {
  identifier(orgId); identifier(accountCode); const day=dateOnly(asOf);
  const journals=new Map<string,JournalEntry>();
  for(const entry of entries){identifier(entry.id);ensure(entry.org_id===orgId&&!journals.has(entry.id),'قيد أجنبي أو مكرر في إثبات الانكشاف.');dateOnly(entry.date);validateJournal(entry.lines);journals.set(entry.id,entry);}
  const proof=new Map<string,NativeSourceAllocation>();
  for(const allocation of allocations){identifier(allocation.journal_id);identifier(allocation.source_id);ensure(['SDG','USD'].includes(allocation.native_currency),'عملة مصدر الانكشاف غير صالحة.');ensure(Number.isSafeInteger(allocation.line_index)&&allocation.line_index>=0,'طرف مصدر الانكشاف غير صالح.');
    const entry=journals.get(allocation.journal_id),line=entry?.lines[allocation.line_index];ensure(line&&line.account_code===accountCode,'دليل المصدر يشير إلى قيد أو طرف غير مطابق.');
    const key=JSON.stringify([allocation.journal_id,allocation.line_index]);ensure(!proof.has(key),'دليل مصدر الانكشاف مكرر.');proof.set(key,allocation);
  }
  const pools={SDG:{sdg:new BigNumber(0),usd:new BigNumber(0)},USD:{sdg:new BigNumber(0),usd:new BigNumber(0)}};
  for(const entry of entries)for(const [index,line]of entry.lines.entries())if(line.account_code===accountCode&&dateOnly(entry.date)<=day){const allocation=proof.get(JSON.stringify([entry.id,index]));ensure(allocation,'طرف دفتر الأستاذ بلا إثبات لعملة المصدر.');const pool=pools[allocation.native_currency];pool.sdg=pool.sdg.plus(line.debit_sdg).minus(line.credit_sdg);pool.usd=pool.usd.plus(line.debit_usd).minus(line.credit_usd);}
  return {org_id:orgId,as_of:day,account_code:accountCode,local:{sdg:pools.SDG.sdg.toNumber(),usd:pools.SDG.usd.toNumber()},foreign:{sdg:pools.USD.sdg.toNumber(),usd:pools.USD.usd.toNumber()}};
}
