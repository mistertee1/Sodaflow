import type { MerchantSettings } from '../types';
import type { Document } from './store';
import type { FinancialData } from './reconciliation';
import { buildAccountingHealth, type HealthItem } from './accountingHealth';
import { dateOnly } from './validation';

export type AssistancePriority='blocking'|'attention';
export type AssistanceCategory='reconciliation'|'receivables'|'payables'|'cash'|'inventory'|'margin'|'close'|'source';
export interface AssistanceTask {id:string;priority:AssistancePriority;category:AssistanceCategory;title:string;detail:string;proposed_action:string;review_route:string;source:{collection:string;id:string};execution:'manual_review';requires_confirmation:true;}
export interface AccountingAssistanceReport {as_of:string;summary:{blocking:number;attention:number;anomalies:number};tasks:AssistanceTask[];principle:'reviewable_no_automatic_financial_change';}

const route=(item:HealthItem):AssistanceCategory=>item.source.collection==='customers'||item.source.collection==='invoices'||item.source.collection==='payments'?'receivables':item.source.collection==='suppliers'||item.source.collection==='purchase_bills'||item.source.collection==='supplier_payments'?'payables':item.source.collection.includes('reconciliation')||item.source.collection==='financial_accounts'?'cash':item.source.collection==='products'||item.source.collection==='inventory_movements'?'inventory':'reconciliation';
const routes:Record<AssistanceCategory,string>={reconciliation:'accounting-health',receivables:'receivables',payables:'payables',cash:'cash-reconciliation',inventory:'inventory',margin:'product-profitability',close:'period-close',source:'journal'};
const outstanding=(row:Document)=>Number(row.remaining_sdg||0)!==0||Number(row.remaining_usd||0)!==0;
const day=(value:string)=>Date.parse(`${dateOnly(value)}T00:00:00Z`);
const task=(input:Omit<AssistanceTask,'execution'|'requires_confirmation'>):AssistanceTask=>({...input,execution:'manual_review',requires_confirmation:true});

/** Deterministic read-only assistance. It proposes a review route and never posts or edits financial records. */
export function buildAccountingAssistance(data:FinancialData,settings:MerchantSettings,asOfInput:string):AccountingAssistanceReport{
  const asOf=dateOnly(asOfInput),health=buildAccountingHealth(data,settings,asOf),tasks:AssistanceTask[]=health.items.map(item=>{const category=route(item);return task({id:`health:${item.id}`,priority:item.severity==='issue'?'blocking':'attention',category,title:item.title,detail:item.detail,proposed_action:item.action,review_route:routes[category],source:item.source});});
  const from=day(asOf),until=from+7*86400000;
  for(const bill of data.purchase_bills||[]){if(bill.status==='paid'||!outstanding(bill)||typeof bill.due_date!=='string')continue;const due=day(bill.due_date);if(due>=from&&due<=until)tasks.push(task({id:`anomaly:supplier-due:${bill.id}`,priority:'attention',category:'payables',title:'استحقاق مورد قريب',detail:`${bill.supplier_reference||bill.id} يستحق في ${dateOnly(bill.due_date)}.`,proposed_action:'راجع السيولة وكشف المورد وجدول الدفعة؛ لا تُنشئ دفعة تلقائياً.',review_route:routes.payables,source:{collection:'purchase_bills',id:String(bill.id)}}));}
  for(const invoice of data.invoices||[]){if(invoice.status==='void'||invoice.costing_status!=='complete')continue;const revenueSdg=Number(invoice.subtotal_sdg||0)-Number(invoice.discount_total_sdg||0),revenueUsd=Number(invoice.subtotal_usd||0)-Number(invoice.discount_total_usd||0),loss=(revenueSdg>0&&Number(invoice.cogs_sdg||0)>revenueSdg)||(revenueUsd>0&&Number(invoice.cogs_usd||0)>revenueUsd);if(loss)tasks.push(task({id:`anomaly:negative-margin:${invoice.id}`,priority:'attention',category:'margin',title:'بيع بهامش سلبي',detail:`${invoice.invoice_number||invoice.id}: التكلفة المثبتة أعلى من صافي المبيعات في أحد الدفترين.`,proposed_action:'راجع ربحية الفاتورة والتكلفة المجمدة والخصم؛ أي تصحيح يتم من المستند الأصلي وباعتماد صريح.',review_route:routes.margin,source:{collection:'invoices',id:String(invoice.id)}}));}
  for(const period of data.accounting_periods||[]){if(typeof period.end_date!=='string'||dateOnly(period.end_date)>=asOf||period.status==='CLOSED')continue;tasks.push(task({id:`anomaly:period-open:${period.id}`,priority:'attention',category:'close',title:'فترة منتهية غير مقفلة',detail:`الفترة ${period.id} انتهت في ${dateOnly(period.end_date)} وحالتها ${period.status}.`,proposed_action:'افتح مساعد الإقفال وراجع القائمة والأدلة قبل أي إقفال.',review_route:routes.close,source:{collection:'accounting_periods',id:String(period.id)}}));}
  tasks.sort((a,b)=>a.priority===b.priority?a.id.localeCompare(b.id):a.priority==='blocking'?-1:1);
  return{as_of:asOf,summary:{blocking:tasks.filter(x=>x.priority==='blocking').length,attention:tasks.filter(x=>x.priority==='attention').length,anomalies:tasks.filter(x=>x.id.startsWith('anomaly:')).length},tasks,principle:'reviewable_no_automatic_financial_change'};
}
