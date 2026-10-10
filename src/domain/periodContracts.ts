import { classifyAccount } from './accountClassification';
import type { Account, OrgRole } from '../types';
import type { Document } from './store';
import { hasPermission } from '../services/rbacService';
import { dateOnly, ensure, identifier, text } from './validation';

export const periodCollections = ['accounting_periods'] as const;
export type PeriodStatus = 'OPEN' | 'SOFT_CLOSED' | 'CLOSED' | 'REOPENED';
export interface AccountingPeriod extends Document {
  id: string; org_id: string; start_date: string; end_date: string; status: PeriodStatus; revision: number;
}
export function validatePeriods(rows: Document[], orgId?: string): AccountingPeriod[] {
  ensure(Array.isArray(rows) && rows.length <= 1200, 'عدد الفترات يتجاوز الحد؛ يلزم إجراء أرشفة مضبوط.', 413);
  ensure(rows.every(row=>row && typeof row==='object' && !Array.isArray(row)),'سجل الفترة غير صالح.');
  const sorted = [...rows].sort((a,b) => String(a.start_date).localeCompare(String(b.start_date)));
  const ids = new Set<string>();
  for (const row of sorted) {
    ensure(row && typeof row==='object' && row.schema_version===1,'صيغة الفترة غير صالحة.');
    identifier(row.id); identifier(row.org_id); ensure(!orgId || row.org_id === orgId, 'الفترة تنتمي لمؤسسة أخرى.');
    ensure(!ids.has(row.id), 'معرف الفترة مكرر.'); ids.add(row.id);
    const start=dateOnly(row.start_date),end=dateOnly(row.end_date);
    ensure(start===row.start_date && end===row.end_date && start<=end && Date.parse(end)-Date.parse(start)<366*86400000, 'نطاق الفترة غير صالح؛ أقصى مدة 366 يوماً.');
    ensure(['OPEN','SOFT_CLOSED','CLOSED','REOPENED'].includes(row.status), 'حالة الفترة غير صالحة.');
    ensure(Number.isSafeInteger(row.revision) && row.revision>0, 'إصدار الفترة غير صالح.');
    identifier(row.created_by); dateOnly(row.created_at); identifier(row.operation_id);
    if(row.status!=='OPEN') { identifier(row.changed_by); dateOnly(row.changed_at); text(row.reason,1000,true); }
    if(row.status==='CLOSED') {
      const proof=row.close_evidence;
      ensure(proof?.schema_version===1 && /^[a-f0-9]{64}$/.test(proof.ledger_hash) && proof.period_id===row.id && proof.end_date===row.end_date && proof.fx_review_completed===true && proof.findings_count===0 && proof.balanced===true && proof.can_close===true && Array.isArray(proof.findings) && !proof.findings.length && Array.isArray(proof.missing_reconciliations) && !proof.missing_reconciliations.length && Array.isArray(proof.reconciliations), 'إثبات الإغلاق النهائي ناقص.'); dateOnly(proof.checked_at);identifier(proof.reviewed_by);text(proof.review_reason,1000,true);
    }
    if(row.status==='REOPENED') { ensure(['SOFT_CLOSED','CLOSED'].includes(row.previous_status),'حالة ما قبل إعادة الفتح غير صالحة.');identifier(row.reopened_by);dateOnly(row.reopened_at);text(row.reopen_reason,1000,true); }
  }
  for(let i=1;i<sorted.length;i++) ensure(sorted[i-1].end_date<sorted[i].start_date,'الفترات المحاسبية متداخلة.');
  return sorted as AccountingPeriod[];
}
export function assertPeriodPosting(rows: AccountingPeriod[], value: unknown, role: OrgRole, adjusting: boolean, reason: unknown) {
  if(!rows.length) return;
  const day=dateOnly(value),period=rows.find(row=>row.start_date<=day && day<=row.end_date);
  ensure(period, 'التاريخ خارج الفترات المحاسبية؛ أنشئ فترة تغطيه أولاً.',409);
  ensure(period.status!=='CLOSED','الفترة المحاسبية مقفلة نهائياً؛ إعادة الفتح تتطلب المالك والتحقق الحديث.',409);
  if(period.status==='SOFT_CLOSED') {
    ensure(adjusting && hasPermission(role,'periods:adjust'), 'الفترة مقفلة مبدئياً؛ يسمح فقط بقيد تسوية موثق للمحاسب أو المالك.',403);
    text(reason,1000,true);
  }
}
/** auth_time comes from a verified Firebase token, never request data or token issue time. */
export function assertRecentOwner(role: OrgRole, authTime: unknown, now: Date, operation = 'إعادة الفتح') {
  ensure(role==='Owner' && hasPermission(role,'periods:reopen'),`${operation} متاحة للمالك الفعلي فقط.`,403);
  ensure(typeof authTime==='number' && Number.isSafeInteger(authTime) && authTime>0 && now.getTime()/1000-authTime>=-30 && now.getTime()/1000-authTime<=300,`أعد التحقق من الدخول خلال آخر خمس دقائق لتنفيذ ${operation}.`,401);
}
export async function periodLedgerHash(entries: Document[], end: string) {
  const stable=(value: unknown): string => Array.isArray(value)?`[${value.map(stable).join(',')}]`:value && typeof value==='object'?`{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`:JSON.stringify(value)??'null';
  const rows=entries.filter(entry=>dateOnly(entry.date)<=end).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(({org_id: _org,...entry})=>entry);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(rows)));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function verifyClosedPeriodHashes(rows: Document[], entries: Document[], collections?: Record<string,Document[]>) {
  for(const period of validatePeriods(rows)) if(period.status==='CLOSED') {
    ensure(period.close_evidence.ledger_hash===await periodLedgerHash(entries,period.end_date),'دفتر الفترة المقفلة لا يطابق إثبات الإغلاق.',409);
    if(!collections) continue;
    const proof=period.close_evidence.reconciliations as Document[],needed=(collections.accounts||[]).filter(account=>classifyAccount(account as Account).reporting_group==='cash_bank' && entries.some(entry=>dateOnly(entry.date)<=period.end_date && entry.lines.some((line:Document)=>line.account_code===account.code && (line.debit_sdg||line.credit_sdg||line.debit_usd||line.credit_usd))));
    ensure(proof.length===needed.length && new Set(proof.map(row=>row.account_code)).size===proof.length && needed.every(account=>proof.some(row=>row.account_code===account.code)),'إثبات مطابقة حسابات الفترة المقفلة ناقص.',409);
    for(const row of proof) {
      ensure(['bank','cash'].includes(row.kind),'نوع إثبات مطابقة الفترة غير صالح.');identifier(row.id);identifier(row.financial_account_id);identifier(row.account_code);
      const saved=(collections[row.kind==='cash'?'cash_reconciliations':'bank_reconciliations']||[]).find(record=>record.id===row.id),map=(collections.financial_accounts||[]).find(account=>account.id===row.financial_account_id);
      ensure(saved && map && saved.status==='matched' && saved.difference===0 && saved.ledger_snapshot.period.end===period.end_date && (row.kind==='cash'||saved.ledger_snapshot.period.start<=period.start_date) && saved.financial_account_id===row.financial_account_id && saved.account_code===row.account_code && map.account_code===row.account_code && saved.ledger_snapshot.ledger_hash===row.ledger_hash,'مصدر مطابقة الفترة المقفلة ناقص أو مختلف.',409);
    }
  }
}
