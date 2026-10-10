import type { Account, JournalEntry } from '../types';
import type { Document } from './store';
import { clean } from './store';
import { ownerEquityQuote, type OwnerEquityInput, type OwnerEquitySnapshot } from './ownerEquity';
import { dateOnly, ensure, identifier, text } from './validation';
import { journal } from './financial';

export const equityCollections = ['owner_equity_events'] as const;
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}` : JSON.stringify(v) ?? 'null';
const pick = (row:Document,keys:string[])=>Object.fromEntries(keys.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
export function equityEvidence(input:OwnerEquityInput,snapshot:OwnerEquitySnapshot,identity:{operation_id:string;created_by:string;created_at:string;sequence:number}) {
  identifier(identity.operation_id);identifier(identity.created_by);dateOnly(identity.created_at);
  ensure(Number.isSafeInteger(identity.sequence)&&identity.sequence>0,'تسلسل حركة المالك غير صالح.');
  const quote=ownerEquityQuote(input,snapshot),id=`oe-${identity.operation_id}`,journalId=`jv-oe-${identity.operation_id}`;
  identifier(id);identifier(journalId);
  const account_basis=snapshot.accounts.map(row=>pick(row,['code','name_ar','name_en','org_id','type','nature','is_active','reporting_group','cash_flow_category','normal_balance','subtype'])) as Account[];
  const financial_basis=snapshot.financial_accounts.filter(row=>row.id===input.financial_account_id).map(row=>pick(row,['id','org_id','account_code','currency','kind','status','name']));
  const event={schema_version:1,org_id:snapshot.org_id,id,journal_id:journalId,...identity,input:clean(input),quote,account_basis,financial_basis,prior_journal_ids:snapshot.journal_entries.map(row=>row.id).sort()};
  const entry={...journal(journalId,snapshot.org_id,identity.created_by,input.date,'owner_equity',id,input.reason,quote.lines,quote.exchange_rate_used),created_at:identity.created_at};
  ensure(new TextEncoder().encode(JSON.stringify(event)).length<=200000,'أدلة عملية المالك تتجاوز حد السجل؛ يلزم إجراء خادمي للدفاتر الأكبر.',413);
  return {event,entry};
}
/** Re-quotes immutable source basis against the actual referenced journals; mutable account names/balances are irrelevant. */
export function verifyEquitySources(data:Record<string,Document[]>,orgId?:string) {
  const events=data.owner_equity_events||[],entries=data.journal_entries||[],accounts=data.accounts||[],financial=data.financial_accounts||[];
  const tenant=orgId || events[0]?.org_id || entries.find(row=>row.reference_type==='owner_equity')?.org_id;
  if(!events.length && !entries.some(row=>row.reference_type==='owner_equity'))return;
  identifier(tenant);ensure(events.length<=1200,'حركات المالك تتجاوز حد التحقق.',413);
  const ids=new Set<string>(),operations=new Set<string>(),sequences=new Set<number>(),entryIndex=new Map<string,Document>();
  for(const row of entries){ensure(!entryIndex.has(row.id),'معرف القيد مكرر.');entryIndex.set(row.id,row);}
  for(const event of [...events].sort((a,b)=>a.sequence-b.sequence)) {
    identifier(event.id);identifier(event.operation_id);identifier(event.created_by);dateOnly(event.created_at);
    ensure(event.org_id===tenant && event.schema_version===1 && event.id===`oe-${event.operation_id}` && event.journal_id===`jv-oe-${event.operation_id}` && !ids.has(event.id) && !operations.has(event.operation_id),'هوية مصدر عملية المالك مكررة أو مختلفة.');
    ensure(Number.isSafeInteger(event.sequence)&&event.sequence>0&&!sequences.has(event.sequence),'تسلسل حركة المالك مكرر أو غير صالح.');
    ids.add(event.id);operations.add(event.operation_id);sequences.add(event.sequence);
    ensure(Array.isArray(event.prior_journal_ids)&&event.prior_journal_ids.length<=1200&&new Set(event.prior_journal_ids).size===event.prior_journal_ids.length&&!event.prior_journal_ids.includes(event.journal_id),'أدلة القيود السابقة ناقصة أو مكررة.');
    const prior=event.prior_journal_ids.map((id:string)=>{identifier(id);const entry=entryIndex.get(id);ensure(entry && entry.org_id===tenant,'قيد سابق مطلوب لإثبات حركة المالك مفقود أو أجنبي.');return entry;});
    // Every earlier owner source must participate; later sources must never masquerade as its prior basis.
    for(const other of events)if(other.id!==event.id)ensure(event.prior_journal_ids.includes(other.journal_id)===(other.sequence<event.sequence),'ترتيب أدلة عمليات المالك مختلف.');
    const snapshot:OwnerEquitySnapshot={org_id:tenant,accounts:event.account_basis,financial_accounts:event.financial_basis,journal_entries:prior as JournalEntry[],accounting_periods:[],settings:{}};
    const expected=equityEvidence(event.input,snapshot,{operation_id:event.operation_id,created_by:event.created_by,created_at:event.created_at,sequence:event.sequence});
    ensure(stable(expected.event)===stable(event),'مصدر عملية المالك لا يطابق حساباته أو أدلته.');
    const linked=entries.filter(row=>row.reference_type==='owner_equity'&&row.reference_id===event.id);
    ensure(linked.length===1&&stable(linked[0])===stable(expected.entry),'قيد عملية المالك مفقود أو مكرر أو مختلف.');
    const map=financial.filter(row=>row.id===event.input.financial_account_id),basis=event.financial_basis[0];
    ensure(map.length===1&&map[0].org_id===tenant&&['account_code','currency','kind'].every(k=>map[0][k]===basis[k]),'ربط النقدية التاريخي لعملية المالك مختلف.');
    for(const code of [event.quote.account_code,event.quote.equity_account_code]){const current=accounts.filter(row=>row.code===code),old=event.account_basis.find((row:Document)=>row.code===code);ensure(current.length===1&&current[0].org_id===tenant&&old&&current[0].type===old.type&&current[0].nature===old.nature,'حساب مصدر عملية المالك مفقود أو مختلف.');}
    text(event.input.reason,1000,true);
  }
  ensure([...sequences].sort((a,b)=>a-b).every((n,i)=>n===i+1),'تسلسل مصادر المالك ناقص.');
  for(const entry of entries.filter(row=>row.reference_type==='owner_equity'))ensure(ids.has(entry.reference_id),'قيد حركة المالك بلا مصدر.');
}
export function reconcileEquitySources(data:Record<string,Document[]>) {
  try {verifyEquitySources(data);return [];}catch(e){return [{code:'invalid_owner_equity_source',collection:'owner_equity_events',id:'sources',message:e instanceof Error?e.message:'مصدر غير صالح'}];}
}
export function equityBackupCounts(data:Record<string,Document[]>) {return {owner_equity_event_count:(data.owner_equity_events||[]).length};}
export function validateEquityBackup(backup:Document) {
  const data=backup.collections;ensure(data&&typeof data==='object','مصادر النسخة غير صالحة.');
  const declared=backup.owner_equity_schema_version!==undefined||backup.counters?.owner_equity_event_count!==undefined||(data.owner_equity_events||[]).length||data.journal_entries?.some((row:Document)=>row.reference_type==='owner_equity');
  if(declared){ensure(backup.owner_equity_schema_version===1&&Array.isArray(data.owner_equity_events)&&Number.isSafeInteger(backup.counters?.owner_equity_event_count)&&backup.counters.owner_equity_event_count===data.owner_equity_events.length,'مصادر أو عدد حركات المالك في النسخة ناقص.',409);if(data.owner_equity_events.length){ensure(backup.org?.accounting_version===2,'حركات المالك تتطلب نسخة V2.',409);verifyEquitySources(data,identifier(backup.org?.id));}}
  else ensure(data.owner_equity_events===undefined||Array.isArray(data.owner_equity_events),'مصادر حركات المالك غير صالحة.');
  return {owner_equity_events:data.owner_equity_events||[]};
}
export function remapEquityEvents(data:Record<string,Document[]>,destination:string) {
  identifier(destination);return (data.owner_equity_events||[]).map(row=>({...row,org_id:destination,quote:{...row.quote,org_id:destination},account_basis:row.account_basis.map((a:Document)=>({...a,org_id:destination})),financial_basis:row.financial_basis.map((a:Document)=>({...a,org_id:destination}))}));
}
