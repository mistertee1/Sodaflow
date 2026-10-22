import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { merchantDay } from '../../domain/operationalReports';
import type { Operations } from '../../domain/operations';
import { OwnerReauthenticationDialog } from './OwnerReauthenticationDialog';
type Report = Awaited<ReturnType<Operations['periodReports']>>;
const statuses = { OPEN: 'مفتوحة', SOFT_CLOSED: 'مقفلة مبدئياً', CLOSED: 'مقفلة نهائياً', REOPENED: 'أعيد فتحها' };
const checkLabels = { sales_posted:'المبيعات والتحصيلات المسجلة', expenses_posted:'المصروفات المسجلة', bank_reconciled:'مطابقة البنوك', cash_reconciled:'جرد الصناديق', inventory_reconciled:'مطابقة المخزون والتكلفة', ar_reconciled:'مطابقة أرصدة العملاء', ap_reconciled:'مطابقة أرصدة الموردين', journals_balanced:'اتزان قيود العملتين', journals_complete:'اكتمال القيود المصدرية' };
const sourceLabels: Record<string,string> = { invoices:'فاتورة', payments:'تحصيل', expenses:'مصروف', journal_entries:'قيد', products:'صنف', inventory_movements:'حركة مخزون', customers:'عميل', suppliers:'مورد', purchase_bills:'فاتورة شراء', supplier_payments:'سداد مورد', credit_notes:'إشعار دائن', customer_refunds:'رد عميل', purchase_returns:'مردود شراء', supplier_refunds:'استرداد مورد', financial_accounts:'حساب نقدي', bank_reconciliations:'مطابقة بنك', cash_reconciliations:'جرد صندوق', accounting_periods:'فترة', audit_archives:'أرشيف تدقيق' };
const input = 'w-full min-w-0 p-2 mt-1 border border-sf-border rounded-lg bg-sf-raised text-sf-text';
const button = 'p-3 rounded-lg border border-sf-border disabled:opacity-50';
export function AccountingPeriodsCenter() {
  const { currentOrg, currentUser, userRole, settings, counters, accounts, loadAccountingPeriods, saveAccountingPeriod, updateSettings, isActionAllowed } = useApp();
  const today = merchantDay(new Date(), settings.timezone || 'Africa/Khartoum');
  const [selected, setSelected] = useState(''), [report, setReport] = useState<Report | null>(null), [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [id, setId] = useState(today.slice(0,7)), [start, setStart] = useState(today.slice(0,8)+'01'), [end, setEnd] = useState(today), [createReason, setCreateReason] = useState('');
  const [reason, setReason] = useState(''), [fxReviewed, setFxReviewed] = useState(false), [reauth, setReauth] = useState<'period' | 'legacy' | null>(null);
  const [legacyDate, setLegacyDate] = useState(settings.period_lock_date || '');
  const lock = useRef(false);
  const allowed = isActionAllowed('periods:read'), manage = isActionAllowed('periods:manage'), reopen = isActionAllowed('periods:reopen');
  const v2 = currentOrg?.accounting_version === 2;
  useEffect(() => {
    let active = true; setReport(null); setLoading(allowed && v2); setError(''); setFxReviewed(false);
    if (allowed && v2) void loadAccountingPeriods(selected || undefined).then(value => { if (active) setReport(value); }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'تعذر تحميل الفترات.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentOrg?.id, currentUser?.uid, counters.revision, allowed, v2, selected, retry]);
  const period = report?.periods.find(row => row.id === selected), checks = report?.checklist;
  const execute = async (work: () => Promise<unknown>, success: string) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setMessage('');
    try { await work(); setMessage(success); setRetry(value => value + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); throw e; }
    finally { lock.current = false; setBusy(false); }
  };
  const transition = (action: 'period.softClose' | 'period.close', event: React.FormEvent) => {
    event.preventDefault(); if (!period || !currentOrg || !reason.trim()) return;
    void execute(() => saveAccountingPeriod(action, { id:period.id, expected_revision:period.revision, reason:reason.trim(), ...(action === 'period.close' ? { fx_review_completed:fxReviewed } : {}) }, currentOrg.id), 'تم حفظ حالة الفترة.').then(() => setReason('')).catch(() => undefined);
  };
  return <section aria-label="إدارة الفترات المحاسبية" className="space-y-4 text-sf-text text-sm">
    <div className="sf-card p-4 space-y-3"><h2 className="font-bold text-lg">الفترات ومساعد إقفال الشهر</h2><p className="text-sf-muted">الإقفال المبدئي يسمح بتسويات المحاسب والمالك فقط. الإقفال النهائي يمنع أي ترحيل داخل الفترة. إعادة الفتح تتطلب تحقق المالك وسبباً مسجلاً.</p></div>
    {error && <p role="alert" className="sf-card p-3 text-sf-danger">{error} <button className="underline" disabled={busy} onClick={() => setRetry(n => n+1)}>تحديث البيانات</button></p>}
    {message && <p role="status" className="text-sf-action">{message}</p>}
    {!allowed && <p role="alert">صلاحية الفترات أو الاشتراك المحاسبي غير متاحة.</p>}
    {allowed && !v2 && <p className="sf-card p-4">فعّل Accounting V2 من إعدادات المخزون بعد مراجعة البيانات لبدء إدارة الفترات. الإقفال القديم أدناه يظل سارياً.</p>}
    {allowed && v2 && <>
      {manage && <form aria-label="إنشاء فترة محاسبية" onSubmit={e => { e.preventDefault(); if (!currentOrg) return; void execute(() => saveAccountingPeriod('period.create',{id,start_date:start,end_date:end,reason:createReason.trim()},currentOrg.id),'تم إنشاء الفترة.').then(() => { setSelected(id); setCreateReason(''); }).catch(() => undefined); }} className="sf-card p-4 space-y-3">
        <h3 className="font-semibold">إنشاء فترة</h3><p className="text-sf-warning">بعد إنشاء أول فترة يجب أن تغطي الفترات تواريخ العمليات. أنشئ الفترات التاريخية والجديدة المطلوبة؛ لا يسمح النظام بترحيل تاريخ خارجها.</p>
        <div className="grid sm:grid-cols-3 gap-3"><label>معرف الفترة<input aria-label="معرف الفترة" value={id} onChange={e => setId(e.target.value)} maxLength={100} required disabled={busy} className={input} /></label><label>بداية الفترة<input aria-label="بداية الفترة" type="date" value={start} onChange={e => setStart(e.target.value)} required disabled={busy} className={input} /></label><label>نهاية الفترة<input aria-label="نهاية الفترة" type="date" min={start} value={end} onChange={e => setEnd(e.target.value)} required disabled={busy} className={input} /></label></div>
        <label className="block">سبب إنشاء الفترة<textarea aria-label="سبب إنشاء الفترة" value={createReason} onChange={e => setCreateReason(e.target.value)} maxLength={1000} required disabled={busy} className={input} /></label><button type="submit" disabled={busy || !createReason.trim()} className={`${button} bg-sf-action text-white`}>إنشاء الفترة</button>
      </form>}
      <div className="sf-card p-4 space-y-3"><label className="block">الفترة المحددة<select aria-label="الفترة المحددة" value={selected} onChange={e => { setSelected(e.target.value); setReason(''); }} disabled={busy} className={input}><option value="">اختر فترة</option>{report?.periods.map(row => <option key={row.id} value={row.id}>{row.id} — {statuses[row.status]} ({row.start_date} / {row.end_date})</option>)}</select></label><button type="button" disabled={busy || loading} onClick={() => setRetry(n => n+1)} className={button}>تحديث فحص الإغلاق</button>{loading && <p role="status">جارٍ تحميل الفترات وفحص الإغلاق…</p>}{report && !report.periods.length && <p>لم تنشأ فترات بعد.</p>}</div>
      {period && <div role="region" className="sf-card p-4 space-y-4" aria-label="حالة الفترة"><h3 className="font-semibold">{period.id} — {statuses[period.status]}</h3><p>{period.start_date} — {period.end_date} · الإصدار {period.revision}</p>
        {checks && <section aria-label="فحص إقفال الشهر" className="space-y-3"><h4 className="font-semibold">فحص إقفال الشهر</h4><p>يفحص النظام البيانات المسجلة في المؤسسة كاملة وأدلة المطابقة حتى نهاية الفترة. أي حركة جديدة تستلزم فحصاً جديداً.</p>
          <ul className="grid sm:grid-cols-2 gap-2">{Object.entries(checkLabels).map(([key,label]) => <li key={key} className="border border-sf-border rounded p-2 flex gap-2"><span aria-hidden="true">{checks.checks[key as keyof typeof checkLabels] ? '✓' : '!'}</span><span>{label}: {checks.checks[key as keyof typeof checkLabels] ? 'مطابق' : 'يحتاج مراجعة'}</span></li>)}</ul>
          <p className={checks.can_close ? 'text-sf-action' : 'text-sf-warning'}>{checks.can_close ? (period.status === 'CLOSED' ? 'دليل الإغلاق محفوظ؛ الفحص الحالي مطابق.' : 'الفحص الآلي مطابق؛ أكد مراجعة الصرف قبل الإغلاق النهائي.') : `الإغلاق متوقف: ${checks.findings_count} ملاحظة و${checks.missing_reconciliations.length} حساب يحتاج مطابقة.`}</p>
          {!!checks.missing_reconciliations.length && <ul>{checks.missing_reconciliations.map(code => <li key={code}>{accounts.find(a=>a.code===code)?.name_ar || code} ({code}): يلزم أحدث جرد أو مطابقة حتى {period.end_date}.</li>)}</ul>}
          {!!checks.findings.length && <details><summary>تفاصيل المراجعة ({checks.findings.length} من {checks.findings_count})</summary><ul className="space-y-2 pt-2">{checks.findings.map((row,index) => <li key={index} className="break-words">{sourceLabels[row.collection] || 'سجل مالي'}: {row.id}{row.message ? ` — ${row.message}` : ' — اختلاف في إثبات المصدر أو الرصيد؛ راجع المستند المرتبط.'}</li>)}</ul></details>}
        </section>}
        {period.status === 'CLOSED' && period.close_evidence && <section aria-label="دليل الإغلاق" className="p-3 border border-sf-border rounded space-y-2"><h4 className="font-semibold">دليل الإغلاق النهائي</h4><p>المراجع: {period.close_evidence.reviewed_by} · {period.close_evidence.checked_at}</p><p className="break-words">السبب: {period.close_evidence.review_reason}</p><p>أدلة الصندوق والبنك: {period.close_evidence.reconciliations.length}</p><p dir="ltr" className="font-mono text-xs break-all">{period.close_evidence.ledger_hash}</p></section>}
        {period.reopened_by && <p className="break-words">آخر إعادة فتح: {period.reopened_by} · {period.reopened_at} · {period.reopen_reason}</p>}
        {manage && period.status !== 'CLOSED' && <form onSubmit={e => transition(period.status === 'SOFT_CLOSED' ? 'period.close' : 'period.softClose',e)} className="space-y-3"><label className="block">سبب الإقفال<textarea aria-label="سبب الإقفال" value={reason} onChange={e=>setReason(e.target.value)} required maxLength={1000} disabled={busy} className={input} /></label>{period.status === 'SOFT_CLOSED' && <label className="flex gap-2"><input type="checkbox" checked={fxReviewed} onChange={e=>setFxReviewed(e.target.checked)} disabled={busy} />راجعت فروق الصرف للجزء المطلوب إقفاله</label>}<button type="submit" disabled={busy || loading || !reason.trim() || (period.status === 'SOFT_CLOSED' && (!checks?.can_close || !fxReviewed))} className={`${button} bg-sf-action text-white`}>{period.status === 'SOFT_CLOSED' ? 'إقفال نهائي للفترة' : 'إقفال مبدئي للفترة'}</button></form>}
        {reopen && ['SOFT_CLOSED','CLOSED'].includes(period.status) && <button type="button" onClick={() => setReauth('period')} disabled={busy} className={button}>إعادة فتح الفترة</button>}
      </div>}
    </>}
    {(settings.period_lock_date || !v2) && <section aria-label="الإقفال القديم" className="sf-card p-4 space-y-3"><h3 className="font-semibold">الإقفال القديم حتى تاريخ</h3><p>{settings.period_lock_date || 'غير مفعل'}</p><p className="text-sf-muted">هذه حماية إضافية مستقلة. إزالة التاريخ لا تفتح فترة مقفلة في النظام الجديد.</p>{isActionAllowed('org:update_settings') && !v2 && <form onSubmit={e=>{e.preventDefault();if (!currentOrg)return;if(settings.period_lock_date && legacyDate < settings.period_lock_date){setError('تخفيف الإقفال القديم يتطلب تحقق المالك؛ استخدم إزالة الإقفال أولاً.');return;}void execute(()=>updateSettings({period_lock_date:legacyDate},undefined,currentOrg.id),'تم حفظ الإقفال القديم.').catch(()=>undefined);}}><label>تاريخ الإقفال القديم<input aria-label="تاريخ الإقفال القديم" type="date" value={legacyDate} onChange={e=>setLegacyDate(e.target.value)} required disabled={busy} className={input} /></label><button type="submit" disabled={busy || !legacyDate} className={button}>حفظ الإقفال القديم</button></form>}{isActionAllowed('periods:reopen') && isActionAllowed('org:update_settings') && settings.period_lock_date && <button type="button" disabled={busy} onClick={()=>setReauth('legacy')} className={button}>إزالة الإقفال القديم بتحقق المالك</button>}</section>}
    {reauth && <OwnerReauthenticationDialog onClose={()=>setReauth(null)} onConfirm={async (reopenReason,orgId)=>{if(reauth==='legacy')await execute(()=>updateSettings({period_lock_date:''},reopenReason,orgId),'تمت إزالة الإقفال القديم.');else {if(!period)throw new Error('الفترة غير متاحة؛ حدث البيانات.');await execute(()=>saveAccountingPeriod('period.reopen',{id:period.id,expected_revision:period.revision,reason:reopenReason},orgId),'تمت إعادة فتح الفترة وسجل السبب.');}}} />}
  </section>;
}
