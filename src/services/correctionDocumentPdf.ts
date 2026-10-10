import BigNumber from 'bignumber.js';
import type { CorrectionDocument } from '../domain/correctionDocuments';
import { downloadDocumentPdf } from './documentPdf';

const titles = { credit_note: 'إشعار دائن / مردود بيع', customer_refund: 'سند رد نقدي للعميل', purchase_return: 'مردود مشتريات', supplier_refund: 'سند استرداد من المورد' };
const amount = (value: number, book: 'SDG' | 'USD') => new Intl.NumberFormat('en-US', { minimumFractionDigits: book === 'USD' ? 2 : 0, maximumFractionDigits: book === 'USD' ? 2 : 0 }).format(value === 0 ? 0 : value) + ' ' + book;
const numeric = (value: unknown) => typeof value === 'number' ? String(value) : '—';
/** Safe text nodes and the established A4 row-aware renderer; no caller-supplied HTML. */
export function correctionDocumentTemplate(payload: CorrectionDocument): HTMLElement {
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-10000px;top:0;width:718px;';
  const source = document.createElement('div'); source.className = 'sf-print-document'; source.dir = 'rtl';
  source.style.cssText = "width:718px;background:white;color:#142c35;padding:20px;font:400 14px/1.7 'IBM Plex Sans Arabic',sans-serif;";
  host.appendChild(source);
  const paragraph = (parent: HTMLElement, label: string, value: string, ltr = false) => {
    const p = document.createElement('p'); p.style.cssText = 'margin:0 0 8px;overflow-wrap:anywhere;';
    const title = document.createElement('span'); title.textContent = label + ': ';
    const text = document.createElement('span'); text.textContent = value;
    if (ltr) { text.dir = 'ltr'; text.style.unicodeBidi = 'isolate'; }
    p.append(title, text); parent.appendChild(p);
  };
  const header = document.createElement('div'); header.dataset.pdfRepeat = 'header'; header.style.cssText = 'border-bottom:2px solid #087f75;margin-bottom:16px;padding-bottom:12px;';
  const heading = document.createElement('h1'); heading.textContent = payload.document_type==='credit_note' ? payload.document.kind==='sales_return' ? 'إشعار مردود بيع' : 'إشعار دائن - تصحيح سعر / خصم' : titles[payload.document_type]; heading.style.cssText = 'font-size:20px;line-height:32px;margin:0 0 8px;color:#087f75;'; header.appendChild(heading);
  paragraph(header, 'المنشأة', payload.business.name);
  if (payload.business.phone) paragraph(header, 'الهاتف', payload.business.phone, true);
  if (payload.business.address) paragraph(header, 'العنوان', payload.business.address);
  paragraph(header, 'المستند', payload.document.id, true);
  paragraph(header, 'المصدر', payload.source.number, true);
  source.appendChild(header);
  const row = payload.document;
  const summary = document.createElement('div'); summary.style.cssText = 'background:#edf3f0;padding:12px;margin-bottom:16px;';
  paragraph(summary, 'الطرف', payload.source.partner_name);
  paragraph(summary, 'عملة المصدر', payload.source.currency, true);
  paragraph(summary, 'التاريخ', row.date, true); paragraph(summary, 'السبب', row.reason);
  paragraph(summary, 'قيد اليومية', row.journal_id || 'حركة بضاعة صفرية دون قيد مالي', true);
  paragraph(summary, 'تسلسل المصدر', String(row.source_sequence), true);
  const pair = (label: string, sdg: number, usd: number) => paragraph(summary, label, `${amount(sdg, 'SDG')} / ${amount(usd, 'USD')}`, true);
  if (payload.document_type === 'credit_note') {
    const total=(component:string,book:string)=>payload.lines.reduce((sum,line)=>sum.plus(line.allocated?.[component]?.[book]||0),new BigNumber(0)).toNumber();
    pair('التخفيض قبل الضريبة', total('revenue','sdg'), total('revenue','usd'));
    pair('الضريبة المعكوسة', total('tax','sdg'), total('tax','usd'));
    pair('تخفيض الفاتورة', row.credit_sdg, row.credit_usd);
    if (row.kind === 'sales_return') pair('تكلفة المخزون المستعادة', row.restored_cost_sdg, row.restored_cost_usd);
  } else if (payload.document_type === 'purchase_return') {
    pair('رصيد المورد بالقيمة الأصلية', row.supplier_credit_sdg, row.supplier_credit_usd);
    pair('تكلفة المخزون الخارج', row.inventory_out_sdg, row.inventory_out_usd);
    pair('فرق التكلفة (دائن موجب / مدين سالب)', row.variance_sdg, row.variance_usd);
  } else {
    if (payload.financial_account) { paragraph(summary, 'الحساب المالي', payload.financial_account.name); paragraph(summary, 'رمز الحساب', payload.financial_account.account_code, true); }
    paragraph(summary, 'عملة التحصيل / الدفع', row.currency, true);
    paragraph(summary, 'المبلغ النقدي', amount(row.amount, row.currency), true);
    paragraph(summary, 'سعر الصرف المستخدم', numeric(row.exchange_rate_used), true);
    pair('القيمة الدفترية المسوّاة', row.settled_amount_sdg, row.settled_amount_usd);
    pair('النقد بالدفترين', row.cash_amount_sdg, row.cash_amount_usd);
    const direction = payload.document_type === 'customer_refund' ? -1 : 1;
    pair('فرق الصرف (ربح موجب / خسارة سالبة)', direction * (row.cash_amount_sdg - row.settled_amount_sdg), direction * (row.cash_amount_usd - row.settled_amount_usd));
  }
  source.appendChild(summary);
  const table = (headings: string[], rows: { value: string; ltr?: boolean; prefix?: string }[][]) => {
    const result = document.createElement('table'); result.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse;margin-bottom:16px;';
    const head = document.createElement('thead'), body = document.createElement('tbody'), tr = document.createElement('tr');
    for (const [index,title] of headings.entries()) { const th = document.createElement('th'); th.textContent = title; th.style.cssText = 'border:1px solid #d9e4df;padding:8px;background:#edf3f0;line-height:24px;'; th.style.width = [40,10,25,25][index] + '%'; tr.appendChild(th); }
    head.appendChild(tr);
    for (const cells of rows) { const tr = document.createElement('tr'); for (const item of cells) { const td = document.createElement('td'); if (item.prefix) { const prefix=document.createElement('bdi'); prefix.dir='ltr'; prefix.textContent=item.prefix+' / ';td.appendChild(prefix); } const text=document.createElement('span');text.dir=item.ltr?'ltr':'auto';text.style.unicodeBidi='isolate';text.textContent=item.value;td.appendChild(text); td.style.cssText = 'border:1px solid #d9e4df;padding:8px;line-height:24px;overflow-wrap:anywhere;'; if (item.ltr) { td.dir = 'ltr'; td.style.unicodeBidi = 'isolate'; } tr.appendChild(td); } body.appendChild(tr); }
    result.append(head, body); source.appendChild(result);
  };
  if (payload.lines.length) table(['بند المصدر / البيان', 'الكمية', 'القيمة SDG', 'القيمة USD'], payload.lines.map(line => {
    const credit = line.components?.supplier_credit || { sdg: (line.allocated?.revenue?.sdg || 0) + (line.allocated?.tax?.sdg || 0), usd: (line.allocated?.revenue?.usd || 0) + (line.allocated?.tax?.usd || 0) };
    return [{ value: line.description, prefix: line.line_id }, { value: numeric(line.quantity), ltr: true }, { value: amount(credit.sdg, 'SDG'), ltr: true }, { value: amount(credit.usd, 'USD'), ltr: true }];
  }));
  if (payload.stock.length) table(['الصنف المرتجع', 'الكمية', 'التكلفة SDG', 'التكلفة USD'], payload.stock.map(stock => [{ value: stock.product_name }, { value: numeric(stock.quantity), ltr: true }, { value: amount(stock.inventory_out_sdg, 'SDG'), ltr: true }, { value: amount(stock.inventory_out_usd, 'USD'), ltr: true }]));
  const evidence = document.createElement('div'); evidence.style.cssText = 'margin:16px 0;font-size:12px;';
  paragraph(evidence, 'مرجع العملية', row.operation_id, true); paragraph(evidence, 'من أنشأ المستند', row.created_by, true); paragraph(evidence, 'وقت الإنشاء', row.created_at, true); paragraph(evidence, 'وقت التصدير', payload.generated_at, true); source.appendChild(evidence);
  const footer = document.createElement('div'); footer.dataset.pdfRepeat = 'footer'; footer.style.cssText = 'margin-top:16px;padding-top:8px;border-top:1px solid #d9e4df;display:flex;justify-content:space-between;gap:12px;';
  const brand = document.createElement('span'); brand.textContent = 'SudaFlow - مستند مالي محفوظ؛ التصحيح بمستند جديد'; footer.appendChild(brand); source.appendChild(footer);
  return host;
}
export async function downloadCorrectionDocumentPdf(payload: CorrectionDocument) {
  const host = correctionDocumentTemplate(payload); document.body.appendChild(host);
  try { await downloadDocumentPdf(host, `${payload.document_type}-${payload.document.id}.pdf`); }
  finally { host.remove(); }
}
