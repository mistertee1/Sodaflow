import { useDisplayMoney } from '../context/useDisplayMoney';
import { productPricingMode } from '../domain/productPricing';
import React, { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';

import { Dialog } from './Dialog';

export function InventoryCostCenter() {
  const { formatMoney } = useDisplayMoney();
  const { products, userRole, currentOrg, settings, establishProductCost, receiveInventory, activateAccountingV2, updateProductStock, isActionAllowed } = useApp();
  const [open, setOpen] = useState(false), [productId, setProductId] = useState(''), [mode, setMode] = useState<'basis' | 'receipt' | 'count'>('basis');
  const [quantity, setQuantity] = useState(1), [unitCost, setUnitCost] = useState(0), [currency, setCurrency] = useState<'SDG' | 'USD'>('SDG'), [rate, setRate] = useState(settings.manual_exchange_rate && settings.manual_exchange_rate > 0 ? settings.manual_exchange_rate : settings.default_exchange_rate || 0), [reason, setReason] = useState(''), [method, setMethod] = useState('cash');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), submitLock = useRef(false);
  const tracked = products.filter(p => p.track_inventory), product = tracked.find(p => p.id === productId), unknown = tracked.filter(p => p.cost_status !== 'valued').length;
  const canAdjust = isActionAllowed('products:stock_adjustment');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (submitLock.current) return;
    submitLock.current = true; setBusy(true); setError('');
    try {
      const cost = { cost_currency: currency, unit_cost: unitCost, exchange_rate_used: rate, zero_cost_reason: reason };
      if (mode === 'basis') await establishProductCost(productId, cost, reason);
      else if (mode === 'receipt') await receiveInventory(productId, quantity, cost, reason, method);
      else await updateProductStock(productId, quantity, reason, cost);
      setOpen(false); setReason('');
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تأكيد العملية.'); }
    finally { setBusy(false); submitLock.current = false; }
  };
  const activate = async () => {
    if (submitLock.current) return; submitLock.current = true; setBusy(true); setError('');
    try { await activateAccountingV2('تأكيد المالك مراجعة تكلفة المخزون والمطابقة قبل التفعيل'); }
    catch (error) { setError(error instanceof Error ? error.message : 'تعذر التفعيل.'); }
    finally { submitLock.current = false; setBusy(false); }
  };
  if (!canAdjust) return null;
  return <section className="space-y-3 bg-sf-surface border border-sf-border rounded-xl p-4">
    <div className="flex flex-wrap gap-3 justify-between items-center">
      <div><h3 className="text-sm font-semibold">تكلفة المخزون والمطابقة</h3><p className="text-xs text-sf-muted">{unknown ? `${unknown} منتج بدون تكلفة موثقة` : 'تكلفة المنتجات المتتبعة موثقة'} — {currentOrg?.accounting_version === 2 ? 'المحاسبة V2 مفعّلة' : 'التفعيل يحتاج مراجعة المالك ومطابقة الدفاتر'}</p></div>
      <button onClick={() => { setMode(userRole === 'Owner' ? 'basis' : 'receipt'); setProductId(''); setOpen(true); setError(''); }} className="bg-sf-action text-sf-on-action rounded-xl px-3 py-2 text-xs">تسجيل تكلفة أو استلام مخزون</button>
      {userRole === 'Owner' && currentOrg?.accounting_version !== 2 && <button disabled={busy || unknown > 0} onClick={activate} className="border border-sf-border rounded-xl px-3 py-2 text-xs disabled:opacity-50">تفعيل المحاسبة V2 بعد المطابقة</button>}
    </div>
    <p className="text-xs text-sf-muted">إثبات التكلفة يخص المخزون الحالي بوثيقة مصدر؛ لا يغير فواتير الماضي. الاستلام النقدي يزيد قيمة المخزون، والجرد يصحح الكمية والقيمة بسبب موثق. الموردون وفواتير الشراء النقدية والآجلة وسداد الذمم متاحة من «الموردون ومنتجاتهم والمشتريات والذمم الدائنة» في هذا القسم.</p>
    {error && !open && <p role="alert" className="text-sf-danger">{error}</p>}
    {open && <Dialog label="تكلفة المخزون" onClose={() => { if (!busy) setOpen(false); }} className="fixed inset-0 z-50 flex items-center justify-center bg-sf-canvas/80 backdrop-blur-sm p-4 overflow-y-auto"><div className="bg-sf-surface rounded-xl p-5 w-full max-w-lg space-y-4 my-auto">
      <h3 id="inventory-cost-title" className="font-semibold">تكلفة المخزون</h3>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs">عملية المخزون<select aria-label="عملية المخزون" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setProductId(''); }} className="block w-full bg-sf-raised border border-sf-border rounded-lg p-2"><option value="basis" disabled={userRole !== 'Owner'}>إثبات تكلفة افتتاحية — للمالك</option><option value="receipt">استلام مخزون بسداد نقدي / بنكي</option><option value="count">تسوية جرد موثقة</option></select></label>
        <label className="block text-xs">منتج التكلفة<select aria-label="منتج التكلفة" required value={productId} onChange={e => setProductId(e.target.value)} className="block w-full bg-sf-raised border border-sf-border rounded-lg p-2"><option value="">اختر المنتج</option>{tracked.filter(p => mode === 'basis' ? p.cost_status !== 'valued' : p.cost_status === 'valued').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {product && <p className="text-xs text-sf-muted">الكمية الحالية: {product.stock_quantity || 0} — {product.cost_status === 'valued' ? `القيمة: ${formatMoney(product.inventory_value_sdg || 0, 'SDG')}` : 'التكلفة غير موثقة'}</p>}
        {mode !== 'basis' && <label className="block text-xs">{mode === 'count' ? 'الكمية الفعلية بعد الجرد' : 'الكمية المستلمة'}<input aria-label="كمية عملية التكلفة" type="number" step="0.000001" min={mode === 'count' ? 0 : .000001} required value={quantity} onChange={e => setQuantity(Number(e.target.value))} className="block w-full bg-sf-raised border border-sf-border rounded-lg p-2" /></label>}
        <label className="block text-xs">تكلفة الوحدة الموثقة<input aria-label="تكلفة الوحدة الموثقة" type="number" step="0.00000001" min="0" required value={unitCost} onChange={e => setUnitCost(Number(e.target.value))} className="block w-full bg-sf-raised border border-sf-border rounded-lg p-2" /></label>
        <label className="block text-xs">عملة التكلفة<select aria-label="عملة التكلفة" value={currency} onChange={e => setCurrency(e.target.value as 'SDG' | 'USD')} className="block w-full bg-sf-raised border border-sf-border rounded-lg p-2"><option value="SDG">جنيه سوداني</option><option value="USD">دولار أمريكي</option></select></label>
        <label className="block text-xs">سعر الصرف الموثق<input aria-label="سعر صرف التكلفة" type="number" step="0.00000001" min={currency === 'USD' || product && productPricingMode(product) === 'usd_cost_plus' ? .00000001 : 0} required value={rate} onChange={e => setRate(Number(e.target.value))} className="block w-full bg-sf-raised border border-sf-border rounded-lg p-2" /></label>
        <p className="text-xs text-sf-muted">سجل سعر الصرف وقت الشراء لتثبيت تكلفة الدولار. سعر البيع يُحسب لاحقاً بسعر صرف الفاتورة الجديدة؛ أصل التكلفة يظل محفوظاً.</p>
        {mode === 'receipt' && <label className="block text-xs">سداد استلام المخزون<select aria-label="سداد استلام المخزون" value={method} onChange={e => setMethod(e.target.value)} className="block w-full bg-sf-raised border border-sf-border rounded-lg p-2"><option value="cash">نقداً</option><option value="bankak">بنكك</option><option value="fawry">فوري</option><option value="bank_transfer">تحويل بنكي</option></select></label>}
        <label className="block text-xs">سبب العملية ومرجع وثيقة التكلفة<input aria-label="سبب العملية ومرجع وثيقة التكلفة" required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className="block w-full bg-sf-raised border border-sf-border rounded-lg p-2" /></label>
        {error && <p role="alert" className="text-xs text-sf-danger">{error}</p>}
        <div className="flex gap-2"><button disabled={busy || !product || mode === 'basis' && userRole !== 'Owner'} type="submit" className="bg-sf-action text-sf-on-action rounded-xl px-3 py-2 text-xs disabled:opacity-50">{busy ? 'جاري تأكيد الحفظ…' : 'حفظ عملية التكلفة'}</button><button type="button" disabled={busy} onClick={() => setOpen(false)} className="border border-sf-border rounded-xl px-3 py-2 text-xs">إغلاق</button></div>
      </form>
    </div></Dialog>}
  </section>;
}
