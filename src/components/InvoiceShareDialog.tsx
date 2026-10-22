import { whatsAppUrl } from '../lib/currencyCatalog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Share2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatMoney, invoicePricingBalance } from '../lib/currency';
import type { Invoice } from '../types';
import { Dialog } from './Dialog';

export function InvoiceShareDialog({ invoice, onClose, reminder = false }: { invoice: Invoice; onClose: () => void; reminder?: boolean }) {
  const { settings, payments } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const shareLock = useRef(false);
  const relevantPayments = payments.filter(payment => payment.invoice_id === invoice.id);
  const snapshotKey = JSON.stringify([invoice, settings, relevantPayments]);
  const snapshot = useMemo(() => ({ invoice, settings, payments:relevantPayments }), [snapshotKey]);
  const generation = useRef<{ key:string; job:Promise<File> } | null>(null);

  useEffect(() => {
    let active = true;
    setFile(null); setError(''); setNotice('');
    const key = `${snapshotKey}:${attempt}`;
    if (!generation.current || generation.current.key !== key) generation.current = { key, job:import('../services/pdfService')
      .then(({ createInvoicePdfFile }) => createInvoicePdfFile(snapshot.invoice, snapshot.settings, snapshot.payments)) };
    generation.current.job
      .then(pdf => { if (active) setFile(pdf); })
      .catch(() => { if (active) setError('تعذر تجهيز ملف الفاتورة. أعد المحاولة.'); });
    return () => { active = false; };
  }, [snapshot, snapshotKey, attempt]);

  const text = `السلام عليكم ورحمة الله،
${reminder ? 'نود تذكيركم بلطف بسداد الفاتورة المستحقة التالية.\n' : ''}الفاتورة رقم: *${invoice.invoice_number}*
العميل: ${invoice.customer_name}
التاريخ: ${invoice.issue_date}${invoice.due_date ? `\nتاريخ الاستحقاق: ${invoice.due_date}` : ''}

${invoice.pricing ? `إجمالي عملة الفاتورة: *${formatMoney(invoice.pricing.total, invoice.pricing.currency)}*
المتبقي بعملة الفاتورة: *${formatMoney(invoicePricingBalance(invoice), invoice.pricing.currency)}*
سعر العملة المجمّد: 1 USD = ${invoice.pricing.units_per_usd} ${invoice.pricing.currency}

` : ''}المبلغ الإجمالي:
• بالجنيه السوداني: *${formatMoney(invoice.grand_total_sdg, 'SDG', settings)}*
• بالدولار الأمريكي: *${formatMoney(invoice.grand_total_usd, 'USD', settings)}*
سعر الصرف المجمّد: 1 USD = ${formatMoney(invoice.exchange_rate_used, 'SDG', settings)}

المبلغ المسدد: ${formatMoney(invoice.paid_amount_sdg, 'SDG', settings)}
المبلغ المتبقي: *${formatMoney(invoice.remaining_sdg, 'SDG', settings)}* (${formatMoney(invoice.remaining_usd, 'USD', settings)})

بيانات السداد:
${invoice.payment_instructions || settings.bank_details || 'تطبيق بنكك أو كاش'}

شكراً لتعاملكم مع:
*${settings.business_name}*
هاتف: ${settings.phone}`;
  // File is mandatory. A WhatsApp text URL cannot carry a PDF attachment.
  const shareData: ShareData = { files:file ? [file] : [], text };
  let supportsFiles = false;
  try { supportsFiles = !!file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files:[file] }); } catch { /* Offer manual attachment. */ }
  const whatsappUrl = whatsAppUrl(invoice.customer_phone, text, invoice.pricing?.currency || 'SDG', 'SDG');
  const embedded = window.self !== window.top;
  const standaloneUrl = new URL(window.location.href);
  standaloneUrl.searchParams.set('share-invoice', invoice.id);

  const share = async (fileOnly = false) => {
    if (!file || !supportsFiles || shareLock.current) return;
    shareLock.current = true; setSharing(true); setError(''); setNotice('');
    try {
      // The PDF is already ready: invoke sharing within this fresh button gesture.
      await navigator.share(fileOnly ? { files:[file] } : shareData);
      setNotice(fileOnly ? 'تم فتح مشاركة ملف PDF. اختر واتساب وألصق التفاصيل المنسوخة في وصف المرفق.' : 'تم فتح مشاركة ملف PDF مع التفاصيل. اختر واتساب وتأكد من ظهور مرفق الفاتورة قبل الإرسال.');
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') setNotice('تم إلغاء المشاركة. يمكنك المحاولة مرة أخرى.');
      else if (failure instanceof DOMException && failure.name === 'NotAllowedError') setError(embedded ? 'المعاينة تمنع مشاركة الملفات. افتح الفاتورة في صفحة مستقلة من الزر أدناه ثم شارك PDF.' : 'المتصفح منع مشاركة الملف. افتح الموقع عبر HTTPS في Chrome، ثم اضغط زر إرسال PDF مرة أخرى.');
      else setError('تعذرت مشاركة الملف مع التفاصيل. استخدم «مشاركة ملف PDF فقط» ثم ألصق التفاصيل في وصف المرفق.');
    } finally { shareLock.current = false; setSharing(false); }
  };
  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url; link.download = file.name;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const copyDetails = async () => {
    try { await navigator.clipboard.writeText(text); setNotice('تم نسخ التفاصيل. ألصقها مع ملف الفاتورة في واتساب.'); }
    catch { setError('تعذر النسخ. افتح تفاصيل الرسالة أدناه وانسخها يدوياً.'); }
  };
  const shareFileOnly = () => {
    // Do not await clipboard work: native sharing needs this same button gesture.
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(() => {});
    void share(true);
  };

  return <Dialog label="مشاركة الفاتورة مع PDF" onClose={() => { if (!shareLock.current) onClose(); }} className="fixed inset-0 z-50 bg-sf-canvas/80 flex items-center justify-center p-4">
    <div className="sf-card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between gap-4"><h2 className="sf-heading-2">مشاركة الفاتورة مع PDF</h2><button type="button" className="sf-icon-action" aria-label="إغلاق المشاركة" disabled={sharing} onClick={onClose}><X /></button></div>
      {!file && !error && <p role="status" className="flex items-center gap-2"><Loader2 className="animate-spin" />جارٍ تجهيز ملف الفاتورة…</p>}
      {error && <p role="alert" className="text-sf-danger">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!file && error && <button type="button" className="sf-secondary" onClick={() => setAttempt(value => value + 1)}>إعادة تجهيز PDF</button>}
      {file && <>
        <p className="text-sf-muted"><bdi dir="ltr">{file.name}</bdi></p>
        {supportsFiles ? <><p>اضغط إرسال PDF، ثم اختر واتساب والعميل. ملف الفاتورة والتفاصيل يُشاركان معاً.</p><button type="button" className="sf-action flex items-center gap-2" disabled={sharing} onClick={() => void share()}><Share2 />{sharing ? 'المشاركة مفتوحة…' : 'إرسال PDF عبر واتساب'}</button>
          <div className="flex flex-wrap gap-2"><button type="button" className="sf-secondary" disabled={sharing} onClick={shareFileOnly}>مشاركة ملف PDF فقط</button><button type="button" className="sf-secondary" disabled={sharing} onClick={copyDetails}>نسخ التفاصيل</button></div>
          <p className="text-sm text-sf-muted">إذا تجاهل واتساب النص المصاحب، شارك ملف PDF فقط ثم ألصق التفاصيل في وصف المرفق.</p>
        </> : <p>{embedded ? 'معاينة التطبيق تمنع مشاركة ملف PDF. افتح التطبيق في صفحة مستقلة ثم أعد المشاركة.' : !window.isSecureContext ? 'مشاركة PDF تحتاج فتح الموقع عبر HTTPS في Chrome.' : 'مشاركة PDF غير متاحة في هذا المتصفح. افتح الموقع في Chrome على الموبايل.'}</p>}
        {embedded && <a className="sf-secondary inline-flex items-center" href={standaloneUrl.href} target="_blank" rel="noopener noreferrer">فتح الفاتورة خارج المعاينة</a>}
        <details><summary className="cursor-pointer text-sf-muted">تنزيل الملف أو الإرفاق اليدوي</summary><p className="text-sm my-3">نزّل PDF أولاً، ثم افتح واتساب وأرفق الملف من زر المرفقات. هذا الخيار لا يرفق الملف تلقائياً.</p><div className="flex flex-wrap gap-2"><button type="button" className="sf-secondary flex items-center gap-2" disabled={sharing} onClick={download}><Download />تنزيل PDF</button><a className="sf-secondary inline-flex items-center" href={whatsappUrl} target="_blank" rel="noopener noreferrer">فتح واتساب للإرفاق اليدوي</a></div></details>
      </>}
      <details><summary className="cursor-pointer text-sf-action">تفاصيل الرسالة</summary><pre className="whitespace-pre-wrap break-words font-sans text-sm mt-3">{text}</pre></details>
    </div>
  </Dialog>;
}
