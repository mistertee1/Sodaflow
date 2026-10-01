import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Payment } from '../types';
import { X, Printer, Share2, Building2, CheckCircle2, Receipt, Download, Loader2 } from 'lucide-react';
import { formatMoney, getPaymentMethodLabel } from '../lib/currency';
import { downloadReceiptPdf } from '../services/pdfService';
import { Dialog } from './Dialog';

interface PaymentReceiptModalProps {
  payment: Payment | null;
  onClose: () => void;
}

export const PaymentReceiptModal: React.FC<PaymentReceiptModalProps> = ({ payment, onClose }) => {
  const { settings } = useApp();
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  if (!payment) return null;

  const handlePrint = async () => {
    try {
      if (document.fonts) {
        await document.fonts.ready;
      }
      const images = document.querySelectorAll('#printable-receipt img');
      await Promise.all(
        Array.from(images).map(
          (img) =>
            (img as HTMLImageElement).complete
              ? Promise.resolve()
              : new Promise((res) => {
                  (img as HTMLImageElement).onload = res;
                  (img as HTMLImageElement).onerror = res;
                })
        )
      );
    } catch {
      // ignore
    }
    window.print();
  };

  const handleDownloadPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      await downloadReceiptPdf(payment, settings);
    } catch (e) {
      console.error('Error downloading receipt PDF:', e);
      alert('حدث خطأ أثناء تحميل إيصال السداد، يمكنك استخدام زر الطباعة.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleShareWhatsApp = () => {
    const text = `*سند قبض واستلام نقدية*
رقم الإيصال: *${payment.id}*
التاريخ: ${payment.payment_date.split('T')[0]}

وصلنا من العميل: *${payment.customer_name}*
مبلغ وقدره: *${formatMoney(payment.amount, payment.currency, settings)}*
(ما يعادل: ${formatMoney(
      payment.amount_in_other_currency,
      payment.currency === 'SDG' ? 'USD' : 'SDG',
      settings
    )})

سدادًا عن الفاتورة رقم: *${payment.invoice_number}*
طريقة السداد: ${getPaymentMethodLabel(payment.payment_method)}
${payment.reference_number ? `رقم العملية: ${payment.reference_number}` : ''}

شكراً لتعاملكم معنا.
*${settings.business_name}*`;

    const encoded = encodeURIComponent(text);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  };

  return (
    <Dialog label="سند قبض مالي" onClose={onClose} className="fixed inset-0 z-50 bg-sf-canvas/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-sf-surface rounded-xl shadow-2xl border border-sf-border max-w-lg w-full my-auto animate-in fade-in zoom-in-95 text-sf-text">
        {/* Actions Bar */}
        <div className="no-print p-4 border-b border-sf-border bg-sf-raised rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-sf-action" />
            <h3 className="font-semibold text-sm text-sf-text">سند قبض مالي (إيصال استلام)</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="px-3 py-2 text-xs font-semibold bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border rounded-lg flex items-center gap-2 shadow-2xs transition-colors disabled:opacity-50"
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
              className="px-3 py-2 text-xs font-semibold bg-sf-raised hover:bg-sf-raised text-sf-text border border-sf-border rounded-lg flex items-center gap-2 shadow-2xs transition-colors"
            >
              <Printer className="w-3.5 h-3.5 text-sf-action" />
              <span>طباعة</span>
            </button>
            <button
              onClick={handleShareWhatsApp}
              className="px-3 py-2 text-xs font-semibold bg-sf-action hover:bg-sf-action-hover text-sf-on-action font-semibold rounded-lg flex items-center gap-2 shadow-2xs transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>واتساب</span>
            </button>
            <button aria-label="إغلاق النافذة"
              onClick={onClose}
              className="p-1 rounded-md text-sf-muted hover:text-sf-text hover:bg-sf-raised transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Receipt Paper */}
        <div id="printable-receipt" className="p-6 sm:p-8 space-y-6 text-xs sm:text-sm text-sf-text bg-sf-surface">
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-sf-border pb-4">
            <div className="flex items-center gap-3">
              {settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg' ? (
                <div className="w-11 h-11 rounded-xl bg-white p-1 flex items-center justify-center shadow-xs border border-sf-border shrink-0">
                  <img
                    src={settings.logo_url}
                    alt="Store Logo"
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                null
              )}
              <div>
                <h2 className="text-base font-semibold text-sf-text">{settings.business_name}</h2>
                <p className="text-xs text-sf-muted">{settings.phone}</p>
                {settings.address && <p className="text-xs text-sf-muted">{settings.address}</p>}
              </div>
            </div>
            <div className="text-left">
              <span className="inline-block bg-sf-action/10 text-sf-action font-semibold text-xs px-3 py-1 rounded border border-sf-action/20">
                سند قبض نقدية
              </span>
              <p className="text-xs font-mono text-sf-muted mt-1">
                التاريخ: {payment.payment_date.split('T')[0]}
              </p>
            </div>
          </div>

          {/* Receipt Body */}
          <div className="space-y-3 bg-sf-raised p-4 rounded-xl border border-sf-border">
            <div className="flex items-center justify-between">
              <span className="text-sf-muted">وصلنا من السيد / السادة:</span>
              <span className="font-semibold text-sf-text text-sm">{payment.customer_name}</span>
            </div>

            <div className="flex items-center justify-between border-t border-sf-border pt-2">
              <span className="text-sf-muted">المبلغ المستلم:</span>
              <div className="text-left font-mono">
                <span className="font-semibold text-base text-sf-action">
                  {formatMoney(payment.amount, payment.currency, settings)}
                </span>
                <span className="text-xs text-sf-muted block font-normal">
                  ما يعادل: {formatMoney(
                    payment.amount_in_other_currency,
                    payment.currency === 'SDG' ? 'USD' : 'SDG',
                    settings
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-sf-border pt-2">
              <span className="text-sf-muted">وذلك سداداً عن:</span>
              <span className="font-semibold font-mono text-sf-text">فاتورة #{payment.invoice_number}</span>
            </div>

            <div className="flex items-center justify-between border-t border-sf-border pt-2">
              <span className="text-sf-muted">طريقة الدفع:</span>
              <span className="font-semibold text-sf-text">
                {getPaymentMethodLabel(payment.payment_method)}
              </span>
            </div>

            {payment.reference_number && (
              <div className="flex items-center justify-between border-t border-sf-border pt-2">
                <span className="text-sf-muted">رقم الإشعار / العملية:</span>
                <span className="font-mono font-semibold text-sf-text">{payment.reference_number}</span>
              </div>
            )}

            {payment.notes && (
              <div className="border-t border-sf-border pt-2 text-sf-text">
                <span className="block text-xs text-sf-muted mb-1">ملاحظات:</span>
                <p>{payment.notes}</p>
              </div>
            )}
          </div>

          {/* Signature / Approval */}
          <div className="pt-6 border-t border-sf-border grid grid-cols-2 text-center text-xs text-sf-muted">
            <div>
              <p className="mb-6 font-semibold text-sf-text">توقيع المستلم</p>
              <div className="w-28 border-b border-sf-border mx-auto"></div>
            </div>
            <div>
              <p className="mb-6 font-semibold text-sf-text">ختم المحل</p>
              <div className="w-28 border-b border-sf-border mx-auto"></div>
            </div>
          </div>

          {/* Watermark note */}
          <div className="pt-3 border-t border-sf-border/60 flex items-center justify-between text-xs text-sf-muted">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sf-action"></span>
              <span>تم إنشاء هذه الوثيقة عبر سودافلو</span>
            </span>
            <span className="font-mono text-sf-muted">SudaFlow</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
