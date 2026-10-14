import React, { useRef, useState } from 'react';
import type { Invoice } from '../types';
import { useApp } from '../context/AppContext';
import { Dialog } from './Dialog';
import { formatMoney } from '../lib/currency';
import { receivableCurrency } from '../domain/financial';
import { merchantDay } from '../domain/operationalReports';
import { ApprovalDecisionField, approvalRequirement } from './accounting/ApprovalDecisionField';

export function SalesCorrectionModal({ invoice, mode, onClose }: { invoice: Invoice; mode: 'credit' | 'refund'; onClose: () => void }) {
  const { settings, financialAccounts, approvalPolicies, userRole, createCreditNote, refundCustomer } = useApp();
  const [kind, setKind] = useState<'price_credit' | 'sales_return'>('price_credit');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(() => merchantDay(new Date(), settings.timezone || 'Africa/Khartoum'));
  const [reason, setReason] = useState(''), [approvalReason,setApprovalReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState(''), [amount, setAmount] = useState(''), [rate, setRate] = useState(String(invoice.exchange_rate_used));
  const submitting = useRef(false), native = receivableCurrency(invoice);
  const accounts = financialAccounts.filter(account => account.status === 'active');
  const account = accounts.find(account => account.id === accountId);
  const approval = approvalRequirement(approvalPolicies,'customer_refund',(account?.currency||native) as 'SDG'|'USD',Number(amount)||0,userRole);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (mode === 'credit') {
        const lines = invoice.items.filter(item => Number(amounts[item.id]) > 0).map(item => ({ line_id: item.id, ...(kind === 'sales_return' ? { quantity: Number(amounts[item.id]) } : { amount: Number(amounts[item.id]) }) }));
        if (!lines.length) throw new Error('أدخل مبلغ التصحيح أو كمية المردود لبند واحد على الأقل.');
        await createCreditNote({ invoice_id: invoice.id, kind, date, reason, lines });
      } else {
        if(approval&&(!approval.allowed||!approvalReason.trim()))throw new Error(approval.allowed?'اكتب سبب اعتماد رد العميل.':`رد العميل يتطلب اعتماد دور ${approval.tier.required_role}.`);
        await refundCustomer({ invoice_id: invoice.id, date, reason, financial_account_id: accountId, amount: Number(amount), exchange_rate_used: Number(rate),...(approval?{approval_reason:approvalReason.trim()}:{}) });
      }
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر حفظ العملية.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  const label = mode === 'credit' ? 'إشعار دائن ومردود بيع' : 'رد رصيد العميل الدائن';
  const field = 'sf-field w-full min-w-0';
  return <Dialog label={label} onClose={() => { if (!busy) onClose(); }} className="fixed inset-0 z-[70] bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-3">
    <form onSubmit={submit} className="bg-sf-surface border border-sf-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-sf-text">
      <h2 className="text-lg font-semibold">{label} · {invoice.invoice_number}</h2>
      <p className="text-sm text-sf-muted">{mode === 'credit' ? 'تصحيح السعر يخفض الإيراد والضريبة دون حركة بضاعة. المردود الفعلي يستعيد كمية البضاعة وتكلفتها الأصلية، ويخصم قيمة التصحيحات السابقة.' : 'الرد النقدي متاح فقط من الرصيد الدائن الفعلي لهذه الفاتورة بعد التحصيل والإشعارات. اختر الحساب الذي دفع المبلغ للعميل.'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">تاريخ العملية<input aria-label="تاريخ التصحيح أو الرد" type="date" required value={date} onChange={event => setDate(event.target.value)} className={field} /></label>
        {mode === 'credit' && <label className="space-y-1">نوع الإشعار<select aria-label="نوع الإشعار الدائن" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setAmounts({}); }} className={field}><option value="price_credit">تصحيح سعر / خصم</option><option value="sales_return">مردود بضاعة فعلي</option></select></label>}
      </div>
      {mode === 'credit' ? <div className="space-y-3">
        {invoice.items.map((item, i) => <label key={item.id} className="block border border-sf-border rounded-lg p-3 space-y-2">
          <span className="block text-sm">{item.description} · الكمية الأصلية: {item.quantity}</span>
          <span className="block text-sm text-sf-muted">{kind === 'sales_return' ? 'الكمية المرتجعة' : `مبلغ التخفيض (${native})`}</span>
          <input aria-label={kind === 'sales_return' ? `كمية المردود للبند ${i + 1}` : `مبلغ التصحيح للبند ${i + 1}`} type="number" min="0" step={kind === 'sales_return' ? '0.000001' : native === 'USD' ? '0.01' : '1'} disabled={busy || kind === 'sales_return' && item.cost_status !== 'valued'} value={amounts[item.id] || ''} onChange={event => setAmounts(previous => ({ ...previous, [item.id]: event.target.value }))} className={field} />
          {kind === 'sales_return' && item.cost_status !== 'valued' && <span className="block text-sm text-sf-muted">التكلفة الأصلية غير موثقة للمخزون؛ المردود الفعلي يحتاج مراجعة.</span>}
        </label>)}
      </div> : <div className="space-y-3">
        <p>الرصيد الدائن: <bdi dir="ltr">{formatMoney(invoice.credit_balance_sdg || 0, 'SDG', settings)} / {formatMoney(invoice.credit_balance_usd || 0, 'USD', settings)}</bdi></p>
        <label className="block space-y-1">حساب الدفع<select aria-label="حساب الرد النقدي" required value={accountId} onChange={event => setAccountId(event.target.value)} className={field}><option value="">اختر حساباً مالياً</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
        {!accounts.length && <p className="text-sm text-sf-muted">أضف حساباً مالياً في قسم النقد والبنوك قبل الرد.</p>}
        <label className="block space-y-1">مبلغ الرد ({account?.currency || native})<input aria-label="مبلغ الرد النقدي" required type="number" min={account?.currency === 'USD' ? '0.01' : '1'} step={account?.currency === 'USD' ? '0.01' : '1'} value={amount} onChange={event => setAmount(event.target.value)} className={field} /></label>
        <label className="block space-y-1">سعر الصرف عند الدفع<input aria-label="سعر الصرف عند الرد" required type="number" min="0" step="0.00000001" value={rate} onChange={event => setRate(event.target.value)} className={field} /></label>
      </div>}
      <label className="block space-y-1">سبب العملية<textarea aria-label="سبب التصحيح أو الرد" required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className={field} /></label>
      {mode==='refund'&&<ApprovalDecisionField requirement={approval} reason={approvalReason} setReason={setApprovalReason}/>}
      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || mode === 'refund' && (!account || !!approval&&!approval.allowed)} className="sf-action">{busy ? 'جاري الحفظ…' : mode === 'credit' ? 'ترحيل الإشعار الدائن' : 'ترحيل الرد النقدي'}</button><button type="button" disabled={busy} onClick={onClose} className="sf-secondary">إغلاق</button></div>
    </form>
  </Dialog>;
}
