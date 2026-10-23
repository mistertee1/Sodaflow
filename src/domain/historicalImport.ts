import BigNumber from 'bignumber.js';
import { ensure, dateOnly, identifier, money, text } from './validation';

export type HistoricalImportKind='journal'|'invoice'|'purchase'|'trial_balance';
export interface HistoricalImportPeriod { start_date:string; end_date:string; status:'OPEN'|'SOFT_CLOSED'|'CLOSED'|'REOPENED' }
export interface HistoricalImportContext { orgId:string; periodLockDate?:string; periods?:HistoricalImportPeriod[]; accounts:string[]; branches:string[]; currencies:string[]; dimensions?:string[]; existingReferences?:string[] }
export interface HistoricalImportRow { row_number:number; kind:HistoricalImportKind; reference:string; date:string; currency:string; branch_id:string; dimensions?:string[]; debit?:number; credit?:number; total?:number; paid?:number; account_code?:string; counterparty_code?:string; lines?:Array<{account_code:string;debit:number;credit:number}> }
export interface HistoricalImportIssue { row_number:number; code:string; message:string }

const normalized=(value:string)=>value.trim().toLowerCase();
const allowedKinds:HistoricalImportKind[]=['journal','invoice','purchase','trial_balance'];
const commonRowKeys=['row_number','kind','reference','date','currency','branch_id','dimensions'];

