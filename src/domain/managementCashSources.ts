import type { Document, Transaction } from './store';
import { dateOnly, ensure, identifier, money, text } from './validation';

export interface RecurringCashSource { id:string; org_id:string; name:string; frequency:'weekly'|'monthly'|'quarterly'|'yearly'; next_date:string; end_date?:string; amount_sdg:number; amount_usd:number; status:'active'|'paused'; revision:number; created_by:string; created_at:string; updated_by:string; updated_at:string }
export interface ScheduledCashSource { id:string; org_id:string; name:string; due_date:string; direction:'inflow'|'outflow'; amount_sdg:number; amount_usd:number; party_name?:string; reference?:string; status:'scheduled'|'cancelled'; revision:number; created_by:string; created_at:string; updated_by:string; updated_at:string }
const allowed=(value:Document,keys:string[])=>ensure(Object.keys(value).every(key=>keys.includes(key)),'حقول مصدر التوقع غير صالحة أو محمية.');
const amounts=(data:Document)=>{const amount_sdg=money(data.amount_sdg||0,2),amount_usd=money(data.amount_usd||0,2);ensure(amount_sdg>0||amount_usd>0,'يجب أن يحتوي مصدر التوقع مبلغاً موجباً.');return{amount_sdg,amount_usd};};

export async function saveRecurringCashSource(tx:Transaction,root:string,orgId:string,actor:string,now:string,action:'recurringCashSource.create'|'recurringCashSource.update',data:Document){
  allowed(data,['id','name','frequency','next_date','end_date','amount_sdg','amount_usd','status','expected_revision']);
  const id=data.id?identifier(data.id):crypto.randomUUID(),path=`${root}/recurring_cash_sources/${id}`,existing=await tx.get(path) as RecurringCashSource|undefined;
  ensure(action.endsWith('.create')?!existing:!!existing,action.endsWith('.create')?'معرّف المصروف الدوري مستخدم مسبقاً.':'المصروف الدوري غير موجود.',action.endsWith('.create')?409:404);
  if(existing)ensure(Number(data.expected_revision)===existing.revision,'تم تعديل مصدر التوقع من جلسة أخرى؛ حدّث البيانات وأعد المحاولة.',409);
  const frequency=String(data.frequency) as RecurringCashSource['frequency'];ensure(['weekly','monthly','quarterly','yearly'].includes(frequency),'تكرار المصروف غير صالح.');
  const next_date=dateOnly(data.next_date),end_date=data.end_date?dateOnly(data.end_date):undefined;ensure(!end_date||end_date>=next_date,'نهاية التكرار يجب ألا تسبق أول استحقاق.');
  const status=(data.status||'active') as RecurringCashSource['status'];ensure(['active','paused'].includes(status),'حالة المصروف الدوري غير صالحة.');
  const result:RecurringCashSource={id,org_id:orgId,name:text(data.name,120,true),frequency,next_date,...end_date?{end_date}:{},...amounts(data),status,revision:(existing?.revision||0)+1,created_by:existing?.created_by||actor,created_at:existing?.created_at||now,updated_by:actor,updated_at:now};tx.set(path,result);return result;
}

export async function saveScheduledCashSource(tx:Transaction,root:string,orgId:string,actor:string,now:string,action:'scheduledCashSource.create'|'scheduledCashSource.update',data:Document){
  allowed(data,['id','name','due_date','direction','amount_sdg','amount_usd','party_name','reference','status','expected_revision']);
  const id=data.id?identifier(data.id):crypto.randomUUID(),path=`${root}/scheduled_cash_sources/${id}`,existing=await tx.get(path) as ScheduledCashSource|undefined;
  ensure(action.endsWith('.create')?!existing:!!existing,action.endsWith('.create')?'معرّف الدفعة المجدولة مستخدم مسبقاً.':'الدفعة المجدولة غير موجودة.',action.endsWith('.create')?409:404);
  if(existing)ensure(Number(data.expected_revision)===existing.revision,'تم تعديل مصدر التوقع من جلسة أخرى؛ حدّث البيانات وأعد المحاولة.',409);
  const direction=String(data.direction) as ScheduledCashSource['direction'];ensure(['inflow','outflow'].includes(direction),'اتجاه الدفعة المجدولة غير صالح.');
  const status=(data.status||'scheduled') as ScheduledCashSource['status'];ensure(['scheduled','cancelled'].includes(status),'حالة الدفعة المجدولة غير صالحة.');
  const optional=(key:'party_name'|'reference',limit:number)=>data[key]?text(data[key],limit,true):undefined;
  const party_name=optional('party_name',120),reference=optional('reference',120);
  const result:ScheduledCashSource={id,org_id:orgId,name:text(data.name,120,true),due_date:dateOnly(data.due_date),direction,...amounts(data),...party_name?{party_name}:{},...reference?{reference}:{},status,revision:(existing?.revision||0)+1,created_by:existing?.created_by||actor,created_at:existing?.created_at||now,updated_by:actor,updated_at:now};tx.set(path,result);return result;
}
