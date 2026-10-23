import React, { useState, useEffect } from 'react';
import {
  Download,
  Printer,
  MessageCircle,
  FileCheck,
  Building2,
  Phone,
  Mail,
  MapPin,
  Calendar,
  CreditCard,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  Loader2
} from 'lucide-react';
import { Invoice, MerchantSettings, Payment } from '../types';
import { formatMoney, invoicePricingBalance } from '../lib/currency';
import { downloadInvoicePdf, printInvoiceThroughIsolatedIframe, parseInvoicePublicUrlParam } from '../services/pdfService';
import { useApp } from '../context/AppContext';

interface PublicInvoiceViewProps {
  param: string;
  onClose?: () => void;
}

export const PublicInvoiceView: React.FC<PublicInvoiceViewProps> = ({ param, onClose }) => {
  const { invoices, settings: appSettings } = useApp();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<MerchantSettings | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    // 1. Try decoding self-contained URL parameter
    const parsed = parseInvoicePublicUrlParam(param);
    if (parsed) {
      setInvoice(parsed.invoice);
      setSettings(parsed.settings);
      setPayments(parsed.payments);
      setIsLoading(false);
      return;
    }

    // 2. Fallback: Check if matching invoice exists in loaded context
    const foundInvoice = invoices.find((i) => i.id === param || i.invoice_number === param);
    if (foundInvoice) {
      setInvoice(foundInvoice);
      setSettings(appSettings);
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
  }, [param, invoices, appSettings]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-sf-canvas flex flex-col items-center justify-center text-sf-text p-4">
        <Loader2 className="w-8 h-8 text-sf-action animate-spin mb-3" />
        <p className="text-sm font-semibold">جاري تحميل بيانات الفاتورة الرسمية...</p>
      </div>
    );
  }

  if (!invoice || !settings) {
    return (
      <div className="min-h-screen bg-sf-canvas flex flex-col items-center justify-center text-sf-text p-4">
        <div className="bg-sf-surface border border-sf-border p-6 sm:p-8 rounded-2xl max-w-md w-full text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-sf-danger-bg text-sf-danger mx-auto flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold">تعذر العثور على الفاتورة</h2>
          <p className="text-xs text-sf-muted leading-relaxed">
            الرابط المستخدم غير مكتمل أو منتهي الصلاحية. يرجى التواصل مع المنشأة لإعادة إرسال الرابط أو ملف الفاتورة.
          </p>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-sf-raised hover:bg-sf-raised/80 border border-sf-border rounded-xl text-xs font-semibold"
            >
              العودة إلى الصفحة الرئيسية
            </button>
          )}
        </div>
      </div>
    );
  }

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await downloadInvoicePdf(invoice, settings, payments);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      await printInvoiceThroughIsolatedIframe(invoice, settings, payments);
    } catch (err) {
      console.error('Print error:', err);
    } finally {
      setIsPrinting(false);
    }
  };

  const isPaid = invoice.status === 'paid' || (invoice.remaining_sdg <= 0 && invoice.remaining_usd <= 0);
  const isPartiallyPaid = !isPaid && (invoice.paid_amount_sdg > 0 || invoice.paid_amount_usd > 0);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-sf-text pb-16 font-sans">
      {/* Top Banner Navigation */}
      <header className="sticky top-0 z-40 bg-sf-surface/90 backdrop-blur-md border-b border-sf-border px-4 py-3">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-sf-action/10 border border-sf-action/20 text-sf-action flex items-center justify-center font-bold">
              <FileCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-sm text-sf-text block leading-none">
                بوابة الفاتورة الرسمية
              </span>
              <span className="text-2xs text-sf-muted font-mono">{invoice.invoice_number}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
            >
              {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>تحميل الفاتورة PDF</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="px-3 py-2 bg-sf-raised hover:bg-sf-raised/80 border border-sf-border text-sf-text rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-sf-action" />
              <span className="hidden sm:inline">طباعة</span>
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 bg-sf-raised hover:bg-sf-raised/80 border border-sf-border text-sf-text rounded-xl text-xs font-medium flex items-center gap-1 transition-colors"
                title="العودة"
              >
                <span>إغلاق</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Invoice Document Container */}
      <main className="max-w-4xl mx-auto p-3 sm:p-6 mt-4">
        <div className="bg-sf-surface border border-sf-border rounded-2xl shadow-xl overflow-hidden p-6 sm:p-10 space-y-8">
          {/* Header: Business & Invoice Info */}
          <div className="flex flex-col sm:flex-row items-start justify-between gap-6 border-b border-sf-border pb-6">
            <div className="space-y-2">
              {settings.logo_url ? (
                <img
                  src={settings.logo_url}
                  alt={settings.business_name}
                  className="h-14 max-w-[200px] object-contain rounded-lg"
                />
              ) : (
                <div className="inline-flex items-center gap-2 text-sf-action">
                  <Building2 className="w-6 h-6" />
                  <span className="font-bold text-lg">{settings.business_name}</span>
                </div>
              )}
              <h1 className="text-xl sm:text-2xl font-black text-sf-text">{settings.business_name}</h1>
              {settings.address && (
                <p className="text-xs text-sf-muted flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-sf-action" />
                  <span>{settings.address}</span>
                </p>
              )}
              {settings.phone && (
                <p className="text-xs text-sf-muted flex items-center gap-1.5 font-mono">
                  <Phone className="w-3.5 h-3.5 text-sf-action" />
                  <span>{settings.phone}</span>
                </p>
              )}
              {settings.tax_number && (
                <p className="text-xs text-sf-muted">
                  الرقم الضريبي: <span className="font-mono font-semibold">{settings.tax_number}</span>
                </p>
              )}
            </div>

            <div className="sm:text-left space-y-2 w-full sm:w-auto bg-sf-raised/50 p-4 rounded-xl border border-sf-border/60">
              <div className="flex items-center justify-between sm:justify-end gap-2">
                <span className="text-xs text-sf-muted">حالة الفاتورة:</span>
                {isPaid ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" />
                    مدفوعة بالكامل
                  </span>
                ) : isPartiallyPaid ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-amber-500/10 text-amber-600 border border-amber-500/30">
                    <Clock className="w-3 h-3" />
                    مسددة جزئياً
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-sf-danger-bg text-sf-danger border border-sf-danger/30">
                    <AlertCircle className="w-3 h-3" />
                    غير مدفوعة
                  </span>
                )}
              </div>
              <div className="text-sm font-bold font-mono">
                رقم الفاتورة: <span className="text-sf-action">{invoice.invoice_number}</span>
              </div>
              <div className="text-xs text-sf-muted flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>تاريخ الإصدار: {invoice.issue_date}</span>
              </div>
              {invoice.due_date && (
                <div className="text-xs text-sf-muted flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-500" />
                  <span>تاريخ الاستحقاق: {invoice.due_date}</span>
                </div>
              )}
            </div>
          </div>

          {/* Customer Card */}
          <div className="bg-sf-raised/40 border border-sf-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-2xs font-semibold text-sf-muted block mb-1">فاتورة صادرة إلى:</span>
              <h2 className="text-base font-bold text-sf-text">{invoice.customer_name}</h2>
              {invoice.customer_phone && (
                <p className="text-xs text-sf-muted font-mono mt-0.5">هاتف العميل: {invoice.customer_phone}</p>
              )}
            </div>
            <div className="text-xs text-sf-muted bg-sf-surface px-3 py-2 rounded-lg border border-sf-border">
              <span>سعر الصرف المعتمد والمجمّد: </span>
              <strong className="text-sf-text font-mono">1 $ = {formatMoney(invoice.exchange_rate_used, 'SDG', settings)}</strong>
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="border-b border-sf-border bg-sf-raised/60 text-sf-muted">
                  <th className="py-2.5 px-3 font-semibold w-10">#</th>
                  <th className="py-2.5 px-3 font-semibold">بيان الصنف والخدمة</th>
                  <th className="py-2.5 px-3 font-semibold text-center w-24">الكمية</th>
                  <th className="py-2.5 px-3 font-semibold text-left w-32">سعر الوحدة</th>
                  <th className="py-2.5 px-3 font-semibold text-left w-36">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sf-border/50">
                {(invoice.items || []).map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-sf-raised/30 transition-colors">
                    <td className="py-3 px-3 text-sf-muted font-mono">{idx + 1}</td>
                    <td className="py-3 px-3 font-medium text-sf-text">
                      <div>{item.description}</div>
                      {item.unit && <span className="text-2xs text-sf-muted font-normal">({item.unit})</span>}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-medium">
                      {item.quantity} {item.unit || ''}
                    </td>
                    <td className="py-3 px-3 text-left font-mono">
                      {formatMoney(item.unit_price, item.currency, settings)}
                    </td>
                    <td className="py-3 px-3 text-left font-mono font-bold text-sf-text">
                      {formatMoney(item.line_total, item.currency, settings)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Financial Totals */}
          <div className="flex flex-col sm:flex-row items-start justify-between gap-6 pt-4 border-t border-sf-border">
            <div className="space-y-4 max-w-sm w-full">
              {/* Payment Instructions / Bank */}
              {(invoice.payment_instructions || settings.bank_details) && (
                <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-3.5 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-bold">
                    <CreditCard className="w-4 h-4" />
                    <span>بيانات السداد والتحويل المعتمدة:</span>
                  </div>
                  <p className="text-2xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {invoice.payment_instructions || settings.bank_details}
                  </p>
                </div>
              )}

              {invoice.notes && (
                <div className="bg-sf-raised/50 border border-sf-border/60 rounded-xl p-3 text-xs space-y-1">
                  <span className="font-semibold text-sf-text block text-2xs">ملاحظات:</span>
                  <p className="text-2xs text-sf-muted whitespace-pre-wrap leading-relaxed">{invoice.notes}</p>
                </div>
              )}
            </div>

            {invoice.pricing && <div className="bg-sf-raised border border-sf-border rounded-xl p-4 space-y-2 text-xs" data-testid="public-native-summary">
              <p>إجمالي عملة الفاتورة: <bdi dir="ltr">{formatMoney(invoice.pricing.total, invoice.pricing.currency)}</bdi></p>
              <p>المتبقي بعملة الفاتورة: <bdi dir="ltr">{formatMoney(invoicePricingBalance(invoice), invoice.pricing.currency)}</bdi></p>
              <p>سعر عملة الفاتورة المجمّد: <bdi dir="ltr">1 USD = {invoice.pricing.units_per_usd} {invoice.pricing.currency}</bdi></p>
            </div>}
            {/* Calculations Card */}
            <div className="w-full sm:w-80 bg-sf-raised/50 border border-sf-border rounded-xl p-4 space-y-2 text-xs">
              <div className="flex justify-between text-sf-muted">
                <span>المجموع الفرعي:</span>
                <span className="font-mono">{formatMoney(invoice.subtotal_sdg, 'SDG', settings)}</span>
              </div>

              {invoice.discount_value > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>الخصم الممنوح:</span>
                  <span className="font-mono">
                    -{invoice.discount_type === 'percent' ? `${invoice.discount_value}%` : formatMoney(invoice.discount_value, invoice.pricing?.currency || 'SDG', settings)}
                  </span>
                </div>
              )}

              {invoice.tax_total_sdg > 0 && (
                <div className="flex justify-between text-sf-muted">
                  <span>الضريبة والقيمة المضافة:</span>
                  <span className="font-mono">{formatMoney(invoice.tax_total_sdg, 'SDG', settings)}</span>
                </div>
              )}

              <div className="border-t border-sf-border pt-2 flex justify-between font-bold text-sm text-sf-text">
                <span>الإجمالي النهائي (ج.س):</span>
                <span className="font-mono text-sf-action">{formatMoney(invoice.grand_total_sdg, 'SDG', settings)}</span>
              </div>

              <div className="flex justify-between text-xs text-sf-muted font-medium pb-2 border-b border-sf-border">
                <span>المقابل بالدولار ($):</span>
                <span className="font-mono">{formatMoney(invoice.grand_total_usd, 'USD', settings)}</span>
              </div>

              <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400">
                <span>المسدد:</span>
                <span className="font-mono">{formatMoney(invoice.paid_amount_sdg, 'SDG', settings)}</span>
              </div>

              <div className="flex justify-between font-black text-sm text-sf-danger pt-1">
                <span>المتبقي للدفع:</span>
                <span className="font-mono">{formatMoney(invoice.remaining_sdg, 'SDG', settings)}</span>
              </div>
            </div>
          </div>

          {/* Bottom Call-to-action button */}
          <div className="pt-6 border-t border-sf-border flex flex-wrap items-center justify-between gap-4">
            <div className="text-2xs text-sf-muted">
              وثيقة محاسبية رقمية أصلية صادرة عبر نظام الفوترة المعتمد.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
              >
                {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>تحميل الفاتورة بصيغة PDF الرسمية</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
