import { jsPDF } from 'jspdf';
import { escapeHtml, escapeStrings, imageUrl } from '../lib/html';
import html2canvas from 'html2canvas';
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
  const rawRate = invoice.exchange_rate_used || settings.default_exchange_rate || 0;
  const formattedRate = rawRate > 0 ? formatMoney(rawRate, 'SDG', settings) : 'غير محدد';

  const paymentRowsHtml = invoicePayments.length > 0
    ? invoicePayments.map((p) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 6px 10px; font-family: monospace; color: #475569;">${p.payment_date.split('T')[0]}</td>
          <td style="padding: 6px 10px; color: #1e293b;">${getPaymentMethodLabel(p.payment_method)}</td>
          <td style="padding: 6px 10px; font-family: monospace; color: #475569;">${p.reference_number || '-'}</td>
          <td style="padding: 6px 10px; text-align: left; font-family: monospace; font-weight: bold; color: #047857;">
            ${formatMoney(p.amount, p.currency, settings)}
          </td>
        </tr>
      `).join('')
    : '';

  const itemsRowsHtml = (invoice.items || []).map((item, idx) => `
    <tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
      <td style="padding: 8px 10px; color: #64748b; font-family: monospace;">${idx + 1}</td>
      <td style="padding: 8px 10px; font-weight: 600; color: #0f172a;">${item.description}</td>
      <td style="padding: 8px 10px; text-align: center; font-family: monospace; color: #334155;">
        ${item.quantity} ${item.unit || ''}
      </td>
      <td style="padding: 8px 10px; text-align: center; font-family: monospace; color: #334155;">
        ${formatMoney(item.unit_price, item.currency, settings)}
      </td>
      <td style="padding: 8px 10px; text-align: left; font-family: monospace; font-weight: bold; color: #047857;">
        ${formatMoney(item.line_total, item.currency, settings)}
      </td>
    </tr>
  `).join('');

  return `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; direction: rtl; text-align: right; background-color: #ffffff; color: #0f172a; padding: 24px; max-width: 800px; margin: 0 auto; box-sizing: border-box; line-height: 1.5;">
      
      <!-- Top Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 16px;">
        <div>
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
            ${settings.logo_url && settings.logo_url !== '/hisabuk_logo.jpg'
              ? `<img src="${settings.logo_url}" alt="Logo" style="height: 48px; max-width: 120px; object-fit: contain; border-radius: 6px;" />`
              : ''
            }
            <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #0f172a;">${settings.business_name || 'اسم المنشأة'}</h1>
          </div>
          <p style="margin: 2px 0; font-size: 12px; color: #475569;">
            ${settings.address ? `<span>${settings.address} • </span>` : ''}
            <span>هاتف: ${settings.phone || '-'}</span>
          </p>
          ${settings.bank_details ? `<p style="margin: 2px 0; font-size: 11px; font-family: monospace; color: #047857; font-weight: bold;">${settings.bank_details}</p>` : ''}
        </div>

        <div style="text-align: left;">
          <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 4px;">
            فاتورة ضريبية / مبيعات
          </div>
          <div style="font-family: monospace; font-size: 18px; font-weight: 900; color: #047857;">
            ${invoice.invoice_number}
          </div>
          <div style="font-size: 12px; color: #475569; margin-top: 4px;">
            <div>تاريخ الإصدار: <span style="font-family: monospace; font-weight: bold;">${invoice.issue_date}</span></div>
            ${invoice.due_date ? `<div>تاريخ الاستحقاق: <span style="font-family: monospace;">${invoice.due_date}</span></div>` : ''}
          </div>
          <div style="margin-top: 6px;">
            <span style="display: inline-block; font-size: 11px; font-weight: bold; padding: 2px 8px; border-radius: 12px; background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;">
              ${statusInfo.label}
            </span>
          </div>
        </div>
      </div>

      <!-- Customer Details & Frozen Exchange Rate -->
      <div style="display: flex; justify-content: space-between; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 18px;">
        <div>
          <span style="display: block; font-size: 11px; font-weight: bold; color: #64748b; margin-bottom: 4px;">فاتورة إلى العميل:</span>
          <h2 style="margin: 0; font-size: 15px; font-weight: 800; color: #0f172a;">${invoice.customer_name || 'عميل نقدي'}</h2>
          ${invoice.customer_phone ? `<div style="font-size: 12px; color: #334155; margin-top: 2px;">الهاتف: ${invoice.customer_phone}</div>` : ''}
          ${invoice.customer_address ? `<div style="font-size: 12px; color: #475569; margin-top: 2px;">العنوان: ${invoice.customer_address}</div>` : ''}
        </div>

        <div style="text-align: left; display: flex; flex-direction: column; justify-content: center;">
          <div style="font-size: 12px; font-weight: bold; color: #047857; background-color: #ecfdf5; padding: 4px 10px; border-radius: 6px; border: 1px solid #a7f3d0; display: inline-block;">
            سعر الصرف المجمّد: 1$ = ${formattedRate}
          </div>
          <span style="font-size: 10px; color: #64748b; margin-top: 4px;">
            تم تجميد هذا السعر وقت إصدار الفاتورة لضمان دقة الحسابات
          </span>
        </div>
      </div>

      <!-- Products & Items Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 12px;">
        <thead>
          <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; color: #0f172a; font-weight: bold;">
            <th style="padding: 8px 10px; text-align: right; width: 30px;">#</th>
            <th style="padding: 8px 10px; text-align: right;">الوصف / الصنف</th>
            <th style="padding: 8px 10px; text-align: center; width: 80px;">الكمية</th>
            <th style="padding: 8px 10px; text-align: center; width: 110px;">سعر الوحدة</th>
            <th style="padding: 8px 10px; text-align: left; width: 120px;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRowsHtml}
        </tbody>
      </table>

      <!-- Financial Totals (Dual Currency) -->
      <div style="display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px;">
        <!-- Notes & Payment Info -->
        <div style="flex: 1; font-size: 11px;">
          ${invoice.notes ? `
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
              <span style="font-weight: bold; color: #334155; display: block; margin-bottom: 2px;">ملاحظات:</span>
              <p style="margin: 0; color: #475569; white-space: pre-line;">${invoice.notes}</p>
            </div>
          ` : ''}
          ${invoice.payment_instructions ? `
            <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 10px;">
              <span style="font-weight: bold; color: #047857; display: block; margin-bottom: 2px;">تعليمات السداد والتحويل:</span>
              <p style="margin: 0; color: #166534; font-family: monospace;">${invoice.payment_instructions}</p>
            </div>
          ` : ''}
        </div>

        <!-- Totals Card -->
        <div style="width: 320px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-size: 12px; box-sizing: border-box;">
          <div style="display: flex; justify-content: space-between; padding: 3px 0; color: #475569;">
            <span>المجموع الفرعي:</span>
            <span style="font-family: monospace; font-weight: bold; color: #0f172a;">${formatMoney(invoice.subtotal_sdg, 'SDG', settings)}</span>
          </div>

          ${invoice.discount_total_sdg > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 3px 0; color: #b91c1c;">
              <span>الخصم الممنوح:</span>
              <span style="font-family: monospace; font-weight: bold;">- ${formatMoney(invoice.discount_total_sdg, 'SDG', settings)}</span>
            </div>
          ` : ''}

          ${invoice.tax_total_sdg > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 3px 0; color: #475569;">
              <span>الضريبة:</span>
              <span style="font-family: monospace; font-weight: bold; color: #0f172a;">+ ${formatMoney(invoice.tax_total_sdg, 'SDG', settings)}</span>
            </div>
          ` : ''}

          <!-- Grand Total Box -->
          <div style="border-top: 2px solid #cbd5e1; margin-top: 8px; padding-top: 8px;">
            <div style="font-size: 11px; font-weight: bold; color: #334155; margin-bottom: 2px;">
              المبلغ الإجمالي النهائي (بالعملتين):
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-family: monospace; font-size: 16px; font-weight: 900; color: #0f172a;">
                ${formatMoney(invoice.grand_total_sdg, 'SDG', settings)}
              </span>
              <span style="font-family: monospace; font-size: 13px; font-weight: bold; color: #047857; background-color: #ecfdf5; padding: 2px 6px; border-radius: 4px; border: 1px solid #a7f3d0;">
                ${formatMoney(invoice.grand_total_usd, 'USD', settings)}
              </span>
            </div>
          </div>

          <!-- Paid & Remaining -->
          <div style="border-top: 1px solid #e2e8f0; margin-top: 8px; padding-top: 6px;">
            <div style="display: flex; justify-content: space-between; color: #047857; font-size: 11px;">
              <span>المبلغ المسدد:</span>
              <span style="font-family: monospace; font-weight: bold;">
                ${formatMoney(invoice.paid_amount_sdg, 'SDG', settings)} (${formatMoney(invoice.paid_amount_usd, 'USD', settings)})
              </span>
            </div>
            <div style="display: flex; justify-content: space-between; color: #b91c1c; font-size: 12px; font-weight: bold; margin-top: 2px;">
              <span>المتبقي المطلوب:</span>
              <span style="font-family: monospace;">
                ${formatMoney(invoice.remaining_sdg, 'SDG', settings)} (${formatMoney(invoice.remaining_usd, 'USD', settings)})
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Payment History Table if any -->
      ${invoicePayments.length > 0 ? `
        <div style="margin-bottom: 18px;">
          <h4 style="margin: 0 0 6px 0; font-size: 12px; font-weight: bold; color: #0f172a;">
            سجل الدفعات وسندات القبض المسجلة (${invoicePayments.length})
          </h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
            <thead>
              <tr style="background-color: #f1f5f9; border-bottom: 1px solid #cbd5e1; color: #475569; font-weight: bold;">
                <th style="padding: 6px 10px; text-align: right;">التاريخ</th>
                <th style="padding: 6px 10px; text-align: right;">طريقة الدفع</th>
                <th style="padding: 6px 10px; text-align: right;">رقم العملية / الإشعار</th>
                <th style="padding: 6px 10px; text-align: left;">المبلغ المستلم</th>
              </tr>
            </thead>
            <tbody>
              ${paymentRowsHtml}
            </tbody>
          </table>
        </div>
      ` : ''}

      <!-- Signatures & Official Stamp -->
      <div style="display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 20px; margin-top: 20px; text-align: center; font-size: 11px; color: #475569;">
        <div style="width: 40%;">
          <p style="margin: 0 0 35px 0; font-weight: bold; color: #334155;">توقيع المستلم / العميل</p>
          <div style="border-bottom: 1px solid #94a3b8; width: 140px; margin: 0 auto;"></div>
        </div>
        <div style="width: 40%;">
          <p style="margin: 0 0 35px 0; font-weight: bold; color: #334155;">الختم والتوقيع المعتمد</p>
          <div style="border-bottom: 1px solid #94a3b8; width: 140px; margin: 0 auto;"></div>
        </div>
      </div>

      <!-- Watermark Certification -->
      <div style="border-top: 1px solid #e2e8f0; margin-top: 16px; padding-top: 8px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b;">
        <span>تم إنشاء هذه الوثيقة عبر سودافلو</span>
        <span style="font-family: monospace; font-weight: bold;">SudaFlow</span>
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
  container.style.width = '800px';
  container.style.backgroundColor = '#ffffff';
  container.style.zIndex = '-9999';
  container.innerHTML = buildInvoiceHtml(invoice, settings, invoicePayments);
  document.body.appendChild(container);

  try {
    // 2. Wait for web fonts and images to load
    if (document.fonts) {
      await document.fonts.ready;
    }
    const images = container.querySelectorAll('img');
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

    // 3. Render container to high-DPI canvas
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 800,
    });

    // 4. Initialize A4 jsPDF (210mm x 297mm)
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = (canvas.height * contentWidth) / canvas.width;

    const imgData = canvas.toDataURL('image/png');

    // Handle pagination if content exceeds single page
    let heightLeft = contentHeight;
    let position = margin;

    pdf.addImage(imgData, 'PNG', margin, position, contentWidth, contentHeight);
    heightLeft -= (pageHeight - margin * 2);

    while (heightLeft > 0) {
      position = heightLeft - contentHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, position, contentWidth, contentHeight);
      heightLeft -= (pageHeight - margin * 2);
    }

    // 5. Trigger download
    const cleanNumber = invoice.invoice_number.replace(/[^a-zA-Z0-9-_]/g, '_');
    pdf.save(`فاتورة_${cleanNumber}.pdf`);
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
            color: #0f172a !important;
            font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          @media print {
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
  settings = escapeStrings(settings);
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '600px';
  container.style.backgroundColor = '#ffffff';
  container.style.zIndex = '-9999';

  container.innerHTML = `
    <div style="font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif; direction: rtl; text-align: right; background-color: #ffffff; color: #0f172a; padding: 24px; border: 2px solid #0f172a; border-radius: 8px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #047857; padding-bottom: 12px; margin-bottom: 14px;">
        <div>
          <h2 style="margin: 0; font-size: 18px; font-weight: 900; color: #0f172a;">${settings.business_name}</h2>
          <span style="font-size: 11px; color: #64748b;">سند قبض واستلام نقدية</span>
        </div>
        <div style="text-align: left;">
          <span style="font-family: monospace; font-weight: bold; font-size: 14px; color: #047857;">${payment.id}</span>
          <div style="font-size: 11px; color: #64748b;">${payment.payment_date.split('T')[0]}</div>
        </div>
      </div>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-bottom: 14px; font-size: 13px; line-height: 1.8;">
        <div>وصلنا من السيد / السادة: <strong style="color: #0f172a;">${payment.customer_name}</strong></div>
        <div>مبلغ وقدره: <strong style="color: #047857; font-size: 15px; font-family: monospace;">${formatMoney(payment.amount, payment.currency, settings)}</strong></div>
        ${payment.amount_in_other_currency ? `
          <div style="font-size: 11px; color: #64748b;">(ما يعادل: ${formatMoney(payment.amount_in_other_currency, payment.currency === 'SDG' ? 'USD' : 'SDG', settings)})</div>
        ` : ''}
        <div>سداداً عن الفاتورة رقم: <strong style="font-family: monospace;">${payment.invoice_number}</strong></div>
        <div>طريقة السداد: <strong>${getPaymentMethodLabel(payment.payment_method)}</strong></div>
        ${payment.reference_number ? `<div>رقم العملية / الإشعار: <span style="font-family: monospace;">${payment.reference_number}</span></div>` : ''}
      </div>

      <div style="display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 20px; text-align: center; font-size: 11px; color: #475569;">
        <div style="width: 45%;">
          <p style="margin: 0 0 30px 0; font-weight: bold;">توقيع العميل / المسلم</p>
          <div style="border-bottom: 1px solid #94a3b8; width: 120px; margin: 0 auto;"></div>
        </div>
        <div style="width: 45%;">
          <p style="margin: 0 0 30px 0; font-weight: bold;">توقيع وأمين الصندوق</p>
          <div style="border-bottom: 1px solid #94a3b8; width: 120px; margin: 0 auto;"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const pdf = new jsPDF('p', 'mm', 'a5');
    const pageWidth = 148;
    const margin = 10;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = (canvas.height * contentWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/png');

    pdf.addImage(imgData, 'PNG', margin, margin, contentWidth, contentHeight);
    pdf.save(`سند_قبض_${payment.invoice_number}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
};
