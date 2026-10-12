import type { Account, JournalEntry } from '../types';
import type { Document } from './store';
import { clean } from './store';
import { deriveNativeSourceAllocations } from './fxSourceAllocations';
import { fxRevaluationQuote, fxRevaluationQuoteFromProof, type FxRevaluationInput, type FxRevaluationSnapshot } from './fxRevaluation';
import { dateOnly, ensure, identifier } from './validation';
import { journal } from './financial';

export const fxRevaluationCollections=['fx_revaluations'] as const;
const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`:JSON.stringify(v)??'null';
const pick=(row:Document,keys:string[])=>Object.fromEntries(keys.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
const emptySources=()=>({financial_accounts:[],invoices:[],payments:[],purchase_bills:[],supplier_payments:[],credit_notes:[],customer_refunds:[],purchase_returns:[],supplier_refunds:[],opening_batches:[],opening_lots:[],opening_settlements:[],inventory_movements:[],fx_revaluations:[]});

export function fxRevaluationEvidence(input:FxRevaluationInput,snapshot:FxRevaluationSnapshot,identity:{operation_id:string;created_by:string;created_at:string;sequence:number}){
  identifier(identity.operation_id);identifier(identity.created_by);dateOnly(identity.created_at);ensure(Number.isSafeInteger(identity.sequence)&&identity.sequence>0,'تسلسل إعادة التقييم غير صالح.');
  const quote=fxRevaluationQuote(input,snapshot),allocations=deriveNativeSourceAllocations(snapshot,input.account_codes,input.date),id=`fxr-${identity.operation_id}`,journalId=`jv-fxr-${identity.operation_id}`;
  const codes=new Set([...input.account_codes,'4210','5510']),account_basis=snapshot.accounts.filter(row=>codes.has(row.code)).map(row=>pick(row as unknown as Document,['code','name_ar','name_en','org_id','type','nature','is_active','reporting_group','cash_flow_category','normal_balance','subtype'])) as Account[];
  const period_basis=snapshot.accounting_periods.filter(row=>row.id===quote.period_id).map(row=>clean(row as Document));
  const event={schema_version:1,org_id:snapshot.org_id,id,journal_id:journalId,...identity,input:clean(input as unknown as Document),quote,source_allocations:allocations,account_basis,period_basis,prior_journal_ids:snapshot.journal_entries.map(row=>row.id).sort()};
  const entry={...journal(journalId,snapshot.org_id,identity.created_by,input.date,'fx_revaluation',id,input.reason,quote.lines,input.closing_rate),created_at:identity.created_at,adjusting:true,adjustment_reason:input.reason,period_id:quote.period_id};
  ensure(new TextEncoder().encode(JSON.stringify(event)).length<=300000,'أدلة إعادة التقييم تتجاوز حد السجل.',413);return{event,entry};
}

export function verifyFxRevaluationSources(data:Record<string,Document[]>,orgId?:string){
  const events=data.fx_revaluations||[],entries=data.journal_entries||[],tenant=orgId||events[0]?.org_id||entries.find(row=>row.reference_type==='fx_revaluation')?.org_id;
  if(!events.length&&!entries.some(row=>row.reference_type==='fx_revaluation'))return;identifier(tenant);ensure(events.length<=1200,'مصادر إعادة التقييم تتجاوز حد التحقق.',413);
  const entryIndex=new Map<string,Document>();for(const row of entries){ensure(!entryIndex.has(row.id),'معرف القيد مكرر.');entryIndex.set(row.id,row);}
  const ids=new Set<string>(),operations=new Set<string>(),sequences=new Set<number>();
  for(const event of [...events].sort((a,b)=>a.sequence-b.sequence)){
    identifier(event.id);identifier(event.operation_id);identifier(event.created_by);dateOnly(event.created_at);ensure(event.org_id===tenant&&event.schema_version===1&&event.id===`fxr-${event.operation_id}`&&event.journal_id===`jv-fxr-${event.operation_id}`&&!ids.has(event.id)&&!operations.has(event.operation_id),'هوية مصدر إعادة التقييم مكررة أو مختلفة.');
    ensure(Number.isSafeInteger(event.sequence)&&event.sequence>0&&!sequences.has(event.sequence),'تسلسل إعادة التقييم مكرر أو غير صالح.');ids.add(event.id);operations.add(event.operation_id);sequences.add(event.sequence);
    ensure(Array.isArray(event.prior_journal_ids)&&new Set(event.prior_journal_ids).size===event.prior_journal_ids.length&&!event.prior_journal_ids.includes(event.journal_id),'أدلة القيود السابقة لإعادة التقييم ناقصة أو مكررة.');
    const prior=event.prior_journal_ids.map((id:string)=>{identifier(id);const row=entryIndex.get(id);ensure(row&&row.org_id===tenant,'قيد سابق لإعادة التقييم مفقود أو أجنبي.');return row as unknown as JournalEntry;});
    for(const other of events)if(other.id!==event.id)ensure(event.prior_journal_ids.includes(other.journal_id)===(other.sequence<event.sequence),'ترتيب مصادر إعادة التقييم مختلف.');
    const snapshot={org_id:tenant,accounts:event.account_basis,journal_entries:prior,accounting_periods:event.period_basis,settings:{},...emptySources()} as FxRevaluationSnapshot;
    const quote=fxRevaluationQuoteFromProof(event.input,snapshot,event.source_allocations);ensure(stable(quote)===stable(event.quote),'مصدر إعادة التقييم لا يطابق المعاينة المثبتة.');
    const expected={...journal(event.journal_id,tenant,event.created_by,event.input.date,'fx_revaluation',event.id,event.input.reason,quote.lines,event.input.closing_rate),created_at:event.created_at,adjusting:true,adjustment_reason:event.input.reason,period_id:quote.period_id};
    const linked=entries.filter(row=>row.reference_type==='fx_revaluation'&&row.reference_id===event.id);ensure(linked.length===1&&stable(linked[0])===stable(expected),'قيد إعادة التقييم مفقود أو مكرر أو مختلف.');
  }
  ensure([...sequences].sort((a,b)=>a-b).every((n,i)=>n===i+1),'تسلسل إعادة التقييم ناقص.');for(const entry of entries.filter(row=>row.reference_type==='fx_revaluation'))ensure(ids.has(entry.reference_id),'قيد إعادة تقييم بلا مصدر.');
}
export function reconcileFxRevaluations(data:Record<string,Document[]>){try{verifyFxRevaluationSources(data);return [];}catch(e){return[{code:'invalid_fx_revaluation_source',collection:'fx_revaluations',id:'sources',message:e instanceof Error?e.message:'مصدر غير صالح'}];}}
export function fxRevaluationBackupCounts(data:Record<string,Document[]>){return{fx_revaluation_count:(data.fx_revaluations||[]).length};}
export function validateFxRevaluationBackup(backup:Document){const data=backup.collections;ensure(data&&typeof data==='object','مصادر النسخة غير صالحة.');const declared=backup.fx_revaluation_schema_version!==undefined||backup.counters?.fx_revaluation_count!==undefined||(data.fx_revaluations||[]).length||data.journal_entries?.some((row:Document)=>row.reference_type==='fx_revaluation');if(declared){ensure(backup.fx_revaluation_schema_version===1&&Array.isArray(data.fx_revaluations)&&backup.counters?.fx_revaluation_count===data.fx_revaluations.length,'مصادر أو عدد إعادات التقييم في النسخة ناقص.',409);verifyFxRevaluationSources(data,identifier(backup.org?.id));}return{fx_revaluations:data.fx_revaluations||[]};}
export function remapFxRevaluations(data:Record<string,Document[]>,destination:string){identifier(destination);return(data.fx_revaluations||[]).map(row=>({...row,org_id:destination,quote:{...row.quote,org_id:destination},account_basis:row.account_basis.map((a:Document)=>({...a,org_id:destination})),period_basis:row.period_basis.map((p:Document)=>({...p,org_id:destination}))}));}
