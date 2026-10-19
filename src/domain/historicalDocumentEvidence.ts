import BigNumber from 'bignumber.js';
import { dateOnly, ensure, identifier, money, text } from './validation';
import type { HistoricalImportRow } from './historicalImport';

export interface HistoricalDocumentLineEvidence {
  product_id?:string;
  description:string;
  quantity:number;
  net:number;
  tax:number;
  cogs?:number;
  inventory_value?:number;
}

export interface HistoricalDocumentPaymentEvidence {
  date:string;
  amount:number;
  account_code:string;
  exchange_rate_used:number;
  reference:string;
}

export interface HistoricalDocumentEvidence {
  party_id:string;
  due_date:string;
  exchange_rate_used:number;
  control_account_code:string;
  tax_account_code?:string;
  tax_configuration_version_hash?:string;
  lines:HistoricalDocumentLineEvidence[];
  payments?:HistoricalDocumentPaymentEvidence[];
}

export interface HistoricalDocumentEvidenceContext {
  customers:string[];
  suppliers:string[];
  products:string[];
  accounts:string[];
}

const sum=(values:number[])=>values.reduce((total,value)=>total.plus(value),new BigNumber(0));
const precision=(currency:string)=>currency==='SDG'?0:2;

/**
 * Validates the native subsidiary evidence required before Excel4 may create
 * historical invoices or purchases. This function is deliberately read-only;
 * the atomic source-document writer is a separate step.
 */
export function validateHistoricalDocumentEvidence(row:HistoricalImportRow,evidence:HistoricalDocumentEvidence,context:HistoricalDocumentEvidenceContext){
  ensure(row.kind==='invoice'||row.kind==='purchase','دليل المستند التاريخي مخصص للفواتير والمشتريات فقط.');
  ensure(evidence&&typeof evidence==='object'&&!Array.isArray(evidence),'دليل المستند التاريخي مفقود.');
  ensure(Object.keys(evidence).every(key=>['party_id','due_date','exchange_rate_used','control_account_code','tax_account_code','tax_configuration_version_hash','lines','payments'].includes(key)),'حقول دليل المستند التاريخي غير صالحة أو محمية.');
  const day=dateOnly(row.date),due=dateOnly(evidence.due_date);ensure(due>=day,'استحقاق المستند التاريخي يسبق تاريخ الإصدار.');
  const party=identifier(evidence.party_id),parties=new Set(row.kind==='invoice'?context.customers:context.suppliers);
  ensure(parties.has(party),'العميل أو المورد التاريخي غير موجود.');
  ensure(text(row.counterparty_code,100,true)===party,'دليل الطرف لا يطابق صف الاستيراد التاريخي.');
  const accounts=new Set(context.accounts),control=identifier(evidence.control_account_code);
  ensure(accounts.has(control)&&control===(row.kind==='invoice'?'1200':'2110'),'حساب رقابة المستند التاريخي غير صحيح.');
  money(evidence.exchange_rate_used,8);ensure(row.currency!=='USD'||evidence.exchange_rate_used>0,'مستند الدولار التاريخي يتطلب سعر صرف موثقاً.');
  ensure(Array.isArray(evidence.lines)&&evidence.lines.length>0&&evidence.lines.length<=100,'دليل المستند التاريخي يتطلب 1–100 بند.');
  const products=new Set(context.products),decimals=precision(row.currency);
  for(const line of evidence.lines){
    ensure(line&&typeof line==='object'&&!Array.isArray(line)&&Object.keys(line).every(key=>['product_id','description','quantity','net','tax','cogs','inventory_value'].includes(key)),'حقول بند الدليل التاريخي غير صالحة أو محمية.');
    text(line.description,500,true);money(line.quantity,6,true);money(line.net,decimals,true);money(line.tax,decimals);
    if(line.product_id!==undefined)ensure(products.has(identifier(line.product_id)),'منتج المستند التاريخي غير موجود.');
    if(row.kind==='invoice'){
      money(line.cogs??0,decimals);ensure(line.inventory_value===undefined,'فاتورة البيع لا تقبل قيمة استلام مخزون.');
      if(line.product_id)ensure((line.cogs??0)>0,'بند المخزون المباع يتطلب COGS تاريخياً مثبتاً.');
    }else{
      ensure(Boolean(line.product_id),'بند الشراء التاريخي يتطلب منتج مخزون أصلياً.');
      money(line.inventory_value,decimals,true);ensure(line.cogs===undefined,'فاتورة الشراء لا تقبل COGS بيع.');
    }
  }
  const net=sum(evidence.lines.map(line=>line.net)),tax=sum(evidence.lines.map(line=>line.tax)),total=net.plus(tax);
  ensure(total.eq(row.total||0),'إجمالي بنود وضريبة المستند التاريخي لا يطابق الصف.');
  if(tax.gt(0)){
    ensure(Boolean(evidence.tax_configuration_version_hash&&/^[a-f0-9]{64}$/i.test(evidence.tax_configuration_version_hash)),'الضريبة التاريخية تتطلب بصمة إصدار إعداد الضريبة.');
    ensure(accounts.has(identifier(evidence.tax_account_code)),'حساب الضريبة التاريخي غير موجود.');
  }else ensure(evidence.tax_account_code===undefined&&evidence.tax_configuration_version_hash===undefined,'لا يقبل دليل ضريبة بلا مبلغ ضريبي.');
  const payments=evidence.payments||[];ensure(payments.length<=100,'عدد دفعات المستند التاريخي يتجاوز الحد.');
  let last=day;
  for(const payment of payments){
    ensure(payment&&typeof payment==='object'&&!Array.isArray(payment)&&Object.keys(payment).every(key=>['date','amount','account_code','exchange_rate_used','reference'].includes(key)),'حقول دفعة الدليل التاريخي غير صالحة أو محمية.');
    const paymentDay=dateOnly(payment.date);ensure(paymentDay>=day&&paymentDay>=last,'دفعات المستند التاريخي يجب أن تكون مرتبة ولا تسبق المستند.');last=paymentDay;
    money(payment.amount,decimals,true);money(payment.exchange_rate_used,8);ensure(row.currency!=='USD'||payment.exchange_rate_used>0,'دفعة الدولار التاريخية تتطلب سعر صرف موثقاً.');
    ensure(accounts.has(identifier(payment.account_code)),'حساب دفعة المستند التاريخي غير موجود.');text(payment.reference,100,true);
  }
  const paid=sum(payments.map(payment=>payment.amount));ensure(paid.eq(row.paid||0),'إجمالي أدلة السداد لا يطابق المبلغ المدفوع في الصف.');ensure(paid.lte(total),'السداد التاريخي يتجاوز إجمالي المستند.');
  const inventory=row.kind==='purchase'?sum(evidence.lines.map(line=>line.inventory_value||0)):new BigNumber(0);
  ensure(row.kind!=='purchase'||inventory.eq(net),'قيمة المخزون التاريخية لا تطابق صافي فاتورة الشراء.');
  return{kind:row.kind,party_id:party,issue_date:day,due_date:due,currency:row.currency,exchange_rate_used:evidence.exchange_rate_used,control_account_code:control,net:net.toNumber(),tax:tax.toNumber(),total:total.toNumber(),paid:paid.toNumber(),remaining:total.minus(paid).toNumber(),cogs:row.kind==='invoice'?sum(evidence.lines.map(line=>line.cogs||0)).toNumber():0,inventory_value:inventory.toNumber(),payment_count:payments.length};
}
