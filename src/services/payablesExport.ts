import type { Operations } from '../domain/operations';
import { downloadDocumentPdf } from './documentPdf';
type Report = Awaited<ReturnType<Operations['payableReports']>>;
export function downloadPayablesCsv(report: Report, supplierId: string) {
  const statement = report.statements.find(s => s.supplier_id === supplierId); if (!statement) throw new Error('اختر المورد أولاً.');
  const cell = (v: unknown) => { const value = typeof v === 'string' && /^\s*[=+@-]/.test(v) ? `'${v}` : String(v ?? ''); return `"${value.replace(/"/g, '""')}"`; };
  const rows = [['supplier_id','supplier_name','date','reference_type','reference_id','journal_id','line_index','source_type','source_id','source_reference','description','movement_sdg','movement_usd','balance_sdg','balance_usd'], [supplierId, statement.supplier_name, report.period.start, 'opening', '', '', '', '', '', '', '', 0, 0, statement.opening_sdg, statement.opening_usd], ...statement.rows.map(r => [supplierId, statement.supplier_name, r.date, r.reference_type, r.reference_id,r.journal_id,r.line_index,r.source_type,r.source_id,r.source_reference, r.description, r.movement_sdg, r.movement_usd, r.balance_sdg, r.balance_usd]), [supplierId, statement.supplier_name, report.period.end, 'closing', '', '', '', '', '', '', '', 0, 0, statement.closing_sdg, statement.closing_usd]];
  const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `supplier-${supplierId}-${report.period.end}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadPayablesPdf(report: Report, supplierId: string, businessName: string) {
  const statement = report.statements.find(s => s.supplier_id === supplierId); if (!statement) throw new Error('اختر المورد أولاً.');
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-10000px;top:0;width:718px;';
  const source = document.createElement('div'); source.className = 'sf-print-document'; source.dir = 'rtl'; source.style.cssText = "width:718px;background:#fff;color:#172d33;padding:20px;font:400 14px/1.6 'IBM Plex Sans Arabic',sans-serif;";
  const header = document.createElement('div'); header.dataset.pdfRepeat = 'header'; header.style.marginBottom = '16px';
  for (const line of [businessName, `كشف المورد: ${statement.supplier_name}`, `${report.period.start || 'البداية'} — ${report.period.end}`, 'القيم بالجنيه السوداني (SDG) والدولار (USD)']) { const p=document.createElement('p'); p.textContent=line; p.style.cssText='margin:0 0 8px;line-height:24px;'; header.appendChild(p); }
  source.appendChild(header);
  const summary = document.createElement('div'); summary.style.cssText = 'margin:16px 0;padding:12px;background:#edf5f2;line-height:24px;';
  for (const [label, sdg, usd] of [['الرصيد الافتتاحي', statement.opening_sdg, statement.opening_usd], ['الرصيد الختامي', statement.closing_sdg, statement.closing_usd]]) {
    const row=document.createElement('p');row.style.cssText='margin:0;line-height:24px;';const title=document.createElement('span');title.textContent=label+': ';const value=document.createElement('span');value.dir='ltr';value.style.unicodeBidi='isolate';value.textContent=`${sdg} SDG / ${usd} USD`;row.append(title,value);summary.appendChild(row);
  }
  source.appendChild(summary);
  const table = document.createElement('table'); table.style.cssText='width:100%;border-collapse:collapse;table-layout:fixed;';
  const addRow = (parent: HTMLElement, cells: unknown[], heading = false) => { const row=document.createElement('tr'); for (const value of cells) { const cell=document.createElement(heading?'th':'td'); cell.textContent=String(value); cell.style.cssText='border:1px solid #d2dedb;padding:8px;line-height:24px;overflow-wrap:anywhere;'; row.appendChild(cell); } parent.appendChild(row); };
  const head=document.createElement('thead'), body=document.createElement('tbody'); addRow(head,['التاريخ','الحركة والمرجع','رصيد SDG','رصيد USD'],true);
  for(const row of statement.rows) addRow(body,[row.date,`${row.description}\n${row.reference_type}:${row.reference_id}\n${row.source_type}:${row.source_id} — ${row.source_reference}`,row.balance_sdg,row.balance_usd]); table.append(head,body); source.appendChild(table);
  const footer=document.createElement('p'); footer.dataset.pdfRepeat='footer'; footer.style.cssText='margin:16px 0 0;line-height:24px;display:flex;justify-content:space-between;gap:16px;'; footer.textContent='SudaFlow — كشف مبني على قيود ذمم الموردين'; source.appendChild(footer); host.appendChild(source); document.body.appendChild(host);
  try { await downloadDocumentPdf(host, `supplier-${supplierId}-${report.period.end}.pdf`); } finally { host.remove(); }
}
