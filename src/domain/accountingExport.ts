import type { Account, JournalEntry, MerchantSettings, OrgRole } from '../types';
import { calculateBalanceSheet, calculateCashFlowStatement, calculateIncomeStatement, calculateTrialBalance } from '../services/accountingService';
import { ensure } from './validation';
import type { Document } from './store';

type Period={start?:string;end?:string}; type Cell=string|number|boolean|null|undefined;
const esc=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const cell=(v:Cell)=>typeof v==='number'&&Number.isFinite(v)?`<Cell><Data ss:Type="Number">${v}</Data></Cell>`:typeof v==='boolean'?`<Cell><Data ss:Type="Boolean">${v?1:0}</Data></Cell>`:`<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`;
const sheet=(name:string,headers:string[],rows:Cell[][])=>`<Worksheet ss:Name="${esc(name)}"><Table><Row>${headers.map(cell).join('')}</Row>${rows.map(r=>`<Row>${r.map(cell).join('')}</Row>`).join('')}</Table></Worksheet>`;
const objectRows=(value:unknown):[string,Cell][]=>(value&&typeof value==='object'?Object.entries(value as Record<string,unknown>):[]).filter(([,v])=>['string','number','boolean'].includes(typeof v)||v==null) as [string,Cell][];

export function buildAccountingExport(input:{orgId:string;role:OrgRole;createdAt:string;operationId:string;period:Period;accounts:Account[];entries:JournalEntry[];reconciliations:Document[];settings:MerchantSettings;maxEntries?:number;maxBytes?:number}){
  ensure(['Owner','Admin','Accountant'].includes(input.role),'التصدير المحاسبي متاح للمالك والمدير والمحاسب فقط.',403);
  ensure(input.accounts.every(x=>x.org_id===input.orgId)&&input.entries.every(x=>x.org_id===input.orgId),'عُثر على سجل من مؤسسة أخرى في التصدير.',409);
  ensure(input.entries.length<=(input.maxEntries??5000),`عدد قيود التصدير يتجاوز حد المهمة (${input.maxEntries??5000}).`,413);
  const entries=[...input.entries].filter(e=>(!input.period.start||e.date>=input.period.start)&&(!input.period.end||e.date<=input.period.end)).sort((a,b)=>`${a.date}:${a.id}`.localeCompare(`${b.date}:${b.id}`));
  const trial=calculateTrialBalance(input.accounts,input.entries,input.period),income=calculateIncomeStatement(input.entries,input.accounts,input.period),balance=calculateBalanceSheet(input.accounts,input.entries,input.period),cash=calculateCashFlowStatement(input.accounts,input.entries,input.period);
  const lines=entries.flatMap(e=>(e.lines||[]).map((l,index)=>[e.id,index+1,l.account_code,l.account_name,e.date,e.reference_type,e.reference_id,l.debit_sdg,l.credit_sdg,l.debit_usd,l.credit_usd,l.branch_id||'',l.cost_center_id||'',l.project_id||''] as Cell[]));
  const parts=[
    sheet('Journal_Entries',['entry_id','date','reference_type','reference_id','description','exchange_rate'],entries.map(e=>[e.id,e.date,e.reference_type,e.reference_id,e.description,(e as unknown as Document).exchange_rate])),
    sheet('Journal_Lines',['entry_id','line','account_code','account_name','date','reference_type','reference_id','debit_sdg','credit_sdg','debit_usd','credit_usd','branch_id','cost_center_id','project_id'],lines),
    sheet('Trial_Balance',['field','value'],objectRows(trial)),sheet('Income_Statement',['field','value'],objectRows(income)),sheet('Balance_Sheet',['field','value'],objectRows(balance)),sheet('Cash_Flow',['field','value'],objectRows(cash)),
    sheet('Reconciliation',['id','kind','account_code','difference','opening_difference','created_at'],input.reconciliations.sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(r=>[r.id,r.statement_lines?'bank':'cash',r.account_code,r.difference,r.opening_difference,r.created_at])),
    sheet('Data_Dictionary',['sheet','purpose'],[['Journal_Entries','رؤوس القيود ضمن الفترة'],['Journal_Lines','سطور القيود الرقمية ثنائية العملة'],['Trial_Balance','ميزان المراجعة'],['Reconciliation','أدلة مطابقة النقد والبنوك']]),
    sheet('Export_Summary',['field','value'],[['schema_version',1],['export_type','accounting'],['organization_id',input.orgId],['period_start',input.period.start||''],['period_end',input.period.end||''],['created_at',input.createdAt],['entry_count',entries.length],['line_count',lines.length],['currency_books',`${input.settings.primary_currency}/${input.settings.secondary_currency}`]])
  ];
  const workbook=`<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${parts.join('')}</Workbook>`,bytes=new TextEncoder().encode(workbook);ensure(bytes.length<=(input.maxBytes??900000),'حجم التصدير يتجاوز حد المهمة.',413);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return{schema_version:1,id:`accounting-export-${input.operationId}`,export_type:'accounting',format:'excel-xml',filename:`sudaflow-accounting-${input.createdAt.slice(0,10)}.xls`,mime_type:'application/vnd.ms-excel',record_count:entries.length,line_count:lines.length,workbook_base64:btoa(binary),period:input.period,created_at:input.createdAt};
}
