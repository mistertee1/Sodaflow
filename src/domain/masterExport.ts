import type { ActionType } from '../services/rbacService';
import type { OrgRole } from '../types';
import { ensure } from './validation';
import type { Document } from './store';

export type MasterExportModule = 'customers' | 'suppliers' | 'products' | 'invoices';
export const masterExportPermission = (module: MasterExportModule): ActionType => `export:${module}` as ActionType;
const modules = new Set<MasterExportModule>(['customers','suppliers','products','invoices']);
export const masterExportModule = (value: unknown): MasterExportModule => { ensure(typeof value === 'string' && modules.has(value as MasterExportModule), 'نوع التصدير السريع غير صالح.'); return value as MasterExportModule; };

type Cell = string | number | boolean | null | undefined;
type Column = { key: string; label: string; sensitive?: boolean };
const columns: Record<MasterExportModule, Column[]> = {
  customers: [
    {key:'id',label:'customer_id'},{key:'name',label:'name'},{key:'phone',label:'phone',sensitive:true},{key:'email',label:'email',sensitive:true},{key:'address',label:'address',sensitive:true},{key:'preferred_currency',label:'preferred_currency'},{key:'balance_sdg',label:'balance_sdg'},{key:'balance_usd',label:'balance_usd'},{key:'credit_limit_sdg',label:'credit_limit_sdg'},{key:'credit_limit_usd',label:'credit_limit_usd'},{key:'notes',label:'internal_notes',sensitive:true},
  ],
  suppliers: [
    {key:'id',label:'supplier_id'},{key:'name',label:'name'},{key:'phone',label:'phone',sensitive:true},{key:'email',label:'email',sensitive:true},{key:'address',label:'address',sensitive:true},{key:'tax_number',label:'tax_number',sensitive:true},{key:'default_currency',label:'default_currency'},{key:'payment_terms_days',label:'payment_terms_days'},{key:'credit_limit',label:'credit_limit'},{key:'payable_due_sdg',label:'payable_due_sdg'},{key:'payable_due_usd',label:'payable_due_usd'},{key:'status',label:'status'},{key:'notes',label:'internal_notes',sensitive:true},
  ],
  products: [
    {key:'id',label:'product_id'},{key:'name',label:'name'},{key:'description',label:'description'},{key:'category',label:'category'},{key:'unit',label:'unit'},{key:'price_sdg',label:'price_sdg'},{key:'price_usd',label:'price_usd'},{key:'tax_rate',label:'tax_rate'},{key:'stock_quantity',label:'stock_quantity'},{key:'min_stock_alert',label:'min_stock_alert'},{key:'average_cost_sdg',label:'average_cost_sdg',sensitive:true},{key:'average_cost_usd',label:'average_cost_usd',sensitive:true},{key:'inventory_value_sdg',label:'inventory_value_sdg',sensitive:true},{key:'inventory_value_usd',label:'inventory_value_usd',sensitive:true},{key:'cost_status',label:'cost_status',sensitive:true},{key:'is_active',label:'is_active'},
  ],
  invoices: [
    {key:'id',label:'invoice_id'},{key:'invoice_number',label:'invoice_number'},{key:'customer_id',label:'customer_id'},{key:'customer_name',label:'customer_name'},{key:'issue_date',label:'issue_date'},{key:'due_date',label:'due_date'},{key:'status',label:'status'},{key:'currency_mode',label:'currency_mode'},{key:'exchange_rate',label:'exchange_rate'},{key:'subtotal_sdg',label:'subtotal_sdg'},{key:'subtotal_usd',label:'subtotal_usd'},{key:'tax_amount_sdg',label:'tax_amount_sdg'},{key:'tax_amount_usd',label:'tax_amount_usd'},{key:'discount_amount_sdg',label:'discount_amount_sdg'},{key:'discount_amount_usd',label:'discount_amount_usd'},{key:'grand_total_sdg',label:'grand_total_sdg'},{key:'grand_total_usd',label:'grand_total_usd'},{key:'paid_amount_sdg',label:'paid_amount_sdg'},{key:'paid_amount_usd',label:'paid_amount_usd'},{key:'remaining_sdg',label:'remaining_sdg'},{key:'remaining_usd',label:'remaining_usd'},{key:'customer_phone',label:'customer_phone',sensitive:true},{key:'customer_email',label:'customer_email',sensitive:true},{key:'notes',label:'internal_notes',sensitive:true},{key:'cogs_sdg',label:'cogs_sdg',sensitive:true},{key:'cogs_usd',label:'cogs_usd',sensitive:true},
  ],
};
const xml = (value: unknown) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const cell = (value: Cell) => typeof value === 'number' && Number.isFinite(value)
  ? `<Cell><Data ss:Type="Number">${value}</Data></Cell>`
  : typeof value === 'boolean' ? `<Cell><Data ss:Type="Boolean">${value ? 1 : 0}</Data></Cell>`
  : `<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`;

export function buildMasterExport(module: MasterExportModule, source: Document[], role: OrgRole, orgId: string, createdAt: string, operationId: string) {
  ensure(source.length <= 2000, 'التصدير السريع محدود بـ 2000 سجل؛ استخدم تصدير الشركة المجدول للحجم الأكبر.', 413);
  ensure(source.every(row => row.org_id === undefined || row.org_id === orgId), 'عُثر على سجل من مؤسسة أخرى في التصدير.', 409);
  const authorizedSensitive = ['Owner','Admin','Accountant'].includes(role);
  const selected = columns[module].filter(column => authorizedSensitive || !column.sensitive);
  const maskedFields = columns[module].filter(column => column.sensitive && !authorizedSensitive).map(column => column.label);
  const rows = [...source].sort((a,b) => String(a.id || '').localeCompare(String(b.id || '')));
  const table = `<Row>${selected.map(column => cell(column.label)).join('')}</Row>${rows.map(row => `<Row>${selected.map(column => cell(row[column.key] as Cell)).join('')}</Row>`).join('')}`;
  const summary = `<Row>${cell('export_type')}${cell('quick')}</Row><Row>${cell('module')}${cell(module)}</Row><Row>${cell('record_count')}${cell(rows.length)}</Row><Row>${cell('created_at')}${cell(createdAt)}</Row><Row>${cell('masked_fields')}${cell(maskedFields.join(','))}</Row>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${xml(module)}"><Table>${table}</Table></Worksheet><Worksheet ss:Name="Export_Summary"><Table>${summary}</Table></Worksheet></Workbook>`;
  const bytes = new TextEncoder().encode(workbook); ensure(bytes.length <= 650000, 'حجم ملف Excel يتجاوز حد التصدير السريع.', 413);
  let binary=''; for(const byte of bytes)binary+=String.fromCharCode(byte);
  return { schema_version:1, id:`export-${operationId}`, export_type:'quick', module, format:'excel-xml', filename:`sudaflow-${module}-${createdAt.slice(0,10)}.xls`, mime_type:'application/vnd.ms-excel', record_count:rows.length, masked_fields:maskedFields, workbook_base64:btoa(binary), created_at:createdAt };
}
