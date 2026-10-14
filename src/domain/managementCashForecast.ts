import BigNumber from 'bignumber.js';
import type { Document } from './store';
import { dateOnly, ensure } from './validation';

export interface CashForecastRow { date:string; source_type:'customer_due'|'supplier_due'; source_id:string; reference:string; party_name:string; inflow_sdg:number; inflow_usd:number; outflow_sdg:number; outflow_usd:number }
const add=(a:number,b:number)=>new BigNumber(a).plus(b).toNumber();
export function cashForecast(asOfInput:string,horizonDaysInput:number,receivables:Document[],payables:Document[]){
  const as_of=dateOnly(asOfInput),horizon_days=Math.trunc(horizonDaysInput);ensure(horizon_days>=1&&horizon_days<=365,'فترة التوقع يجب أن تكون بين يوم و365 يوماً.');
  const end_date=new Date(Date.parse(`${as_of}T00:00:00Z`)+horizon_days*86400000).toISOString().slice(0,10),rows:CashForecastRow[]=[];
  for(const row of receivables){const due=dateOnly(row.due_date);if(due>end_date)continue;const sdg=Number(row.remaining_sdg||0),usd=Number(row.remaining_usd||0);if(sdg<=0&&usd<=0)continue;rows.push({date:due<as_of?as_of:due,source_type:'customer_due',source_id:String(row.source_id),reference:String(row.source_reference||row.invoice_number||row.source_id),party_name:String(row.customer_name||''),inflow_sdg:sdg,inflow_usd:usd,outflow_sdg:0,outflow_usd:0});}
  for(const row of payables){const due=dateOnly(row.due_date);if(due>end_date)continue;const sdg=Number(row.remaining_sdg||0),usd=Number(row.remaining_usd||0);if(sdg<=0&&usd<=0)continue;rows.push({date:due<as_of?as_of:due,source_type:'supplier_due',source_id:String(row.source_id),reference:String(row.reference||row.source_id),party_name:String(row.supplier_name||''),inflow_sdg:0,inflow_usd:0,outflow_sdg:sdg,outflow_usd:usd});}
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.source_type.localeCompare(b.source_type)||a.source_id.localeCompare(b.source_id));
  const totals=rows.reduce((sum,row)=>({inflow_sdg:add(sum.inflow_sdg,row.inflow_sdg),inflow_usd:add(sum.inflow_usd,row.inflow_usd),outflow_sdg:add(sum.outflow_sdg,row.outflow_sdg),outflow_usd:add(sum.outflow_usd,row.outflow_usd)}),{inflow_sdg:0,inflow_usd:0,outflow_sdg:0,outflow_usd:0});
  return{as_of,end_date,horizon_days,rows,totals:{...totals,net_sdg:add(totals.inflow_sdg,-totals.outflow_sdg),net_usd:add(totals.inflow_usd,-totals.outflow_usd)},coverage:{customer_due_dates:true,supplier_due_dates:true,recurring_expenses:false,scheduled_payments:false}};
}
