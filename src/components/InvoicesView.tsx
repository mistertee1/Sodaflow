import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Invoice } from '../types';
import {
  Search,
  Plus,
  Filter,
  Eye,
  CreditCard,
  Share2,
  Calendar,
  XCircle,
  FileText,
  Loader2,
} from 'lucide-react';
import { formatMoney, getInvoiceStatusInfo } from '../lib/currency';

interface InvoicesViewProps {
  onOpenNewInvoice: () => void;
  onViewInvoice: (invoice: Invoice) => void;
  onOpenRecordPayment: (invoice: Invoice) => void;
}

export const InvoicesView: React.FC<InvoicesViewProps> = ({
  onOpenNewInvoice,
  onViewInvoice,
  onOpenRecordPayment,
}) => {
  const {
    invoices,
    voidInvoice,
    settings,
    counters,
    hasMoreInvoices,
    isLoadingMoreInvoices,
    loadMoreInvoices,
  } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const safeInvoices = Array.isArray(invoices) ? invoices : [];

  const filteredInvoices = safeInvoices.filter((inv) => {
    if (!inv) return false;
    const matchesSearch =
      (inv.invoice_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.customer_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.customer_phone && inv.customer_phone.includes(searchTerm));

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'void'
        ? inv.status === 'void' || inv.status === 'cancelled'
        : inv.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleShareWhatsApp = (invoice: Invoice) => {
    const text = `السلام عليكم ورحمة الله،
مرفق تفاصيل الفاتورة رقم: *${invoice.invoice_number}*
العميل: ${invoice.customer_name}
التاريخ: ${invoice.issue_date}

المبلغ الإجمالي:
• بالجنيه السوداني: *${formatMoney(invoice.grand_total_sdg, 'SDG', settings)}*
• بالدولار الأمريكي: *${formatMoney(invoice.grand_total_usd, 'USD', settings)}*
(سعر الصرف المعتمد: 1$ = ${formatMoney(invoice.exchange_rate_used, 'SDG', settings)})

المبلغ المدفوع: ${formatMoney(invoice.paid_amount_sdg, 'SDG', settings)}
المبلغ المتبقي: *${formatMoney(invoice.remaining_sdg, 'SDG', settings)}* (${formatMoney(invoice.remaining_usd, 'USD', settings)})

بيانات الدفع:
${invoice.payment_instructions || settings.bank_details || 'تطبيق بنكك أو كاش'}

شكراً لتعاملكم معنا.
*${settings.business_name}*`;

    const encoded = encodeURIComponent(text);
    const phone = invoice.customer_phone ? invoice.customer_phone.replace(/[^0-9]/g, '') : '';
    const url = phone
      ? `https://api.whatsapp.com/send?phone=${phone.startsWith('249') ? phone : '249' + (phone.startsWith('0') ? phone.slice(1) : phone)}&text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;

    window.open(url, '_blank');
  };

  const handleCancelInvoice = async (inv: Invoice) => {
    const reason = window.prompt(
      `تأكيد إبطال الفاتورة ${inv.invoice_number}؟\nسيتم عكس حركات المخزون وإرجاع الكميات المخصومة وتعديل رصيد العميل تلقائيًا.\nالرجاء إدخال سبب الإلغاء:`,
      'إلغاء بناء على طلب العميل'
    );
    if (reason !== null) {
      await voidInvoice(inv.id, reason || 'إلغاء بناء على طلب المستخدم');
    }
  };

  const statusTabs = [
    { id: 'all', label: 'الكل' },
    { id: 'sent', label: 'مُرسلة' },
    { id: 'partially_paid', label: 'مدفوعة جزئيًا' },
    { id: 'paid', label: 'مدفوعة' },
    { id: 'overdue', label: 'متأخرة' },
    { id: 'void', label: 'مُلغاة / باطلة' },
    { id: 'draft', label: 'مسودة' },
  ];

  return (
    <div className="space-y-5 pb-16">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0c0c0f] p-4 sm:p-5 rounded-2xl border border-[#1e1e24] shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-white">سجل الفواتير</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            إصدار ومتابعة الفواتير بالعرض المزدوج (جنيه سوداني / دولار) مع تجميد سعر الصرف وخصم المخزون
          </p>
        </div>
        <button
          onClick={onOpenNewInvoice}
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-black px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4 text-slate-950" />
          <span>إنشاء فاتورة جديدة</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث برقم الفاتورة أو اسم العميل أو الهاتف..."
            className="w-full bg-[#0c0c0f] border border-[#1e1e24] rounded-xl pr-9 pl-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 shadow-sm"
          />
        </div>

        {/* Status Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          {statusTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`text-xs px-3 py-2 rounded-xl font-medium whitespace-nowrap transition-colors ${
                statusFilter === tab.id
                  ? 'bg-emerald-500 text-slate-950 font-black shadow-lg shadow-emerald-500/20'
                  : 'bg-[#0c0c0f] text-slate-300 hover:text-white hover:bg-[#16161d] border border-[#1e1e24]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Counter & Count Indicator */}
      {safeInvoices.length > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>
            عرض <strong className="text-white font-mono">{filteredInvoices.length}</strong> من إجمالي{' '}
            <strong className="text-white font-mono">{counters.invoice_count > 0 ? counters.invoice_count : safeInvoices.length}</strong> فاتورة مسجلة
          </span>
          {counters.invoice_count > safeInvoices.length && (
            <span className="text-[11px] text-emerald-400">
              (تخزين سحابي مجزأ لتحسين سرعة التحميل)
            </span>
          )}
        </div>
      )}

      {/* Invoices List */}
      {safeInvoices.length === 0 ? (
        <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-12 text-center text-slate-400 shadow-sm">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-40 text-slate-500" />
          <p className="text-base font-bold text-white mb-1">لا توجد بيانات حتى الآن. أضف أول فاتورة لبدء المتابعة</p>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-5">
            أنشئ فواتير البيع بالعملتين (جنيه سوداني ودولار) مع تجميد سعر الصرف وطباعتها ومشاركتها عبر واتساب.
          </p>
          <button
            onClick={onOpenNewInvoice}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-black rounded-xl shadow-lg shadow-emerald-500/20 inline-flex items-center gap-2 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>+ فاتورة جديدة</span>
          </button>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-2xl p-10 text-center text-slate-500 shadow-sm">
          <Filter className="w-10 h-10 mx-auto mb-2 text-slate-600" />
          <p className="text-sm font-medium text-slate-300">لم يتم العثور على أي فواتير مطابقة للبحث</p>
          <button
            onClick={() => {
              setSearchTerm('');
              setStatusFilter('all');
            }}
            className="mt-3 text-xs text-emerald-400 hover:underline font-bold"
          >
            إعادة تعيين الفلاتر
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {(filteredInvoices || []).map((inv) => {
            const statusInfo = getInvoiceStatusInfo(inv.status);
            return (
              <div
                key={inv.id}
                className="bg-[#0c0c0f] border border-[#1e1e24] hover:border-[#2b2b36] rounded-2xl p-4 sm:p-5 shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Invoice Main Info */}
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-xs sm:text-sm text-emerald-400 bg-[#14141a] border border-emerald-500/20 px-2 py-0.5 rounded-md">
                      {inv.invoice_number}
                    </span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full border font-bold ${
                        inv.status === 'paid'
                          ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                          : inv.status === 'overdue'
                          ? 'bg-rose-950/60 text-rose-400 border-rose-800/50'
                          : inv.status === 'partially_paid'
                          ? 'bg-blue-950/60 text-blue-400 border-blue-800/50'
                          : 'bg-[#15151d] text-slate-300 border-[#252530]'
                      }`}
                    >
                      {statusInfo.label}
                    </span>
                    {inv.currency_mode === 'dual' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#14141a] text-slate-300 border border-[#22222c] font-medium">
                        عرض مزدوج
                      </span>
                    )}
                    <span className="text-xs text-slate-400 flex items-center gap-1 mr-auto sm:mr-0">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      {inv.issue_date}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-bold text-base text-white">
                      {inv.customer_name}
                    </h3>
                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3 mt-0.5">
                      {inv.customer_phone && <span>الهاتف: {inv.customer_phone}</span>}
                      <span>•</span>
                      <span className="font-medium text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">
                        سعر الصرف المجمّد: 1$ = {formatMoney(inv.exchange_rate_used, 'SDG', settings)}
                      </span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-400">
                    عدد البنود: {inv.items.length}
                    {inv.due_date && <span className="mr-3 text-slate-300">استحقاق: {inv.due_date}</span>}
                  </div>
                </div>

                {/* Amounts (Dual Display) */}
                <div className="border-t md:border-t-0 md:border-r border-[#1e1e24] pt-3 md:pt-0 md:pr-6 md:pl-2 min-w-[200px] flex flex-col justify-center">
                  <div className="text-xs text-slate-400 mb-0.5">إجمالي الفاتورة:</div>
                  <div className="font-black font-mono text-lg text-white leading-tight">
                    {formatMoney(inv.grand_total_sdg, 'SDG', settings)}
                  </div>
                  <div className="font-bold font-mono text-sm text-emerald-400 leading-tight mt-0.5">
                    {formatMoney(inv.grand_total_usd, 'USD', settings)}
                  </div>

                  {inv.remaining_sdg > 0 && inv.status !== 'paid' && (
                    <div className="mt-2 pt-2 border-t border-[#1e1e24]">
                      <div className="text-[11px] text-slate-400">المتبقي للتحصيل:</div>
                      <div className="font-bold font-mono text-xs text-rose-400">
                        {formatMoney(inv.remaining_sdg, 'SDG', settings)}
                        <span className="text-[10px] text-slate-400 font-sans mr-1">
                          ({formatMoney(inv.remaining_usd, 'USD', settings)})
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap md:flex-col items-center justify-end gap-2 border-t md:border-t-0 border-[#1e1e24] pt-3 md:pt-0">
                  <button
                    onClick={() => onViewInvoice(inv)}
                    className="flex-1 md:flex-none px-3 py-1.5 text-xs font-semibold text-slate-200 bg-[#15151c] hover:bg-[#1e1e26] rounded-xl flex items-center justify-center gap-1.5 border border-[#262633] transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                    <span>معاينة وطباعة</span>
                  </button>

                  {inv.status !== 'paid' && inv.status !== 'cancelled' && inv.status !== 'void' && (
                    <button
                      onClick={() => onOpenRecordPayment(inv)}
                      className="flex-1 md:flex-none px-3 py-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all active:scale-95"
                    >
                      <CreditCard className="w-3.5 h-3.5 text-slate-950" />
                      <span>تسجيل دفعة</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleShareWhatsApp(inv)}
                    className="p-2 text-xs font-medium text-emerald-400 bg-emerald-950/60 hover:bg-emerald-950 border border-emerald-700/40 rounded-xl flex items-center justify-center transition-colors"
                    title="مشاركة الفاتورة عبر واتساب"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>

                  {inv.status !== 'cancelled' && inv.status !== 'void' && inv.status !== 'paid' && (
                    <button
                      onClick={() => handleCancelInvoice(inv)}
                      title="إبطال وإلغاء الفاتورة مع استرجاع المخزون"
                      className="p-2 text-slate-500 hover:text-rose-400 rounded-xl transition-colors hover:bg-rose-950/30"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Load More */}
      {hasMoreInvoices && (
        <div className="pt-2 flex justify-center">
          <button
            onClick={loadMoreInvoices}
            disabled={isLoadingMoreInvoices}
            className="px-6 py-2.5 bg-[#15151c] hover:bg-[#1e1e26] border border-[#262633] text-emerald-400 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            {isLoadingMoreInvoices ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                <span>جاري تحميل المزيد من الفواتير...</span>
              </>
            ) : (
              <span>تحميل المزيد من الفواتير السابقة</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
