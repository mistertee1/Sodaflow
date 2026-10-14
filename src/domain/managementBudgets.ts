import type { Account, Invoice, JournalEntry } from '../types';
import type { PurchaseBill } from './payables';
import type { Document, Transaction } from './store';
import { dateOnly, ensure, identifier, money, text } from './validation';

export const managementPlanningCollections = ['budgets', 'cash_forecast_schedules'] as const;

export interface BookAmount { sdg: number; usd: number }
export interface BudgetLine { account_code:string; amount_sdg:number; amount_usd:number; branch_id?:string; cost_center_id?:string; project_id?:string }
export interface BudgetPlan {
  id:string; org_id:string; name:string; start_date:string; end_date:string; status:'draft'|'active'|'archived';
  revision:number; lines:BudgetLine[]; created_by:string; created_at:string; updated_by:string; updated_at:string; operation_id?:string;
}
export interface CashForecastSchedule {
  id:string; org_id:string; name:string; kind:'recurring_expense'|'scheduled_payment'; start_date:string; end_date:string|null;
  cadence:'once'|'weekly'|'monthly'; amount_sdg:number; amount_usd:number; active:boolean; revision:number;
  created_by:string; created_at:string; updated_by:string; updated_at:string; operation_id:string;
}
export interface CashForecastRow {
  date:string; direction:'inflow'|'outflow'; source_kind:'customer_due'|'supplier_due'|'recurring_expense'|'scheduled_payment';
  source_id:string; source_label:string; amount_sdg:number; amount_usd:number; overdue:boolean;
  due_date_source:'explicit'|'issue_date_fallback'|'schedule';
}

const dimensions=['branch_id','cost_center_id','project_id'] as const;
const allowed=(value:Document,keys:string[])=>ensure(Object.keys(value).every(key=>keys.includes(key)),'حقول التخطيط غير صالحة أو محمية.');
const addDays=(value:string,days:number)=>new Date(Date.parse(`${value}T00:00:00.000Z`)+days*86400000).toISOString().slice(0,10);
const monthDate=(value:string,index:number)=>{
  const source=new Date(`${value}T00:00:00.000Z`),first=new Date(Date.UTC(source.getUTCFullYear(),source.getUTCMonth()+index,1));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(source.getUTCDate(),last));return first.toISOString().slice(0,10);
};
const rounded=(value:number,decimals:number)=>Number(value.toFixed(decimals));

function parseLine(value:unknown,index:number):BudgetLine {
  ensure(value&&typeof value==='object'&&!Array.isArray(value),`بند الميزانية ${index+1} غير صالح.`);
  const row=value as Document;allowed(row,['account_code','amount_sdg','amount_usd',...dimensions]);
  const result:BudgetLine={account_code:identifier(row.account_code),amount_sdg:money(row.amount_sdg??0,0),amount_usd:money(row.amount_usd??0,2)};
  ensure(result.amount_sdg>=0&&result.amount_usd>=0&&(result.amount_sdg>0||result.amount_usd>0),`بند الميزانية ${index+1} يجب أن يحتوي مبلغاً موجباً.`);
  for(const key of dimensions)if(row[key])result[key]=identifier(row[key]);
  return result;
}
export function validateBudgetInput(data:Document){
  allowed(data,['id','name','start_date','end_date','status','lines','expected_revision']);
  const start=dateOnly(data.start_date),end=dateOnly(data.end_date);ensure(start<=end,'نهاية الميزانية يجب ألا تسبق بدايتها.');
  ensure(Array.isArray(data.lines)&&data.lines.length>0&&data.lines.length<=500,'أضف من بند واحد إلى 500 بند للميزانية.');
  const lines=data.lines.map(parseLine),seen=new Set<string>();
  for(const line of lines){const key=[line.account_code,...dimensions.map(k=>line[k]||'')].join('|');ensure(!seen.has(key),'يوجد بند ميزانية مكرر للحساب والأبعاد نفسها.');seen.add(key);}
  const status=(data.status||'draft') as BudgetPlan['status'];ensure(['draft','active','archived'].includes(status),'حالة الميزانية غير صالحة.');
  return{id:data.id?identifier(data.id):crypto.randomUUID(),name:text(data.name,120,true),start_date:start,end_date:end,status,lines};
}
async function verifyReferences(tx:Transaction,root:string,orgId:string,plan:ReturnType<typeof validateBudgetInput>){
  const accounts=await tx.list(`${root}/accounts`) as Account[];
  for(const line of plan.lines){
    const account=accounts.find(row=>row.code===line.account_code);
    ensure(account&&account.org_id===orgId&&account.is_active,'حساب بند الميزانية غير موجود أو غير نشط.');
    ensure(account.type==='EXPENSE'||account.type==='REVENUE','الميزانية التشغيلية تقبل حسابات الإيراد والمصروف فقط.');
    for(const [field,collection] of [['branch_id','branches'],['cost_center_id','cost_centers'],['project_id','projects']] as const)if(line[field]){
      const row=await tx.get(`${root}/${collection}/${line[field]}`);ensure(row&&row.org_id===orgId&&row.status==='active','بُعد بند الميزانية غير موجود أو غير نشط.');
    }
  }
}
export async function saveBudget(
  tx:Transaction,root:string,orgId:string,actor:string,now:string,operationId:string,
  action:'budget.create'|'budget.update',data:Document
){
  const parsed=validateBudgetInput(data),path=`${root}/budgets/${parsed.id}`,existing=await tx.get(path) as BudgetPlan|undefined;
  ensure(action==='budget.create'?!existing:!!existing,action==='budget.create'?'معرّف الميزانية مستخدم مسبقاً.':'الميزانية غير موجودة.',action==='budget.create'?409:404);
  if(existing)ensure(Number(data.expected_revision)===existing.revision,'تم تعديل الميزانية من جلسة أخرى؛ حدّث البيانات وأعد المحاولة.',409);
  await verifyReferences(tx,root,orgId,parsed);
  const result:BudgetPlan={...parsed,org_id:orgId,revision:(existing?.revision||0)+1,created_by:existing?.created_by||actor,created_at:existing?.created_at||now,updated_by:actor,updated_at:now,operation_id:operationId};
  tx.set(path,result);return result;
}