export function validateHistoricalImport(rows:HistoricalImportRow[],context:HistoricalImportContext){
  ensure(Array.isArray(rows)&&rows.length>0&&rows.length<=5000,'الاستيراد التاريخي يتطلب من 1 إلى 5000 صف.');
  ensure(context.accounts.length>0&&context.branches.length>0&&context.currencies.length>0,'سياق الترحيل التاريخي غير مكتمل.');
  const accountSet=new Set(context.accounts.map(normalized)),branchSet=new Set(context.branches),currencySet=new Set(context.currencies),dimensionSet=new Set(context.dimensions||[]),references=new Set((context.existingReferences||[]).map(normalized)),rowNumbers=new Set<number>(),issues:HistoricalImportIssue[]=[];
  const totals={debit:new BigNumber(0),credit:new BigNumber(0)};
  const add=(row:HistoricalImportRow,code:string,message:string)=>issues.push({row_number:row.row_number,code,message});
  for(const row of rows){
    ensure(row&&typeof row==='object'&&!Array.isArray(row),'صف الاستيراد التاريخي غير صالح.');
    ensure(Number.isInteger(row.row_number)&&row.row_number>0,'رقم صف الاستيراد التاريخي غير صالح.');
    ensure(allowedKinds.includes(row.kind),'نوع السجل التاريخي غير صالح.');
    const allowedKeys=row.kind==='journal'?[...commonRowKeys,'lines']:row.kind==='trial_balance'?[...commonRowKeys,'account_code','debit','credit']:[...commonRowKeys,'account_code','counterparty_code','total','paid','debit','credit'];
    ensure(Object.keys(row).every(key=>allowedKeys.includes(key)),'حقول صف الاستيراد التاريخي غير صالحة أو محمية.');
    ensure(!rowNumbers.has(row.row_number),'رقم صف الاستيراد التاريخي مكرر.');rowNumbers.add(row.row_number);
    const reference=text(row.reference,100,true),day=dateOnly(row.date),referenceKey=normalized(reference);
    if(references.has(referenceKey))add(row,'DUPLICATE_REFERENCE','المرجع مستخدم مسبقاً أو مكرر داخل الملف.');else references.add(referenceKey);
    const period=context.periods?.find(item=>item.start_date<=day&&day<=item.end_date);
    if(context.periods?.length&&!period)add(row,'INVALID_PERIOD','التاريخ خارج الفترات المحاسبية المعتمدة.');
    if(context.periodLockDate&&day<=context.periodLockDate||period&&['SOFT_CLOSED','CLOSED'].includes(period.status))add(row,'CLOSED_PERIOD','التاريخ يقع في فترة مقفلة.');
    if(!currencySet.has(row.currency))add(row,'INVALID_CURRENCY','العملة غير مفعلة للمؤسسة.');
    try{identifier(row.branch_id);}catch{add(row,'INVALID_BRANCH','معرف الفرع غير صالح.');}
    if(!branchSet.has(row.branch_id))add(row,'INVALID_BRANCH','الفرع غير متاح للمؤسسة.');
    ensure(row.dimensions===undefined||Array.isArray(row.dimensions)&&row.dimensions.length<=3,'أبعاد صف الاستيراد التاريخي غير صالحة.');
    for(const dimension of row.dimensions||[]){try{identifier(dimension);}catch{add(row,'INVALID_DIMENSION','معرف البعد المحاسبي غير صالح.');continue;}if(!dimensionSet.has(dimension))add(row,'INVALID_DIMENSION','البعد المحاسبي غير معتمد.');}
    if(row.kind==='journal'){
      if(!Array.isArray(row.lines)||row.lines.length<2||row.lines.length>100){add(row,'INVALID_JOURNAL','القيد التاريخي يحتاج من طرفين إلى 100 طرف.');continue;}
      let debit=new BigNumber(0),credit=new BigNumber(0);
      for(const line of row.lines){
        ensure(line&&typeof line==='object'&&!Array.isArray(line)&&Object.keys(line).every(key=>['account_code','debit','credit'].includes(key)),'حقول طرف القيد التاريخي غير صالحة أو محمية.');
        if(typeof line.account_code!=='string'||!accountSet.has(normalized(line.account_code)))add(row,'INVALID_ACCOUNT','حساب القيد غير موجود.');
        try{money(line.debit,2);money(line.credit,2);}catch{add(row,'INVALID_AMOUNT','مبلغ طرف القيد غير صالح.');continue;}
        if((line.debit>0)===(line.credit>0))add(row,'INVALID_JOURNAL_SIDE','كل طرف يجب أن يكون مديناً أو دائناً فقط.');
        debit=debit.plus(line.debit);credit=credit.plus(line.credit);
      }
      if(!debit.eq(credit))add(row,'UNBALANCED_JOURNAL','القيد التاريخي غير متزن.');
      totals.debit=totals.debit.plus(debit);totals.credit=totals.credit.plus(credit);
    }else{
      try{money(row.debit??0,2);money(row.credit??0,2);money(row.paid??0,2);if(row.kind==='invoice'||row.kind==='purchase')money(row.total,2,true);else money(row.total??0,2);}catch{add(row,'INVALID_AMOUNT','مبلغ السجل التاريخي غير صالح.');continue;}
      if(typeof row.account_code!=='string'||!accountSet.has(normalized(row.account_code)))add(row,'INVALID_ACCOUNT','الحساب غير موجود.');
      if(row.kind==='invoice'||row.kind==='purchase'){
        if(!row.counterparty_code)add(row,'MISSING_COUNTERPARTY','يلزم رمز العميل أو المورد.');else try{text(row.counterparty_code,100,true);}catch{add(row,'MISSING_COUNTERPARTY','رمز العميل أو المورد غير صالح.');}
        if(row.debit!==row.total||row.credit!==row.total)add(row,'UNBALANCED_DOCUMENT','إجمالي المستند لا يطابق طرفيه المحاسبيين.');
      }else if(((row.debit??0)>0)===((row.credit??0)>0))add(row,'INVALID_TRIAL_BALANCE_SIDE','رصيد الحساب القديم يجب أن يكون مديناً أو دائناً فقط.');
      if((row.paid??0)>(row.total??0))add(row,'PAYMENT_EXCEEDS_TOTAL','المدفوع يتجاوز إجمالي المستند.');
      totals.debit=totals.debit.plus(row.debit??0);totals.credit=totals.credit.plus(row.credit??0);
    }
  }
  return{rows_total:rows.length,blocking_issues:issues,can_stage:issues.length===0,totals:{debit:totals.debit.toNumber(),credit:totals.credit.toNumber(),balanced:totals.debit.eq(totals.credit)},accounting_block:issues.length>0||!totals.debit.eq(totals.credit)};
}
