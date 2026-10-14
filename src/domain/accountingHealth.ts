import type { MerchantSettings } from '../types';
import type { Document } from './store';
import { reconcileFinancialData, type FinancialData, type Finding } from './reconciliation';
import { dateOnly } from './validation';

export type HealthSeverity = 'issue' | 'warning';
export interface HealthItem { id:string; severity:HealthSeverity; code:string; title:string; detail:string; action:string; source:{collection:string;id:string}; }
export interface HealthCheck { code:string; title:string; status:'passed'|'failed'; finding_count:number; }
export interface AccountingHealthReport { as_of:string; summary:{issues:number;warnings:number;passed_checks:number;failed_checks:number}; items:HealthItem[]; checks:HealthCheck[]; }

const labels:Record<string,string>={journal:'توازن القيود وربطها',receivables:'مطابقة ذمم العملاء',payables:'مطابقة ذمم الموردين',inventory:'مطابقة كميات وقيمة المخزون',cash:'مطابقة النقد والبنوك',sources:'سلامة المستندات والمراجع'};
const group=(finding:Finding)=>finding.collection==='journal_entries'?'journal':finding.collection==='customers'||finding.collection==='invoices'||finding.collection==='payments'?'receivables':finding.collection==='suppliers'||finding.collection==='purchase_bills'||finding.collection==='supplier_payments'?'payables':finding.collection==='products'||finding.collection==='inventory_movements'?'inventory':finding.collection.includes('reconciliation')||finding.collection==='financial_accounts'?'cash':'sources';
const amount=(row:Document)=>Number(row.remaining_sdg||0)!==0||Number(row.remaining_usd||0)!==0;
const overdue=(value:unknown,asOf:string)=>typeof value==='string'&&dateOnly(value)<asOf;

/** Read-only deterministic evidence. It never posts, fixes or rewrites financial history. */
export function buildAccountingHealth(data:FinancialData,settings:MerchantSettings,asOfInput:string):AccountingHealthReport{
  const asOf=dateOnly(asOfInput),findings=reconcileFinancialData(data,settings,{requireCosting:true}),items:HealthItem[]=[];
  for(const finding of findings)items.push({id:`finding:${finding.collection}:${finding.id}:${finding.code}:${finding.field||''}`,severity:'issue',code:finding.code,title:'فرق يحتاج مراجعة',detail:finding.message||`${finding.collection}/${finding.id}${finding.field?` — ${finding.field}`:''}`,action:'افتح مركز المحاسبة وراجع المصدر والقيد المرتبط؛ لا تُعدّل السجل التاريخي مباشرة.',source:{collection:finding.collection,id:finding.id}});
  for(const invoice of data.invoices||[])if(invoice.status!=='void'&&amount(invoice)&&overdue(invoice.due_date,asOf))items.push({id:`overdue-invoice:${invoice.id}`,severity:'warning',code:'customer_overdue',title:'فاتورة عميل متأخرة',detail:`${invoice.invoice_number||invoice.id} مستحقة منذ ${invoice.due_date}.`,action:'راجع كشف العميل وسجّل التحصيل أو التصحيح من العملية الأصلية.',source:{collection:'invoices',id:invoice.id}});
  for(const bill of data.purchase_bills||[])if(bill.status!=='paid'&&amount(bill)&&overdue(bill.due_date,asOf))items.push({id:`overdue-bill:${bill.id}`,severity:'warning',code:'supplier_overdue',title:'فاتورة مورد متأخرة',detail:`${bill.supplier_reference||bill.id} مستحقة منذ ${bill.due_date}.`,action:'راجع كشف المورد وجدول السداد قبل إنشاء دفعة.',source:{collection:'purchase_bills',id:bill.id}});
  for(const customer of data.customers||[])for(const currency of ['SDG','USD'] as const){const key=currency.toLowerCase(),limit=customer[`credit_limit_${key}`],balance=Number(customer[`balance_${key}`]||0);if(limit!==undefined&&limit!==null&&balance>Number(limit))items.push({id:`credit:${customer.id}:${currency}`,severity:'warning',code:'credit_limit_exceeded',title:'تجاوز حد ائتمان عميل',detail:`${customer.name||customer.id}: الرصيد ${balance} ${currency} يتجاوز الحد ${limit}.`,action:'راجع كشف العميل وحد الائتمان قبل بيع آجل جديد.',source:{collection:'customers',id:customer.id}});}
  for(const record of [...data.bank_reconciliations||[],...data.cash_reconciliations||[]])if(Number(record.difference||0)!==0||Number(record.opening_difference||0)!==0)items.push({id:`cash-difference:${record.id}`,severity:'warning',code:'cash_discrepancy',title:'فرق مطابقة نقد أو بنك',detail:`إثبات المطابقة ${record.id} يحتوي فرقاً موثقاً يحتاج تسوية.`,action:'راجع حركات الحساب والإثبات، ثم أنشئ تسوية معتمدة عند الحاجة.',source:{collection:record.statement_lines?'bank_reconciliations':'cash_reconciliations',id:record.id}});
  const grouped=new Map<string,number>();for(const finding of findings)grouped.set(group(finding),(grouped.get(group(finding))||0)+1);
  const checks=Object.entries(labels).map(([code,title])=>({code,title,status:grouped.has(code)?'failed' as const:'passed' as const,finding_count:grouped.get(code)||0}));
  items.sort((a,b)=>a.severity===b.severity?a.id.localeCompare(b.id):a.severity==='issue'?-1:1);
  return{as_of:asOf,summary:{issues:items.filter(x=>x.severity==='issue').length,warnings:items.filter(x=>x.severity==='warning').length,passed_checks:checks.filter(x=>x.status==='passed').length,failed_checks:checks.filter(x=>x.status==='failed').length},items,checks};
}
