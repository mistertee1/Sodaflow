import React,{useEffect,useState} from 'react';
import { useApp } from '../../context/AppContext';
import type { Operations } from '../../domain/operations';

type Report=Awaited<ReturnType<Operations['ownerFinancialSummary']>>;
const money=(value:number)=>new Intl.NumberFormat('ar',{maximumFractionDigits:2}).format(value);
export function OwnerFinancialSummaryCenter(){
  const {currentOrg,currentUser,userRole,loadOwnerFinancialSummary}=useApp(),[asOf,setAsOf]=useState(new Date().toISOString().slice(0,10)),[report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const load=async()=>{setLoading(true);setError('');try{setReport(await loadOwnerFinancialSummary(asOf));}catch(e){setReport(null);setError(e instanceof Error?e.message:'تعذر تحميل ملخص المالك.');}finally{setLoading(false);}};
  useEffect(()=>{setReport(null);setError('');if(userRole==='Owner')void load();},[currentOrg?.id,currentUser?.uid,userRole]);
  if(userRole!=='Owner')return <section role="region" aria-label="ملخص المالك المالي" className="sf-card p-4"><p>هذا الملخص متاح لمالك المؤسسة الفعلي فقط.</p></section>;
  return <section role="region" aria-label="ملخص المالك المالي" className="space-y-4">
    <form aria-label="تحديث ملخص المالك" className="sf-card p-4 flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();void load();}}><label className="text-sm">حتى تاريخ<input aria-label="تاريخ ملخص المالك" type="date" value={asOf} onChange={e=>setAsOf(e.target.value)} className="sf-input mt-1 block" /></label><button className="sf-btn-primary" disabled={loading}>{loading?'جارٍ التحميل…':'تحديث الملخص'}</button></form>
    {error&&<div role="alert" className="sf-card p-4 text-sf-danger">{error}</div>}
    {report&&<><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{[
      ['الإيرادات',report.financials.revenue_sdg,report.financials.revenue_usd],['المصروفات',report.financials.expenses_sdg,report.financials.expenses_usd],['صافي الربح',report.financials.net_profit_sdg,report.financials.net_profit_usd],['النقد',report.financials.cash_sdg,report.financials.cash_usd],['ذمم العملاء',report.financials.receivables_sdg,report.financials.receivables_usd],['ذمم الموردين',report.financials.payables_sdg,report.financials.payables_usd],['الأصول',report.financials.assets_sdg,report.financials.assets_usd],['الالتزامات',report.financials.liabilities_sdg,report.financials.liabilities_usd]
    ].map(([label,sdg,usd])=><article key={String(label)} className="sf-card p-4"><h3 className="text-sm text-sf-muted">{label}</h3><p className="font-semibold">{money(Number(sdg))} SDG</p><p>{money(Number(usd))} USD</p></article>)}</div>
    <section aria-label="تذكيرات المالك" className="sf-card p-4 overflow-auto"><h3 className="font-semibold mb-3">تذكيرات المراجعة خلال 30 يوماً</h3><p className="text-xs text-sf-muted mb-3">قرائية فقط؛ لا ينشئ النظام مصروفاً أو قيداً تلقائياً.</p><table className="w-full whitespace-nowrap text-right"><thead><tr><th>التاريخ</th><th>النوع</th><th>التذكير</th><th>SDG</th><th>USD</th><th>الحالة</th></tr></thead><tbody>{report.reminders.length===0?<tr><td colSpan={6} className="p-4">لا توجد تذكيرات داخل النطاق.</td></tr>:report.reminders.map(row=><tr key={row.id}><td>{row.due_date}</td><td>{row.kind==='recurring_expense'?'مصروف دوري':'مسودة قيد إهلاك'}</td><td>{row.title}</td><td>{money(row.amount_sdg)}</td><td>{money(row.amount_usd)}</td><td>{row.due_date<report.as_of?'متأخر':'للمراجعة'}</td></tr>)}</tbody></table></section></>}
  </section>;
}
