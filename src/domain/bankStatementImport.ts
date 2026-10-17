import BigNumber from 'bignumber.js';
import { dateOnly, ensure, identifier, money, text } from './validation';

export const bankStatementHeaders = ['id','date','direction','amount','reference','description'] as const;
export type BankStatementFormat = 'csv'|'xlsx';
export interface BankStatementImportCell { value:unknown; formula?:string; }
export interface BankStatementImportFile { file_name:string;file_hash:string;format:BankStatementFormat;headers:string[];rows:Array<Array<unknown|BankStatementImportCell>>; }
export interface BankStatementImportMetadata { financial_account_id:string;currency:'SDG'|'USD';period:{start:string;end:string};statement_opening:number;statement_closing:number; }

const raw=(cell:unknown|BankStatementImportCell)=>cell&&typeof cell==='object'&&!Array.isArray(cell)&&Object.prototype.hasOwnProperty.call(cell,'value')?(cell as BankStatementImportCell).value:cell;
const hasFormula=(cell:unknown|BankStatementImportCell)=>Boolean(cell&&typeof cell==='object'&&!Array.isArray(cell)&&(cell as BankStatementImportCell).formula);
const unsafeText=(value:unknown)=>/^[\t\r\n ]*[=+@]/.test(String(value??''));

export function buildBankStatementImportPreview(file:BankStatementImportFile,metadata:BankStatementImportMetadata){
  ensure(Object.keys(file).every(key=>['file_name','file_hash','format','headers','rows'].includes(key)),'حقول ملف كشف البنك غير صالحة.');
  ensure(file.format==='csv'||file.format==='xlsx','صيغة كشف البنك غير مدعومة.');
  ensure(file.format==='csv'?/\.csv$/i.test(text(file.file_name,180,true)):/\.xlsx$/i.test(text(file.file_name,180,true)),'امتداد كشف البنك لا يطابق الصيغة.');
  ensure(/^[a-f0-9]{64}$/i.test(file.file_hash),'بصمة كشف البنك غير صالحة.');
  ensure(file.headers.length===bankStatementHeaders.length&&file.headers.every((header,index)=>header===bankStatementHeaders[index]),'عناوين كشف البنك لا تطابق القالب الرسمي.');
  ensure(file.rows.length>0&&file.rows.length<=500,'كشف البنك يتطلب 1 إلى 500 حركة.',413);
  const start=dateOnly(metadata.period.start),end=dateOnly(metadata.period.end);ensure(start===metadata.period.start&&end===metadata.period.end&&start<=end,'فترة كشف البنك غير صالحة.');
  const currency=metadata.currency;ensure(currency==='SDG'||currency==='USD','عملة كشف البنك غير مدعومة.');identifier(metadata.financial_account_id);
  const precision=currency==='SDG'?0:2,opening=money(metadata.statement_opening,precision),closing=money(metadata.statement_closing,precision),seen=new Set<string>();
  const statement_lines=file.rows.map((cells,rowIndex)=>{
    ensure(Array.isArray(cells)&&cells.length<=bankStatementHeaders.length,`صف ${rowIndex+2} في كشف البنك غير صالح.`);
    ensure(!cells.some(hasFormula),`الصيغ غير مسموحة في صف ${rowIndex+2} من كشف البنك.`);
    const row=Object.fromEntries(bankStatementHeaders.map((header,index)=>[header,raw(cells[index])]));
    const id=identifier(row.id);ensure(!seen.has(id),'معرّف حركة كشف البنك مكرر.');seen.add(id);
    const date=dateOnly(row.date);ensure(date===row.date&&date>=start&&date<=end,`تاريخ حركة ${id} خارج فترة الكشف.`);
    const direction=String(row.direction??'').trim().toLowerCase();ensure(direction==='inflow'||direction==='outflow',`اتجاه حركة ${id} يجب أن يكون inflow أو outflow.`);
    const amount=money(typeof row.amount==='string'?Number(row.amount.replace(/,/g,'').trim()):Number(row.amount),precision,true);
    ensure(!unsafeText(row.reference)&&!unsafeText(row.description),`نص حركة ${id} يبدأ بصيغة غير آمنة.`);
    return{id,date,direction:direction as 'inflow'|'outflow',amount,reference:text(row.reference??'',200),description:text(row.description??'',500)};
  });
  const total_inflow=statement_lines.filter(row=>row.direction==='inflow').reduce((sum,row)=>sum.plus(row.amount),new BigNumber(0));
  const total_outflow=statement_lines.filter(row=>row.direction==='outflow').reduce((sum,row)=>sum.plus(row.amount),new BigNumber(0));
  const computed=BigNumber(opening).plus(total_inflow).minus(total_outflow),difference=BigNumber(closing).minus(computed);
  return{schema_version:1 as const,mode:'staging_preview' as const,requires_manual_matching:true as const,writes_financial_data:false as const,file:{name:file.file_name,hash:file.file_hash,format:file.format},financial_account_id:metadata.financial_account_id,currency,period:{start,end},statement_opening:opening,statement_closing:closing,statement_lines,summary:{row_count:statement_lines.length,total_inflow:money(total_inflow.toNumber(),precision),total_outflow:money(total_outflow.toNumber(),precision),computed_closing:money(computed.toNumber(),precision),closing_difference:money(difference.toNumber(),precision)}};
}
