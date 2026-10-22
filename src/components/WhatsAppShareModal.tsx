import { normalizeWhatsAppPhone, transactionCurrency, whatsAppUrl } from '../lib/currencyCatalog';
import React, { useState, useEffect } from 'react';
import {
  X,
  Share2,
  FileDown,
  Copy,
  Check,
  Send,
  ExternalLink,
  Loader2,
  Info,
  Phone,
  FileText,
  DollarSign,
  AlertCircle
} from 'lucide-react';
import { Invoice, MerchantSettings, Payment } from '../types';
import { formatMoney } from '../lib/currency';
import {
  generateInvoicePdfFile,
  downloadInvoicePdf,
  buildInvoiceWhatsAppMessage,
  generateInvoicePublicUrl
} from '../services/pdfService';

interface WhatsAppShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice;
  settings: MerchantSettings;
  payments?: Payment[];
}

export const WhatsAppShareModal: React.FC<WhatsAppShareModalProps> = ({
  isOpen,
  onClose,
  invoice,
  settings,
  payments = []
}) => {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pdfReadyFile, setPdfReadyFile] = useState<File | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const cleanNumber = (invoice.invoice_number || '').replace(/[^a-zA-Z0-9-_]/g, '_');
  const filename = `فاتورة_${cleanNumber}.pdf`;

  const invoicePayments = payments.filter((p) => p.invoice_id === invoice.id);
  const publicUrl = generateInvoicePublicUrl(invoice, settings, invoicePayments);
  const messageText = buildInvoiceWhatsAppMessage(invoice, settings, invoicePayments, publicUrl);

  const formattedPhone = normalizeWhatsAppPhone(invoice.customer_phone, invoice.pricing?.currency || transactionCurrency(settings), transactionCurrency(settings));

  // Pre-generate PDF file on modal open
  useEffect(() => {
    if (!isOpen) {
      setPdfReadyFile(null);
      setStatusMessage(null);
      setCopiedText(false);
      setCopiedUrl(false);
      return;
    }

    let isMounted = true;
    setIsGeneratingPdf(true);
    generateInvoicePdfFile(invoice, settings, invoicePayments)
      .then((file) => {
        if (isMounted) {
          setPdfReadyFile(file);
          setIsGeneratingPdf(false);
        }
      })
      .catch((err) => {
        console.warn('PDF preparation error:', err);
        if (isMounted) setIsGeneratingPdf(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, invoice.id]);

  if (!isOpen) return null;

  // 1. Primary Action: Send to WhatsApp with full details + auto download PDF
  const handleSendToWhatsApp = async () => {
    setStatusMessage('جاري تجهيز الفاتورة وفتح واتساب...');

    // Copy details to clipboard
    try {
      await navigator.clipboard.writeText(messageText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 4000);
    } catch {
      // Non-blocking
    }

    // Auto-download PDF file to disk so merchant has it immediately ready to attach
    try {
      if (pdfReadyFile) {
        const url = URL.createObjectURL(pdfReadyFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      } else {
        await downloadInvoicePdf(invoice, settings, invoicePayments);
      }
    } catch (err) {
      console.warn('Could not auto-download PDF:', err);
    }

    // Launch WhatsApp
    const whatsappUrl = whatsAppUrl(invoice.customer_phone, messageText, invoice.pricing?.currency || transactionCurrency(settings), transactionCurrency(settings));

    window.open(whatsappUrl, '_blank');
    setStatusMessage('تم فتح واتساب مع التفاصيل ورابط الـ PDF، وتم تنزيل ملف الـ PDF في جهازك لإرفاقه بنقرة واحدة.');
  };

  // 2. Action: Native file share (for mobile devices)
  const handleShareFileDirectly = async () => {
    try {
      let fileToShare = pdfReadyFile;
      if (!fileToShare) {
        setIsGeneratingPdf(true);
        fileToShare = await generateInvoicePdfFile(invoice, settings, invoicePayments);
        setPdfReadyFile(fileToShare);
        setIsGeneratingPdf(false);
      }

      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
        setStatusMessage('جاري فتح مشاركة النظام...');
        await navigator.share({
          title: `فاتورة ${invoice.invoice_number}`,
          text: messageText,
          files: [fileToShare],
        });
        setStatusMessage('تمت المشاركة بنجاح.');
      } else {
        // Fallback to download
        handleDownloadPdf();
        setStatusMessage('مشاركة الملفات المباشرة غير مدعومة في هذا المتصفح، تم تنزيل ملف الـ PDF لجهازك.');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('File share failed, falling back to download:', err);
        handleDownloadPdf();
      }
    }
  };

  // 3. Action: Download PDF manually
  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      if (pdfReadyFile) {
        const url = URL.createObjectURL(pdfReadyFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      } else {
        await downloadInvoicePdf(invoice, settings, invoicePayments);
      }
      setStatusMessage(`تم تنزيل ملف الفاتورة (${filename}) بنجاح.`);
    } catch (err) {
      console.error('Download error:', err);
      setStatusMessage('حدث خطأ أثناء تحميل ملف الـ PDF.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // 4. Action: Copy Message Text
  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopiedText(true);
      setStatusMessage('تم نسخ نص الفاتورة كاملاً إلى الحافظة.');
      setTimeout(() => setCopiedText(false), 3000);
    } catch {
      setStatusMessage('تعذر نسخ النص تلقائياً.');
    }
  };

  // 5. Action: Copy Public Link
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopiedUrl(true);
      setStatusMessage('تم نسخ رابط الفاتورة المباشر.');
      setTimeout(() => setCopiedUrl(false), 3000);
    } catch {
      setStatusMessage('تعذر نسخ الرابط تلقائياً.');
    }
  };

  const isNativeShareSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    pdfReadyFile &&
    navigator.canShare({ files: [pdfReadyFile] });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-share-title"
    >
      <div className="bg-sf-surface border border-sf-border text-sf-text rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-sf-border flex items-center justify-between bg-sf-raised/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="whatsapp-share-title" className="text-base sm:text-lg font-bold">
                إرسال الفاتورة عبر واتساب
              </h2>
              <p className="text-xs text-sf-muted">
                الفاتورة رقم: <span className="font-mono font-semibold text-sf-text">{invoice.invoice_number}</span> (ملف PDF + التفاصيل الكاملة)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-sf-muted hover:text-sf-text hover:bg-sf-raised rounded-lg transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Quick Invoice Summary Card */}
          <div className="bg-sf-raised border border-sf-border/70 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sf-text">{invoice.customer_name}</span>
                {formattedPhone && (
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md text-2xs">
                    <Phone className="w-3 h-3" />
                    +{formattedPhone}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 font-mono">
                <span className="font-bold text-sf-text">
                  {formatMoney(invoice.grand_total_sdg, 'SDG', settings)}
                </span>
                <span className="text-sf-muted">|</span>
                <span className="text-sf-muted">
                  {formatMoney(invoice.grand_total_usd, 'USD', settings)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-sf-muted border-t border-sf-border/40 pt-2">
              <span>سعر الصرف المجمّد: 1 $ = {formatMoney(invoice.exchange_rate_used, 'SDG', settings)}</span>
              <span>المتبقي: {formatMoney(invoice.remaining_sdg, 'SDG', settings)}</span>
            </div>

            {/* PDF status pill */}
            <div className="flex items-center gap-2 pt-1 text-2xs">
              {isGeneratingPdf ? (
                <div className="flex items-center gap-1.5 text-amber-500 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>جاري تجهيز ملف الـ PDF المعتمد...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  <span>ملف الفاتورة جاهز: <span className="font-mono">{filename}</span></span>
                </div>
              )}
            </div>
          </div>

          {/* Status / Feedback message */}
          {statusMessage && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2 animate-in fade-in">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{statusMessage}</p>
            </div>
          )}

          {/* Main Action Buttons */}
          <div className="space-y-2.5">
            {/* Primary Action Button: Open WhatsApp with Details & Auto Download PDF */}
            <button
              type="button"
              onClick={handleSendToWhatsApp}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>إرسال إلى واتساب (التفاصيل + رابط الـ PDF المباشر)</span>
            </button>

            {/* Sub-actions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Option 2: Native Share (mobile only or browser share) */}
              <button
                type="button"
                onClick={handleShareFileDirectly}
                disabled={isGeneratingPdf}
                className="py-2.5 px-3 bg-sf-raised hover:bg-sf-raised/80 border border-sf-border text-sf-text font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                title="مشاركة ملف الـ PDF مباشرة كمستند عبر تطبيقات الهاتف"
              >
                <Share2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{isNativeShareSupported ? 'مشاركة ملف PDF مباشرة كمستند' : 'مشاركة الملف عبر التطبيقات'}</span>
              </button>

              {/* Option 3: Download PDF file directly */}
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isDownloadingPdf || isGeneratingPdf}
                className="py-2.5 px-3 bg-sf-raised hover:bg-sf-raised/80 border border-sf-border text-sf-text font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isDownloadingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin text-sf-action" />
                ) : (
                  <FileDown className="w-4 h-4 text-sf-action" />
                )}
                <span>تحميل ملف الـ PDF للجهاز</span>
              </button>
            </div>
          </div>

          {/* Copy Message Text & Public Link */}
          <div className="bg-sf-raised/60 border border-sf-border/80 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-sf-text flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-sf-action" />
                <span>رابط الفاتورة المباشر للعميل:</span>
              </span>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="text-2xs font-semibold text-sf-action hover:underline flex items-center gap-1"
              >
                {copiedUrl ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedUrl ? 'تم نسخ الرابط' : 'نسخ الرابط'}</span>
              </button>
            </div>
            <div className="p-2 bg-sf-surface border border-sf-border/60 rounded-lg text-2xs font-mono text-sf-muted truncate select-all">
              {publicUrl}
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-sf-border/40">
              <button
                type="button"
                onClick={handleCopyText}
                className="px-3 py-1.5 bg-sf-surface hover:bg-sf-raised border border-sf-border text-sf-text font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors"
              >
                {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedText ? 'تم نسخ النص كاملاً' : 'نسخ نص الفاتورة كاملاً'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="text-xs text-sf-action hover:underline font-medium"
              >
                {showPreview ? 'إخفاء معاينة الرسالة' : 'معاينة رسالة واتساب'}
              </button>
            </div>
          </div>

          {/* Live Message Preview (Expandable) */}
          {showPreview && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-500/20 rounded-xl space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-bold text-emerald-800 dark:text-emerald-300">
                  معاينة نص الرسالة التي ستصل للعميل:
                </span>
                <span className="text-3xs text-sf-muted">نمط واتساب المعتمد</span>
              </div>
              <pre className="text-2xs font-sans text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed max-h-44 overflow-y-auto p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-emerald-500/20 select-all">
                {messageText}
              </pre>
            </div>
          )}

          {/* Helpful Tips Section */}
          <div className="p-3 bg-sf-raised/40 border border-sf-border/60 rounded-xl flex items-start gap-2 text-2xs text-sf-muted leading-relaxed">
            <Info className="w-4 h-4 shrink-0 text-sf-action mt-0.5" />
            <div>
              <p className="font-semibold text-sf-text mb-0.5">كيف تضمن وصول الـ PDF والتفاصيل معاً؟</p>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  عند النقر على <strong>إرسال إلى واتساب</strong>، يتم فتح المحادثة وتنزيل ملف الـ PDF في جهازك تلقائيًا، كما تتضمن الرسالة <strong>رابطاً مباشراً</strong> يتيح للعميل استعراض وتحميل الفاتورة الأصلية.
                </li>
                <li>
                  على أجهزة الكمبيوتر، يمكنك سحب ملف الـ PDF المُنَزّل مباشرة إلى محادثة واتساب.
                </li>
                <li>
                  على الهواتف الذكية، يمكنك أيضاً استخدام زر <strong>مشاركة الملف عبر التطبيقات</strong> لإرسال ملف الـ PDF كمستند مباشرة.
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-sf-border bg-sf-raised/50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-sf-raised hover:bg-sf-raised/80 border border-sf-border text-sf-text font-semibold text-xs rounded-xl transition-colors cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
