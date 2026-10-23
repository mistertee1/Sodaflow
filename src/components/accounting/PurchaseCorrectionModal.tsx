import { useDisplayMoney } from '../../context/useDisplayMoney';
import { CorrectionDocumentDownload } from '../CorrectionDocumentDownload';
import React, { useRef, useState } from 'react';
import { Dialog } from '../Dialog';
import { useApp } from '../../context/AppContext';
import type { Document } from '../../domain/store';
import type { PurchaseBill } from '../../domain/payables';


export function PurchaseCorrectionModal({ bill, mode, onClose }: { bill: PurchaseBill; mode: 'return' | 'refund' | 'history'; onClose: () => void }) {
  const { formatMoney } = useDisplayMoney();
  const { purchaseReturns, supplierRefunds, financialAccounts, settings, returnPurchase, refundSupplier } = useApp();
  const [date, setDate] = useState(new Date().toISOString().slice(0,10)), [reason, setReason] = useState(''), [quantities, setQuantities] = useState<Record<string,number>>({});
  const [accountId, setAccountId] = useState(''), [amount, setAmount] = useState(0), [rate, setRate] = useState(settings.default_exchange_rate), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), notes = purchaseReturns.filter(row=>row.bill_id===bill.id), refunds = supplierRefunds.filter(row=>row.bill_id===bill.id);
  const close = () => { if (!lock.current) onClose(); };
  const title = mode === 'return' ? 'مردود المورد' : mode === 'refund' ? 'استرداد من المورد' : 'سجل تصحيحات المورد';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if(lock.current) return; lock.current=true;setBusy(true);setError('');
    try {
      if(mode==='return') await returnPurchase({bill_id:bill.id,date,reason,lines:bill.items.filter(item=>(quantities[item.id]||0)>0).map(item=>({line_id:item.id,quantity:quantities[item.id]}))});
      else await refundSupplier({bill_id:bill.id,date,reason,financial_account_id:accountId,amount,exchange_rate_used:rate});
      onClose();
    } catch(e) { setError(e instanceof Error?e.message:'تعذر حفظ تصحيح المورد.'); } finally {lock.current=false;setBusy(false);}
  };
  return <Dialog label={title} onClose={close} className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-3"><div className="sf-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 space-y-3" dir="rtl">
    <div className="flex flex-wrap justify-between gap-3"><h3 className="font-bold">{title} — <bdi>{bill.supplier_reference}</bdi></h3><button className="sf-secondary" type="button" disabled={busy} onClick={close}>إغلاق تصحيح المورد</button></div>
    <p>{bill.supplier_name} — المستحق من المورد: <bdi>{formatMoney(bill.advance_balance_sdg||0,'SDG')} / {formatMoney(bill.advance_balance_usd||0,'USD')}</bdi></p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {mode!=='history' && <form onSubmit={submit} className="space-y-3"><fieldset disabled={busy} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3"><label>تاريخ تصحيح المورد<input aria-label="تاريخ تصحيح المورد" type="date" className="sf-field w-full" required value={date} onChange={e=>setDate(e.target.value)} /></label><label>سبب تصحيح المورد<input aria-label="سبب تصحيح المورد" className="sf-field w-full" required value={reason} onChange={e=>setReason(e.target.value)} /></label></div>
      {mode==='return' ? <><p className="text-sf-muted">الرصيد عند المورد من قيمة الفاتورة الأصلية؛ المخزون يخرج بتكلفته الحالية ويُثبت فرق التكلفة.</p>{bill.items.map((item,index)=>{const previous=notes.flatMap(row=>row.lines).filter(line=>line.line_id===item.id).reduce((sum,line)=>sum+line.quantity,0);return <label className="block sf-card p-3" key={item.id}><span className="block">{item.product_name} — البند {index+1} — المتبقي للإرجاع <bdi>{Math.max(0,item.quantity-previous)}</bdi></span><input aria-label={`كمية مردود المورد ${index+1}`} className="sf-field w-full" type="number" min="0" step="any" value={quantities[item.id]||0} onChange={e=>setQuantities(rows=>({...rows,[item.id]:Number(e.target.value)}))} /></label>;})}</> : <div className="grid sm:grid-cols-2 gap-3"><label>حساب الاسترداد<select aria-label="حساب استرداد المورد" className="sf-field w-full" required value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">اختر حساباً نشطاً</option>{financialAccounts.filter(row=>row.status==='active').map(row=><option value={row.id} key={row.id}>{row.name} ({row.currency})</option>)}</select></label><label>مبلغ الاسترداد<input aria-label="مبلغ استرداد المورد" className="sf-field w-full" required type="number" min="0.01" step="any" value={amount} onChange={e=>setAmount(Number(e.target.value))} /></label><label>صرف الاسترداد<input aria-label="صرف استرداد المورد" className="sf-field w-full" type="number" min="0" step="any" value={rate} onChange={e=>setRate(Number(e.target.value))} /></label><p className="text-sf-muted">المبلغ بعملة حساب الاسترداد، مقابل رصيد مصدر مدين مثبت؛ تُحفظ فروق الصرف.</p></div>}
      <button className="sf-action" disabled={busy} type="submit">{busy?'جارٍ الحفظ…':mode==='return'?'ترحيل مردود المورد':'تسجيل استرداد المورد'}</button>
    </fieldset></form>}
    <section aria-label="سجل تصحيحات المورد"><h4 className="font-bold">السجل المحفوظ</h4>{[...notes.map<Document>(row=>({...row,documentKind:'purchase_return',label:'مردود المورد',sdg:row.supplier_credit_sdg,usd:row.supplier_credit_usd})),...refunds.map<Document>(row=>({...row,documentKind:'supplier_refund',label:'استرداد المورد',sdg:row.settled_amount_sdg,usd:row.settled_amount_usd}))].sort((a,b)=>a.source_sequence-b.source_sequence).map(row=><div className="border-t border-sf-border py-2" key={row.id}><p>{row.label}: <bdi>{row.date}</bdi> — <bdi>{formatMoney(row.sdg,'SDG')} / {formatMoney(row.usd,'USD')}</bdi></p><p>{row.reason}</p><CorrectionDocumentDownload kind={row.documentKind} id={row.id} />{row.variance_usd!==undefined && <p>فرق التكلفة: <bdi>{formatMoney(row.variance_sdg,'SDG')} / {formatMoney(row.variance_usd,'USD')}</bdi></p>}</div>)}{!notes.length&&!refunds.length&&<p className="text-sf-muted">لا توجد تصحيحات محفوظة لهذه الفاتورة.</p>}</section>
  </div></Dialog>;
}