const matches=(line:JournalEntry['lines'][number],budget:BudgetLine)=>dimensions.every(key=>!budget[key]||line[key]===budget[key]);
export function budgetVsActual(plan:BudgetPlan,accounts:Account[],entries:JournalEntry[]){
  const byCode=new Map(accounts.map(row=>[row.code,row]));
  const rows=plan.lines.map(line=>{
    const account=byCode.get(line.account_code);ensure(account,'حساب بند الميزانية غير موجود في الدليل.',409);
    let actual_sdg=0,actual_usd=0;
    for(const entry of entries)if(entry.date.slice(0,10)>=plan.start_date&&entry.date.slice(0,10)<=plan.end_date)for(const journalLine of entry.lines)if(journalLine.account_code===line.account_code&&matches(journalLine,line)){
      const sign=account.type==='REVENUE'?-1:1;actual_sdg+=sign*(journalLine.debit_sdg-journalLine.credit_sdg);actual_usd+=sign*(journalLine.debit_usd-journalLine.credit_usd);
    }
    actual_sdg=rounded(actual_sdg,0);actual_usd=rounded(actual_usd,2);
    const variance_sdg=rounded(line.amount_sdg-actual_sdg,0),variance_usd=rounded(line.amount_usd-actual_usd,2);
    return{...line,account_name:account.name_ar,actual_sdg,actual_usd,variance_sdg,variance_usd,variance_percent_sdg:line.amount_sdg?rounded(variance_sdg/line.amount_sdg*100,2):null,variance_percent_usd:line.amount_usd?rounded(variance_usd/line.amount_usd*100,2):null};
  });
  return{budget:plan,rows,totals:rows.reduce((sum,row)=>({budget_sdg:sum.budget_sdg+row.amount_sdg,budget_usd:sum.budget_usd+row.amount_usd,actual_sdg:sum.actual_sdg+row.actual_sdg,actual_usd:sum.actual_usd+row.actual_usd,variance_sdg:sum.variance_sdg+row.variance_sdg,variance_usd:sum.variance_usd+row.variance_usd}),{budget_sdg:0,budget_usd:0,actual_sdg:0,actual_usd:0,variance_sdg:0,variance_usd:0})};
}

