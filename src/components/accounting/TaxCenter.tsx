import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useApp} from '../../context/AppContext';
import {classifyAccount} from '../../domain/accountClassification';
import type {TaxConfiguration} from '../../domain/taxConfiguration';
import {operationId} from '../../services/businessApi';
import {OwnerReauthenticationDialog} from './OwnerReauthenticationDialog';

const field = 'w-full min-w-0 mt-1 p-2 rounded border border-sf-border bg-sf-raised';
type Draft = Omit<TaxConfiguration, 'schema_version' | 'org_id' | 'revision'> & {reason: string; expected_revision?: number};
const blank = (): Draft => ({id: `tax-${operationId()}`, name: '', jurisdiction: '', direction: 'sales', rate: 0,
  calculation: 'exclusive', rounding: 'half_up', recoverable: false, tax_account_code: '', effective_from: '', effective_to: null, active: true, reason: ''});

export function TaxCenter() {
  const a = useApp(), [draft, setDraft] = useState<Draft>(blank), [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [reauth, setReauth] = useState(false);
  const mounted = useRef(true), working = useRef(false), scope = useRef({org: a.currentOrg?.id, uid: a.currentUser?.uid});
  const current = useRef(scope.current); current.current = {org: a.currentOrg?.id, uid: a.currentUser?.uid};
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const canManage = a.userRole === 'Owner' && a.isActionAllowed('tax:manage');
  const permissionNow = useRef(canManage); permissionNow.current = canManage;
  const accounts = useMemo(() => a.accounts.filter(account => {
    if (!account.is_active) return false;
    const group = classifyAccount(account).reporting_group;
    return draft.direction === 'sales' ? account.type === 'LIABILITY' && account.nature === 'CREDIT' && group === 'tax_payable'
      : draft.recoverable && account.type === 'ASSET' && account.nature === 'DEBIT' && group === 'other_assets';
  }), [a.accounts, draft.direction, draft.recoverable]);
  const guard = () => {
    if (!mounted.current || !scope.current.org || scope.current.org !== current.current.org || scope.current.uid !== current.current.uid || !permissionNow.current)
      throw Error('تغيرت المؤسسة أو الصلاحية؛ أعد فتح إعداد الضريبة.');
    return scope.current.org;
  };
  const reset = () => {setDraft(blank()); setEditing(false);};
  const select = (row: TaxConfiguration) => {setEditing(true); setNotice(''); setDraft({id:row.id,name:row.name,jurisdiction:row.jurisdiction,direction:row.direction,rate:row.rate,
    calculation:row.calculation,rounding:row.rounding,recoverable:row.recoverable,tax_account_code:row.tax_account_code,effective_from:row.effective_from,
    effective_to:row.effective_to,active:row.active,reason:'',expected_revision:row.revision});};
  const save = async (reason: string, org: string) => {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice('');
    try {
      if (org !== guard() || reason !== draft.reason.trim()) throw Error('سبب التحقق يجب أن يطابق النموذج؛ أعد فتح التحقق.');
      const payload = {...draft, reason, rate: Number(draft.rate), tax_account_code: draft.direction === 'purchases' && !draft.recoverable ? null : draft.tax_account_code || null,
        effective_to: draft.effective_to || null};
      const saved = await a.saveTaxConfiguration(payload, editing, org, operationId()); guard();
      setNotice(`تم حفظ إعداد ${saved.name} بالإصدار ${saved.revision}.`); reset();
    } catch (error) {if (mounted.current) setNotice(error instanceof Error ? error.message : 'تعذر حفظ إعداد الضريبة.');}
    finally {working.current = false; if (mounted.current) setBusy(false);}
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(row => ({...row, [key]: value}));
  return <section role="region" aria-label="مركز الضرائب" className="space-y-4 min-w-0 text-sm">
    <h3 className="text-lg font-semibold">مركز الضرائب</h3>
    <p>سياسات داخلية قابلة للضبط وليست إقراراً بالامتثال القانوني. تحفظ كل تعديلات المالك كسلسلة إصدارات مدققة.</p>
    {notice && <p role="status" className="sf-card p-3">{notice}</p>}
    {!canManage && <p>الإعدادات للعرض فقط؛ الإنشاء والتعديل متاحان لمالك المؤسسة بعد تحقق الدخول.</p>}
    {canManage && <form aria-label="إعداد ضريبة" className="sf-card p-4 space-y-3" onSubmit={event => {event.preventDefault(); setReauth(true);}}>
      <h4 className="font-semibold">{editing ? `تعديل ${draft.name}` : 'إضافة سياسة ضريبية'}</h4>
      <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3 min-w-0">
        <label>المعرف<input aria-label="معرف الضريبة" className={field} required maxLength={100} disabled={editing} value={draft.id} onChange={e => set('id', e.target.value)}/></label>
        <label>الاسم<input aria-label="اسم الضريبة" className={field} required maxLength={200} value={draft.name} onChange={e => set('name', e.target.value)}/></label>
        <label>النطاق أو الولاية<input aria-label="نطاق الضريبة" className={field} required maxLength={100} value={draft.jurisdiction} onChange={e => set('jurisdiction', e.target.value)}/></label>
        <label>الاتجاه<select aria-label="اتجاه الضريبة" className={field} value={draft.direction} onChange={e => {const direction=e.target.value as Draft['direction'];setDraft(row=>({...row,direction,recoverable:direction==='sales'?false:row.recoverable,tax_account_code:''}));}}><option value="sales">مبيعات — مستحقة</option><option value="purchases">مشتريات</option></select></label>
        <label>النسبة %<input aria-label="نسبة الضريبة" className={field} type="number" min="0" max="100" step="0.0001" required value={draft.rate} onChange={e => set('rate', Number(e.target.value))}/></label>
        <label>الحساب<select aria-label="حساب الضريبة" className={field} required={draft.direction==='sales'||draft.recoverable} disabled={draft.direction==='purchases'&&!draft.recoverable} value={draft.tax_account_code || ''} onChange={e => set('tax_account_code', e.target.value)}><option value="">{draft.direction==='purchases'&&!draft.recoverable?'تحمل على التكلفة':'اختر حساب التحكم'}</option>{accounts.map(row=><option key={row.code} value={row.code}>{row.code} — {row.name_ar}</option>)}</select></label>
        <label>طريقة الحساب<select aria-label="طريقة حساب الضريبة" className={field} value={draft.calculation} onChange={e => set('calculation',e.target.value as Draft['calculation'])}><option value="exclusive">غير شاملة</option><option value="inclusive">شاملة</option></select></label>
        <label>التقريب<select aria-label="قاعدة تقريب الضريبة" className={field} value={draft.rounding} onChange={e => set('rounding',e.target.value as Draft['rounding'])}><option value="half_up">نصف لأعلى</option><option value="half_even">نصف للزوجي</option><option value="floor">لأسفل</option></select></label>
        <label>سارية من<input aria-label="بداية سريان الضريبة" className={field} type="date" required value={draft.effective_from} onChange={e => set('effective_from',e.target.value)}/></label>
        <label>سارية إلى<input aria-label="نهاية سريان الضريبة" className={field} type="date" min={draft.effective_from} value={draft.effective_to || ''} onChange={e => set('effective_to',e.target.value || null)}/></label>
        {draft.direction==='purchases' && <label className="flex items-center gap-2"><input aria-label="ضريبة قابلة للاسترداد" type="checkbox" checked={draft.recoverable} onChange={e => setDraft(row=>({...row,recoverable:e.target.checked,tax_account_code:''}))}/>قابلة للاسترداد</label>}
        <label className="flex items-center gap-2"><input aria-label="إعداد ضريبة نشط" type="checkbox" checked={draft.active} onChange={e => set('active',e.target.checked)}/>نشط</label>
        <label className="sm:col-span-2">سبب الاعتماد أو التعديل<textarea aria-label="سبب إعداد الضريبة" className={field} required maxLength={1000} value={draft.reason} onChange={e => set('reason',e.target.value)}/></label>
      </fieldset>
      <div className="flex gap-2"><button className="sf-action" disabled={busy || ((draft.direction==='sales'||draft.recoverable)&&!draft.tax_account_code)}>{editing ? 'حفظ إصدار جديد' : 'اعتماد الإعداد'}</button>{editing&&<button type="button" className="sf-secondary" onClick={reset}>إلغاء التعديل</button>}</div>
    </form>}
    <section role="region" aria-label="سجل إعدادات الضرائب" className="sf-card p-4 space-y-3 min-w-0">
      <h4 className="font-semibold">الإعدادات المحفوظة</h4>
      {!a.taxConfigurations.length ? <p>لا توجد إعدادات ضريبية.</p> : <div className="overflow-auto"><table className="w-full whitespace-nowrap text-right"><thead><tr><th>السياسة</th><th>الاتجاه</th><th>النسبة</th><th>الحساب</th><th>السريان</th><th>الإصدار</th><th>الحالة</th>{canManage&&<th>إجراء</th>}</tr></thead><tbody>{[...a.taxConfigurations].sort((x,y)=>x.id.localeCompare(y.id)).map(row=><tr key={row.id}><td>{row.name}<br/><span className="text-xs text-sf-muted">{row.jurisdiction}</span></td><td>{row.direction==='sales'?'مبيعات':'مشتريات'}</td><td>{row.rate}%</td><td>{row.tax_account_code||'على التكلفة'}</td><td>{row.effective_from} — {row.effective_to||'مفتوح'}</td><td>{row.revision}</td><td>{row.active?'نشط':'متوقف'}</td>{canManage&&<td><button className="sf-secondary" aria-label={`تعديل إعداد ${row.name}`} onClick={()=>select(row)}>تعديل</button></td>}</tr>)}</tbody></table></div>}
    </section>
    {reauth && <OwnerReauthenticationDialog purpose={{title:'تحقق المالك وحفظ إعداد الضريبة',description:'ينشئ الحفظ إصداراً مدققاً جديداً لسياسة الضريبة.',initialReason:draft.reason,reasonLabel:'سبب إعداد الضريبة',confirmation:'أؤكد حفظ سياسة الضريبة في التجربة المحلية',submit:'التحقق وحفظ الإعداد'}} onClose={()=>setReauth(false)} onConfirm={save}/>} 
  </section>;
}
