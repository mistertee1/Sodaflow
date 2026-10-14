import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { ApprovalCurrency, ApprovalPolicy, ApprovalSubject, ApprovalTier } from '../../domain/approvalPolicies';
import type { OrgRole } from '../../types';
import { operationId } from '../../services/businessApi';

const subjects: Array<[ApprovalSubject,string]> = [['discount','خصم الفاتورة'],['expense','المصروف'],['customer_refund','رد مبلغ للعميل'],['supplier_refund','استرداد من المورد']];
const roles: OrgRole[] = ['Cashier','Sales','Accountant','Admin','Owner'];
const roleLabels: Record<OrgRole,string> = { Viewer:'مشاهد',Cashier:'أمين صندوق',Sales:'مبيعات',Accountant:'محاسب',Admin:'مدير',Owner:'مالك' };
const labelOf = (subject: ApprovalSubject) => subjects.find(row => row[0] === subject)?.[1] || subject;

const initialTiers = (): ApprovalTier[] => [{max_value:1000,required_role:'Accountant'},{max_value:null,required_role:'Owner'}];

export function ApprovalPolicyCenter() {
  const { approvalPolicies, saveApprovalPolicy, currentOrg, isActionAllowed } = useApp();
  const canManage = isActionAllowed('approvals:manage');
  const lock = useRef(false);
  const [editing,setEditing] = useState<ApprovalPolicy|null>(null);
  const [subject,setSubject] = useState<ApprovalSubject>('expense');
  const [currency,setCurrency] = useState<ApprovalCurrency>('SDG');
  const [tiers,setTiers] = useState<ApprovalTier[]>(initialTiers);
  const [active,setActive] = useState(true);
  const [reason,setReason] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const sorted = useMemo(() => [...approvalPolicies].sort((a,b) => labelOf(a.subject).localeCompare(labelOf(b.subject),'ar') || a.currency.localeCompare(b.currency)),[approvalPolicies]);
  const reset = () => { setEditing(null);setSubject('expense');setCurrency('SDG');setTiers(initialTiers());setActive(true);setReason(''); };
  const edit = (policy:ApprovalPolicy) => { setEditing(policy);setSubject(policy.subject);setCurrency(policy.currency);setTiers(policy.tiers.map(row=>({...row})));setActive(policy.active);setReason('');setError('');setNotice(''); };
  const changeSubject = (value:ApprovalSubject) => { setSubject(value);setCurrency(value === 'discount' ? 'PERCENT' : currency === 'PERCENT' ? 'SDG' : currency); };
  const save = async (event:React.FormEvent) => {
    event.preventDefault(); if(lock.current || !currentOrg) return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      const id = editing?.id || `approval-${crypto.randomUUID()}`;
      await saveApprovalPolicy({id,...(editing?{expected_revision:editing.revision}:{}),subject,currency,tiers,active,reason:reason.trim()},!!editing,currentOrg.id,operationId());
      setNotice(editing?'تم تحديث السياسة ومزامنتها.':'تم إنشاء السياسة ومزامنتها.');reset();
    } catch(failure) { setError(failure instanceof Error?failure.message:'تعذر حفظ سياسة الاعتماد.'); }
    finally {lock.current=false;setBusy(false);}
  };
  return <section aria-label="إدارة سياسات الاعتماد" className="space-y-5">
    <div className="sf-card p-4"><h2 className="font-bold text-lg">حدود الاعتماد</h2><p className="text-sm text-sf-muted">تحدد الدور الأدنى المطلوب حسب قيمة العملية. يحتفظ كل ترحيل بنسخة ثابتة من السياسة وقرار الاعتماد.</p></div>
    {error&&<p role="alert" className="text-sf-danger">{error}</p>}{notice&&<p role="status" className="text-sf-action">{notice}</p>}
    {!canManage&&<p className="sf-card p-3 text-sm text-sf-muted">العرض فقط: تعديل سياسات الاعتماد متاح لمالك المؤسسة.</p>}
    {canManage&&<form aria-label="حفظ سياسة اعتماد" onSubmit={save} className="sf-card p-4 space-y-4">
      <div className="grid sm:grid-cols-3 gap-3"><label>نوع العملية<select aria-label="نوع سياسة الاعتماد" value={subject} onChange={e=>changeSubject(e.target.value as ApprovalSubject)} className="sf-field w-full">{subjects.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>العملة<select aria-label="عملة سياسة الاعتماد" disabled={subject==='discount'} value={currency} onChange={e=>setCurrency(e.target.value as ApprovalCurrency)} className="sf-field w-full">{subject==='discount'?<option value="PERCENT">نسبة مئوية</option>:<><option value="SDG">جنيه سوداني</option><option value="USD">دولار أمريكي</option></>}</select></label><label className="flex items-end gap-2 pb-2"><input aria-label="السياسة نشطة" type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> نشطة</label></div>
      <fieldset className="space-y-2"><legend className="font-semibold">مستويات الاعتماد</legend>{tiers.map((tier,index)=><div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2"><label>{index===tiers.length-1?'الحد الأخير':'الحد الأعلى'}<input aria-label={`حد المستوى ${index+1}`} disabled={index===tiers.length-1} type="number" min="0" max={currency==='PERCENT'?100:undefined} step={currency==='USD'?'0.01':'0.0001'} value={tier.max_value??''} onChange={e=>setTiers(rows=>rows.map((row,i)=>i===index?{...row,max_value:Number(e.target.value)}:row))} className="sf-field w-full" placeholder={index===tiers.length-1?'بلا حد':''}/></label><label>الدور المطلوب<select aria-label={`دور المستوى ${index+1}`} value={tier.required_role} onChange={e=>setTiers(rows=>rows.map((row,i)=>i===index?{...row,required_role:e.target.value as OrgRole}:row))} className="sf-field w-full">{roles.map(role=><option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>{tiers.length>1&&index<tiers.length-1?<button type="button" aria-label={`حذف المستوى ${index+1}`} onClick={()=>setTiers(rows=>rows.filter((_,i)=>i!==index))} className="sf-secondary self-end">حذف</button>:<span/>}</div>)}</fieldset>
      <button type="button" disabled={tiers.length>=10} onClick={()=>setTiers(rows=>[...rows.slice(0,-1),{max_value:(rows.at(-2)?.max_value||0)+1000,required_role:'Admin'},rows.at(-1)!])} className="sf-secondary">إضافة مستوى</button>
      <label className="block">سبب التغيير<textarea aria-label="سبب تغيير سياسة الاعتماد" required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className="sf-field w-full"/></label>
      <div className="flex gap-2"><button disabled={busy} className="sf-action" type="submit">{busy?'جارٍ الحفظ…':editing?'تحديث السياسة':'إنشاء السياسة'}</button>{editing&&<button type="button" disabled={busy} onClick={reset} className="sf-secondary">إلغاء التعديل</button>}</div>
    </form>}
    <div className="grid md:grid-cols-2 gap-3">{sorted.map(policy=><article data-testid="approval-policy-card" key={policy.id} className="sf-card p-4 space-y-2"><div className="flex justify-between gap-2"><h3 className="font-bold">{labelOf(policy.subject)} · {policy.currency==='PERCENT'?'%':policy.currency}</h3><span>{policy.active?'نشطة':'موقوفة'}</span></div><p className="text-xs text-sf-muted">الإصدار {policy.revision}</p><ol className="text-sm list-decimal list-inside">{policy.tiers.map((tier,index)=><li key={index}>{tier.max_value===null?'أعلى من الحدود السابقة':`حتى ${tier.max_value}`} — {roleLabels[tier.required_role]}</li>)}</ol>{canManage&&<button type="button" onClick={()=>edit(policy)} className="sf-secondary">تعديل السياسة</button>}</article>)}{!sorted.length&&<p className="text-sf-muted">لا توجد سياسات اعتماد محفوظة.</p>}</div>
  </section>;
}
