import { useDisplayMoney } from '../context/useDisplayMoney';
import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CreditCard,
  FileText,
  History,
  Printer,
  Receipt,
  Share2,
  UserRound,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Invoice } from '../types';
import { invoicePricingBalance } from '../lib/currency';
import { InvoiceStatus } from './InvoiceStatus';
import { InvoiceShareDialog } from './InvoiceShareDialog';

interface InvoiceWorkspaceViewProps {
  invoice: Invoice;
  onBack: () => void;
  onOpenDocument: (invoice: Invoice) => void;
  onOpenRecordPayment: (invoice: Invoice) => void;
}

type Section = 'overview' | 'payments' | 'accounting' | 'activity';

const paymentMethodLabel = (method: string) => ({
  cash: 'نقدي',
  bankak: 'بنكك',
  fawry: 'فوري',
  bank_transfer: 'تحويل بنكي',
  other: 'أخرى',
}[method] || method);

export const InvoiceWorkspaceView: React.FC<InvoiceWorkspaceViewProps> = ({
  invoice,
  onBack,
  onOpenDocument,
  onOpenRecordPayment,
}) => {
  const { formatMoney, nativeMoney, pair, enabled } = useDisplayMoney();
  const { payments, journalEntries, settings, isActionAllowed } = useApp();
  const [section, setSection] = useState<Section>('overview');
  const [isShareOpen, setIsShareOpen] = useState(false);

  const invoicePayments = useMemo(
    () => payments
      .filter(payment => payment.invoice_id === invoice.id)
      .sort((a, b) => (b.payment_date || b.created_at).localeCompare(a.payment_date || a.created_at)),
    [payments, invoice.id],
  );

  const paymentIds = useMemo(() => new Set(invoicePayments.map(payment => payment.id)), [invoicePayments]);
  const invoiceJournalEntries = useMemo(
    () => journalEntries
      .filter(entry => entry.reference_id === invoice.id || (entry.reference_type === 'payment' && paymentIds.has(entry.reference_id)))
      .sort((a, b) => (b.created_at || b.date).localeCompare(a.created_at || a.date)),
    [journalEntries, invoice.id, paymentIds],
  );

  const activity = useMemo(() => {
    const events: Array<{ id: string; title: string; detail: string; at: string; kind: 'invoice' | 'payment' | 'journal' | 'status' }> = [
      {
        id: `invoice-${invoice.id}`,
        title: 'تم إنشاء الفاتورة',
        detail: `${invoice.invoice_number} · ${invoice.customer_name}`,
        at: invoice.created_at || invoice.issue_date,
        kind: 'invoice',
      },
      ...invoicePayments.map(payment => ({
        id: `payment-${payment.id}`,
        title: 'تم تسجيل دفعة',
        detail: `${formatMoney(payment.amount, payment.currency, { ...settings, currency_rates: payment.currency_rates_used || settings.currency_rates })} · ${paymentMethodLabel(payment.payment_method)}`,
        at: payment.created_at || payment.payment_date,
        kind: 'payment' as const,
      })),
      ...invoiceJournalEntries.map(entry => ({
        id: `journal-${entry.id}`,
        title: 'تم تسجيل قيد محاسبي',
        detail: `${entry.entry_number} · ${entry.description}`,
        at: entry.created_at || entry.date,
        kind: 'journal' as const,
      })),
    ];
    if (invoice.voided_at) {
      events.push({
        id: `void-${invoice.id}`,
        title: 'تم إبطال الفاتورة',
        detail: invoice.void_reason || 'تم إنشاء المعالجة العكسية للفاتورة.',
        at: invoice.voided_at,
        kind: 'status',
      });
    }
    return events.sort((a, b) => Date.parse(b.at || '') - Date.parse(a.at || ''));
  }, [invoice, invoicePayments, invoiceJournalEntries, settings]);

  const canRecordPayment = isActionAllowed('payments:create')
    && !['paid', 'cancelled', 'void', 'draft'].includes(invoice.status)
    && (invoice.remaining_sdg > 0 || invoice.remaining_usd > 0);

  const sections: Array<{ id: Section; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'التفاصيل', icon: FileText },
    { id: 'payments', label: `التحصيلات (${invoicePayments.length})`, icon: Receipt },
    { id: 'accounting', label: `القيود (${invoiceJournalEntries.length})`, icon: BookOpenCheck },
    { id: 'activity', label: 'المسار', icon: History },
  ];

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} className="sf-icon-action" aria-label="العودة إلى الفواتير" title="العودة إلى الفواتير">
            <ArrowRight aria-hidden="true" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="sf-heading-1"><bdi dir="ltr" className="sf-id">{invoice.invoice_number}</bdi></h1>
              <InvoiceStatus status={invoice.status} />
            </div>
            <p className="text-sm text-sf-muted mt-2">مساحة تشغيل الفاتورة: التفاصيل، التحصيلات، القيود، ومسار العملية في مكان واحد.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canRecordPayment && (
            <button type="button" onClick={() => onOpenRecordPayment(invoice)} className="sf-action inline-flex items-center gap-2">
              <CreditCard aria-hidden="true" />
              <span>تسجيل دفعة</span>
            </button>
          )}
          <button type="button" onClick={() => setIsShareOpen(true)} className="sf-secondary inline-flex items-center gap-2">
            <Share2 aria-hidden="true" />
            <span>مشاركة</span>
          </button>
          <button type="button" onClick={() => onOpenDocument(invoice)} className="sf-secondary inline-flex items-center gap-2">
            <Printer aria-hidden="true" />
            <span>معاينة المستند</span>
          </button>
        </div>
      </div>

      {invoice.pricing && <section className="sf-card p-4 space-y-2" aria-label="عملة الفاتورة الأصلية" data-testid="invoice-native-workspace">
        <p className="font-semibold">إجمالي عملة الفاتورة: <bdi dir="ltr" className="sf-number">{nativeMoney(invoice.pricing.total, invoice.pricing.currency)}</bdi></p>
        <p>المتبقي بعملة الفاتورة: <bdi dir="ltr" className="sf-number">{nativeMoney(invoicePricingBalance(invoice), invoice.pricing.currency)}</bdi></p>
        <p className="text-xs text-sf-muted">سعر عملة الفاتورة المجمّد: <bdi dir="ltr">1 USD = {formatMoney(invoice.pricing.units_per_usd, 'USD')} {invoice.pricing.currency}</bdi></p>
      </section>}

      <dl className="sf-grid">
        <div className="sf-card sf-summary-card sf-span-4">
          <dt>إجمالي الفاتورة</dt>
          <dd><bdi dir="ltr" className="sf-number">{enabled ? pair(invoice.grand_total_sdg, invoice.grand_total_usd) : nativeMoney(invoice.grand_total_sdg, 'SDG', settings)}</bdi></dd>
          <small><bdi dir="ltr" className="sf-number">{enabled ? '' : nativeMoney(invoice.grand_total_usd, 'USD', settings)}</bdi></small>
        </div>
        <div className="sf-card sf-summary-card sf-span-4">
          <dt>المحصّل</dt>
          <dd><bdi dir="ltr" className="sf-number">{enabled ? pair(invoice.paid_amount_sdg, invoice.paid_amount_usd) : nativeMoney(invoice.paid_amount_sdg, 'SDG', settings)}</bdi></dd>
          <small><bdi dir="ltr" className="sf-number">{enabled ? '' : nativeMoney(invoice.paid_amount_usd, 'USD', settings)}</bdi></small>
        </div>
        <div className="sf-card sf-summary-card sf-span-4">
          <dt>المتبقي</dt>
          <dd><bdi dir="ltr" className="sf-number">{enabled ? pair(invoice.remaining_sdg, invoice.remaining_usd) : nativeMoney(invoice.remaining_sdg, 'SDG', settings)}</bdi></dd>
          <small><bdi dir="ltr" className="sf-number">{enabled ? '' : nativeMoney(invoice.remaining_usd, 'USD', settings)}</bdi></small>
        </div>
      </dl>

      <div className="sf-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex items-center gap-3">
            <UserRound className="text-sf-muted" aria-hidden="true" />
            <div>
              <p className="text-xs text-sf-muted">العميل</p>
              <p className="font-semibold">{invoice.customer_name}</p>
              {invoice.customer_phone && <bdi dir="ltr" className="text-sm text-sf-muted">{invoice.customer_phone}</bdi>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <CalendarDays className="text-sf-muted" aria-hidden="true" />
            <div>
              <p className="text-xs text-sf-muted">الإصدار / الاستحقاق</p>
              <p className="text-sm"><bdi dir="ltr">{invoice.issue_date}</bdi>{invoice.due_date ? <> · <bdi dir="ltr">{invoice.due_date}</bdi></> : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <CreditCard className="text-sf-muted" aria-hidden="true" />
            <div>
              <p className="text-xs text-sf-muted">سعر الصرف المجمّد</p>
              <p className="text-sm font-mono"><bdi dir="ltr">1 USD = {nativeMoney(invoice.exchange_rate_used, 'SDG', settings)}</bdi></p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="أقسام الفاتورة">
        {sections.map(item => {
          const Icon = item.icon;
          const selected = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSection(item.id)}
              className="sf-filter inline-flex items-center gap-2"
              aria-pressed={selected}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {section === 'overview' && (
        <div className="space-y-4">
          <div className="sf-card sf-table-scroll" role="region" aria-label="بنود الفاتورة" tabIndex={0}>
            <table className="sf-table min-w-[760px]">
              <thead>
                <tr>
                  <th scope="col">الصنف / الوصف</th>
                  <th scope="col" className="sf-value-cell">الكمية</th>
                  <th scope="col" className="sf-value-cell">سعر الوحدة</th>
                  <th scope="col" className="sf-value-cell">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, index) => (
                  <tr key={item.id || index}>
                    <td>
                      <span className="font-semibold">{item.description}</span>
                      <span className="sf-detail">{item.unit}</span>
                    </td>
                    <td className="sf-value-cell"><bdi dir="ltr" className="sf-number">{item.quantity}</bdi></td>
                    <td className="sf-value-cell"><bdi dir="ltr" className="sf-number">{formatMoney(item.unit_price, item.currency, { ...settings, currency_rates: invoice.currency_rates_used || settings.currency_rates })}</bdi></td>
                    <td className="sf-value-cell"><bdi dir="ltr" className="sf-number">{formatMoney(item.line_total, item.currency, { ...settings, currency_rates: invoice.currency_rates_used || settings.currency_rates })}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(invoice.notes || invoice.payment_instructions) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {invoice.notes && <div className="sf-card p-4"><p className="text-xs text-sf-muted mb-2">ملاحظات الفاتورة</p><p className="text-sm whitespace-pre-line">{invoice.notes}</p></div>}
              {invoice.payment_instructions && <div className="sf-card p-4"><p className="text-xs text-sf-muted mb-2">تعليمات الدفع</p><p className="text-sm whitespace-pre-line">{invoice.payment_instructions}</p></div>}
            </div>
          )}
        </div>
      )}

      {section === 'payments' && (
        invoicePayments.length ? (
          <div className="sf-card sf-table-scroll" role="region" aria-label="تحصيلات الفاتورة" tabIndex={0}>
            <table className="sf-table min-w-[720px]">
              <thead><tr><th>التاريخ</th><th>الطريقة</th><th>المرجع</th><th className="sf-value-cell">المبلغ</th></tr></thead>
              <tbody>{invoicePayments.map(payment => (
                <tr key={payment.id}>
                  <td><bdi dir="ltr" className="sf-id">{payment.payment_date}</bdi></td>
                  <td>{paymentMethodLabel(payment.payment_method)}</td>
                  <td><bdi dir="ltr" className="sf-id">{payment.reference_number || '—'}</bdi></td>
                  <td className="sf-value-cell"><bdi dir="ltr" className="sf-number">{formatMoney(payment.amount, payment.currency, { ...settings, currency_rates: payment.currency_rates_used || settings.currency_rates })}</bdi></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="sf-card p-8 text-center"><Receipt className="mx-auto mb-3 text-sf-muted" /><h2 className="sf-heading-2">لا توجد تحصيلات مسجلة</h2><p className="text-sm text-sf-muted mt-2">عند تسجيل أول دفعة ستظهر هنا مع طريقة الدفع والمرجع.</p></div>
      )}

      {section === 'accounting' && (
        !isActionAllowed('journal:read') ? (
          <div className="sf-card p-8 text-center"><BookOpenCheck className="mx-auto mb-3 text-sf-muted" /><p className="text-sm text-sf-muted">عرض القيود المحاسبية غير متاح لصلاحيتك الحالية.</p></div>
        ) : invoiceJournalEntries.length ? (
          <div className="space-y-3">
            {invoiceJournalEntries.map(entry => (
              <div key={entry.id} className="sf-card p-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold"><bdi dir="ltr" className="sf-id">{entry.entry_number}</bdi></p>
                  <p className="text-sm text-sf-muted mt-1">{entry.description}</p>
                </div>
                <div className="text-end">
                  <bdi dir="ltr" className="sf-id text-sm">{entry.date}</bdi>
                  <p className="text-xs text-sf-muted mt-1">{entry.is_balanced ? 'قيد متوازن' : 'يحتاج مراجعة'}</p>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="sf-card p-8 text-center"><BookOpenCheck className="mx-auto mb-3 text-sf-muted" /><p className="text-sm text-sf-muted">لا توجد قيود مرتبطة بهذه الفاتورة ضمن البيانات المحملة.</p></div>
      )}

      {section === 'activity' && (
        <div className="sf-card p-5">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="sf-heading-2">مسار الفاتورة</h2>
              <p className="text-sm text-sf-muted mt-1">تسلسل مستمد من الفاتورة والتحصيلات والقيود المحاسبية المتاحة حالياً.</p>
            </div>
            <History className="text-sf-muted" aria-hidden="true" />
          </div>
          <ol className="space-y-0">
            {activity.map((event, index) => (
              <li key={event.id} className="relative pe-8 pb-6 last:pb-0">
                {index < activity.length - 1 && <span className="absolute end-[9px] top-5 bottom-0 w-px bg-sf-border" aria-hidden="true" />}
                <span className="absolute end-0 top-1 w-5 h-5 rounded-full bg-sf-selected border border-sf-action/40" aria-hidden="true" />
                <p className="font-semibold text-sm">{event.title}</p>
                <p className="text-sm text-sf-muted mt-1">{event.detail}</p>
                <bdi dir="ltr" className="sf-id text-xs text-sf-muted mt-1 inline-block">{event.at}</bdi>
              </li>
            ))}
          </ol>
        </div>
      )}

      {isShareOpen && <InvoiceShareDialog invoice={invoice} onClose={() => setIsShareOpen(false)} />}
    </div>
  );
};
