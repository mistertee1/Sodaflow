import type { Account, JournalEntry } from '../types';
import type { Document } from './store';
import type { RecurringCashSource } from './managementCashSources';
import { calculateBalanceSheet, calculateCashFlowStatement, calculateIncomeStatement } from '../services/accountingService';
import { dateOnly, ensure } from './validation';

export interface OwnerReminder {
  id:string; kind:'recurring_expense'|'journal_draft'; due_date:string; title:string;
  amount_sdg:number; amount_usd:number; source:{collection:string;id:string};
  review_route:'cash-forecast'|'fixed-assets'; execution:'manual_review'; requires_confirmation:true;
}
export interface OwnerFinancialSummary {
  as_of:string; period:{start:string;end:string};
  financials:{revenue_sdg:number;revenue_usd:number;expenses_sdg:number;expenses_usd:number;net_profit_sdg:number;net_profit_usd:number;cash_sdg:number;cash_usd:number;receivables_sdg:number;receivables_usd:number;payables_sdg:number;payables_usd:number;assets_sdg:number;assets_usd:number;liabilities_sdg:number;liabilities_usd:number};
  reminders:OwnerReminder[]; summary:{due:number;overdue:number;recurring_expenses:number;journal_drafts:number};
  principle:'reviewable_no_automatic_financial_change';
}

const nextOccurrence=(date:string,frequency:RecurringCashSource['frequency'])=>{const value=new Date(`${date}T00:00:00Z`);if(frequency==='weekly')value.setUTCDate(value.getUTCDate()+7);else value.setUTCMonth(value.getUTCMonth()+(frequency==='monthly'?1:frequency==='quarterly'?3:12));return value.toISOString().slice(0,10);};
const total=(rows:Document[],field:string)=>rows.reduce((sum,row)=>sum+Number(row[field]||0),0);

/** Owner-only orchestration supplies trusted tenant data. This pure view never creates drafts or financial records. */
export function buildOwnerFinancialSummary(input:{orgId:string;asOf:string;accounts:Account[];journalEntries:JournalEntry[];receivables:Document[];payables:Document[];recurringExpenses:RecurringCashSource[];fixedAssets:Document[]}):OwnerFinancialSummary{
  const as_of=dateOnly(input.asOf),period={start:`${as_of.slice(0,7)}-01`,end:as_of},until=new Date(Date.parse(`${as_of}T00:00:00Z`)+30*86400000).toISOString().slice(0,10);
  const income=calculateIncomeStatement(input.journalEntries,input.accounts,period),balance=calculateBalanceSheet(input.accounts,input.journalEntries,{end:as_of}),cash=calculateCashFlowStatement(input.accounts,input.journalEntries,{end:as_of}),reminders:OwnerReminder[]=[];
  for(const source of input.recurringExpenses){
    ensure(source.org_id===input.orgId,'مصدر مصروف دوري أجنبي.');
    if(source.status!=='active')continue;let due=dateOnly(source.next_date),guard=0;
    if(due<as_of&&(!source.end_date||due<=dateOnly(source.end_date)))reminders.push({id:`recurring-expense:${source.id}:${due}`,kind:'recurring_expense',due_date:due,title:source.name,amount_sdg:Number(source.amount_sdg||0),amount_usd:Number(source.amount_usd||0),source:{collection:'recurring_cash_sources',id:source.id},review_route:'cash-forecast',execution:'manual_review',requires_confirmation:true});
    while(due<as_of){due=nextOccurrence(due,source.frequency);ensure(++guard<=366,'تكرارات التذكير تتجاوز الحد الآمن.');}
    while(due<=until&&(!source.end_date||due<=dateOnly(source.end_date))){reminders.push({id:`recurring-expense:${source.id}:${due}`,kind:'recurring_expense',due_date:due,title:source.name,amount_sdg:Number(source.amount_sdg||0),amount_usd:Number(source.amount_usd||0),source:{collection:'recurring_cash_sources',id:source.id},review_route:'cash-forecast',execution:'manual_review',requires_confirmation:true});due=nextOccurrence(due,source.frequency);ensure(++guard<=372,'تكرارات التذكير تتجاوز الحد الآمن.');}
  }
  for(const asset of input.fixedAssets){
    const sequence=Number(asset.next_depreciation_sequence||0),row=Array.isArray(asset.schedule)?asset.schedule.find((item:Document)=>Number(item.sequence)===sequence):undefined;
    ensure(asset.org_id===input.orgId,'مصدر أصل ثابت أجنبي.');if(asset.status!=='active'||!row||typeof row.date!=='string')continue;const due=dateOnly(row.date);if(due>until)continue;
    reminders.push({id:`journal-draft:depreciation:${asset.id}:${sequence}`,kind:'journal_draft',due_date:due,title:`قيد إهلاك ${asset.name||asset.id}`,amount_sdg:Number(row.depreciation_sdg||0),amount_usd:Number(row.depreciation_usd||0),source:{collection:'fixed_assets',id:String(asset.id)},review_route:'fixed-assets',execution:'manual_review',requires_confirmation:true});
  }
  reminders.sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id.localeCompare(b.id));
  return{as_of,period,financials:{revenue_sdg:income.sales_revenue_sdg,revenue_usd:income.sales_revenue_usd,expenses_sdg:income.cogs_sdg+income.total_operating_expenses_sdg,expenses_usd:income.cogs_usd+income.total_operating_expenses_usd,net_profit_sdg:income.net_profit_sdg,net_profit_usd:income.net_profit_usd,cash_sdg:cash.ending_cash_sdg,cash_usd:cash.ending_cash_usd,receivables_sdg:total(input.receivables,'remaining_sdg'),receivables_usd:total(input.receivables,'remaining_usd'),payables_sdg:total(input.payables,'remaining_sdg'),payables_usd:total(input.payables,'remaining_usd'),assets_sdg:balance.total_assets_sdg,assets_usd:balance.total_assets_usd,liabilities_sdg:balance.total_liabilities_sdg,liabilities_usd:balance.total_liabilities_usd},reminders,summary:{due:reminders.length,overdue:reminders.filter(row=>row.due_date<as_of).length,recurring_expenses:reminders.filter(row=>row.kind==='recurring_expense').length,journal_drafts:reminders.filter(row=>row.kind==='journal_draft').length},principle:'reviewable_no_automatic_financial_change'};
}
