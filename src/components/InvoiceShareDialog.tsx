import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Share2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatMoney } from '../lib/currency';
import type { Invoice } from '../types';
import { Dialog } from './Dialog';

export function InvoiceShareDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { settings, payments } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const shareLock = useRef(false);

  useEffect(() => {
    let active = true;
    setFile(null); setError(''); setNotice('');
    import('../services/pdfService')
      .then(({ createInvoicePdfFile }) => createInvoicePdfFile(invoice, settings, payments.filter(payment => payment.invoice_id === invoice.id)))
      .then(pdf => { if (active) setFile(pdf); })
      .catch(() => { if (active) setError('تعذر تجهيز ملف الفاتورة. أعد المحاولة.'); });
    return () => { active = false; };
  }, [invoice, settings, payments, attempt]);

  const text = `السلام عليكم ورحمة الله،
الفاتورة رقم: *${invoice.invoice_number}*
العميل: ${invoice.customer_name}
التاريخ: ${invoice.issue_date}

المبلغ الإجمالي:
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
  const shareData: ShareData = { files:file ? [file] : [], title:`فاتورة ${invoice.invoice_number}`, text };
  let supportsFiles = false;
  try { supportsFiles = !!file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files:[file] }); } catch { /* Offer manual attachment. */ }
  const phone = (invoice.customer_phone || '').replace(/[^0-9]/g, '');
  const normalizedPhone = phone.startsWith('249') ? phone : '249' + (phone.startsWith('0') ? phone.slice(1) : phone);
  const whatsappUrl = `https://api.whatsapp.com/send?${phone ? `phone=${normalizedPhone}&` : ''}text=${encodeURIComponent(text)}`;

  const share = async () => {
    if (!file || !supportsFiles || shareLock.current) return;
    shareLock.current = true; setSharing(true); setError(''); setNotice('');
    try {
      // The PDF is already ready: invoke sharing within this fresh button gesture.
      await navigator.share(shareData);
      setNotice('تم تسليم الملف والتفاصيل لتطبيق المشاركة. تأكد من المرفق ثم أرسل الرسالة داخل واتساب.');
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') setNotice('تم إلغاء المشاركة. يمكنك المحاولة مرة أخرى.');
      else setError('تعذرت مشاركة الملف. أعد المحاولة أو نزّل PDF وأرفقه في واتساب يدوياً.');
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

  return <Dialog label="مشاركة الفاتورة مع PDF" onClose={() => { if (!shareLock.current) onClose(); }} className="fixed inset-0 z-50 bg-sf-canvas/80 flex items-center justify-center p-4">
    <div className="sf-card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between gap-4"><h2 className="sf-heading-2">مشاركة الفاتورة مع PDF</h2><button type="button" className="sf-icon-action" aria-label="إغلاق المشاركة" disabled={sharing} onClick={onClose}><X /></button></div>
      {!file && !error && <p role="status" className="flex items-center gap-2"><Loader2 className="animate-spin" />جارٍ تجهيز ملف الفاتورة…</p>}
      {error && <p role="alert" className="text-sf-danger">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!file && error && <button type="button" className="sf-secondary" onClick={() => setAttempt(value => value + 1)}>إعادة تجهيز PDF</button>}
      {file && <>
        <p className="text-sf-muted"><bdi dir="ltr">{file.name}</bdi></p>
        {supportsFiles ? <><p>اختر واتساب ثم العميل لإرسال ملف الفاتورة مع التفاصيل.</p><button type="button" className="sf-action flex items-center gap-2" disabled={sharing} onClick={share}><Share2 />{sharing ? 'المشاركة مفتوحة…' : 'مشاركة PDF والتفاصيل'}</button></> : <p>المتصفح لا يدعم مشاركة الملفات مباشرة. نزّل PDF، وافتح واتساب، ثم أرفق الملف من زر المرفقات قبل إرسال التفاصيل.</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className="sf-secondary flex items-center gap-2" disabled={sharing} onClick={download}><Download />تنزيل PDF</button><button type="button" className="sf-secondary" disabled={sharing} onClick={copyDetails}>نسخ التفاصيل</button><a className="sf-secondary inline-flex items-center" href={whatsappUrl} target="_blank" rel="noopener noreferrer">فتح واتساب بالتفاصيل</a></div>
      </>}
      <details><summary className="cursor-pointer text-sf-action">تفاصيل الرسالة</summary><pre className="whitespace-pre-wrap break-words font-sans text-sm mt-3">{text}</pre></details>
    </div>
  </Dialog>;
}
