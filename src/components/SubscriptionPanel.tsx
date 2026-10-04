import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../services/businessApi';
import { defaultPlatformPlans, formatLimitLabel } from '../lib/plans';
import type { PlatformPlan, SubscriptionPlan } from '../types';

export const subscriptionLabels: Record<string, string> = { trial: 'تجريبي', trialing: 'تجريبي', active: 'نشط', suspended: 'معلّق', expired: 'منتهٍ', past_due: 'منتهٍ', cancelled: 'ملغي', canceled: 'ملغي' };
export function SubscriptionPanel() {
  const { currentUser, currentOrg, subscription, counters, orgMembers, userRole, updateSubscriptionPlan } = useApp();
  const [plans, setPlans] = useState<PlatformPlan[]>(defaultPlatformPlans), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [platformAdmin, setPlatformAdmin] = useState(false);
  useEffect(() => { let active = true; setPlatformAdmin(false); if (currentUser) void currentUser.getIdTokenResult().then(result => { if (active) setPlatformAdmin(result.claims.superAdmin === true); }).catch(() => {}); return () => { active = false; }; }, [currentUser?.uid]);
  useEffect(() => { let active = true; if (currentUser) void api<PlatformPlan[]>('/plans').then(data => { if (active) setPlans(data); }).catch(() => {}); return () => { active = false; }; }, [currentUser?.uid]);
  if (!currentUser) return <section className="sf-card p-4"><h3 className="sf-heading-3">اشتراك الشركة</h3><p className="text-sf-muted mt-2">وضع الضيف تجربة محلية. حساب الشركة المجاني يشمل 100 فاتورة إجمالاً والمالك مع موظف واحد.</p></section>;
  const plan = subscription.plan_definition || plans.find(item => item.id === (subscription.plan_id || subscription.plan)) || plans[0];
  const period = subscription.invoice_period || (subscription.plan === 'Free' ? 'lifetime' : 'month');
  const used = period === 'lifetime' ? counters.lifetime_invoice_count ?? counters.invoice_count : counters.monthly_invoice_count || 0;
  const max = period === 'lifetime' ? subscription.max_invoices_total ?? 100 : subscription.max_invoices_per_month;
  const usage = [
    ['الفواتير' + (period === 'lifetime' ? ' الإجمالية' : ' هذا الشهر'), used, max],
    ['المستخدمون، شاملاً المالك', orgMembers.length || 1, subscription.max_members],
    ['العملاء', counters.customer_count, subscription.max_customers || plan.limits.maxCustomers],
    ['المنتجات', counters.product_count, subscription.max_products || plan.limits.maxProducts],
  ] as [string, number, number][];
  const requestPlan = async (id: string) => {
    setBusy(true); setMessage(''); setError('');
    try { await updateSubscriptionPlan(id as SubscriptionPlan); setMessage('تم إرسال طلب الترقية لإدارة المنصة. الباقة الحالية مستمرة حتى اعتماد الطلب.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر إرسال الطلب.'); }
    finally { setBusy(false); }
  };
  return <section className="sf-card p-4 space-y-4" aria-label="اشتراك الشركة">
    <div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="sf-heading-3">{plan.name}</h3><p className="text-sm text-sf-muted">{plan.description}</p></div><span className="sf-secondary">{subscriptionLabels[subscription.effective_status || subscription.status]}</span></div>
    <p className="text-sm text-sf-muted">{subscription.subscription_end ? `ينتهي الاشتراك: ${new Date(subscription.subscription_end).toLocaleDateString('ar')}` : plan.id === 'Free' ? 'الباقة المجانية لا تنتهي بمرور الوقت؛ حصتها 100 فاتورة إجمالاً.' : 'اشتراك سابق بلا تاريخ نهاية؛ يُراجع من إدارة المنصة.'}</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{usage.map(([label, count, limit]) => <div className="rounded-xl border border-sf-border p-3" key={label}><div className="flex justify-between gap-2"><span>{label}</span><bdi>{count} / {formatLimitLabel(limit)}</bdi></div><progress className="w-full mt-2 accent-sf-action" max={limit} value={Math.min(count, limit)} /></div>)}</div>
    {used >= max && <p role="status" className="text-sf-warning">اكتملت حصة الفواتير. يمكنك قراءة الفواتير السابقة وتحصيلها، وطلب ترقية لإصدار فواتير جديدة.</p>}
    <p className="text-sm text-sf-muted">المجانية تسمح بالمالك وموظف واحد إضافي. تغيير الباقة والتواريخ يتم بواسطة إدارة المنصة.</p>
    {platformAdmin && <a className="sf-secondary inline-flex" href="/super-admin">فتح إدارة منصة SudaFlow</a>}<h4 className="sf-heading-3">طلب ترقية (للمالك فقط)</h4><div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{plans.filter(item => item.active).map(item => <button type="button" className="sf-secondary p-3 text-right" key={item.id} disabled={busy || item.id === (subscription.plan_id || subscription.plan) || userRole !== 'Owner' || !currentOrg} onClick={() => void requestPlan(item.id)}><b>{item.name}</b><span className="block text-sm text-sf-muted mt-1">{item.price === 0 ? item.id === 'Free' ? 'مجانية' : 'تسعير مخصص' : `${item.price} ${item.currency} / ${item.durationDays} يوم`}</span><span className="block text-sm mt-1">{formatLimitLabel(item.limits.maxInvoices)} فاتورة {item.limits.invoicePeriod === 'lifetime' ? 'إجمالاً' : 'شهرياً'}</span></button>)}</div>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-sf-danger">{error}</p>}
  </section>;
}
