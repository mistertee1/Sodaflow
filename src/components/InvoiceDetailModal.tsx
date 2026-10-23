import { CorrectionDocumentDownload } from './CorrectionDocumentDownload';
import { InvoiceStatus } from './InvoiceStatus';
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Invoice } from '../types';
import {
  X,
  Printer,
  Share2,
  CreditCard,
  Building2,
  Calendar,
  Lock,
  Receipt,
  FileCheck,
  Download,
  Loader2,
} from 'lucide-react';
import { formatMoney, invoicePricingBalance, getInvoiceStatusInfo, getPaymentMethodLabel } from '../lib/currency';
import { downloadInvoicePdf, printInvoiceThroughIsolatedIframe } from '../services/pdfService';
import { Dialog } from './Dialog';
import { DocumentWatermark } from './DocumentWatermark';
import { SalesCorrectionModal } from './SalesCorrectionModal';
import { InvoiceShareDialog } from './InvoiceShareDialog';

interface InvoiceDetailModalProps {
  invoice: Invoice | null;
  onClose: () => void;
  onOpenRecordPayment: (invoice: Invoice) => void;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  invoice,
  onClose,
  onOpenRecordPayment,
}) => {
  const { settings, payments, invoices: liveInvoices, currentOrg, creditNotes, customerRefunds, isActionAllowed } = useApp();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [correction, setCorrection] = useState<'credit' | 'refund' | null>(null);
  invoice = liveInvoices.find(row => row.id === invoice?.id) || invoice;

  if (!invoice) return null;

  const statusInfo = getInvoiceStatusInfo(invoice.status);
  const invoicePayments = payments.filter((p) => p.invoice_id === invoice.id);

  const handlePrint = async () => {
    try {
      await printInvoiceThroughIsolatedIframe(invoice, settings, invoicePayments);
    } catch (e) {
      console.error('Error printing through isolated frame, falling back to window.print():', e);
      window.print();
    }
  };

  const handleDownloadPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      await downloadInvoicePdf(invoice, settings, invoicePayments);
    } catch (e) {
      console.error('Error generating PDF:', e);
      alert('حدث خطأ أثناء إنشاء ملف PDF، يمكنك استخدام زر الطباعة كبديل.');
    } finally {
      setIsExportingPdf(false);
    }
  };


  return (
    <>
    <Dialog label="معاينة الفاتورة" onClose={onClose} className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-sf-surface rounded-xl shadow-2xl border border-sf-border max-w-3xl w-full my-auto max-h-[95vh] flex flex-col animate-in fade-in zoom-in-95 text-sf-text">
        {/* Actions Bar (Screen Only) */}
        <div className="no-print p-4 border-b border-sf-border bg-sf-raised rounded-t-2xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-sm bg-sf-raised border border-sf-border px-3 py-1 rounded-md text-sf-text shadow-2xs">
              {invoice.invoice_number}
            </span>
            <InvoiceStatus status={invoice.status} />
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="px-3 py-2 text-xs font-semibold bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border rounded-lg flex items-center gap-2 transition-colors shadow-2xs disabled:opacity-50"
            >
              {isExportingPdf ? (
                <Loader2 className="w-3.5 h-3.5 text-sf-action animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 text-sf-action" />
              )}
              <span>{isExportingPdf ? 'جاري التحميل...' : 'تحميل PDF'}</span>
            </button>

            <button
              onClick={handlePrint}
              className="px-3 py-2 text-xs font-semibold bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border rounded-lg flex items-center gap-2 transition-colors shadow-2xs"
            >
              <Printer className="w-3.5 h-3.5 text-sf-action" />
              <span>طباعة</span>
            </button>

            <button
              onClick={() => setIsShareOpen(true)}
              className="px-3 py-2 text-xs font-semibold bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-xs"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>مشاركة واتساب</span>
            </button>

            {currentOrg?.accounting_version === 2 && isActionAllowed('journal:create') && !['void','cancelled','draft'].includes(invoice.status) && <>
              <button type="button" onClick={() => setCorrection('credit')} className="sf-secondary">إشعار دائن / مردود</button>
              {(invoice.credit_balance_sdg || invoice.credit_balance_usd || 0) > 0 && <button type="button" onClick={() => setCorrection('refund')} className="sf-secondary">رد نقدي للعميل</button>}
            </>}
            {isActionAllowed('payments:create') && !['paid', 'cancelled', 'void', 'draft'].includes(invoice.status) && (
              <button
                onClick={() => {
                  onClose();
                  onOpenRecordPayment(invoice);
                }}
                className="px-3 py-2 text-xs font-semibold bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-xs"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>تسجيل دفعة</span>
              </button>
            )}

            <button aria-label="إغلاق النافذة"
              onClick={onClose}
              className="p-2 text-sf-muted hover:text-sf-text hover:bg-sf-raised rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {(invoice.correction_count || customerRefunds.some(row => row.invoice_id === invoice.id)) ? <section aria-label="تصحيحات الفاتورة" className="no-print p-4 border-b border-sf-border bg-sf-raised text-sm space-y-2">
          <p>الرصيد الدائن القابل للرد: <bdi dir="ltr">{formatMoney(invoice.credit_balance_sdg || 0, 'SDG', settings)} / {formatMoney(invoice.credit_balance_usd || 0, 'USD', settings)}</bdi></p>
          {creditNotes.filter(row => row.invoice_id === invoice.id).sort((a,b) => a.source_sequence-b.source_sequence).map(row => <p key={row.id}>{row.kind === 'sales_return' ? 'مردود بضاعة' : 'إشعار تصحيح سعر'} · <bdi dir="ltr">{row.date}</bdi> · <bdi dir="ltr">{formatMoney(row.credit_sdg, 'SDG', settings)} / {formatMoney(row.credit_usd, 'USD', settings)}</bdi> · {row.reason} <CorrectionDocumentDownload kind="credit_note" id={row.id} /></p>)}
          {customerRefunds.filter(row => row.invoice_id === invoice.id).sort((a,b) => a.source_sequence-b.source_sequence).map(row => <p key={row.id}>رد نقدي · <bdi dir="ltr">{row.date}</bdi> · <bdi dir="ltr">{formatMoney(row.amount, row.currency, settings)}</bdi> · {row.reason} <CorrectionDocumentDownload kind="customer_refund" id={row.id} /></p>)}
        </section> : null}
        {/* Printable Invoice Container */}
        <div id="printable-invoice" className="sf-document-paper p-6 sm:p-8 overflow-y-auto space-y-6 flex-1 text-sf-text bg-sf-surface">
          <DocumentWatermark />
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-sf-border pb-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                {settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg' ? (
                  <div className="w-12 h-12 rounded-xl bg-white p-1 flex items-center justify-center shadow-xs border border-sf-border shrink-0">
                    <img
                      src={settings.logo_url}
                      alt="Store Logo"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  null
                )}
                <h1 className="text-xl font-semibold text-sf-text">{settings.business_name}</h1>
              </div>
              <p className="text-xs text-sf-muted leading-relaxed">
                {settings.address && <span>{settings.address} • </span>}
                <span>هاتف: {settings.phone}</span>
              </p>
              {settings.bank_details && (
                <p className="text-xs text-sf-text mt-1 font-mono">{settings.bank_details}</p>
              )}
            </div>

            <div className="sm:text-left">
              <div className="text-xs font-semibold uppercase tracking-wider text-sf-muted mb-1">
                فاتورة مبيعات
              </div>
              <div className="font-mono text-lg font-semibold text-sf-text">
                {invoice.invoice_number}
              </div>
              <div className="text-xs text-sf-muted mt-1 space-y-1">
                <div>تاريخ الإصدار: {invoice.issue_date}</div>
                {invoice.due_date && <div>تاريخ الاستحقاق: {invoice.due_date}</div>}
              </div>
            </div>
          </div>

          {/* Customer & Frozen Rate Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-sf-raised p-4 rounded-xl border border-sf-border">
            <div>
              <span className="text-xs font-semibold text-sf-muted block mb-1">فاتورة إلى:</span>
              <h2 className="text-sm font-semibold text-sf-text">{invoice.customer_name}</h2>
              {invoice.customer_phone && (
                <div className="text-xs text-sf-text mt-1">الهاتف: {invoice.customer_phone}</div>
              )}
              {invoice.customer_address && (
                <div className="text-xs text-sf-muted mt-1">العنوان: {invoice.customer_address}</div>
              )}
            </div>

            <div className="sm:text-left flex flex-col justify-center">
              <div className="sf-frozen-rate inline-flex items-center sm:justify-end gap-2 text-xs font-semibold px-3 py-1 rounded-lg border">
                <Lock className="w-3.5 h-3.5" />
                <span>
                  سعر الصرف المجمّد: <bdi dir="ltr">1 USD = {formatMoney(invoice.exchange_rate_used, 'SDG', settings)}</bdi>
                </span>
              </div>
              <span className="text-xs text-sf-muted mt-1 sm:text-left">
                تم تجميد هذا السعر وقت إصدار الفاتورة لحماية دقة الحسابات
              </span>
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-sf-border bg-sf-raised text-sf-text font-semibold">
                  <th className="py-3 px-3">#</th>
                  <th className="py-3 px-3">الوصف / الصنف</th>
                  <th className="py-3 px-3 text-center">الكمية</th>
                  <th className="py-3 px-3 text-center">سعر الوحدة</th>
                  <th className="py-3 px-3 text-left">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sf-border">
                {invoice.items.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-sf-raised/50">
                    <td className="py-3 px-3 text-sf-muted font-mono">{idx + 1}</td>
                    <td className="py-3 px-3 font-semibold text-sf-text">{item.description}</td>
                    <td className="py-3 px-3 text-center font-mono text-sf-text">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-sf-text">
                      {formatMoney(item.unit_price, item.currency, settings)}
                    </td>
                    <td className="py-3 px-3 text-left font-mono font-semibold text-sf-text">
                      {formatMoney(item.line_total, item.currency, settings)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Section (Dual Display) */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 pt-2">
            <div className="sm:col-span-6 space-y-2 text-xs">
              {invoice.notes && (
                <div className="p-3 bg-sf-raised rounded-lg border border-sf-border">
                  <span className="font-semibold text-sf-text block mb-1">ملاحظات:</span>
                  <p className="text-sf-muted whitespace-pre-line">{invoice.notes}</p>
                </div>
              )}
              {invoice.payment_instructions && (
                <div className="p-3 bg-sf-selected/30 rounded-lg border border-sf-action/40 text-sf-text">
                  <span className="font-semibold text-sf-action block mb-1">طريقة وسند الدفع:</span>
                  <p className="font-mono text-xs text-sf-text">{invoice.payment_instructions}</p>
                </div>
              )}
            </div>

            <div className="sm:col-span-6 space-y-2 bg-sf-raised p-4 rounded-xl border border-sf-border text-xs">
              <div className="flex items-center justify-between text-sf-text">
                <span>المجموع الفرعي:</span>
                <span className="font-mono font-semibold text-sf-text">
                  {formatMoney(invoice.subtotal_sdg, 'SDG', settings)}
                </span>
              </div>

              {invoice.discount_total_sdg > 0 && (
                <div className="flex items-center justify-between text-sf-danger">
                  <span>الخصم الممنوح:</span>
                  <span className="font-mono font-semibold">
                    - {formatMoney(invoice.discount_total_sdg, 'SDG', settings)}
                  </span>
                </div>
              )}

              {invoice.tax_total_sdg > 0 && (
                <div className="flex items-center justify-between text-sf-text">
                  <span>الضريبة:</span>
                  <span className="font-mono font-semibold text-sf-text">
                    + {formatMoney(invoice.tax_total_sdg, 'SDG', settings)}
                  </span>
                </div>
              )}

              {invoice.pricing && <div className="space-y-1 p-3 bg-sf-action/10 rounded-lg" data-testid="invoice-native-summary">
                <p>إجمالي عملة الفاتورة: <bdi dir="ltr">{formatMoney(invoice.pricing.total, invoice.pricing.currency)}</bdi></p>
                <p>المتبقي بعملة الفاتورة: <bdi dir="ltr">{formatMoney(invoicePricingBalance(invoice), invoice.pricing.currency)}</bdi></p>
                <p className="text-xs" dir="ltr">1 USD = {invoice.pricing.units_per_usd} {invoice.pricing.currency}</p>
              </div>}
              {/* Dual Grand Total Highlight Box */}
              <div className="pt-2 border-t-2 border-sf-border">
                <span className="text-xs font-semibold text-sf-text block mb-1">
                  المبلغ الإجمالي النهائي (بالعملتين):
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-lg text-sf-text">
                    {formatMoney(invoice.grand_total_sdg, 'SDG', settings)}
                  </span>
                  <span className="font-mono font-semibold text-base text-sf-text bg-sf-action/10 px-2 py-1 rounded border border-sf-action/20">
                    {formatMoney(invoice.grand_total_usd, 'USD', settings)}
                  </span>
                </div>
              </div>

              {/* Payments & Remaining */}
              <div className="pt-2 border-t border-sf-border text-xs space-y-1">
                <div className="flex items-center justify-between text-sf-action">
                  <span>المبلغ المسدد:</span>
                  <span className="font-mono font-semibold">
                    {formatMoney(invoice.paid_amount_sdg, 'SDG', settings)} ({formatMoney(invoice.paid_amount_usd, 'USD', settings)})
                  </span>
                </div>
                <div className="flex items-center justify-between text-sf-danger font-semibold">
                  <span>المتبقي المطلوب سداده:</span>
                  <span className="font-mono text-sm">
                    {formatMoney(invoice.remaining_sdg, 'SDG', settings)} ({formatMoney(invoice.remaining_usd, 'USD', settings)})
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment History Table (If any payments recorded) */}
          {invoicePayments.length > 0 && (
            <div className="pt-4 border-t border-sf-border">
              <h4 className="font-semibold text-xs text-sf-text mb-2 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-sf-action" />
                <span>سجل الدفعات المستلمة على هذه الفاتورة ({invoicePayments.length})</span>
              </h4>
              <div className="border border-sf-border rounded-lg overflow-hidden text-xs bg-sf-raised">
                <table className="w-full text-right">
                  <thead className="bg-sf-raised text-sf-text font-medium">
                    <tr>
                      <th className="p-2">التاريخ</th>
                      <th className="p-2">طريقة الدفع</th>
                      <th className="p-2">رقم الإشعار</th>
                      <th className="p-2 text-left">المبلغ المستلم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {invoicePayments.map((p) => (
                      <tr key={p.id}>
                        <td className="p-2 font-mono text-sf-muted">
                          {p.payment_date.split('T')[0]}
                        </td>
                        <td className="p-2 text-sf-text">{getPaymentMethodLabel(p.payment_method)}</td>
                        <td className="p-2 font-mono text-sf-muted">{p.reference_number || '-'}</td>
                        <td className="p-2 text-left font-mono font-semibold text-sf-text">
                          {formatMoney(p.amount, p.currency, settings)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Signature / Footer for Print */}
          <div className="pt-8 border-t border-sf-border grid grid-cols-2 text-center text-xs text-sf-muted">
            <div>
              <p className="mb-8 font-semibold text-sf-text">توقيع المستلم / العميل</p>
              <div className="w-32 border-b border-sf-border mx-auto"></div>
            </div>
            <div>
              <p className="mb-8 font-semibold text-sf-text">الختم والتوقيع المعتمد</p>
              <div className="w-32 border-b border-sf-border mx-auto"></div>
            </div>
          </div>

          {/* System watermark / powered by SudaFlow */}
          <div className="pt-4 border-t border-sf-border/60 flex items-center justify-between text-xs text-sf-muted">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sf-action"></span>
              <span>تم إنشاء هذه الوثيقة عبر سودافلو</span>
            </span>
            <span className="font-mono text-sf-muted">SudaFlow Cloud</span>
          </div>
        </div>
      </div>
      {isShareOpen && <InvoiceShareDialog invoice={invoice} onClose={() => setIsShareOpen(false)} />}
    </Dialog>
    {correction && <SalesCorrectionModal invoice={invoice} mode={correction} onClose={() => setCorrection(null)} />}
    </>
  );
};

