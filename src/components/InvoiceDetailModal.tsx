import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Invoice } from '../types';
import { BrandLogo } from './BrandLogo';
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
import { formatMoney, getInvoiceStatusInfo, getPaymentMethodLabel } from '../lib/currency';
import { downloadInvoicePdf, printInvoiceThroughIsolatedIframe } from '../services/pdfService';

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
  const { settings, payments } = useApp();
  const [isExportingPdf, setIsExportingPdf] = useState(false);

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

  const handleShareWhatsApp = () => {
    const text = `السلام عليكم ورحمة الله،
مرفق تفاصيل الفاتورة رقم: *${invoice.invoice_number}*
العميل: ${invoice.customer_name}
التاريخ: ${invoice.issue_date}

المبلغ الإجمالي:
• بالجنيه السوداني: *${formatMoney(invoice.grand_total_sdg, 'SDG', settings)}*
• بالدولار الأمريكي: *${formatMoney(invoice.grand_total_usd, 'USD', settings)}*
(سعر الصرف المجمّد: 1$ = ${formatMoney(invoice.exchange_rate_used, 'SDG', settings)})

المبلغ المسدد: ${formatMoney(invoice.paid_amount_sdg, 'SDG', settings)}
المبلغ المتبقي: *${formatMoney(invoice.remaining_sdg, 'SDG', settings)}* (${formatMoney(invoice.remaining_usd, 'USD', settings)})

بيانات السداد:
${invoice.payment_instructions || settings.bank_details || 'تطبيق بنكك أو كاش'}

شكراً لتعاملكم مع:
*${settings.business_name}*
هاتف: ${settings.phone}`;

    const encoded = encodeURIComponent(text);
    const phone = invoice.customer_phone ? invoice.customer_phone.replace(/[^0-9]/g, '') : '';
    const url = phone
      ? `https://api.whatsapp.com/send?phone=${phone.startsWith('249') ? phone : '249' + (phone.startsWith('0') ? phone.slice(1) : phone)}&text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;

    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#050505]/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#0c0c0f] rounded-2xl shadow-2xl border border-[#1e1e24] max-w-3xl w-full my-auto max-h-[95vh] flex flex-col animate-in fade-in zoom-in-95 text-slate-100">
        {/* Actions Bar (Screen Only) */}
        <div className="no-print p-4 border-b border-[#1e1e24] bg-[#121216] rounded-t-2xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm bg-[#181820] border border-[#262634] px-2.5 py-1 rounded-md text-emerald-400 shadow-2xs">
              {invoice.invoice_number}
            </span>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${statusInfo.bg} ${statusInfo.color}`}
            >
              {statusInfo.label}
            </span>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="px-3 py-1.5 text-xs font-semibold bg-[#181820] hover:bg-[#22222d] text-slate-200 border border-[#262634] rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50"
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
              className="px-3 py-1.5 text-xs font-semibold bg-[#181820] hover:bg-[#22222d] text-slate-200 border border-[#262634] rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <Printer className="w-3.5 h-3.5 text-emerald-400" />
              <span>طباعة</span>
            </button>

            <button
              onClick={handleShareWhatsApp}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>مشاركة واتساب</span>
            </button>

            {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
              <button
                onClick={() => {
                  onClose();
                  onOpenRecordPayment(invoice);
                }}
                className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>تسجيل دفعة</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-[#1a1a24] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Container */}
        <div id="printable-invoice" className="p-6 sm:p-8 overflow-y-auto space-y-6 flex-1 text-slate-100 bg-[#0c0c0f]">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#1e1e24] pb-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                {settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg' ? (
                  <div className="w-12 h-12 rounded-xl bg-white p-1 flex items-center justify-center shadow-xs border border-slate-200 shrink-0">
                    <img
                      src={settings.logo_url}
                      alt="Store Logo"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <BrandLogo size="md" />
                )}
                <h1 className="text-xl font-black text-white">{settings.business_name}</h1>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {settings.address && <span>{settings.address} • </span>}
                <span>هاتف: {settings.phone}</span>
              </p>
              {settings.bank_details && (
                <p className="text-xs text-emerald-400 mt-1 font-mono">{settings.bank_details}</p>
              )}
            </div>

            <div className="sm:text-left">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                فاتورة ضريبية / مبيعات
              </div>
              <div className="font-mono text-lg font-black text-emerald-400">
                {invoice.invoice_number}
              </div>
              <div className="text-xs text-slate-400 mt-1 space-y-0.5">
                <div>تاريخ الإصدار: {invoice.issue_date}</div>
                {invoice.due_date && <div>تاريخ الاستحقاق: {invoice.due_date}</div>}
              </div>
            </div>
          </div>

          {/* Customer & Frozen Rate Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#121216] p-4 rounded-xl border border-[#1e1e24]">
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block mb-1">فاتورة إلى:</span>
              <h2 className="text-sm font-bold text-white">{invoice.customer_name}</h2>
              {invoice.customer_phone && (
                <div className="text-xs text-slate-300 mt-0.5">الهاتف: {invoice.customer_phone}</div>
              )}
              {invoice.customer_address && (
                <div className="text-xs text-slate-400 mt-0.5">العنوان: {invoice.customer_address}</div>
              )}
            </div>

            <div className="sm:text-left flex flex-col justify-center">
              <div className="inline-flex items-center sm:justify-end gap-1.5 text-xs text-emerald-400 font-bold bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  سعر الصرف المجمّد: 1$ = {formatMoney(invoice.exchange_rate_used, 'SDG', settings)}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 sm:text-left">
                تم تجميد هذا السعر وقت إصدار الفاتورة لحماية دقة الحسابات
              </span>
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-[#1e1e24] bg-[#121216] text-slate-300 font-bold">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">الوصف / الصنف</th>
                  <th className="py-2.5 px-3 text-center">الكمية</th>
                  <th className="py-2.5 px-3 text-center">سعر الوحدة</th>
                  <th className="py-2.5 px-3 text-left">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e1e24]">
                {invoice.items.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-[#121216]/50">
                    <td className="py-2.5 px-3 text-slate-500 font-mono">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-white">{item.description}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-300">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-300">
                      {formatMoney(item.unit_price, item.currency, settings)}
                    </td>
                    <td className="py-2.5 px-3 text-left font-mono font-bold text-emerald-400">
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
                <div className="p-3 bg-[#121216] rounded-lg border border-[#1e1e24]">
                  <span className="font-semibold text-slate-300 block mb-0.5">ملاحظات:</span>
                  <p className="text-slate-400 whitespace-pre-line">{invoice.notes}</p>
                </div>
              )}
              {invoice.payment_instructions && (
                <div className="p-3 bg-emerald-950/30 rounded-lg border border-emerald-800/40 text-slate-200">
                  <span className="font-semibold text-emerald-400 block mb-0.5">طريقة وسند الدفع:</span>
                  <p className="font-mono text-xs text-slate-300">{invoice.payment_instructions}</p>
                </div>
              )}
            </div>

            <div className="sm:col-span-6 space-y-2 bg-[#121216] p-4 rounded-xl border border-[#1e1e24] text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span>المجموع الفرعي:</span>
                <span className="font-mono font-bold text-white">
                  {formatMoney(invoice.subtotal_sdg, 'SDG', settings)}
                </span>
              </div>

              {invoice.discount_total_sdg > 0 && (
                <div className="flex items-center justify-between text-rose-400">
                  <span>الخصم الممنوح:</span>
                  <span className="font-mono font-semibold">
                    - {formatMoney(invoice.discount_total_sdg, 'SDG', settings)}
                  </span>
                </div>
              )}

              {invoice.tax_total_sdg > 0 && (
                <div className="flex items-center justify-between text-slate-300">
                  <span>الضريبة:</span>
                  <span className="font-mono font-semibold text-white">
                    + {formatMoney(invoice.tax_total_sdg, 'SDG', settings)}
                  </span>
                </div>
              )}

              {/* Dual Grand Total Highlight Box */}
              <div className="pt-2 border-t-2 border-[#22222d]">
                <span className="text-[11px] font-bold text-slate-300 block mb-1">
                  المبلغ الإجمالي النهائي (بالعملتين):
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono font-black text-lg text-white">
                    {formatMoney(invoice.grand_total_sdg, 'SDG', settings)}
                  </span>
                  <span className="font-mono font-bold text-base text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    {formatMoney(invoice.grand_total_usd, 'USD', settings)}
                  </span>
                </div>
              </div>

              {/* Payments & Remaining */}
              <div className="pt-2 border-t border-[#22222d] text-xs space-y-1">
                <div className="flex items-center justify-between text-emerald-400">
                  <span>المبلغ المسدد:</span>
                  <span className="font-mono font-bold">
                    {formatMoney(invoice.paid_amount_sdg, 'SDG', settings)} ({formatMoney(invoice.paid_amount_usd, 'USD', settings)})
                  </span>
                </div>
                <div className="flex items-center justify-between text-rose-400 font-bold">
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
            <div className="pt-4 border-t border-[#1e1e24]">
              <h4 className="font-bold text-xs text-white mb-2 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-emerald-400" />
                <span>سجل الدفعات المستلمة على هذه الفاتورة ({invoicePayments.length})</span>
              </h4>
              <div className="border border-[#1e1e24] rounded-lg overflow-hidden text-xs bg-[#121216]">
                <table className="w-full text-right">
                  <thead className="bg-[#15151c] text-slate-300 font-medium">
                    <tr>
                      <th className="p-2">التاريخ</th>
                      <th className="p-2">طريقة الدفع</th>
                      <th className="p-2">رقم الإشعار</th>
                      <th className="p-2 text-left">المبلغ المستلم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e1e24]">
                    {invoicePayments.map((p) => (
                      <tr key={p.id}>
                        <td className="p-2 font-mono text-slate-400">
                          {p.payment_date.split('T')[0]}
                        </td>
                        <td className="p-2 text-slate-200">{getPaymentMethodLabel(p.payment_method)}</td>
                        <td className="p-2 font-mono text-slate-400">{p.reference_number || '-'}</td>
                        <td className="p-2 text-left font-mono font-bold text-emerald-400">
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
          <div className="pt-8 border-t border-[#1e1e24] grid grid-cols-2 text-center text-xs text-slate-400">
            <div>
              <p className="mb-8 font-semibold text-slate-300">توقيع المستلم / العميل</p>
              <div className="w-32 border-b border-slate-600 mx-auto"></div>
            </div>
            <div>
              <p className="mb-8 font-semibold text-slate-300">الختم والتوقيع المعتمد</p>
              <div className="w-32 border-b border-slate-600 mx-auto"></div>
            </div>
          </div>

          {/* System watermark / powered by Hisabuk */}
          <div className="pt-4 border-t border-[#1e1e24]/60 flex items-center justify-between text-[10px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#c59b48]"></span>
              <span>فاتورة معتمدة ومسجلة عبر منظومة «حِسَابُك» للفوترة والمخزون</span>
            </span>
            <span className="font-mono text-slate-400">Hisabuk Cloud</span>
          </div>
        </div>
      </div>
    </div>
  );
};
