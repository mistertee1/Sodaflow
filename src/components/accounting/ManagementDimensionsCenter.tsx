import React, { useMemo, useRef, useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { DimensionKind, ManagementDimension } from '../../domain/managementDimensions';
import { operationId } from '../../services/businessApi';

const labels: Record<DimensionKind, { one: string; many: string }> = {
  branch: { one: 'فرع', many: 'الفروع' },
  cost_center: { one: 'مركز تكلفة', many: 'مراكز التكلفة' },
  project: { one: 'مشروع', many: 'المشاريع' },
};

export const ManagementDimensionsCenter: React.FC = () => {
  const { branches, costCenters, projects, currentOrg, isActionAllowed, saveDimension, loadBranchProfitAndLoss } = useApp();
  const [kind, setKind] = useState<DimensionKind>('branch');
  const [editing, setEditing] = useState<ManagementDimension | null>(null);
  const [code, setCode] = useState(''), [nameAr, setNameAr] = useState(''), [nameEn, setNameEn] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [reportBranch,setReportBranch]=useState(''),[reportStart,setReportStart]=useState(''),[reportEnd,setReportEnd]=useState('');
  const [report,setReport]=useState<Awaited<ReturnType<typeof loadBranchProfitAndLoss>>|null>(null),[reportBusy,setReportBusy]=useState(false),[reportError,setReportError]=useState('');
  const lock = useRef(false);
  const rows = useMemo(() => ({ branch: branches, cost_center: costCenters, project: projects })[kind].slice().sort((a,b) => a.code.localeCompare(b.code)), [kind, branches, costCenters, projects]);
  const canManage = isActionAllowed('dimensions:manage');
  const reset = () => { setEditing(null); setCode(''); setNameAr(''); setNameEn(''); setStatus('active'); setError(null); };
  const edit = (row: ManagementDimension) => { setEditing(row); setCode(row.code); setNameAr(row.name_ar); setNameEn(row.name_en || ''); setStatus(row.status); setError(null); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (lock.current || !currentOrg || !canManage) return;
    if (!code.trim() || !nameAr.trim()) { setError('الرمز والاسم العربي مطلوبان.'); return; }
    lock.current = true; setSaving(true); setError(null);
    try {
      const requestId = operationId();
      await saveDimension(kind, editing ? { id: editing.id, expected_revision: editing.revision, updates: { name_ar: nameAr.trim(), name_en: nameEn.trim(), status } } : { id: `dim-${requestId}`, code: code.trim().toUpperCase(), name_ar: nameAr.trim(), name_en: nameEn.trim(), status }, Boolean(editing), currentOrg.id, requestId);
      reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر حفظ البعد الإداري.'); }
    finally { lock.current = false; setSaving(false); }
  };

  return <section aria-label="إدارة الأبعاد الإدارية" className="space-y-4">
    <div className="bg-sf-surface border border-sf-border rounded-xl p-4 space-y-3">
      <div><h3 className="font-semibold text-sf-text">الفروع ومراكز التكلفة والمشاريع</h3><p className="text-xs text-sf-muted mt-1">السجلات غير النشطة تبقى محفوظة تاريخياً ولا يمكن اختيارها في عمليات جديدة.</p></div>
      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="أنواع الأبعاد">
        {(Object.keys(labels) as DimensionKind[]).map(value => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => { setKind(value); reset(); }} className={kind === value ? 'sf-primary whitespace-nowrap' : 'sf-secondary whitespace-nowrap'}>{labels[value].many}</button>)}
      </div>
    </div>

    {canManage && <form aria-label={`حفظ ${labels[kind].one}`} onSubmit={submit} className="bg-sf-surface border border-sf-border rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-center"><h4 className="font-semibold text-sm">{editing ? `تعديل ${labels[kind].one}` : `إضافة ${labels[kind].one}`}</h4>{editing && <button type="button" onClick={reset} className="text-xs text-sf-muted flex gap-1"><X className="w-4 h-4"/>إلغاء التعديل</button>}</div>
      {error && <div role="alert" className="p-3 rounded-lg bg-sf-danger-bg text-sf-danger text-xs">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="text-xs">الرمز<input aria-label={`رمز ${labels[kind].one}`} required disabled={Boolean(editing) || saving} value={code} onChange={e=>setCode(e.target.value)} maxLength={40} className="w-full mt-1 p-2 rounded-lg bg-sf-raised border border-sf-border" /></label>
        <label className="text-xs">الاسم العربي<input aria-label={`اسم ${labels[kind].one} بالعربية`} required disabled={saving} value={nameAr} onChange={e=>setNameAr(e.target.value)} maxLength={200} className="w-full mt-1 p-2 rounded-lg bg-sf-raised border border-sf-border" /></label>
        <label className="text-xs">الاسم الإنجليزي<input aria-label={`اسم ${labels[kind].one} بالإنجليزية`} disabled={saving} value={nameEn} onChange={e=>setNameEn(e.target.value)} maxLength={200} className="w-full mt-1 p-2 rounded-lg bg-sf-raised border border-sf-border" /></label>
        <label className="text-xs">الحالة<select aria-label={`حالة ${labels[kind].one}`} disabled={saving} value={status} onChange={e=>setStatus(e.target.value as 'active'|'inactive')} className="w-full mt-1 p-2 rounded-lg bg-sf-raised border border-sf-border"><option value="active">نشط</option><option value="inactive">غير نشط</option></select></label>
      </div>
      <button disabled={saving} className="sf-primary flex items-center gap-2" type="submit">{editing ? <Save className="w-4 h-4"/> : <Plus className="w-4 h-4"/>}{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة السجل'}</button>
    </form>}

    <div className="bg-sf-surface border border-sf-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-sf-border font-semibold text-sm">سجل {labels[kind].many} ({rows.length})</div>
      {rows.length === 0 ? <p className="p-6 text-center text-sm text-sf-muted">لا توجد سجلات بعد.</p> : <div className="divide-y divide-sf-border">{rows.map(row => <div key={row.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><div className="font-semibold text-sm">{row.code} — {row.name_ar}</div><div className="text-xs text-sf-muted">{row.name_en || 'بدون اسم إنجليزي'} · إصدار {row.revision}</div></div><div className="flex items-center gap-2"><span className={row.status === 'active' ? 'text-xs text-sf-action' : 'text-xs text-sf-danger'}>{row.status === 'active' ? 'نشط' : 'غير نشط'}</span>{canManage && <button type="button" onClick={()=>edit(row)} className="sf-secondary text-xs">تعديل</button>}</div></div>)}</div>}
    </div>
    {isActionAllowed('reports:advanced')&&kind==='branch'&&<form aria-label="تقرير ربحية الفرع" onSubmit={async e=>{e.preventDefault();if(!reportBranch||reportBusy)return;setReportBusy(true);setReportError('');try{setReport(await loadBranchProfitAndLoss(reportBranch,{start:reportStart||undefined,end:reportEnd||undefined}));}catch(reason){setReportError(reason instanceof Error?reason.message:'تعذر تحميل تقرير الفرع.');}finally{setReportBusy(false);}}} className="bg-sf-surface border border-sf-border rounded-xl p-4 space-y-3"><h4 className="font-semibold">قائمة دخل الفرع</h4><div className="grid sm:grid-cols-4 gap-2"><label>الفرع<select aria-label="فرع تقرير الربحية" required value={reportBranch} onChange={e=>setReportBranch(e.target.value)} className="sf-field w-full"><option value="">اختر فرعاً</option>{branches.map(row=><option key={row.id} value={row.id}>{row.code} — {row.name_ar}</option>)}</select></label><label>من<input aria-label="بداية تقرير الفرع" type="date" value={reportStart} onChange={e=>setReportStart(e.target.value)} className="sf-field w-full"/></label><label>حتى<input aria-label="نهاية تقرير الفرع" type="date" value={reportEnd} onChange={e=>setReportEnd(e.target.value)} className="sf-field w-full"/></label><button disabled={reportBusy} className="sf-primary self-end">{reportBusy?'تحميل...':'عرض التقرير'}</button></div>{reportError&&<p role="alert" className="text-sf-danger">{reportError}</p>}{report&&<div role="region" aria-label="نتيجة ربحية الفرع" className="grid sm:grid-cols-5 gap-2 text-sm"><p>المبيعات<br/><b>{report.sales_sdg} SDG / {report.sales_usd} USD</b></p><p>تكلفة المبيعات<br/><b>{report.cogs_sdg} / {report.cogs_usd}</b></p><p>مجمل الربح<br/><b>{report.gross_profit_sdg} / {report.gross_profit_usd}</b></p><p>المصروفات<br/><b>{report.expenses_sdg} / {report.expenses_usd}</b></p><p>صافي الربح<br/><b>{report.net_profit_sdg} / {report.net_profit_usd}</b></p></div>}</form>}
  </section>;
};
