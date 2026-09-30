import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Payment } from '../types';
import { BrandLogo } from './BrandLogo';
import { X, Printer, Share2, Building2, CheckCircle2, Receipt, Download, Loader2 } from 'lucide-react';
import { formatMoney, getPaymentMethodLabel } from '../lib/currency';
import { downloadReceiptPdf } from '../services/pdfService';

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
    <div className="fixed inset-0 z-50 bg-[#050505]/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0c0c0f] rounded-2xl shadow-2xl border border-[#1e1e24] max-w-lg w-full my-auto animate-in fade-in zoom-in-95 text-slate-100">
        {/* Actions Bar */}
        <div className="no-print p-4 border-b border-[#1e1e24] bg-[#121216] rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-sm text-white">سند قبض مالي (إيصال استلام)</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="px-3 py-1.5 text-xs font-semibold bg-[#181820] hover:bg-[#22222d] text-slate-200 border border-[#262634] rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50"
            >
              {isExportingPdf ? (
                <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>{isExportingPdf ? 'جاري التحميل...' : 'تحميل PDF'}</span>
            </button>
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 text-xs font-semibold bg-[#181820] hover:bg-[#22222d] text-slate-200 border border-[#262634] rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              <Printer className="w-3.5 h-3.5 text-emerald-400" />
              <span>طباعة</span>
            </button>
            <button
              onClick={handleShareWhatsApp}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>واتساب</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1a1a24] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Receipt Paper */}
        <div id="printable-receipt" className="p-6 sm:p-8 space-y-5 text-xs sm:text-sm text-slate-100 bg-[#0c0c0f]">
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-[#1e1e24] pb-4">
            <div className="flex items-center gap-3">
              {settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg' ? (
                <div className="w-11 h-11 rounded-xl bg-white p-1 flex items-center justify-center shadow-xs border border-slate-200 shrink-0">
                  <img
                    src={settings.logo_url}
                    alt="Store Logo"
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <BrandLogo size="sm" />
              )}
              <div>
                <h2 className="text-base font-black text-white">{settings.business_name}</h2>
                <p className="text-xs text-slate-400">{settings.phone}</p>
                {settings.address && <p className="text-xs text-slate-400">{settings.address}</p>}
              </div>
            </div>
            <div className="text-left">
              <span className="inline-block bg-emerald-500/10 text-emerald-400 font-bold text-xs px-2.5 py-1 rounded border border-emerald-500/20">
                سند قبض نقدية
              </span>
              <p className="text-[11px] font-mono text-slate-400 mt-1">
                التاريخ: {payment.payment_date.split('T')[0]}
              </p>
            </div>
          </div>

          {/* Receipt Body */}
          <div className="space-y-3 bg-[#121216] p-4 rounded-xl border border-[#1e1e24]">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">وصلنا من السيد / السادة:</span>
              <span className="font-bold text-white text-sm">{payment.customer_name}</span>
            </div>

            <div className="flex items-center justify-between border-t border-[#1e1e24] pt-2">
              <span className="text-slate-400">المبلغ المستلم:</span>
              <div className="text-left font-mono">
                <span className="font-black text-base text-emerald-400">
                  {formatMoney(payment.amount, payment.currency, settings)}
                </span>
                <span className="text-xs text-slate-400 block font-normal">
                  ما يعادل: {formatMoney(
                    payment.amount_in_other_currency,
                    payment.currency === 'SDG' ? 'USD' : 'SDG',
                    settings
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#1e1e24] pt-2">
              <span className="text-slate-400">وذلك سداداً عن:</span>
              <span className="font-bold font-mono text-white">فاتورة #{payment.invoice_number}</span>
            </div>

            <div className="flex items-center justify-between border-t border-[#1e1e24] pt-2">
              <span className="text-slate-400">طريقة الدفع:</span>
              <span className="font-semibold text-slate-200">
                {getPaymentMethodLabel(payment.payment_method)}
              </span>
            </div>

            {payment.reference_number && (
              <div className="flex items-center justify-between border-t border-[#1e1e24] pt-2">
                <span className="text-slate-400">رقم الإشعار / العملية:</span>
                <span className="font-mono font-bold text-emerald-400">{payment.reference_number}</span>
              </div>
            )}

            {payment.notes && (
              <div className="border-t border-[#1e1e24] pt-2 text-slate-300">
                <span className="block text-[11px] text-slate-400 mb-0.5">ملاحظات:</span>
                <p>{payment.notes}</p>
              </div>
            )}
          </div>

          {/* Signature / Approval */}
          <div className="pt-6 border-t border-[#1e1e24] grid grid-cols-2 text-center text-xs text-slate-400">
            <div>
              <p className="mb-6 font-semibold text-slate-300">توقيع المستلم</p>
              <div className="w-28 border-b border-slate-600 mx-auto"></div>
            </div>
            <div>
              <p className="mb-6 font-semibold text-slate-300">ختم المحل</p>
              <div className="w-28 border-b border-slate-600 mx-auto"></div>
            </div>
          </div>

          {/* Watermark note */}
          <div className="pt-3 border-t border-[#1e1e24]/60 flex items-center justify-between text-[10px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#c59b48]"></span>
              <span>سند رسمي مسجل عبر منظومة «حِسَابُك» للفوترة</span>
            </span>
            <span className="font-mono text-slate-400">Hisabuk Cloud</span>
          </div>
        </div>
      </div>
    </div>
  );
};
