import type { OperationalReportTypes, OperationalView } from '../domain/operationalReports';
import { downloadDocumentPdf } from './documentPdf';
export type OperationalResponse = { [View in OperationalView]: OperationalReportTypes[View] & { organizationId: string; generatedAt: string; view: View } }[OperationalView];
type Table = { title: string; headers: string[]; rows: unknown[][]; opening: string; closing: string };
const balances = (sdg: number, usd: number) => `${sdg} SDG / ${usd} USD`;
function exportTable(report: OperationalResponse, selected: string): Table {
  if (report.view === 'receivables') {
    const statement = report.statements.find(row => row.customer_id === selected); if (!statement) throw new Error('اختر العميل أولاً.');
    return { title: `كشف العميل: ${statement.customer_name}`, opening: balances(statement.opening_sdg, statement.opening_usd), closing: balances(statement.closing_sdg, statement.closing_usd), headers: ['التاريخ', 'معرّف القيد', 'المرجع', 'المصدر', 'مرجع المصدر', 'البيان', 'مدين SDG', 'دائن SDG', 'رصيد SDG', 'مدين USD', 'دائن USD', 'رصيد USD'], rows: statement.rows.map(row => [row.date, `${row.journal_id}:${row.line_index}`, `${row.reference_type}:${row.reference_id}`, `${row.source_type}:${row.source_id}`, row.source_reference, row.description, row.debit_sdg, row.credit_sdg, row.balance_sdg, row.debit_usd, row.credit_usd, row.balance_usd]) };
  }
  if (report.view === 'cash') return { title: 'أرصدة النقدية والبنوك', opening: balances(report.opening_sdg, report.opening_usd), closing: balances(report.closing_sdg, report.closing_usd), headers: ['رمز الحساب', 'اسم الحساب', 'رصيد افتتاحي SDG', 'رصيد ختامي SDG', 'رصيد افتتاحي USD', 'رصيد ختامي USD'], rows: report.accounts.map(row => [row.account.code, row.account.name_ar, row.opening.SDG, row.closing.SDG, row.opening.USD, row.closing.USD]) };
  return { title: `دفتر الأستاذ: ${report.account.code} — ${report.account.name_ar}`, opening: report.currencies.map(book => `${report.opening[book]} ${book}`).join(' / '), closing: report.currencies.map(book => `${report.closing[book]} ${book}`).join(' / '), headers: ['التاريخ', 'معرّف القيد', 'المرجع', 'البيان', ...report.currencies.flatMap(book => [`مدين ${book}`, `دائن ${book}`, `رصيد ${book}`])], rows: report.rows.map(row => [row.date, `${row.journal_id}:${row.line_index}`, `${row.reference_type}:${row.reference_id}`, row.description, ...report.currencies.flatMap(book => [row.debit[book], row.credit[book], row.balance[book]])]) };
}
export function operationalCsv(report: OperationalResponse, selected = '') {
  const table = exportTable(report, selected);
  const cell = (value: unknown) => { const text = typeof value === 'string' && /^\s*[=+@-]/.test(value) ? `'${value}` : String(value ?? ''); return `"${text.replace(/"/g, '""')}"`; };
  const rows = [['report', report.view, 'organization_id', report.organizationId], ['title', table.title], ['start', report.period.start, 'end', report.period.end], ['opening', table.opening, 'closing', table.closing], table.headers, ...table.rows];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
export function downloadOperationalCsv(report: OperationalResponse, selected = '') {
  const url = URL.createObjectURL(new Blob([operationalCsv(report, selected)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${report.view}-${selected || 'accounts'}-${report.period.end}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadOperationalPdf(report: OperationalResponse, selected: string, businessName: string) {
  const tableData = exportTable(report, selected), host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-10000px;top:0;width:718px;';
  const source = document.createElement('div'); source.className = 'sf-print-document'; source.dir = 'rtl'; source.style.cssText = "width:718px;background:white;color:#172d33;padding:20px;font:400 14px/1.6 'IBM Plex Sans Arabic',sans-serif;";
  const header = document.createElement('div'); header.dataset.pdfRepeat = 'header'; header.style.marginBottom = '16px';
  for (const line of [businessName, tableData.title, `${report.period.start || 'البداية'} — ${report.period.end}`]) { const p = document.createElement('p'); p.textContent = line; p.style.cssText = 'margin:0 0 8px;line-height:24px;'; header.appendChild(p); }
  source.appendChild(header);
  const summary = document.createElement('div'); summary.style.cssText = 'margin:16px 0;padding:12px;background:#edf5f2;';
  for (const [label, value] of [['الرصيد الافتتاحي', tableData.opening], ['الرصيد الختامي', tableData.closing]]) { const p = document.createElement('p'); p.style.cssText = 'margin:0;line-height:24px;'; const caption = document.createElement('span'), amount = document.createElement('span'); caption.textContent = label + ': '; amount.textContent = value; amount.dir = 'ltr'; amount.style.unicodeBidi = 'isolate'; p.append(caption, amount); summary.appendChild(p); } source.appendChild(summary);
  // Keep the PDF readable at A4 width. Full source identifiers and debit/credit columns remain in CSV.
  const table = document.createElement('table'); table.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse;'; const head = document.createElement('thead'), body = document.createElement('tbody');
  const addRow = (target: HTMLElement, values: unknown[], heading = false) => { const row = document.createElement('tr'); for (const value of values) { const cell = document.createElement(heading ? 'th' : 'td'); cell.textContent = String(value ?? ''); cell.style.cssText = 'border:1px solid #d2dedb;padding:8px;line-height:24px;overflow-wrap:anywhere;'; row.appendChild(cell); } target.appendChild(row); };
  if (report.view === 'cash') { addRow(head, ['الحساب', 'الافتتاحي SDG / USD', 'الختامي SDG / USD'], true); for (const row of report.accounts) addRow(body, [`${row.account.code} — ${row.account.name_ar}`, balances(row.opening.SDG || 0, row.opening.USD || 0), balances(row.closing.SDG || 0, row.closing.USD || 0)]); }
  else if (report.view === 'receivables') { addRow(head, ['التاريخ', 'الحركة والمرجع', 'رصيد SDG', 'رصيد USD'], true); for (const row of report.statements.find(s => s.customer_id === selected)!.rows) addRow(body, [row.date, `${row.description}\n${row.reference_type}:${row.reference_id}\n${row.source_type}:${row.source_id} — ${row.source_reference}`, row.balance_sdg, row.balance_usd]); }
  else { addRow(head, ['التاريخ', 'الحركة والمرجع', ...report.currencies.map(book => `رصيد ${book}`)], true); for (const row of report.rows) addRow(body, [row.date, `${row.description}\n${row.reference_type}:${row.reference_id}`, ...report.currencies.map(book => row.balance[book])]); }
  table.append(head, body); source.appendChild(table); const footer = document.createElement('p'); footer.dataset.pdfRepeat = 'footer'; footer.style.cssText = 'margin:16px 0 0;line-height:24px;display:flex;justify-content:space-between;gap:16px;'; footer.textContent = 'SudaFlow — كشف مبني على دفتر الأستاذ'; source.appendChild(footer); host.appendChild(source); document.body.appendChild(host);
  try { await downloadDocumentPdf(host, `${report.view}-${selected || 'accounts'}-${report.period.end}.pdf`); } finally { host.remove(); }
}
