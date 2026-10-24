import type { OrgRole } from '../types';
import type { Document } from './store';
import { ensure, identifier, text } from './validation';
import { hasPermission } from '../services/rbacService';
import { canExportAuditorPackage } from './auditorPackage';
import { largeImportValueSha256 } from './largeImportEvidence';

export type ScheduledExportKind = 'accounting' | 'auditor' | 'company';
export interface ExportScheduleSpec {
  name: string; kind: ScheduledExportKind; cadence: 'daily' | 'weekly' | 'monthly';
  timezone: string; time: string; weekday?: number; month_day?: number;
  start_date: string; end_date?: string; period_kind: 'previous_day' | 'previous_month' | 'month_to_date' | 'full';
  retention_hours: number; active: boolean;
}
export interface ExportSchedule extends ExportScheduleSpec {
  schema_version: 1; id: string; org_id: string; revision: number;
  created_by: string; created_at: string; updated_by: string; updated_at: string; next_run_at: string | null;
}
/** All access values must come from a fresh server lookup, never request JSON. */
export interface ScheduledExportAccess {
  authority: 'server' | 'browser' | 'local'; orgId: string; ownerUid: string;
  uid: string; role: OrgRole; emailVerified: boolean; activeMember: boolean; accountEnabled: boolean; organizationActive: boolean; accountingVersion: number;
  subscriptionStatus: string; subscriptionEnd: string | null; features: Readonly<Record<string, boolean>>; now: Date;
}
const inputKeys = ['name','kind','cadence','timezone','time','weekday','month_day','start_date','end_date','period_kind','retention_hours','active'];
const formatters = new Map<string, Intl.DateTimeFormat>();
type Local = {year:number;month:number;day:number;hour:number;minute:number};
const dayMs = 86400000;
const pad = (v: number) => String(v).padStart(2,'0');
const key = (v: Local) => `${v.year}-${pad(v.month)}-${pad(v.day)}`;
function dateValue(value: unknown): string {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'تاريخ الجدول غير صالح.');
  const parsed = new Date(`${value}T00:00:00Z`);
  ensure(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value && parsed.getUTCFullYear() >= 2000 && parsed.getUTCFullYear() <= 9998, 'تاريخ الجدول غير صالح.');
  return value;
}
function checkedNow(value: Date): Date { ensure(value instanceof Date && Number.isFinite(value.getTime()) && value.getUTCFullYear() >= 2000 && value.getUTCFullYear() <= 9998, 'وقت الخادم غير صالح.'); return value; }
function instant(value: unknown): Date {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), 'موعد التصدير غير صالح.');
  const result = checkedNow(new Date(value));
  ensure(result.toISOString() === (value.includes('.') ? value : value.replace('Z','.000Z')), 'موعد التصدير غير صالح.'); return result;
}
function formatter(zone: unknown) {
  ensure(typeof zone === 'string' && zone.length <= 64 && (zone === 'UTC' || zone.includes('/')) && !/^[+-]/.test(zone), 'حدد منطقة زمنية IANA صحيحة.');
  let result = formatters.get(zone);
  if (!result) {
    try { result = new Intl.DateTimeFormat('en-GB',{timeZone:zone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}); }
    catch { ensure(false, 'المنطقة الزمنية غير مدعومة.'); }
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!);
    formatters.set(zone,result!);
  }
  return result!;
}
function local(date: Date, zone: string): Local {
  const p = Object.fromEntries(formatter(zone).formatToParts(date).filter(v=>v.type!=='literal').map(v=>[v.type,Number(v.value)]));
  return {year:p.year,month:p.month,day:p.day,hour:p.hour,minute:p.minute};
}
const calendar = (date: string) => new Date(`${dateValue(date)}T00:00:00Z`);
const shiftDay = (date: string, days: number) => new Date(calendar(date).getTime()+days*dayMs).toISOString().slice(0,10);
const lastDay = (year:number,month:number) => new Date(Date.UTC(year,month,0)).getUTCDate();
const matches = (v: Local, date: string, hour: number, minute: number) => key(v)===date && v.hour===hour && v.minute===minute;

