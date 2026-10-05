import { useApp } from '../context/AppContext';
import { invoiceQuotaReached } from '../domain/subscriptions';
export function SubscriptionBanner({ onManage }: { onManage: () => void }) {
  const { currentUser, currentOrg, subscription, counters, memberStatus } = useApp();
  if (!currentUser || !currentOrg || memberStatus === 'unknown') return null;
  const status = subscription.effective_status || subscription.status;
  const inactive = currentOrg.status !== 'active' || !['active', 'trial', 'trialing'].includes(status) || Boolean(subscription.subscription_end && Date.parse(subscription.subscription_end) <= Date.now());
  const reached = invoiceQuotaReached(subscription, counters.lifetime_invoice_count || counters.invoice_count, counters.monthly_invoice_count || 0);
  if (!inactive && !reached) return null;
  const quota = subscription.invoice_period === 'lifetime' ? subscription.max_invoices_total : subscription.max_invoices_per_month;
  return <div role="status" className="no-print border-b border-sf-warning bg-sf-warning-bg text-sf-warning px-4 py-3 flex flex-wrap justify-between items-center gap-3"><span>{inactive ? 'الاشتراك أو الشركة غير نشط. السجلات السابقة محفوظة؛ العمليات المحمية متوقفة حتى التجديد أو إعادة التفعيل.' : `اكتملت حصة الباقة (${quota} فاتورة). اطلب ترقية لإصدار فواتير جديدة.`}</span><button className="sf-secondary" type="button" onClick={onManage}>إدارة الاشتراك وطلب الترقية</button></div>;
}
