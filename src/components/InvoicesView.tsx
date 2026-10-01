import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Invoice } from '../types';
import { InvoiceStatus } from './InvoiceStatus';
import {
  Search,
  Plus,
  Filter,
  Eye,
  CreditCard,
  Share2,
  Undo2,
  FileText,
  Loader2,
} from 'lucide-react';
import { formatMoney, safeAdd } from '../lib/currency';

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
    isActionAllowed,
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
    { id: 'sent', label: 'مرسلة' },
    { id: 'partially_paid', label: 'مسددة جزئياً' },
    { id: 'paid', label: 'مسددة' },
    { id: 'overdue', label: 'متأخرة' },
    { id: 'draft', label: 'مسودة' },
    { id: 'cancelled', label: 'ملغاة' },
    { id: 'void', label: 'مبطلة' },
  ];
  const issuedInvoices = safeInvoices.filter(invoice => !['draft', 'cancelled', 'void'].includes(invoice.status));
  const sum = (field: 'grand_total_sdg' | 'paid_amount_sdg' | 'remaining_sdg') =>
    issuedInvoices.reduce((total, invoice) => safeAdd(total, invoice[field] || 0, settings.sdg_decimals, settings.rounding_rule), 0);
  const summaries = [
    { label: 'إجمالي الفواتير', value: sum('grand_total_sdg') },
    { label: 'المحصّل من الفواتير', value: sum('paid_amount_sdg') },
    { label: 'المتبقي للتحصيل', value: sum('remaining_sdg') },
  ];
  const canCreate = isActionAllowed('invoices:create');
  const permissionMessage = 'لا تملك صلاحية تعديل هذا السجل. تواصل مع مسؤول المؤسسة.';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="sf-heading-1">الفواتير</h1>
          <p className="text-sm text-sf-muted mt-2">إصدار الفواتير، متابعة التحصيل، وعرض الجنيه السوداني والدولار.</p>
        </div>
        <button type="button" onClick={onOpenNewInvoice} disabled={!canCreate} title={!canCreate ? permissionMessage : undefined} className="sf-action inline-flex items-center gap-2">
          <Plus aria-hidden="true" />
          <span>فاتورة جديدة</span>
        </button>
      </div>

      <section aria-label="ملخص الفواتير الصادرة" className="space-y-3">
        <p className="text-xs text-sf-muted">
          {hasMoreInvoices ? 'السجلات المحمّلة' : 'جميع السجلات'} · {issuedInvoices.length} فاتورة صادرة · القيم بالجنيه السوداني (SDG)
        </p>
        <dl className="sf-grid">
          {summaries.map(summary => <div key={summary.label} className="sf-card sf-summary-card sf-span-4">
            <dt>{summary.label}</dt>
            <dd><bdi dir="ltr" className="font-mono">{formatMoney(summary.value, 'SDG', settings)}</bdi></dd>
          </div>)}
        </dl>
      </section>

      <div className="space-y-4">
        <div className="relative">
          <Search aria-hidden="true" className="absolute start-3 top-3 text-sf-muted" />
          <input aria-label="البحث في الفواتير" type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="رقم الفاتورة، اسم العميل أو الهاتف" className="w-full bg-sf-surface border ps-12 pe-4 py-2 text-sf-text" />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية الفواتير حسب الحالة">
          {statusTabs.map(tab => <button key={tab.id} type="button" onClick={() => setStatusFilter(tab.id)} aria-pressed={statusFilter === tab.id} className="sf-filter">{tab.label}</button>)}
        </div>
      </div>

      {safeInvoices.length === 0 ? (
        <div className="sf-card p-8 text-center">
          <FileText aria-hidden="true" className="mx-auto mb-4 text-sf-muted" />
          <h2 className="sf-heading-2">ابدأ بأول فاتورة</h2>
          <p className="text-sm text-sf-muted mt-2">فواتير البيع باسم متجرك، مع سعر الصرف المستخدم والمحصّل والمتبقي.</p>
          <button type="button" onClick={onOpenNewInvoice} disabled={!canCreate} title={!canCreate ? permissionMessage : undefined} className="sf-action inline-flex items-center gap-2 mt-6"><Plus aria-hidden="true" />فاتورة جديدة</button>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="sf-card p-8 text-center">
          <Filter aria-hidden="true" className="mx-auto mb-4 text-sf-muted" />
          <p>لا توجد فواتير مطابقة للبحث.</p>
          <button type="button" onClick={() => { setSearchTerm(''); setStatusFilter('all'); }} className="sf-secondary mt-4">إعادة تعيين الفلاتر</button>
        </div>
      ) : (
        <div className="sf-card sf-table-scroll" role="region" aria-label="جدول الفواتير، قابل للتمرير أفقياً" tabIndex={0}>
          <table className="sf-table min-w-[880px]">
            <caption>عرض {filteredInvoices.length} من {safeInvoices.length} فاتورة محمّلة{counters.invoice_count > safeInvoices.length ? ` · إجمالي السجلات: ${counters.invoice_count}` : ''}</caption>
            <thead><tr>
              <th scope="col">رقم الفاتورة</th><th scope="col">العميل</th>
              <th scope="col" className="sf-value-cell">الإجمالي</th><th scope="col" className="sf-value-cell">المتبقي</th>
              <th scope="col">الحالة</th><th scope="col">الإجراءات</th>
            </tr></thead>
            <tbody>{filteredInvoices.map(invoice => <tr key={invoice.id}>
              <td>
                <button type="button" onClick={() => onViewInvoice(invoice)} aria-label={`فتح الفاتورة ${invoice.invoice_number}`} className="sf-record-link"><bdi dir="ltr" className="sf-id">{invoice.invoice_number}</bdi></button>
                <bdi dir="ltr" className="sf-detail sf-id">{invoice.issue_date}</bdi>
              </td>
              <td>
                <span>{invoice.customer_name}</span>
                {invoice.customer_phone && <bdi dir="ltr" className="sf-detail">{invoice.customer_phone}</bdi>}
                <span className="sf-detail">سعر الصرف المستخدم: <bdi dir="ltr" className="sf-number">1 USD = {formatMoney(invoice.exchange_rate_used, 'SDG', settings)}</bdi></span>
              </td>
              <td className="sf-value-cell">
                <bdi dir="ltr" className="sf-number">{formatMoney(invoice.grand_total_sdg, 'SDG', settings)}</bdi>
                <small className="block text-sf-muted"><bdi dir="ltr" className="sf-number">{formatMoney(invoice.grand_total_usd, 'USD', settings)}</bdi></small>
              </td>
              <td className="sf-value-cell">
                <bdi dir="ltr" className="sf-number">{formatMoney(invoice.remaining_sdg, 'SDG', settings)}</bdi>
                <small className="block text-sf-muted"><bdi dir="ltr" className="sf-number">{formatMoney(invoice.remaining_usd, 'USD', settings)}</bdi></small>
              </td>
              <td><InvoiceStatus status={invoice.status} /></td>
              <td><div className="sf-table-actions">
                <button type="button" onClick={() => onViewInvoice(invoice)} className="sf-icon-action" aria-label={`معاينة وطباعة ${invoice.invoice_number}`} title="معاينة وطباعة"><Eye aria-hidden="true" /></button>
                {!['paid', 'cancelled', 'void', 'draft'].includes(invoice.status) && <button type="button" onClick={() => onOpenRecordPayment(invoice)} className="sf-icon-action" disabled={!isActionAllowed('payments:create')} aria-label={`تسجيل دفعة للفاتورة ${invoice.invoice_number}`} title={isActionAllowed('payments:create') ? 'تسجيل دفعة' : permissionMessage}><CreditCard aria-hidden="true" /></button>}
                <button type="button" onClick={() => handleShareWhatsApp(invoice)} className="sf-icon-action" aria-label={`مشاركة ${invoice.invoice_number} عبر واتساب`} title="مشاركة عبر واتساب"><Share2 aria-hidden="true" /></button>
                {!['paid', 'cancelled', 'void', 'draft'].includes(invoice.status) && <button type="button" onClick={() => void handleCancelInvoice(invoice)} className="sf-icon-action sf-danger-action" disabled={!isActionAllowed('invoices:void')} aria-label={`إبطال الفاتورة ${invoice.invoice_number}`} title={isActionAllowed('invoices:void') ? 'إبطال الفاتورة' : permissionMessage}><Undo2 aria-hidden="true" /></button>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {hasMoreInvoices && <div className="flex justify-center">
        <button type="button" onClick={loadMoreInvoices} disabled={isLoadingMoreInvoices} className="sf-secondary inline-flex items-center gap-2">
          {isLoadingMoreInvoices && <Loader2 aria-hidden="true" className="animate-spin" />}
          {isLoadingMoreInvoices ? 'جارٍ تحميل الفواتير…' : 'تحميل المزيد من الفواتير'}
        </button>
      </div>}
    </div>
  );
};