/** A gap uses the first valid local minute that day; a fold uses its first instant. */
function localRun(date: string, time: string, zone: string): Date | null {
  const day=calendar(date),year=day.getUTCFullYear(),month=day.getUTCMonth()+1,dayOfMonth=day.getUTCDate();
  const [hour,minute]=time.split(':').map(Number),base=Date.UTC(year,month-1,dayOfMonth,hour,minute);
  const offsets=new Set([-2,-1,0,1,2].map(delta=>{const at=base+delta*dayMs,p=local(new Date(at),zone);return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute)-at;}));
  for(let clock=hour*60+minute;clock<1440;clock++){
    const h=Math.floor(clock/60),m=clock%60,guess=Date.UTC(year,month-1,dayOfMonth,h,m);
    const candidates=[...offsets].map(offset=>new Date(guess-offset)).filter(at=>matches(local(at,zone),date,h,m));
    if(candidates.length)return new Date(Math.min(...candidates.map(at=>at.getTime())));
  }
  return null;
}
function spec(value: unknown, now: Date): ExportScheduleSpec {
  ensure(value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>inputKeys.includes(k)), 'حقول جدول التصدير غير صالحة أو محمية.');
  const data=value as Document; formatter(data.timezone);
  const name=text(data.name,120,true).trim();ensure(Boolean(name),'اسم الجدول مطلوب.');
  ensure(['accounting','auditor','company'].includes(data.kind), 'نوع التصدير المجدول غير صالح.');
  ensure(['daily','weekly','monthly'].includes(data.cadence) && typeof data.time==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.time), 'دورية أو ساعة التصدير غير صالحة.');
  ensure(data.cadence==='weekly' ? Number.isInteger(data.weekday) && data.weekday>=1 && data.weekday<=7 : data.weekday===undefined, 'حدد يوم الأسبوع من1 إلى7 للجدول الأسبوعي فقط.');
  ensure(data.cadence==='monthly' ? Number.isInteger(data.month_day) && data.month_day>=1 && data.month_day<=31 : data.month_day===undefined, 'حدد يوم الشهر من1 إلى31 للجدول الشهري فقط.');
  ensure(data.kind==='company' ? data.period_kind==='full' : ['previous_day','previous_month','month_to_date'].includes(data.period_kind), 'فترة التصدير لا تطابق نوعه.');
  const start=dateValue(data.start_date??key(local(checkedNow(now),data.timezone))),end=data.end_date===undefined?undefined:dateValue(data.end_date);
  ensure(!end||start<=end,'نهاية الجدول قبل بدايته.');
  const retention=data.retention_hours??24;ensure(Number.isInteger(retention)&&retention>=1&&retention<=24,'الاحتفاظ بالملف من1 إلى24 ساعة.');
  ensure(typeof data.active==='boolean','حالة الجدول مطلوبة.');
  return {name,kind:data.kind,cadence:data.cadence,timezone:data.timezone,time:data.time,...(data.weekday!==undefined?{weekday:data.weekday}:{}),...(data.month_day!==undefined?{month_day:data.month_day}:{}),start_date:start,...(end?{end_date:end}:{}),period_kind:data.period_kind,retention_hours:retention,active:data.active};
}
function savedSpec(policy: ExportSchedule): ExportScheduleSpec {
  identifier(policy.id);identifier(policy.org_id);identifier(policy.created_by);
  ensure(policy.schema_version===1 && Number.isSafeInteger(policy.revision) && policy.revision>=1,'إصدار جدول التصدير غير صالح.',409);
  return spec(Object.fromEntries(inputKeys.filter(k=>policy[k as keyof ExportSchedule]!==undefined).map(k=>[k,policy[k as keyof ExportSchedule]])),instant(policy.created_at));
}
export function assertScheduledExportAccess(kind: ScheduledExportKind, access: ScheduledExportAccess) {
  const now=checkedNow(access.now);identifier(access.orgId);identifier(access.uid);identifier(access.ownerUid);
  ensure(access.authority==='server' && access.emailVerified===true && access.activeMember===true && access.accountEnabled===true && access.organizationActive===true,'التصدير المجدول يتطلب حساباً ومؤسسة وعضوية سحابية مؤكدة ونشطة.',403);
  ensure(['Owner','Admin','Accountant'].includes(access.role) && (access.role!=='Owner'||access.uid===access.ownerUid),'صلاحية التصدير المجدول المالية غير متاحة.',403);
  ensure(access.accountingVersion===2,'التصدير المجدول يتطلب محاسبة V2.',409);
  const end=access.subscriptionEnd===null?null:/^\d{4}-\d{2}-\d{2}$/.test(access.subscriptionEnd)?instant(`${dateValue(access.subscriptionEnd)}T00:00:00.000Z`):instant(access.subscriptionEnd);
  ensure(['active','trial'].includes(access.subscriptionStatus) && (end!==null ? end>now : access.subscriptionStatus==='active'),'الاشتراك لا يسمح بتوليد أو تنزيل تصدير مجدول.',403);
  ensure(access.features.accounting===true,'ميزة المحاسبة غير متاحة.',403);
  ensure(['accounting','auditor','company'].includes(kind),'نوع التصدير غير صالح.');
  if(kind==='company')ensure(access.role==='Owner'&&access.uid===access.ownerUid&&hasPermission(access.role,'export:company'),'تصدير الشركة المجدول متاح للمالك الفعلي فقط.',403);
  else {
    ensure(access.features.advanced_reports===true && hasPermission(access.role,'export:accounting'),'تصدير التقارير المتقدمة غير متاح.',403);
    if(kind==='auditor')ensure(access.features.audit_trail===true && canExportAuditorPackage(access.role),'صلاحيات حزمة المراجع غير متاحة.',403);
  }
}
export function nextScheduledExportRun(policy: ExportScheduleSpec, after: Date): string | null {
  const input=spec(Object.fromEntries(inputKeys.filter(k=>policy[k as keyof ExportScheduleSpec]!==undefined).map(k=>[k,policy[k as keyof ExportScheduleSpec]])),checkedNow(after));if(!input.active)return null;
  let date=key(local(after,input.timezone));if(date<input.start_date)date=input.start_date;
  for(let count=0;count<370;count++,date=shiftDay(date,1)){
    if(input.end_date&&date>input.end_date)return null;
    const day=calendar(date),weekday=day.getUTCDay()||7;
    if(input.cadence==='weekly'&&weekday!==input.weekday)continue;
    if(input.cadence==='monthly'&&day.getUTCDate()!==Math.min(input.month_day!,lastDay(day.getUTCFullYear(),day.getUTCMonth()+1)))continue;
    const due=localRun(date,input.time,input.timezone);if(due&&due>after)return due.toISOString();
  }
  ensure(false,'تعذر إيجاد موعد لاحق صالح للجدول.');
  return null;
}
export function createExportSchedule(value: unknown, access: ScheduledExportAccess, operationId: string): ExportSchedule {
  const input=spec(value,access.now);assertScheduledExportAccess(input.kind,access);
  const next=nextScheduledExportRun(input,access.now);ensure(!input.active||next,'لا يوجد موعد قادم ضمن فترة الجدول.');
  const at=access.now.toISOString(),id=identifier(`schedule-${identifier(operationId)}`);return {...input,schema_version:1,id,org_id:access.orgId,revision:1,created_by:access.uid,created_at:at,updated_by:access.uid,updated_at:at,next_run_at:next};
}
export function updateExportSchedule(policy: ExportSchedule, value: unknown, access: ScheduledExportAccess): ExportSchedule {
  const original=savedSpec(policy);assertScheduledExportAccess(original.kind,access);
  ensure(policy.org_id===access.orgId&&(policy.created_by===access.uid||access.role==='Owner'&&access.uid===access.ownerUid),'تعديل الجدول متاح لمنشئه أو المالك الفعلي.',403);
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['id','expected_revision','updates'].includes(k)),'حقول تعديل الجدول غير صالحة أو محمية.');
  const request=value as Document;ensure(request.id===policy.id&&request.expected_revision===policy.revision,'تغير إصدار الجدول؛ حدّث البيانات.',409);
  ensure(policy.revision<Number.MAX_SAFE_INTEGER,'استنفد الجدول تسلسل إصداراته.',409);
  ensure(request.updates&&typeof request.updates==='object'&&!Array.isArray(request.updates)&&Object.keys(request.updates).every(k=>inputKeys.includes(k)),'حقول تحديث الجدول غير صالحة.');
  ensure(request.updates.kind===undefined||request.updates.kind===policy.kind,'نوع الجدول ثابت؛ أنشئ جدولاً جديداً لتغييره.');
  // JSON null explicitly clears optional fields; omitted fields remain unchanged.
  const merged:Document={...original,...request.updates};
  for(const field of ['weekday','month_day','end_date'])if(request.updates[field]===null)delete merged[field];
  const input=spec(merged,access.now);ensure(JSON.stringify(input)!==JSON.stringify(original),'لم تتغير إعدادات الجدول.',409);
  const next=nextScheduledExportRun(input,access.now);ensure(!input.active||next,'لا يوجد موعد قادم ضمن فترة الجدول.');
  const updated:ExportSchedule={...policy,...input,revision:policy.revision+1,updated_by:access.uid,updated_at:access.now.toISOString(),next_run_at:next};
  for(const field of ['weekday','month_day','end_date'] as const)if(input[field]===undefined)delete updated[field];
  return updated;
}
export async function scheduledExportOccurrence(policy: ExportSchedule, dueAt: string, access: ScheduledExportAccess) {
  const input=savedSpec(policy);assertScheduledExportAccess(input.kind,access);
  ensure(policy.org_id===access.orgId&&policy.created_by===access.uid,'منشئ الجدول أو مؤسسته غير مطابق.',403);
  const due=instant(dueAt),date=key(local(due,input.timezone));
  ensure(input.active&&policy.next_run_at===dueAt&&due<=access.now&&date>=input.start_date&&(!input.end_date||key(local(access.now,input.timezone))<=input.end_date),'الجدول غير نشط أو موعده لم يحن أو انتهى.',409);
  const previous=new Date(due.getTime()-1);ensure(nextScheduledExportRun(input,previous)===dueAt,'موعد الجدول لا يطابق تقويمه.',409);
  const token=await largeImportValueSha256({org_id:policy.org_id,schedule_id:policy.id,revision:policy.revision,local_date:date});
  const day=calendar(date),month=day.getUTCMonth(),year=day.getUTCFullYear();
  const period=input.period_kind==='full'?{}:input.period_kind==='previous_day'?{start:shiftDay(date,-1),end:shiftDay(date,-1)}:input.period_kind==='previous_month'?{start:new Date(Date.UTC(year,month-1,1)).toISOString().slice(0,10),end:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)}:{start:`${year}-${pad(month+1)}-01`,end:date};
  return {id:`scheduled-${token}`,operation_id:token,org_id:policy.org_id,schedule_id:policy.id,policy_revision:policy.revision,requested_by:policy.created_by,scheduled_for:dueAt,local_date:date,kind:policy.kind,period,next_run_at:nextScheduledExportRun(input,access.now)};
}
export function scheduledArtifactExpiry(policy: ExportSchedule, completedAt: string): string { const input=savedSpec(policy);return new Date(instant(completedAt).getTime()+input.retention_hours*3600000).toISOString(); }
export function scheduledDownloadExpiry(policy: ExportSchedule, artifact: {org_id:string;schedule_id:string;policy_revision:number;requested_by:string;completed_at:string;expires_at:string}, access: ScheduledExportAccess): string {
  const input=savedSpec(policy);assertScheduledExportAccess(input.kind,access);
  ensure(input.active&&policy.org_id===access.orgId&&artifact.org_id===access.orgId&&artifact.schedule_id===policy.id&&artifact.policy_revision===policy.revision&&artifact.requested_by===policy.created_by,'الملف أو إصدار الجدول لم يعد متاحاً.',403);
  ensure(policy.created_by===access.uid||access.role==='Owner'&&access.uid===access.ownerUid,'الملف متاح لمنشئ الجدول أو المالك الفعلي.',403);
  ensure(!input.end_date||key(local(access.now,input.timezone))<=input.end_date,'انتهت فترة الجدول.',410);
  ensure(artifact.expires_at===scheduledArtifactExpiry(policy,artifact.completed_at),'دليل انتهاء الملف غير صالح.',409);
  const expires=instant(artifact.expires_at),completed=instant(artifact.completed_at);
  ensure(completed<=access.now&&expires>access.now,'انتهت صلاحية الملف أو لم يكتمل.',410);
  return new Date(Math.min(expires.getTime(),access.now.getTime()+5*60000)).toISOString();
}
