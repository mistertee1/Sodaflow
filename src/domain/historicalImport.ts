import BigNumber from 'bignumber.js';
import { ensure, dateOnly, identifier, money, text } from './validation';

export type HistoricalImportKind='journal'|'invoice'|'purchase'|'trial_balance';
export interface HistoricalImportContext { orgId:string; periodLockDate?:string; accounts:string[]; branches:string[]; currencies:string[]; dimensions?:string[]; existingReferences?:string[] }
export interface HistoricalImportRow { row_number:number; kind:HistoricalImportKind; reference:string; date:string; currency:string; branch_id:string; dimensions?:string[]; debit?:number; credit?:number; total?:number; paid?:number; account_code?:string; counterparty_code?:string; lines?:Array<{account_code:string;debit:number;credit:number}> }
export interface HistoricalImportIssue { row_number:number; code:string; message:string }

const normalized=(value:string)=>value.trim().toLowerCase();
const allowedKinds:HistoricalImportKind[]=['journal','invoice','purchase','trial_balance'];

export function validateHistoricalImport(rows:HistoricalImportRow[],context:HistoricalImportContext){
  ensure(Array.isArray(rows)&&rows.length>0&&rows.length<=5000,'الاستيراد التاريخي يتطلب من 1 إلى 5000 صف.');
  ensure(context.accounts.length>0&&context.branches.length>0&&context.currencies.length>0,'سياق الترحيل التاريخي غير مكتمل.');
  const accountSet=new Set(context.accounts.map(normalized)),branchSet=new Set(context.branches),currencySet=new Set(context.currencies),dimensionSet=new Set(context.dimensions||[]),references=new Set((context.existingReferences||[]).map(normalized)),issues:HistoricalImportIssue[]=[];
  const totals={debit:new BigNumber(0),credit:new BigNumber(0)};
  const add=(row:HistoricalImportRow,code:string,message:string)=>issues.push({row_number:row.row_number,code,message});
  for(const row of rows){
    ensure(Number.isInteger(row.row_number)&&row.row_number>0,'رقم صف الاستيراد التاريخي غير صالح.');
    ensure(allowedKinds.includes(row.kind),'نوع السجل التاريخي غير صالح.');
    const reference=text(row.reference,100,true),day=dateOnly(row.date),referenceKey=normalized(reference);
    if(references.has(referenceKey))add(row,'DUPLICATE_REFERENCE','المرجع مستخدم مسبقاً أو مكرر داخل الملف.');else references.add(referenceKey);
    if(context.periodLockDate&&day<=context.periodLockDate)add(row,'CLOSED_PERIOD','التاريخ يقع في فترة مقفلة.');
    if(!currencySet.has(row.currency))add(row,'INVALID_CURRENCY','العملة غير مفعلة للمؤسسة.');
    try{identifier(row.branch_id);}catch{add(row,'INVALID_BRANCH','معرف الفرع غير صالح.');}
    if(!branchSet.has(row.branch_id))add(row,'INVALID_BRANCH','الفرع غير متاح للمؤسسة.');
    for(const dimension of row.dimensions||[])if(!dimensionSet.has(dimension))add(row,'INVALID_DIMENSION','البعد المحاسبي غير معتمد.');
    if(row.kind==='journal'){
      if(!Array.isArray(row.lines)||row.lines.length<2){add(row,'INVALID_JOURNAL','القيد التاريخي يحتاج طرفين على الأقل.');continue;}
      let debit=new BigNumber(0),credit=new BigNumber(0);
      for(const line of row.lines){
        if(!accountSet.has(normalized(line.account_code)))add(row,'INVALID_ACCOUNT','حساب القيد غير موجود.');
        try{money(line.debit,2);money(line.credit,2);}catch{add(row,'INVALID_AMOUNT','مبلغ طرف القيد غير صالح.');continue;}
        if((line.debit>0)===(line.credit>0))add(row,'INVALID_JOURNAL_SIDE','كل طرف يجب أن يكون مديناً أو دائناً فقط.');
        debit=debit.plus(line.debit);credit=credit.plus(line.credit);
      }
      if(!debit.eq(credit))add(row,'UNBALANCED_JOURNAL','القيد التاريخي غير متزن.');
      totals.debit=totals.debit.plus(debit);totals.credit=totals.credit.plus(credit);
    }else{
      try{money(row.debit??0,2);money(row.credit??0,2);money(row.total??0,2,true);money(row.paid??0,2);}catch{add(row,'INVALID_AMOUNT','مبلغ السجل التاريخي غير صالح.');continue;}
      if(!row.account_code||!accountSet.has(normalized(row.account_code)))add(row,'INVALID_ACCOUNT','الحساب غير موجود.');
      if((row.kind==='invoice'||row.kind==='purchase')&&!row.counterparty_code)add(row,'MISSING_COUNTERPARTY','يلزم رمز العميل أو المورد.');
      if((row.paid??0)>(row.total??0))add(row,'PAYMENT_EXCEEDS_TOTAL','المدفوع يتجاوز إجمالي المستند.');
      totals.debit=totals.debit.plus(row.debit??0);totals.credit=totals.credit.plus(row.credit??0);
    }
  }
  return{rows_total:rows.length,blocking_issues:issues,can_stage:issues.length===0,totals:{debit:totals.debit.toNumber(),credit:totals.credit.toNumber(),balanced:totals.debit.eq(totals.credit)},accounting_block:issues.length>0||!totals.debit.eq(totals.credit)};
}