export function validateCashForecastScheduleInput(data:Document){
  allowed(data,['id','name','kind','start_date','end_date','cadence','amount_sdg','amount_usd','active','expected_revision']);
  const kind=data.kind as CashForecastSchedule['kind'],cadence=data.cadence as CashForecastSchedule['cadence'];
  ensure(['recurring_expense','scheduled_payment'].includes(kind),'نوع بند التنبؤ غير صالح.');
  ensure(['once','weekly','monthly'].includes(cadence),'تكرار بند التنبؤ غير صالح.');
  const start_date=dateOnly(data.start_date),end_date=data.end_date?dateOnly(data.end_date):null;
  ensure(!end_date||end_date>=start_date,'نهاية بند التنبؤ يجب ألا تسبق بدايته.');
  if(cadence!=='once')ensure(!!end_date,'حدد نهاية للمصروف الدوري.');
  const amount_sdg=money(data.amount_sdg??0,0),amount_usd=money(data.amount_usd??0,2);
  ensure(amount_sdg>=0&&amount_usd>=0&&(amount_sdg>0||amount_usd>0),'بند التنبؤ يجب أن يحتوي مبلغاً موجباً.');
  return{id:data.id?identifier(data.id):crypto.randomUUID(),name:text(data.name,120,true),kind,start_date,end_date,cadence,amount_sdg,amount_usd,active:data.active!==false};
}
export async function saveCashForecastSchedule(
  tx:Transaction,root:string,orgId:string,actor:string,now:string,operationId:string,
  action:'cashForecastSchedule.create'|'cashForecastSchedule.update',data:Document
){
  const parsed=validateCashForecastScheduleInput(data),path=`${root}/cash_forecast_schedules/${parsed.id}`,existing=await tx.get(path) as CashForecastSchedule|undefined;
  ensure(action.endsWith('create')?!existing:!!existing,action.endsWith('create')?'معرّف بند التنبؤ مستخدم مسبقاً.':'بند التنبؤ غير موجود.',action.endsWith('create')?409:404);
  if(existing)ensure(Number(data.expected_revision)===existing.revision,'تم تعديل بند التنبؤ من جلسة أخرى؛ حدّث البيانات وأعد المحاولة.',409);
  const result:CashForecastSchedule={...parsed,org_id:orgId,revision:(existing?.revision||0)+1,created_by:existing?.created_by||actor,created_at:existing?.created_at||now,updated_by:actor,updated_at:now,operation_id:operationId};
  tx.set(path,result);return result;
}
function scheduleDates(schedule:CashForecastSchedule,asOf:string,end:string){
  if(schedule.end_date&&schedule.end_date<asOf)return[];
  if(schedule.cadence==='once')return schedule.start_date>end?[]:[schedule.start_date<asOf?asOf:schedule.start_date];
  const dates:string[]=[];
  if(schedule.cadence==='weekly'){
    const start=Date.parse(`${schedule.start_date}T00:00:00.000Z`),as=Date.parse(`${asOf}T00:00:00.000Z`);
    const offset=Math.max(0,Math.ceil((as-start)/(7*86400000)));
    for(let index=offset;index<offset+54;index++){const value=addDays(schedule.start_date,index*7);if(value>end||schedule.end_date&&value>schedule.end_date)break;dates.push(value);}
  }else{
    const source=new Date(`${schedule.start_date}T00:00:00.000Z`),target=new Date(`${asOf}T00:00:00.000Z`);
    let offset=Math.max(0,(target.getUTCFullYear()-source.getUTCFullYear())*12+target.getUTCMonth()-source.getUTCMonth());
    if(monthDate(schedule.start_date,offset)<asOf)offset++;
    for(let index=offset;index<offset+13;index++){const value=monthDate(schedule.start_date,index);if(value>end||schedule.end_date&&value>schedule.end_date)break;dates.push(value);}
  }
  return dates;
}
export function cashForecast(input:{as_of:string;days:number;opening_cash:BookAmount;invoices:Invoice[];purchase_bills:PurchaseBill[];schedules:CashForecastSchedule[];invoice_balances:Record<string,BookAmount>;bill_balances:Record<string,BookAmount>}){
  const as_of=dateOnly(input.as_of);ensure(Number.isSafeInteger(input.days)&&input.days>=1&&input.days<=365,'مدة التنبؤ يجب أن تكون من يوم إلى 365 يوماً.');
  const end_date=addDays(as_of,input.days-1),rows:CashForecastRow[]=[];let missing_due_dates=0;
  const addDue=(direction:CashForecastRow['direction'],source_kind:CashForecastRow['source_kind'],source_id:string,source_label:string,due:string,fallback:boolean,amount:BookAmount)=>{
    if(amount.sdg<=0&&amount.usd<=0)return;const effective=due<as_of?as_of:due;if(effective>end_date)return;
    rows.push({date:effective,direction,source_kind,source_id,source_label,amount_sdg:Math.max(0,amount.sdg),amount_usd:Math.max(0,amount.usd),overdue:due<as_of,due_date_source:fallback?'issue_date_fallback':'explicit'});
  };
  for(const invoice of input.invoices){
    if(['draft','cancelled','void','paid'].includes(invoice.status))continue;
    const fallback=!invoice.due_date,due=dateOnly(invoice.due_date||invoice.issue_date);if(fallback)missing_due_dates++;
    addDue('inflow','customer_due',invoice.id,`${invoice.invoice_number} — ${invoice.customer_name}`,due,fallback,input.invoice_balances[invoice.id]||{sdg:0,usd:0});
  }
  for(const bill of input.purchase_bills){
    if(bill.status==='paid')continue;
    const fallback=!bill.due_date,due=dateOnly(bill.due_date||bill.issue_date);if(fallback)missing_due_dates++;
    addDue('outflow','supplier_due',bill.id,`${bill.supplier_reference} — ${bill.supplier_name}`,due,fallback,input.bill_balances[bill.id]||{sdg:0,usd:0});
  }
  for(const schedule of input.schedules.filter(row=>row.active))for(const date of scheduleDates(schedule,as_of,end_date))rows.push({date,direction:'outflow',source_kind:schedule.kind,source_id:schedule.id,source_label:schedule.name,amount_sdg:schedule.amount_sdg,amount_usd:schedule.amount_usd,overdue:schedule.cadence==='once'&&schedule.start_date<as_of,due_date_source:'schedule'});
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.direction.localeCompare(b.direction)||a.source_id.localeCompare(b.source_id));
  const totals=rows.reduce((sum,row)=>{if(row.direction==='inflow'){sum.inflows_sdg+=row.amount_sdg;sum.inflows_usd+=row.amount_usd;}else{sum.outflows_sdg+=row.amount_sdg;sum.outflows_usd+=row.amount_usd;}return sum;},{inflows_sdg:0,inflows_usd:0,outflows_sdg:0,outflows_usd:0});
  const daily=[...rows.reduce((map,row)=>{const value=map.get(row.date)||{date:row.date,inflows_sdg:0,inflows_usd:0,outflows_sdg:0,outflows_usd:0};if(row.direction==='inflow'){value.inflows_sdg+=row.amount_sdg;value.inflows_usd+=row.amount_usd;}else{value.outflows_sdg+=row.amount_sdg;value.outflows_usd+=row.amount_usd;}map.set(row.date,value);return map;},new Map<string,{date:string;inflows_sdg:number;inflows_usd:number;outflows_sdg:number;outflows_usd:number}>()).values()].map(row=>({...row,net_sdg:rounded(row.inflows_sdg-row.outflows_sdg,0),net_usd:rounded(row.inflows_usd-row.outflows_usd,2)}));
  const net_sdg=rounded(totals.inflows_sdg-totals.outflows_sdg,0),net_usd=rounded(totals.inflows_usd-totals.outflows_usd,2);
  return{period:{as_of,end_date,days:input.days},rows,daily,totals:{opening_cash_sdg:input.opening_cash.sdg,opening_cash_usd:input.opening_cash.usd,expected_inflows_sdg:rounded(totals.inflows_sdg,0),expected_inflows_usd:rounded(totals.inflows_usd,2),expected_outflows_sdg:rounded(totals.outflows_sdg,0),expected_outflows_usd:rounded(totals.outflows_usd,2),net_cash_flow_sdg:net_sdg,net_cash_flow_usd:net_usd,forecast_closing_sdg:rounded(input.opening_cash.sdg+net_sdg,0),forecast_closing_usd:rounded(input.opening_cash.usd+net_usd,2)},source_counts:{customer_dues:rows.filter(row=>row.source_kind==='customer_due').length,supplier_dues:rows.filter(row=>row.source_kind==='supplier_due').length,recurring_expenses:rows.filter(row=>row.source_kind==='recurring_expense').length,scheduled_payments:rows.filter(row=>row.source_kind==='scheduled_payment').length},missing_due_dates,source_backed:true,explanation:'التنبؤ النقدي تقدير للتوقيت والسيولة ولا يساوي صافي الربح المحاسبي.'};
}
export function validateManagementPlanningData(data:Record<string,Document[]>,orgId:string){
  for(const value of data.budgets||[]){
    const parsed=validateBudgetInput({id:value.id,name:value.name,start_date:value.start_date,end_date:value.end_date,status:value.status,lines:value.lines});
    ensure(value.org_id===orgId&&Number.isSafeInteger(value.revision)&&value.revision>0&&parsed.id===value.id,'سجل ميزانية غير صالح أو يتبع مؤسسة أخرى.');
  }
  for(const value of data.cash_forecast_schedules||[]){
    const parsed=validateCashForecastScheduleInput({id:value.id,name:value.name,kind:value.kind,start_date:value.start_date,end_date:value.end_date,cadence:value.cadence,amount_sdg:value.amount_sdg,amount_usd:value.amount_usd,active:value.active});
    ensure(value.org_id===orgId&&Number.isSafeInteger(value.revision)&&value.revision>0&&parsed.id===value.id,'بند تنبؤ غير صالح أو يتبع مؤسسة أخرى.');
  }
}
