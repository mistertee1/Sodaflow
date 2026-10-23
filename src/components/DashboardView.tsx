import { InvoiceStatus } from './InvoiceStatus';
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText,
  Users,
  CreditCard,
  TrendingUp,
  ArrowLeftRight,
  ChevronLeft,
  Clock,
  Eye,
  Plus,
  Receipt,
  MessageCircle,
  AlertOctagon,
  Package,
  AlertTriangle,
  Send,
  Calendar,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import {
  formatMoney,
  convertCurrency,
  getInvoiceStatusInfo,
  safeAdd,
  validateExchangeRate,
} from '../lib/currency';
import { Invoice } from '../types';
import { TopProductsChart } from './TopProductsChart';
import { InventoryAuditModal } from './InventoryAuditModal';
import { AdBanner } from './AdBanner';
import { ErrorBoundary } from './ErrorBoundary';
import { InvoiceShareDialog } from './InvoiceShareDialog';
import { OperationsAttentionPanel } from './OperationsAttentionPanel';

interface DashboardViewProps {
  onOpenNewInvoice: () => void;
  onOpenNewCustomer?: () => void;
  onOpenNewProduct?: () => void;
  onOpenNewExpense?: () => void;
  onViewInvoice: (invoice: Invoice) => void;
  onOpenRecordPayment?: (invoice: Invoice) => void;
  onNavigateToTab?: (tab: any) => void;
  onNavigate?: (tab: any) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onOpenNewInvoice,
  onOpenNewCustomer,
  onOpenNewProduct,
  onOpenNewExpense,
  onViewInvoice,
  onOpenRecordPayment,
  onNavigateToTab,
  onNavigate,
}) => {
  const { invoices, customers, products, settings, updateSettings, counters } = useApp();
  const [isInventoryAuditOpen, setIsInventoryAuditOpen] = useState(false);
  const [shareInvoice, setShareInvoice] = useState<Invoice | null>(null);

  // Manual Exchange Rate quick edit states
  const [rateInput, setRateInput] = useState<string>(settings.default_exchange_rate.toString());
  const [isRateUpdating, setIsRateUpdating] = useState(false);
  const [rateToast, setRateToast] = useState<string | null>(null);

  const handleApplyNewRate = async (newVal: number) => {
    const rateVal = validateExchangeRate(newVal);
    if (!rateVal.isValid) return;
    setIsRateUpdating(true);
    try {
      await updateSettings({ default_exchange_rate: rateVal.rate, manual_exchange_rate: 0 });
      setRateInput(rateVal.rate.toString());
      setRateToast(`تم تحديث سعر الصرف يدوياً إلى: 1$ = ${rateVal.rate.toLocaleString()} ج.س`);
      setTimeout(() => setRateToast(null), 3500);
    } finally {
      setIsRateUpdating(false);
    }
  };

  const handleNavigate = (tab: string) => {
    if (onNavigate) onNavigate(tab);
    if (onNavigateToTab) onNavigateToTab(tab);
  };

  // Quick Currency Calculator State
  const [calcAmount, setCalcAmount] = useState<string>('100');
  const [calcFrom, setCalcFrom] = useState<'USD' | 'SDG'>('USD');

  const currentRate = settings.default_exchange_rate || 0;

  // Monthly Sales Calculations
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const issuedInvoices = invoices.filter(inv => !['cancelled', 'void', 'draft'].includes(inv.status));
  const thisMonthInvoices = issuedInvoices.filter((inv) => {
    if (!inv.issue_date) return false;
    const invDate = new Date(inv.issue_date);
    return (
      invDate.getFullYear() === currentYear &&
      invDate.getMonth() === currentMonth
    );
  });

  const totalSalesSdg = thisMonthInvoices.reduce((acc, inv) => safeAdd(acc, inv.grand_total_sdg || 0, 0), 0);
  const totalSalesUsd = thisMonthInvoices.reduce((acc, inv) => safeAdd(acc, inv.grand_total_usd || 0, 2), 0);

  // Outstanding Balances across all customers
  const totalReceivablesSdg = customers.reduce((acc, c) => safeAdd(acc, c.balance_sdg || 0, 0), 0);
  const totalReceivablesUsd = customers.reduce((acc, c) => safeAdd(acc, c.balance_usd || 0, 2), 0);

  // Unpaid invoices count
  const unpaidInvoices = issuedInvoices.filter(inv => inv.status !== 'paid' && inv.remaining_sdg > 0);

  // OVERDUE INVOICES (Due date passed and status is not paid)
  const todayStr = new Date().toISOString().split('T')[0];
  const overdueInvoices = issuedInvoices.filter((inv) => {
    if (!inv.due_date || inv.status === 'paid' || inv.status === 'cancelled') return false;
    return inv.due_date < todayStr;
  });

  // Calculate total overdue amount
  const totalOverdueSdg = overdueInvoices.reduce((acc, inv) => safeAdd(acc, inv.remaining_sdg || 0, 0), 0);
  const totalOverdueUsd = overdueInvoices.reduce((acc, inv) => safeAdd(acc, inv.remaining_usd || 0, 2), 0);

  // LOW STOCK PRODUCTS
  const lowStockProducts = products.filter(
    (p) =>
      typeof p.stock_quantity === 'number' &&
      typeof p.min_stock_alert === 'number' &&
      p.stock_quantity <= p.min_stock_alert
  );

  // Calculator Result
  const parsedCalcAmount = parseFloat(calcAmount) || 0;
  const convertedCalcResult =
    parsedCalcAmount > 0 && currentRate > 0
      ? (calcFrom === 'USD'
          ? convertCurrency(parsedCalcAmount, 'USD', 'SDG', currentRate, settings)
          : convertCurrency(parsedCalcAmount, 'SDG', 'USD', currentRate, settings))
      : 0;

  // Recent 5 invoices
  const recentInvoices = [...invoices]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6 pb-12">
      {/* Welcome Banner / Overview */}
      <div className="bg-sf-surface text-sf-text rounded-xl p-6 sm:p-8 border border-sf-border relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sf-action/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sf-selected/70 text-sf-action text-xs font-semibold mb-3 border border-sf-action/50">
            <Sparkles className="w-3.5 h-3.5" />
            <span>نظام الفوترة المزدوجة + إدارة المخزون والجرد</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold mb-2 text-sf-text">
            {settings.business_name ? `مرحبًا بك في لوحة تحكم ${settings.business_name}` : 'مرحبًا بك في لوحة تحكم حسابك'}
          </h2>
          <p className="text-xs sm:text-sm text-sf-muted leading-relaxed">
            تابع مبيعاتك، تحصيلاتك، الفواتير المتأخرة، والمخزون المتبقي لحظياً بالعملتين (ج.س والدولار) مع تجميد سعر الصرف لكل فاتورة.
          </p>
        </div>
      </div>

      <OperationsAttentionPanel onNavigate={handleNavigate} onViewInvoice={onViewInvoice} />

      {/* Manual Exchange Rate Control Widget (Requirement: تعديل سعر الصرف يدوياً) */}
      <div className="bg-sf-surface border border-sf-border rounded-xl p-4 sm:p-6 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-sf-border pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sf-action/10 border border-sf-action/30 flex items-center justify-center text-sf-text shrink-0 font-mono font-semibold text-base">
              $
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm text-sf-text">تعديل سعر الصرف المعتمد يدويًا</h3>
                <span className="font-mono font-semibold text-xs px-3 py-1 rounded-full bg-sf-selected/90 text-sf-text border border-sf-action/60">
                  1 $ = {settings.default_exchange_rate.toLocaleString()} ج.س
                </span>
              </div>
              <p className="text-xs text-sf-muted mt-1">
                يمكنك كتابة السعر يدوياً في أي وقت، وسيتم اعتماده للفواتير الجديدة والحسابات فوراً دون المساس بالفواتير السابقة.
              </p>
            </div>
          </div>

          {/* Quick Step Buttons */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => handleApplyNewRate(settings.default_exchange_rate - 50)}
              disabled={isRateUpdating}
              className="px-3 py-1 text-xs font-mono font-semibold rounded-lg bg-sf-raised text-sf-text hover:text-sf-text hover:bg-sf-raised border border-sf-border transition-colors"
              title="إنقاص 50 جنيه"
            >
              -50
            </button>
            <button
              onClick={() => handleApplyNewRate(settings.default_exchange_rate + 50)}
              disabled={isRateUpdating}
              className="px-3 py-1 text-xs font-mono font-semibold rounded-lg bg-sf-raised text-sf-text hover:text-sf-text hover:bg-sf-raised border border-sf-border transition-colors"
              title="زيادة 50 جنيه"
            >
              +50
            </button>
          </div>
        </div>

        {/* Interactive Rate Adjuster Form & Market Presets */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
          {/* Manual Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleApplyNewRate(Number(rateInput));
            }}
            className="flex items-center gap-2 flex-1 max-w-md"
          >
            <div className="relative flex-1">
              <input
                type="number"
                min="0.00000001"
                step="0.00000001"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                placeholder="أدخل السعر يدويًا..."
                className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-sm font-semibold font-mono text-sf-text focus:outline-none focus:border-sf-action shadow-inner"
              />
              <span className="absolute left-3 top-2.5 text-xs text-sf-muted font-sans">
                ج.س / $
              </span>
            </div>

            <button
              type="submit"
              disabled={isRateUpdating || Number(rateInput) === settings.default_exchange_rate}
              className="px-4 py-2 bg-sf-action hover:bg-sf-action-hover disabled:opacity-50 text-sf-on-action font-semibold text-xs rounded-xl shadow-lg shadow-sf-action/20 transition-all  shrink-0"
            >
              {isRateUpdating ? 'جارٍ الحفظ...' : 'تثبيت السعر'}
            </button>
          </form>

          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-sf-muted font-medium">خيارات سريعة:</span>
            {[2600, 2700, 2750, 2800, 2850, 2900, 3000].map((rate) => (
              <button
                key={rate}
                onClick={() => handleApplyNewRate(rate)}
                disabled={isRateUpdating}
                className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg border transition-all ${
                  settings.default_exchange_rate === rate
                    ? 'bg-sf-action text-sf-on-action border-sf-action shadow-sm shadow-sf-action/20'
                    : 'bg-sf-raised text-sf-text border-sf-border hover:border-sf-border'
                }`}
              >
                {rate.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        {/* Confirmation Toast */}
        {rateToast && (
          <div className="bg-sf-selected/80 border border-sf-action/50 text-sf-action text-xs px-3 py-2 rounded-xl flex items-center gap-2 animate-in fade-in">
            <Sparkles className="w-4 h-4 text-sf-action shrink-0" />
            <span>{rateToast}</span>
          </div>
        )}
      </div>

      {/* OVERDUE INVOICES ALERT CARD (Requirement: إظهار الفواتير المتأخرة وزر واتساب) */}
      <div className="bg-sf-surface border border-sf-danger/40 rounded-xl overflow-hidden shadow-lg">
        <div className="p-4 sm:p-6 bg-sf-danger-bg border-b border-sf-danger/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sf-danger-bg/10 border border-sf-danger/30 flex items-center justify-center text-sf-danger shrink-0">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-semibold text-sf-text">
                  الفواتير المتأخرة عن موعد السداد
                </h3>
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-sf-danger-bg text-sf-danger border border-sf-danger/60 font-mono">
                  {overdueInvoices.length} فواتير
                </span>
              </div>
              <p className="text-xs text-sf-muted">
                فواتير تجاوزت تاريخ الاستحقاق ولم تسدد بالكامل - اضغط زر الواتساب لإرسال تذكير فوري للعميل
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-sf-muted">إجمالي المتأخرات:</span>
            <span className="text-sf-danger font-semibold">
              {formatMoney(totalOverdueSdg, 'SDG', settings)}
            </span>
            <span className="text-sf-muted">|</span>
            <span className="text-sf-text font-semibold">
              {formatMoney(totalOverdueUsd, 'USD', settings)}
            </span>
          </div>
        </div>

        {(overdueInvoices || []).length === 0 ? (
          <div className="p-6 text-center text-sf-muted">
            <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-sf-action/10 text-sf-action flex items-center justify-center">
              ✓
            </div>
            <p className="text-xs text-sf-text font-semibold">
              ممتاز! لا توجد فواتير متأخرة السداد حالياً في سجلك.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-sf-border max-h-80 overflow-y-auto custom-scrollbar">
            {(overdueInvoices || []).map((inv) => {
              const daysOverdue = inv.due_date
                ? Math.max(1, Math.floor((new Date().getTime() - new Date(inv.due_date).getTime()) / (1000 * 3600 * 24)))
                : 1;

              return (
                <div
                  key={inv.id}
                  className="p-4 hover:bg-sf-raised transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-xs text-sf-text bg-sf-raised border border-sf-border px-2 py-1 rounded">
                        {inv.invoice_number}
                      </span>
                      <span className="text-xs font-semibold text-sf-danger bg-sf-danger-bg/70 border border-sf-danger/40 px-2 py-1 rounded-full flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        متأخرة منذ {daysOverdue} يوم
                      </span>
                      <span className="text-xs text-sf-muted flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        الاستحقاق: {inv.due_date}
                      </span>
                    </div>

                    <div className="font-semibold text-sm text-sf-text flex items-center gap-2">
                      <span>{inv.customer_name}</span>
                      {inv.customer_phone && (
                        <span className="text-xs text-sf-muted font-mono" dir="ltr">
                          ({inv.customer_phone})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-4">
                    <div className="text-left">
                      <div className="text-xs text-sf-muted">المبلغ المتبقي:</div>
                      <div className="font-mono font-semibold text-sm text-sf-danger">
                        {formatMoney(inv.remaining_sdg, 'SDG', settings)}
                      </div>
                      <div className="font-mono text-xs text-sf-text">
                        {formatMoney(inv.remaining_usd, 'USD', settings)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Quick WhatsApp Reminder Button */}
                      <button
                        onClick={() => setShareInvoice(inv)}
                        className="px-4 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs rounded-xl shadow-lg shadow-sf-action/20 flex items-center gap-2 transition-all "
                        title="إرسال تذكير عبر واتساب مع ملف PDF وتفاصيل السداد"
                      >
                        <MessageCircle className="w-4 h-4 fill-slate-950" />
                        <span>تذكير واتساب</span>
                      </button>

                      {onOpenRecordPayment && (
                        <button
                          onClick={() => onOpenRecordPayment(inv)}
                          className="px-3 py-2 bg-sf-raised hover:bg-sf-raised text-sf-text font-semibold text-xs rounded-xl border border-sf-border transition-colors"
                        >
                          سداد
                        </button>
                      )}

                      <button
                        onClick={() => onViewInvoice(inv)}
                        className="p-2 text-sf-muted hover:text-sf-text bg-sf-raised hover:bg-sf-raised rounded-xl border border-sf-border transition-colors"
                        title="معاينة الفاتورة"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Primary KPI Cards (Dual Currency) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Sales This Month Card */}
        <div className="bg-sf-surface rounded-xl border border-sf-border p-6 shadow-sm flex flex-col justify-between hover:border-sf-action/40 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-sf-muted">إجمالي مبيعات الشهر الحالي</span>
            <div className="p-2 rounded-xl bg-sf-action/10 text-sf-action border border-sf-action/20">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-sf-text font-mono tracking-tight">
              {formatMoney(totalSalesSdg, 'SDG', settings)}
            </div>
            <div className="text-sm font-semibold text-sf-text mt-1 font-mono flex items-center gap-1">
              <span>ما يعادل:</span>
              <span>{formatMoney(totalSalesUsd, 'USD', settings)}</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-sf-border flex items-center justify-between text-xs text-sf-muted">
            <span>عدد فواتير الشهر: {thisMonthInvoices.length}</span>
            <button
              onClick={() => handleNavigate('invoices')}
              className="text-sf-action hover:underline font-semibold inline-flex items-center gap-1"
            >
              عرض الفواتير <ChevronLeft className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Outstanding Balances Card */}
        <div className="bg-sf-surface rounded-xl border border-sf-border p-6 shadow-sm flex flex-col justify-between hover:border-sf-warning/40 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-sf-muted">إجمالي الديون المستحقة على العملاء</span>
            <div className="p-2 rounded-xl bg-sf-warning-bg/10 text-sf-warning border border-sf-warning/20">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-sf-warning font-mono tracking-tight">
              {formatMoney(totalReceivablesSdg, 'SDG', settings)}
            </div>
            <div className="text-sm font-semibold text-sf-text mt-1 font-mono flex items-center gap-1">
              <span>+ مبالغ بالدولار:</span>
              <span className="text-sf-warning font-semibold">{formatMoney(totalReceivablesUsd, 'USD', settings)}</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-sf-border flex items-center justify-between text-xs text-sf-muted">
            <span>على {customers.filter((c) => c.balance_sdg > 0 || c.balance_usd > 0).length} عميل</span>
            <button
              onClick={() => handleNavigate('customers')}
              className="text-sf-warning hover:underline font-semibold inline-flex items-center gap-1"
            >
              كشوف حساب العملاء <ChevronLeft className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Inventory & Low Stock Card */}
        <div className="bg-sf-surface rounded-xl border border-sf-border p-6 shadow-sm flex flex-col justify-between sm:col-span-2 lg:col-span-1 hover:border-sf-action/40 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-sf-muted">مراقبة المخزون والجرد</span>
            <div className="p-2 rounded-xl bg-sf-action/10 text-sf-action border border-sf-action/20">
              <Package className="w-5 h-5" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-sf-text font-mono tracking-tight">
              {counters.product_count > 0 ? counters.product_count : products.length} <span className="text-sm font-normal text-sf-muted">صنف مسجل</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {lowStockProducts.length > 0 ? (
                <span className="text-xs font-semibold text-sf-warning bg-sf-warning-bg/60 border border-sf-warning/40 px-2 py-1 rounded-full flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {lowStockProducts.length} أصناف منخفضة المخزون
                </span>
              ) : (
                <span className="text-xs text-sf-action">المخزون متوازن ومستقر</span>
              )}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-sf-border flex items-center justify-between text-xs text-sf-muted">
            <span>حساب تلقائي للمتبقي</span>
            <button
              onClick={() => setIsInventoryAuditOpen(true)}
              className="text-sf-action hover:underline font-semibold inline-flex items-center gap-1"
            >
              جرد المخزون الآن <ChevronLeft className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Recharts Top 5 Best-Selling Products Chart */}
      <ErrorBoundary fallbackTitle="تحليل المنتجات الأكثر مبيعاً">
        <TopProductsChart
          invoices={invoices || []}
          products={products || []}
          settings={settings}
        />
      </ErrorBoundary>

      {/* Quick Actions Grid */}
      <div>
        <h3 className="text-sm font-semibold text-sf-text mb-3 flex items-center gap-2">
          <span>إجراءات التاجر السريعة</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <button
            onClick={onOpenNewInvoice}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs sm:text-sm shadow-lg shadow-sf-action/20 transition-transform  text-center gap-2"
          >
            <FileText className="w-5 h-5 text-sf-on-action" />
            <span>+ إنشاء فاتورة جديدة</span>
          </button>

          <button
            onClick={() => setIsInventoryAuditOpen(true)}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border hover:border-sf-action/30 font-semibold text-xs sm:text-sm shadow-sm transition-all  text-center gap-2"
          >
            <Package className="w-5 h-5 text-sf-action" />
            <span>جرد المخزون الفعلي</span>
          </button>

          <button
            onClick={onOpenNewCustomer || (() => handleNavigate('customers'))}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border hover:border-sf-border font-semibold text-xs sm:text-sm shadow-sm transition-all  text-center gap-2"
          >
            <Users className="w-5 h-5 text-sf-text" />
            <span>+ إضافة عميل جديد</span>
          </button>

          <button
            onClick={onOpenNewProduct || (() => handleNavigate('products'))}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border hover:border-sf-border font-semibold text-xs sm:text-sm shadow-sm transition-all  text-center gap-2"
          >
            <Plus className="w-5 h-5 text-sf-text" />
            <span>+ إضافة منتج / صنف</span>
          </button>

          <button
            onClick={onOpenNewExpense || (() => handleNavigate('expenses'))}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border hover:border-sf-border font-semibold text-xs sm:text-sm shadow-sm transition-all  text-center gap-2"
          >
            <Receipt className="w-5 h-5 text-sf-warning" />
            <span>+ تسجيل مصروف</span>
          </button>

          <button
            onClick={() => handleNavigate('accounting')}
            className="flex flex-col items-center justify-center p-4 rounded-xl bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border hover:border-sf-action/40 font-semibold text-xs sm:text-sm shadow-sm transition-all  text-center gap-2"
          >
            <BookOpen className="w-5 h-5 text-sf-action" />
            <span>دفتر الحسابات والقيود</span>
          </button>
        </div>
      </div>

      {/* Live Market Exchange Calculator for Sudanese Merchants */}
      <div className="bg-sf-surface border border-sf-border rounded-xl p-4 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sf-warning-bg/10 text-sf-warning border border-sf-warning/20">
              <ArrowLeftRight className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-semibold text-sm text-sf-text">حاسبة تحويل العملات السريعة</h4>
              <p className="text-xs text-sf-muted">
                حساب فوري للمبالغ بسعر السوق المعتمد ({currentRate > 0 ? `1$ = ${formatMoney(currentRate, 'SDG', settings)}` : 'سعر الصرف غير محدد بالإعدادات'})
              </p>
            </div>
          </div>
          <button
            onClick={() => setCalcFrom(calcFrom === 'USD' ? 'SDG' : 'USD')}
            className="text-xs font-semibold px-3 py-1 bg-sf-raised hover:bg-sf-raised text-sf-text rounded-lg border border-sf-border transition-colors flex items-center gap-1"
          >
            <span>عكس التحويل</span>
            <ArrowLeftRight className="w-3 h-3" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          <div className="sm:col-span-5">
            <label className="block text-xs font-medium text-sf-muted mb-1">
              المبلغ المراد تحويله ({calcFrom === 'USD' ? 'دولار أمريكي $' : 'جنيه سوداني ج.س'})
            </label>
            <div className="relative">
              <input
                type="number"
                value={calcAmount}
                onChange={(e) => setCalcAmount(e.target.value)}
                className="w-full bg-sf-raised border border-sf-border rounded-xl px-3 py-2 text-base font-semibold font-mono text-sf-text focus:outline-none focus:border-sf-action"
                placeholder="أدخل المبلغ..."
              />
              <span className="absolute left-3 top-2.5 text-xs text-sf-muted font-sans">
                {calcFrom === 'USD' ? 'USD' : 'SDG'}
              </span>
            </div>
          </div>

          <div className="sm:col-span-2 flex justify-center py-1 sm:py-0">
            <div className="text-sf-muted font-semibold text-lg hidden sm:block">=</div>
          </div>

          <div className="sm:col-span-5 bg-sf-raised border border-sf-border rounded-xl p-3">
            <div className="text-xs font-medium text-sf-muted mb-1">القيمة المقابلة فورًا:</div>
            <div className="text-lg sm:text-xl font-semibold text-sf-text font-mono">
              {calcFrom === 'USD'
                ? formatMoney(convertedCalcResult, 'SDG', settings)
                : formatMoney(convertedCalcResult, 'USD', settings)}
            </div>
          </div>
        </div>
      </div>

      {/* Strategic Non-disruptive AdSense Banner */}
      <AdBanner format="horizontal" label="إعلان ممول / AdSense Dashboard" />

      {/* Recent Invoices Table */}
      <div className="bg-sf-surface rounded-xl border border-sf-border overflow-hidden shadow-sm">
        <div className="p-4 border-b border-sf-border flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm text-sf-text">أحدث الفواتير الصادرة</h3>
            <p className="text-xs text-sf-muted">الفواتير الأخيرة مع العرض المزدوج للمبالغ وسعر الصرف المجمّد</p>
          </div>
          <button
            onClick={() => handleNavigate('invoices')}
            className="text-xs text-sf-action hover:underline font-semibold flex items-center gap-1"
          >
            عرض كافة الفواتير ({counters.invoice_count > 0 ? counters.invoice_count : invoices.length})
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentInvoices.length === 0 ? (
          <div className="p-8 text-center text-sf-muted">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-40 text-sf-muted" />
            <p className="text-sm font-semibold text-sf-text">لا توجد بيانات حتى الآن. أضف أول فاتورة لبدء المتابعة</p>
            <p className="text-xs text-sf-muted mt-1">
              ابدأ بإنشاء أول فاتورة لتتبع المبيعات والمدفوعات ومطابقة المخزون.
            </p>
            <button
              onClick={onOpenNewInvoice}
              className="mt-4 px-4 py-2 bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold text-xs rounded-xl shadow-md shadow-sf-action/20 inline-flex items-center gap-2 transition-all "
            >
              <Plus className="w-4 h-4 text-sf-on-action" />
              <span>+ فاتورة جديدة</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-sf-border">
            {(recentInvoices || []).map((inv) => {
              const statusInfo = getInvoiceStatusInfo(inv.status);
              return (
                <div
                  key={inv.id}
                  className="p-4 hover:bg-sf-raised transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-xs text-sf-text bg-sf-raised px-2 py-1 rounded-md border border-sf-border">
                        {inv.invoice_number}
                      </span>
                      <InvoiceStatus status={inv.status} />
                      <span className="text-xs text-sf-muted">
                        {inv.issue_date}
                      </span>
                    </div>
                    <div className="font-semibold text-sm text-sf-text">
                      {inv.customer_name}
                    </div>
                    <div className="text-xs text-sf-muted">
                      سعر الصرف المجمّد: 1$ = {formatMoney(inv.exchange_rate_used, 'SDG', settings)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4">
                    <div className="text-left">
                      <div className="font-mono font-semibold text-sm text-sf-text">
                        {formatMoney(inv.grand_total_sdg, 'SDG', settings)}
                      </div>
                      <div className="font-mono text-xs text-sf-text font-semibold">
                        {formatMoney(inv.grand_total_usd, 'USD', settings)}
                      </div>
                      {inv.remaining_sdg > 0 && inv.status !== 'paid' && (
                        <div className="text-xs text-sf-danger font-mono font-semibold">
                          متبقي: {formatMoney(inv.remaining_sdg, 'SDG', settings)}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {inv.status !== 'paid' && inv.status !== 'cancelled' && onOpenRecordPayment && (
                        <button
                          onClick={() => onOpenRecordPayment(inv)}
                          title="تسجيل دفعة"
                          className="px-3 py-1 text-xs font-semibold bg-sf-action hover:bg-sf-action-hover text-sf-on-action rounded-lg transition-colors shadow-xs"
                        >
                          تحصيل
                        </button>
                      )}
                      <button
                        onClick={() => onViewInvoice(inv)}
                        title="معاينة وطباعة الفاتورة"
                        className="p-2 text-sf-muted hover:text-sf-text bg-sf-raised hover:bg-sf-raised rounded-lg border border-sf-border transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inventory Audit Modal */}
      {shareInvoice && <InvoiceShareDialog invoice={shareInvoice} reminder onClose={() => setShareInvoice(null)} />}
      <InventoryAuditModal
        isOpen={isInventoryAuditOpen}
        onClose={() => setIsInventoryAuditOpen(false)}
      />
    </div>
  );
};
