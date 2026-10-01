import { escapeHtml, escapeStrings, imageUrl } from '../lib/html';
import { documentWatermarkHtml } from '../lib/documentBrand';
import { downloadDocumentPdf } from './documentPdf';
import identity from '../styles/sudaflow.tokens.json';
const printTheme = identity.theme.light;
import { Invoice, Payment, MerchantSettings } from '../types';
import { formatMoney, getInvoiceStatusInfo, getPaymentMethodLabel } from '../lib/currency';

/**
 * Creates a clean, dedicated, standalone printable HTML representation
 * of an invoice styled specifically for high-resolution A4 printing and PDF export.
 */
export const buildInvoiceHtml = (
  invoice: Invoice,
  settings: MerchantSettings,
  invoicePayments: Payment[] = []
): string => {
  settings = { ...escapeStrings(settings), logo_url: escapeHtml(imageUrl(settings.logo_url)) };
  invoice = escapeStrings(invoice);
  invoicePayments = escapeStrings(invoicePayments);
  const statusInfo = getInvoiceStatusInfo(invoice.status);
  const statusDefinition = identity.invoiceStatus[invoice.status as keyof typeof identity.invoiceStatus];
  const statusColors = identity.status.light[(statusDefinition?.semantic || 'neutral') as keyof typeof identity.status.light];
  const rawRate = invoice.exchange_rate_used || settings.default_exchange_rate || 0;
  const formattedRate = rawRate > 0 ? formatMoney(rawRate, 'SDG', settings) : 'غير محدد';

  const paymentRowsHtml = invoicePayments.length > 0
    ? invoicePayments.map((p) => `
        <tr style="height:48px;break-inside:avoid;border-bottom: 1px solid ${printTheme.border};">
          <td style="padding: 12px 12px; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; color: ${printTheme.textMuted};">${p.payment_date.split('T')[0]}</td>
          <td style="padding: 12px 12px; color: ${printTheme.text};">${getPaymentMethodLabel(p.payment_method)}</td>
          <td style="padding: 12px 12px; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; color: ${printTheme.textMuted};">${p.reference_number || '-'}</td>
          <td style="padding: 12px 12px; text-align: left; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500; color: ${printTheme.text};">
            ${formatMoney(p.amount, p.currency, settings)}
          </td>
        </tr>
      `).join('')
    : '';

  const itemsRowsHtml = (invoice.items || []).map((item, idx) => `
    <tr style="height:48px;break-inside:avoid;border-bottom: 1px solid ${printTheme.border}; ${idx % 2 === 1 ? 'background-color: ${printTheme.surfaceRaised};' : ''}">
      <td style="padding: 12px 12px; color: ${printTheme.textMuted}; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate;">${idx + 1}</td>
      <td style="padding: 12px 12px; font-weight: 600; color: ${printTheme.text};">${item.description}</td>
      <td style="padding: 12px 12px; text-align: center; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; color: ${printTheme.text};">
        ${item.quantity} ${item.unit || ''}
      </td>
      <td style="padding: 12px 12px; text-align: center; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; color: ${printTheme.text};">
        ${formatMoney(item.unit_price, item.currency, settings)}
      </td>
      <td style="padding: 12px 12px; text-align: left; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500; color: ${printTheme.text};">
        ${formatMoney(item.line_total, item.currency, settings)}
      </td>
    </tr>
  `).join('');

  return `
    <div class="sf-print-document" style="position:relative;isolation:isolate;font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif; font-size:14px; direction: rtl; text-align: right; background-color: #ffffff; color: ${printTheme.text}; padding: 24px; max-width: 800px; margin: 0 auto; box-sizing: border-box; line-height: 22px;">
      ${documentWatermarkHtml}
      
      <!-- Top Header -->
      <div data-pdf-repeat="header" style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${printTheme.text}; padding-bottom: 16px; margin-bottom: 16px;">
        <div>
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
            ${settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg'
              ? `<img src="${settings.logo_url}" alt="Logo" style="height: 48px; max-width: 120px; object-fit: contain; border-radius: 12px;" />`
              : ''
            }
            <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: ${printTheme.text};">${settings.business_name || 'اسم المنشأة'}</h1>
          </div>
          <p style="margin: 2px 0; font-size: 14px; color: ${printTheme.textMuted};">
            ${settings.address ? `<span>${settings.address} • </span>` : ''}
            <span>هاتف: ${settings.phone || '-'}</span>
          </p>
          ${settings.bank_details ? `<p style="margin: 2px 0; font-size: 14px; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; color: ${printTheme.text}; font-weight: 500;">${settings.bank_details}</p>` : ''}
        </div>

        <div style="text-align: left;">
          <div style="font-size: 14px; font-weight: 500; color: ${printTheme.textMuted}; margin-bottom: 4px;">
            فاتورة مبيعات
          </div>
          <div class="sf-print-document" style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-size: 18px; font-weight: 600; color: ${printTheme.text};">
            ${invoice.invoice_number}
          </div>
          <div style="font-size: 14px; color: ${printTheme.textMuted}; margin-top: 4px;">
            <div>تاريخ الإصدار: <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500;">${invoice.issue_date}</span></div>
            ${invoice.due_date ? `<div>تاريخ الاستحقاق: <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate;">${invoice.due_date}</span></div>` : ''}
          </div>
          <div style="margin-top: 6px;">
            <span style="display: inline-block; font-size: 14px; line-height:28px; font-weight: 500; color: ${statusColors.foreground};">
              الحالة: ${statusInfo.label}
            </span>
          </div>
        </div>
      </div>

      <!-- Customer Details & Frozen Exchange Rate -->
      <div style="display: flex; justify-content: space-between; background-color: ${printTheme.surfaceRaised}; border: 1px solid ${printTheme.border}; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <div>
          <span style="display: block; font-size: 14px; font-weight: 500; color: ${printTheme.textMuted}; margin-bottom: 4px;">فاتورة إلى العميل:</span>
          <h2 style="margin: 0; font-size: 15px; font-weight: 600; color: ${printTheme.text};">${invoice.customer_name || 'عميل نقدي'}</h2>
          ${invoice.customer_phone ? `<div style="font-size: 14px; color: ${printTheme.text}; margin-top: 2px;">الهاتف: ${invoice.customer_phone}</div>` : ''}
          ${invoice.customer_address ? `<div style="font-size: 14px; color: ${printTheme.textMuted}; margin-top: 2px;">العنوان: ${invoice.customer_address}</div>` : ''}
        </div>

        <div style="text-align: left; display: flex; flex-direction: column; justify-content: center;">
          <div style="font-size: 14px; line-height:28px; font-weight: 500; color:#FFFFFF; background-color:#087F75; padding: 8px 12px; border-radius: 8px; border: 1px solid #06675F; display: inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
            سعر الصرف المجمّد: <bdi dir="ltr" style="display:inline-block;direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums;">1 USD = ${formattedRate}</bdi>
          </div>
          <span style="font-size: 14px; color: ${printTheme.textMuted}; margin-top: 4px;">
            السعر المثبّت عند إصدار هذه الفاتورة.
          </span>
        </div>
      </div>

      <!-- Products & Items Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
        <thead style="display:table-header-group;">
          <tr style="background-color: ${printTheme.surfaceRaised}; border-bottom: 2px solid ${printTheme.border}; color: ${printTheme.text}; font-weight: 500;">
            <th style="padding: 12px 12px; text-align: right; width: 30px;">#</th>
            <th style="padding: 12px 12px; text-align: right;">الوصف / الصنف</th>
            <th style="padding: 12px 12px; text-align: center; width: 80px;">الكمية</th>
            <th style="padding: 12px 12px; text-align: center; width: 110px;">سعر الوحدة</th>
            <th style="padding: 12px 12px; text-align: left; width: 120px;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRowsHtml}
        </tbody>
      </table>

      <!-- Financial Totals (Dual Currency) -->
      <div style="display: flex; justify-content: space-between; gap: 16px; margin-bottom: 24px;">
        <!-- Notes & Payment Info -->
        <div style="flex: 1; font-size: 14px;">
          ${invoice.notes ? `
            <div style="background-color: ${printTheme.surfaceRaised}; border: 1px solid ${printTheme.border}; border-radius: 12px; padding: 12px; margin-bottom: 8px;">
              <span style="font-weight: 500; color: ${printTheme.text}; display: block; margin-bottom: 2px;">ملاحظات:</span>
              <p style="margin: 0; color: ${printTheme.textMuted}; white-space: pre-line;">${invoice.notes}</p>
            </div>
          ` : ''}
          ${invoice.payment_instructions ? `
            <div style="background-color: ${printTheme.surfaceRaised}; border: 1px solid ${printTheme.border}; border-radius: 12px; padding: 12px;">
              <span style="font-weight: 500; color: ${printTheme.text}; display: block; margin-bottom: 2px;">تعليمات السداد والتحويل:</span>
              <p style="margin: 0; color: ${printTheme.text}; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate;">${invoice.payment_instructions}</p>
            </div>
          ` : ''}
        </div>

        <!-- Totals Card -->
        <div style="width: 360px; background-color: ${printTheme.surfaceRaised}; border: 1px solid ${printTheme.border}; border-radius: 8px; padding: 12px; font-size: 14px; box-sizing: border-box;">
          <div style="display: flex; justify-content: space-between; padding: 3px 0; color: ${printTheme.textMuted};">
            <span>المجموع الفرعي:</span>
            <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500; color: ${printTheme.text};">${formatMoney(invoice.subtotal_sdg, 'SDG', settings)}</span>
          </div>

          ${invoice.discount_total_sdg > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 3px 0; color: ${printTheme.text};">
              <span>الخصم الممنوح:</span>
              <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500;">- ${formatMoney(invoice.discount_total_sdg, 'SDG', settings)}</span>
            </div>
          ` : ''}

          ${invoice.tax_total_sdg > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 3px 0; color: ${printTheme.textMuted};">
              <span>الضريبة:</span>
              <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500; color: ${printTheme.text};">+ ${formatMoney(invoice.tax_total_sdg, 'SDG', settings)}</span>
            </div>
          ` : ''}

          <!-- Grand Total Box -->
          <div style="border-top: 2px solid ${printTheme.border}; margin-top: 8px; padding-top: 8px;">
            <div style="font-size: 14px; font-weight: 500; color: ${printTheme.text}; margin-bottom: 2px;">
              المبلغ الإجمالي النهائي (بالعملتين):
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-size: 16px; font-weight: 600; color: ${printTheme.text};">
                ${formatMoney(invoice.grand_total_sdg, 'SDG', settings)}
              </span>
              <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-size: 14px; font-weight: 500; color: ${printTheme.text}; background-color: ${printTheme.surfaceRaised}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${printTheme.border};">
                ${formatMoney(invoice.grand_total_usd, 'USD', settings)}
              </span>
            </div>
          </div>

          <!-- Paid & Remaining -->
          <div style="border-top: 1px solid ${printTheme.border}; margin-top: 8px; padding-top: 6px;">
            <div style="display: flex; justify-content: space-between; color: ${printTheme.text}; font-size: 14px;">
              <span>المبلغ المسدد:</span>
              <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500;">
                ${formatMoney(invoice.paid_amount_sdg, 'SDG', settings)} (${formatMoney(invoice.paid_amount_usd, 'USD', settings)})
              </span>
            </div>
            <div style="display: flex; justify-content: space-between; color: ${printTheme.text}; font-size: 14px; font-weight: 500; margin-top: 2px;">
              <span>المتبقي المطلوب:</span>
              <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate;">
                ${formatMoney(invoice.remaining_sdg, 'SDG', settings)} (${formatMoney(invoice.remaining_usd, 'USD', settings)})
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Payment History Table if any -->
      ${invoicePayments.length > 0 ? `
        <div style="margin-bottom: 24px;">
          <h4 style="margin: 0 0 6px 0; font-size: 14px; font-weight: 500; color: ${printTheme.text};">
            سجل الدفعات وسندات القبض المسجلة (${invoicePayments.length})
          </h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; background-color: #ffffff; border: 1px solid ${printTheme.border}; border-radius: 12px; overflow: hidden;">
            <thead style="display:table-header-group;">
              <tr style="background-color: ${printTheme.surfaceRaised}; border-bottom: 1px solid ${printTheme.border}; color: ${printTheme.textMuted}; font-weight: 500;">
                <th style="padding: 12px 12px; text-align: right;">التاريخ</th>
                <th style="padding: 12px 12px; text-align: right;">طريقة الدفع</th>
                <th style="padding: 12px 12px; text-align: right;">رقم العملية / الإشعار</th>
                <th style="padding: 12px 12px; text-align: left;">المبلغ المستلم</th>
              </tr>
            </thead>
            <tbody>
              ${paymentRowsHtml}
            </tbody>
          </table>
        </div>
      ` : ''}

      <!-- Signatures & Official Stamp -->
      <div style="display: flex; justify-content: space-between; border-top: 1px solid ${printTheme.border}; padding-top: 20px; margin-top: 20px; text-align: center; font-size: 14px; color: ${printTheme.textMuted};">
        <div style="width: 40%;">
          <p style="margin: 0 0 35px 0; font-weight: 500; color: ${printTheme.text};">توقيع المستلم / العميل</p>
          <div style="border-bottom: 1px solid ${printTheme.controlBorder}; width: 140px; margin: 0 auto;"></div>
        </div>
        <div style="width: 40%;">
          <p style="margin: 0 0 35px 0; font-weight: 500; color: ${printTheme.text};">الختم والتوقيع المعتمد</p>
          <div style="border-bottom: 1px solid ${printTheme.controlBorder}; width: 140px; margin: 0 auto;"></div>
        </div>
      </div>

      <!-- Platform attribution; the merchant remains the issuer -->
      <div data-pdf-repeat="footer" style="border-top: 1px solid ${printTheme.border}; margin-top: 16px; padding-top: 8px; display: flex; justify-content: space-between; font-size: 14px; color: ${printTheme.textMuted};">
        <span>تم إنشاء هذه الوثيقة عبر سودافلو</span>
        <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500;">SudaFlow</span>
      </div>
    </div>
  `;
};

/**
 * Downloads a high-resolution, perfectly formatted PDF file of an invoice
 * using html2canvas and jsPDF.
 */
export const downloadInvoicePdf = async (
  invoice: Invoice,
  settings: MerchantSettings,
  invoicePayments: Payment[] = []
): Promise<void> => {
  // 1. Create a clean offscreen render container
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '718px';
  container.style.backgroundColor = '#ffffff';
  container.style.zIndex = '-9999';
  container.innerHTML = buildInvoiceHtml(invoice, settings, invoicePayments);
  document.body.appendChild(container);

  try {
    const cleanNumber = invoice.invoice_number.replace(/[^a-zA-Z0-9-_]/g, '_');
    await downloadDocumentPdf(container, `فاتورة_${cleanNumber}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
};

