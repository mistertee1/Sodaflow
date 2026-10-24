import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasPermission } from '../../services/rbacService';
import { BusinessError } from '../../domain/validation';
import type { ExportScheduleInput, ExportScheduleList, ExportScheduleView, ExportJobView, ExportDownload, ScheduledExportKind } from '../../types/exportSchedules';

const field = 'block w-full min-w-0 mt-1 p-2 rounded border border-sf-border bg-sf-raised';
const kinds: Record<ScheduledExportKind, string> = { accounting: 'دفتر المحاسب', auditor: 'حزمة المراجع', company: 'الشركة كاملة' };
const states: Record<ExportJobView['status'], string> = { queued: 'في الانتظار', running: 'جارٍ الإنشاء', completed: 'مكتمل', failed: 'تعذر الإنشاء', cancelled: 'ملغاة', expired: 'انتهت الصلاحية' };
const weekdays = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
function today(zone: string) {
  try { const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(v => [v.type, v.value])); return `${p.year}-${p.month}-${p.day}`; }
  catch { return new Date().toISOString().slice(0, 10); }
}
type Draft = ExportScheduleInput & { end_date: string; weekday: number; month_day: number };
const defaults = (zone: string, kind: ScheduledExportKind = 'accounting'): Draft => ({ name: '', kind, cadence: 'daily', timezone: zone, time: '10:00', weekday: 1, month_day: 1, start_date: today(zone), end_date: '', period_kind: kind === 'company' ? 'full' : 'previous_day', retention_hours: 24, active: true });
function input(draft: Draft): ExportScheduleInput {
  return { name: draft.name.trim(), kind: draft.kind, cadence: draft.cadence, timezone: draft.timezone.trim(), time: draft.time,
    ...(draft.cadence === 'weekly' ? { weekday: draft.weekday } : {}), ...(draft.cadence === 'monthly' ? { month_day: draft.month_day } : {}),
    start_date: draft.start_date, ...(draft.end_date ? { end_date: draft.end_date } : {}), period_kind: draft.kind === 'company' ? 'full' : draft.period_kind, retention_hours: draft.retention_hours, active: draft.active };
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'تعذر تأكيد الطلب. أعد المحاولة.';

export const ScheduledExportsCenter: React.FC = () => {
  const app = useApp(), appRef = useRef(app); appRef.current = app;
  const orgId = app.currentOrg?.id || '', uid = app.currentUser?.uid || '';
  const permitted = !!uid && !app.authLoading && hasPermission(app.userRole, 'export:accounting');
  const entitlementKey = JSON.stringify([app.userRole, app.currentOrg?.status, app.currentOrg?.accounting_version, app.subscription.effective_status, app.subscription.status, app.subscription.subscription_end, app.subscription.features.accounting, app.subscription.features.advanced_reports, app.subscription.features.audit_trail]);
  const [list, setList] = useState<ExportScheduleList | null>(null), [jobs, setJobs] = useState<ExportJobView[]>([]);
  const [draft, setDraft] = useState<Draft>(() => defaults(app.settings.timezone || 'Africa/Khartoum'));
  const [editing, setEditing] = useState<ExportScheduleView | null>(null), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [link, setLink] = useState<(ExportDownload & { jobId: string }) | null>(null);
  const epoch = useRef(0), alive = useRef(false), lock = useRef(false);
  const live = (version: number) => alive.current && epoch.current === version;
  const loadData = async (version: number) => {
    try {
      const [policies, history] = await Promise.all([appRef.current.loadExportSchedules(orgId), appRef.current.loadExportJobHistory(orgId)]);
      if (!live(version)) return;
      setList(policies); setJobs(history.jobs); setLoadError(''); setLink(null);
      setDraft(value => policies.allowed_kinds.includes(value.kind) ? value : defaults(value.timezone, policies.allowed_kinds[0]));
    } catch (failure) {
      if (!live(version)) return;
      setList(null); setJobs([]); setLink(null); setLoadError(errorText(failure));
    }
  };
  const perform = async (work: (version: number) => Promise<void>) => {
    if (lock.current) return;
    const version = epoch.current; lock.current = true; setBusy(true); setError(''); setNotice(''); setLink(null);
    try { await work(version); }
    catch (failure) {
      if (!live(version)) return;
      setError(errorText(failure));
      if (failure instanceof BusinessError && failure.status === 409 && failure.code !== 'scope_changed') {
        setEditing(null); setDraft(defaults(appRef.current.settings.timezone || 'Africa/Khartoum')); await loadData(version);
        if (live(version)) setError('تغير إصدار البيانات. راجع الجدول الحالي ثم عدّله من جديد.');
      } else if (failure instanceof BusinessError && [401, 403].includes(failure.status)) { setList(null); setJobs([]); }
    } finally { if (live(version)) { lock.current = false; setBusy(false); } }
  };
  useEffect(() => {
    alive.current = true; const version = ++epoch.current;
    lock.current = false; setList(null); setJobs([]); setEditing(null); setLink(null); setError(''); setNotice(''); setLoadError('');
    setDraft(defaults(appRef.current.settings.timezone || 'Africa/Khartoum'));
    if (orgId && permitted) {
      lock.current = true; setBusy(true);
      void loadData(version).finally(() => { if (live(version)) { lock.current = false; setBusy(false); } });
    } else setBusy(false);
    return () => { alive.current = false; ++epoch.current; };
  }, [orgId, uid, permitted, entitlementKey]);
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(() => setLink(null), Math.max(0, Date.parse(link.expires_at) - Date.now()));
    return () => clearTimeout(timer);
  }, [link]);
  const edit = (policy: ExportScheduleView) => {
    setEditing(policy); setDraft({ ...policy, end_date: policy.end_date || '', weekday: policy.weekday || 1, month_day: policy.month_day || 1 }); setError(''); setNotice(''); setLink(null);
  };
  const save = () => perform(async version => {
    const value = input(draft);
    if (editing) await appRef.current.updateExportSchedule(editing.id, editing.revision, { ...value, weekday: value.weekday ?? null, month_day: value.month_day ?? null, end_date: value.end_date ?? null }, orgId);
    else await appRef.current.createExportSchedule(value, orgId);
    if (!live(version)) return;
    setNotice(editing ? 'تم تأكيد تعديل الجدول.' : 'تم تأكيد حفظ الجدول.'); setEditing(null); setDraft(defaults(draft.timezone, value.kind));
    await loadData(version);
  });
  const toggle = (policy: ExportScheduleView) => perform(async version => {
    await appRef.current.updateExportSchedule(policy.id, policy.revision, { active: !policy.active }, orgId);
    if (!live(version)) return;
    setEditing(null); setDraft(defaults(draft.timezone)); setNotice(policy.active ? 'تم تأكيد إيقاف الجدول.' : 'تم تأكيد استئناف الجدول.'); await loadData(version);
  });
  const download = (job: ExportJobView) => perform(async version => {
    const result = await appRef.current.getExportDownload(job, orgId);
    if (live(version)) { setLink({ ...result, jobId: job.id }); setNotice('رابط التنزيل مؤقت؛ ينتهي في الوقت الموضح.'); }
  });
  const cadenceText = (p: ExportScheduleView) => p.cadence === 'daily' ? 'يومي' : p.cadence === 'weekly' ? `أسبوعي — ${weekdays[(p.weekday || 1) - 1]}` : `شهري — يوم ${p.month_day}`;
  return <section className="border-t border-sf-border pt-5 space-y-4 min-w-0" data-testid="scheduled-exports-center">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">جداول التصدير والملفات</h3>{permitted && <button type="button" className="sf-secondary" disabled={busy} onClick={() => void perform(loadData)}>تحديث بيانات الجداول</button>}</div>
    {!permitted ? <p className="text-sm text-sf-muted">إدارة الجداول متاحة لصاحب الصلاحية المالية فقط.</p> : <>
      {busy && !list && <p role="status">جارٍ تحميل الجداول والملفات…</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {list && <>
        {!list.execution_enabled && <p className="rounded-lg bg-amber-50 text-amber-950 p-3" data-testid="schedule-execution-state">يمكن حفظ المواعيد وإدارتها؛ التشغيل التلقائي غير مفعّل بعد. حفظ الجدول لا يعني إنشاء ملف.</p>}
        <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3" aria-label="إعداد جدول التصدير">
          <h4 className="font-bold">{editing ? `تعديل الجدول: ${editing.name}` : 'جدول تصدير جديد'}</h4>
          <fieldset disabled={busy} className="grid min-w-0 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="block min-w-0 text-sm">اسم الجدول<input className={field} aria-label="اسم جدول التصدير" required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
            <label className="block min-w-0 text-sm">نوع الملف<select className={field} aria-label="نوع ملف الجدول" disabled={!!editing} value={draft.kind} onChange={e => { const kind = e.target.value as ScheduledExportKind; setDraft({ ...draft, kind, period_kind: kind === 'company' ? 'full' : 'previous_day' }); }}>{list.allowed_kinds.map(kind => <option key={kind} value={kind}>{kinds[kind]}</option>)}</select></label>
            <label className="block min-w-0 text-sm">التكرار<select className={field} aria-label="تكرار جدول التصدير" value={draft.cadence} onChange={e => setDraft({ ...draft, cadence: e.target.value as Draft['cadence'] })}><option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly">شهري</option></select></label>
            <label className="block min-w-0 text-sm">المنطقة الزمنية<input className={field} aria-label="المنطقة الزمنية للجدول" required value={draft.timezone} maxLength={64} placeholder="Asia/Kuwait" onChange={e => setDraft({ ...draft, timezone: e.target.value })}/></label>
            <label className="block min-w-0 text-sm">الوقت المحلي<input className={field} aria-label="وقت جدول التصدير" required type="time" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })}/></label>
            {draft.cadence === 'weekly' && <label className="block min-w-0 text-sm">يوم الأسبوع<select className={field} aria-label="يوم جدول التصدير" value={draft.weekday} onChange={e => setDraft({ ...draft, weekday: Number(e.target.value) })}>{weekdays.map((day, i) => <option key={day} value={i + 1}>{day}</option>)}</select></label>}
            {draft.cadence === 'monthly' && <label className="block min-w-0 text-sm">يوم الشهر<input className={field} aria-label="يوم شهر جدول التصدير" required type="number" min={1} max={31} value={draft.month_day} onChange={e => setDraft({ ...draft, month_day: Number(e.target.value) })}/><span className="text-xs text-sf-muted">اليوم غير الموجود يُنقل لآخر يوم في الشهر.</span></label>}
            <label className="block min-w-0 text-sm">بداية المواعيد<input className={field} aria-label="بداية جدول التصدير" required type="date" value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value })}/></label>
            <label className="block min-w-0 text-sm">نهاية اختيارية<input className={field} aria-label="نهاية جدول التصدير" type="date" min={draft.start_date} value={draft.end_date} onChange={e => setDraft({ ...draft, end_date: e.target.value })}/></label>
            <label className="block min-w-0 text-sm">فترة بيانات الملف<select className={field} aria-label="فترة بيانات الجدول" disabled={draft.kind === 'company'} value={draft.kind === 'company' ? 'full' : draft.period_kind} onChange={e => setDraft({ ...draft, period_kind: e.target.value as Draft['period_kind'] })}><option value="previous_day">اليوم السابق</option><option value="previous_month">الشهر السابق</option><option value="month_to_date">الشهر حتى موعد التصدير</option><option value="full">كل الفترات</option></select></label>
            <label className="block min-w-0 text-sm">الاحتفاظ بالملف بالساعات<input className={field} aria-label="ساعات الاحتفاظ بملف الجدول" required type="number" min={1} max={24} value={draft.retention_hours} onChange={e => setDraft({ ...draft, retention_hours: Number(e.target.value) })}/></label>
            <label className="flex items-center gap-2"><input className="h-4 w-4" aria-label="تفعيل جدول التصدير" type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })}/>الجدول نشط</label>
          </fieldset>
          <div className="flex gap-2"><button className="sf-primary" type="submit" disabled={busy || !draft.name.trim() || !list.allowed_kinds.includes(draft.kind)}>{editing ? 'تأكيد تعديل الجدول' : 'حفظ جدول التصدير'}</button>{editing && <button className="sf-secondary" type="button" disabled={busy} onClick={() => { setEditing(null); setDraft(defaults(draft.timezone)); }}>إلغاء التعديل</button>}</div>
        </form>
        <div className="max-w-full overflow-x-auto"><table className="sf-table min-w-full text-sm" aria-label="جداول التصدير المحفوظة"><thead><tr><th>الجدول</th><th>المواعيد</th><th>الموعد التالي</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{list.schedules.map(policy => <tr key={policy.id} data-testid={`export-schedule-${policy.id}`}><td>{policy.name}<div className="text-xs text-sf-muted">{kinds[policy.kind]} · الإصدار {policy.revision}</div></td><td>{cadenceText(policy)} · {policy.time}<div className="text-xs">{policy.timezone}</div></td><td>{policy.next_run_at ? new Date(policy.next_run_at).toLocaleString('ar-KW', { timeZone: policy.timezone }) : 'لا يوجد موعد قادم'}</td><td>{policy.active ? 'نشط' : 'متوقف'}{policy.last_dispatch_outcome === 'skipped' && <div>تُخطي آخر موعد لعدم توافر حق التصدير.</div>}</td><td><div className="flex gap-2"><button className="sf-secondary" disabled={busy} onClick={() => edit(policy)} aria-label={`تعديل الجدول ${policy.name}`}>تعديل</button><button className="sf-secondary" disabled={busy} onClick={() => void toggle(policy)} aria-label={`${policy.active ? 'إيقاف' : 'استئناف'} الجدول ${policy.name}`}>{policy.active ? 'إيقاف' : 'استئناف'}</button></div></td></tr>)}</tbody></table>{!list.schedules.length && <p className="text-sm text-sf-muted py-2">لا توجد جداول محفوظة بعد.</p>}</div>
        <div className="space-y-2"><h4 className="font-bold">أحدث ملفات التصدير</h4><p className="text-sm text-sf-muted">أحدث 100 مهمة مسموحة لك. يُراجع حق الوصول مجدداً عند تجهيز رابط التنزيل.</p><div className="max-w-full overflow-x-auto"><table className="sf-table min-w-full text-sm" aria-label="أحدث مهام التصدير"><thead><tr><th>الملف</th><th>المصدر</th><th>تاريخ الطلب</th><th>الحالة</th><th>التنزيل</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id} data-testid={`export-job-${job.id}`}><td>{kinds[job.kind]}<div className="text-xs">{job.filename}</div></td><td>{job.origin === 'scheduled' ? 'مجدول' : 'طلب يدوي'}</td><td>{new Date(job.created_at).toLocaleString('ar-KW')}</td><td>{states[job.status]}{job.status === 'running' && ` (${job.progress}%)`}</td><td>{job.download_available && (!job.expires_at || Date.parse(job.expires_at) > Date.now()) && <button className="sf-secondary" disabled={busy} onClick={() => void download(job)}>تجهيز رابط التنزيل</button>}{link?.jobId === job.id && <div className="space-y-1"><a className="sf-primary inline-block" href={link.url} target="_blank" rel="noopener noreferrer" download={job.filename}>تنزيل الملف</a><p className="text-xs">ينتهي الرابط: {new Date(link.expires_at).toLocaleTimeString('ar-KW')}</p></div>}</td></tr>)}</tbody></table></div>{!jobs.length && <p className="text-sm text-sf-muted">لا توجد مهام تصدير متاحة.</p>}</div>
      </>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </>}
  </section>;
};
