import type { Account, JournalEntry, MerchantSettings } from '../types';
import type { Document, Transaction } from './store';
import { clean } from './store';
import { fxRevaluationEvidence, verifyFxRevaluationSources } from './fxRevaluationSources';
import type { FxRevaluationInput, FxRevaluationSnapshot } from './fxRevaluation';
import { readOpeningFinancialData, assertOpeningFinancialData } from './openingTransactions';
import { ensure } from './validation';

const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`:JSON.stringify(v)??'null';
export async function fxQuoteHash(quote:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(quote)));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}

export async function fxRevaluationTransaction(data:Document,c:{tx:Transaction;root:string;orgId:string;settings:MerchantSettings;actor:string;operationId:string;now:Date}){
  ensure(Object.keys(data).every(key=>['date','closing_rate','account_codes','reason','rate_source','expected_quote_hash'].includes(key)),'حقول ترحيل إعادة التقييم غير مسموحة.');
  ensure(typeof data.expected_quote_hash==='string'&&/^[a-f0-9]{64}$/.test(data.expected_quote_hash),'بصمة معاينة إعادة التقييم مطلوبة.');
  const original=await readOpeningFinancialData(c.tx,c.root,c.orgId);await assertOpeningFinancialData(original,c.settings);verifyFxRevaluationSources(original,c.orgId);
  const input=Object.fromEntries(['date','closing_rate','account_codes','reason','rate_source'].map(key=>[key,data[key]])) as unknown as FxRevaluationInput;
  const evidence=fxRevaluationEvidence(input,{...original,org_id:c.orgId,accounts:original.accounts as Account[],journal_entries:original.journal_entries as JournalEntry[],settings:c.settings} as unknown as FxRevaluationSnapshot,{operation_id:c.operationId,created_by:c.actor,created_at:c.now.toISOString(),sequence:original.fx_revaluations.length+1});
  ensure(await fxQuoteHash(evidence.event.quote)===data.expected_quote_hash,'معاينة إعادة التقييم تغيرت؛ أعد المعاينة والتأكيد.',409);
  const staged=clean(original);staged.fx_revaluations.push(evidence.event);staged.journal_entries.push(evidence.entry);await assertOpeningFinancialData(staged,c.settings);verifyFxRevaluationSources(staged,c.orgId);
  for(const [name,id] of [['fx_revaluations',evidence.event.id],['journal_entries',evidence.entry.id]])ensure(!await c.tx.get(`${c.root}/${name}/${id}`),'معرف إعادة التقييم أو القيد موجود مسبقاً.',409);
  return evidence;
}