/**
 * Robust print handler for invoices:
 * Uses a clean, isolated hidden iframe to completely bypass modal dialog styling,
 * dark mode, and parent CSS transforms, while maintaining full fallback.
 */
export const printInvoiceThroughIsolatedIframe = async (
  invoice: Invoice,
  settings: MerchantSettings,
  invoicePayments: Payment[] = []
): Promise<void> => {
  const invoiceHtml = buildInvoiceHtml(invoice, settings, invoicePayments);

  // 1. Create a hidden iframe
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  iframe.id = 'invoice-print-frame';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    // Fallback to normal window.print() if iframe document unavailable
    window.print();
    return;
  }

  // 2. Write complete standalone HTML document into iframe
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>فاتورة ${escapeHtml(invoice.invoice_number)}</title>
        <style>
          @font-face { font-family:'IBM Plex Sans Arabic';font-style:normal;font-weight:400;src:url('/brand/fonts/IBMPlexSansArabic-Regular.woff2') format('woff2'); }
          @font-face { font-family:'IBM Plex Sans Arabic';font-style:normal;font-weight:500;src:url('/brand/fonts/IBMPlexSansArabic-Medium.woff2') format('woff2'); }
          @font-face { font-family:'IBM Plex Sans Arabic';font-style:normal;font-weight:600;src:url('/brand/fonts/IBMPlexSansArabic-SemiBold.woff2') format('woff2'); }

          @page {
            size: A4 portrait;
            margin: 10mm 12mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 0;
            background: #ffffff !important;
            color: ${printTheme.text} !important;
            font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          @media print {
            [data-pdf-repeat="watermark"] { position:fixed!important; }
            body {
              width: 100%;
            }
          }
        </style>
      </head>
      <body>
        ${invoiceHtml}
      </body>
    </html>
  `);
  doc.close();

  // 3. Wait for iframe fonts and images to load
  try {
    if (iframe.contentWindow?.document.fonts) {
      await iframe.contentWindow.document.fonts.ready;
    }
    const images = doc.querySelectorAll('img');
    await Promise.all(
      Array.from(images).map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((res) => {
                img.onload = res;
                img.onerror = res;
              })
      )
    );
  } catch {
    // Ignore font loading errors
  }

  // 4. Focus and trigger print from isolated iframe
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.print();
    } finally {
      // Clean up iframe after printing dialog closes
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }
  }, 250);
};

/**
 * Downloads payment receipt as a PDF.
 */
export const downloadReceiptPdf = async (
  payment: Payment,
  settings: MerchantSettings
): Promise<void> => {
  payment = escapeStrings(payment);
  settings = { ...escapeStrings(settings), logo_url: escapeHtml(imageUrl(settings.logo_url)) };
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '718px';
  container.style.backgroundColor = '#ffffff';
  container.style.zIndex = '-9999';

  container.innerHTML = `
    <div class="sf-print-document" style="position:relative;isolation:isolate;font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif; direction: rtl; text-align: right; background-color: #ffffff; color: ${printTheme.text}; padding: 24px; border: 2px solid ${printTheme.text}; border-radius: 8px; margin: 0 auto;">
      ${documentWatermarkHtml}
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid ${printTheme.text}; padding-bottom: 12px; margin-bottom: 14px;">
        <div>
          ${settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg' ? `<img src="${settings.logo_url}" alt="شعار المنشأة" style="height:48px;max-width:120px;object-fit:contain;" />` : ''}
          <h2 style="margin: 0; font-size: 24px; font-weight: 600; color: ${printTheme.text};">${settings.business_name}</h2>
          <span style="font-size: 14px; color: ${printTheme.textMuted};">سند قبض واستلام نقدية</span>
        </div>
        <div style="text-align: left;">
          <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate; font-weight: 500; font-size: 14px; color: ${printTheme.text};">${payment.id}</span>
          <div style="font-size: 14px; color: ${printTheme.textMuted};">${payment.payment_date.split('T')[0]}</div>
        </div>
      </div>

      <div style="background-color: ${printTheme.surfaceRaised}; border: 1px solid ${printTheme.border}; border-radius: 12px; padding: 12px; margin-bottom: 14px; font-size: 14px; line-height: 1.8;">
        <div>وصلنا من السيد / السادة: <strong style="color: ${printTheme.text};">${payment.customer_name}</strong></div>
        <div>مبلغ وقدره: <strong style="color: ${printTheme.text}; font-size: 15px; font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate;">${formatMoney(payment.amount, payment.currency, settings)}</strong></div>
        ${payment.amount_in_other_currency ? `
          <div style="font-size: 14px; color: ${printTheme.textMuted};">(ما يعادل: ${formatMoney(payment.amount_in_other_currency, payment.currency === 'SDG' ? 'USD' : 'SDG', settings)})</div>
        ` : ''}
        <div>سداداً عن الفاتورة رقم: <strong style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate;">${payment.invoice_number}</strong></div>
        <div>طريقة السداد: <strong>${getPaymentMethodLabel(payment.payment_method)}</strong></div>
        ${payment.reference_number ? `<div>رقم العملية / الإشعار: <span style="font-family:'IBM Plex Sans Arabic', sans-serif; font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:isolate;">${payment.reference_number}</span></div>` : ''}
      </div>

      <div style="display: flex; justify-content: space-between; border-top: 1px solid ${printTheme.border}; padding-top: 20px; text-align: center; font-size: 14px; color: ${printTheme.textMuted};">
        <div style="width: 45%;">
          <p style="margin: 0 0 30px 0; font-weight: 500;">توقيع العميل / المسلم</p>
          <div style="border-bottom: 1px solid ${printTheme.controlBorder}; width: 120px; margin: 0 auto;"></div>
        </div>
        <div style="width: 45%;">
          <p style="margin: 0 0 30px 0; font-weight: 500;">توقيع وأمين الصندوق</p>
          <div style="border-bottom: 1px solid ${printTheme.controlBorder}; width: 120px; margin: 0 auto;"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const cleanNumber = payment.invoice_number.replace(/[^a-zA-Z0-9-_]/g, '_');
    await downloadDocumentPdf(container, `سند_قبض_${cleanNumber}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
};
