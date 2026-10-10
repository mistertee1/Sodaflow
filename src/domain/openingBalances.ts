import BigNumber from 'bignumber.js';
import type { Account, JournalEntryLine } from '../types';
import type { Document } from './store';
import { classifyAccount } from './accountClassification';
import { validateFinancialAccount } from './cashManagement';
import { dateOnly, ensure, identifier, money, text, validateJournal } from './validation';
import { journalLine } from './financial';

export type OpeningCurrencyPolicy = 'dual' | 'sdg_only';
export interface OpeningAmount { currency: 'SDG' | 'USD'; amount: number; exchange_rate_used?: number; }
export interface OpeningParty extends OpeningAmount { id: string; }
export interface OpeningInventory { id: string; quantity: number; unit_cost: number; currency: 'SDG' | 'USD'; exchange_rate_used?: number; }
export interface OpeningInput {
  batch_id: string; date: string; reason: string; currency_policy: OpeningCurrencyPolicy;
  cash: OpeningParty[]; receivables: OpeningParty[]; payables: OpeningParty[]; inventory: OpeningInventory[];
  capital: { sdg: number; usd: number }; equity_difference_reason?: string;
}
/** Derived from actual tenant documents by the future server transaction, never a request-body counter. */
export interface OpeningSnapshot {
  org_id: string; accounting_version: number; financial_activity_count: number;
  accounts: Account[]; financial_accounts: Document[]; customers: Document[]; suppliers: Document[]; products: Document[];
}
interface Pair { sdg: number; usd: number; }
export interface OpeningSource extends Pair {
  kind: 'cash' | 'receivable' | 'payable' | 'inventory'; source_id: string; account_code: string;
  currency: 'SDG' | 'USD'; native_amount: number; exchange_rate_used: number;
  financial_kind?: string; quantity?: number; unit_cost?: number;
}
function exact(value: unknown, keys: string[]): asserts value is Document {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'صيغة معاينة الأرصدة غير صالحة.');
  ensure(Object.keys(value).every(key => keys.includes(key)), 'مدخلات الأرصدة تتضمن حقولاً غير مسموحة.');
}
const round = (value: BigNumber, precision: number) => money(value.decimalPlaces(precision, BigNumber.ROUND_HALF_UP).toNumber(), precision);
function quoteAmount(row: OpeningAmount, policy: OpeningCurrencyPolicy): Pair {
  ensure(['SDG','USD'].includes(row.currency), 'عملة الرصيد الافتتاحي غير مدعومة.');
  money(row.amount, row.currency === 'SDG' ? 0 : 2, true);
  if (policy === 'sdg_only') {
    ensure(row.currency === 'SDG' && (row.exchange_rate_used === undefined || row.exchange_rate_used === 0), 'الوضع السوداني فقط لا يتضمن أرصدة أو أسعار صرف أجنبية.');
    return { sdg:row.amount, usd:0 };
  }
  const rate = money(row.exchange_rate_used, 8, true);
  return row.currency === 'SDG' ? { sdg:row.amount, usd:round(new BigNumber(row.amount).dividedBy(rate),2) } : { usd:row.amount, sdg:round(new BigNumber(row.amount).times(rate),0) };
}
function selected(rows: Document[], id: string, orgId: string) {
  identifier(id); const matches=rows.filter(row=>row.id===id);
  ensure(matches.length===1 && matches[0].org_id===orgId, 'مصدر الرصيد مفقود أو مكرر أو ينتمي لمؤسسة أخرى.');
  return matches[0];
}
function control(snapshot: OpeningSnapshot, code: string, type: string, group: string) {
  const rows=snapshot.accounts.filter(row=>row.code===code);
  ensure(rows.length===1 && rows[0].org_id===snapshot.org_id && rows[0].is_active===true && rows[0].type===type && rows[0].nature===(type==='ASSET'?'DEBIT':'CREDIT') && classifyAccount(rows[0]).reporting_group===group, 'حساب التحكم الافتتاحي غير صالح أو غير نشط.');
  return rows[0];
}
/** A read-only posting quote. This function grants no permission and performs no storage writes. */
export function openingBalanceQuote(input: OpeningInput, snapshot: OpeningSnapshot) {
  exact(input,['batch_id','date','reason','currency_policy','cash','receivables','payables','inventory','capital','equity_difference_reason']);
  ensure(snapshot && typeof snapshot==='object' && ['accounts','financial_accounts','customers','suppliers','products'].every(key=>Array.isArray((snapshot as unknown as Document)[key]) && (snapshot as unknown as Document)[key].every((row:unknown)=>row && typeof row==='object' && !Array.isArray(row))), 'مصادر معاينة الأرصدة غير صالحة.');
  identifier(snapshot.org_id); identifier(input.batch_id); ensure(input.batch_id.length<=96,'معرف دفعة الأرصدة طويل.');
  const date=dateOnly(input.date); ensure(date===input.date,'حدد تاريخاً فقط للأرصدة الافتتاحية.');
  const reason=text(input.reason,1000,true);
  ensure(snapshot.accounting_version===2 && snapshot.financial_activity_count===0, 'الأرصدة الافتتاحية تتطلب مؤسسة V2 بلا نشاط مالي؛ البيانات التاريخية تحتاج ترحيلاً مضبوطاً.',409);
  const zeroFields=(rows:Document[],fields:string[])=>rows.every(row=>row.org_id===snapshot.org_id && fields.every(field=>row[field]===undefined||row[field]===0));
  ensure(zeroFields(snapshot.accounts,['balance_sdg','balance_usd']) && zeroFields(snapshot.customers,['balance_sdg','balance_usd']) && zeroFields(snapshot.suppliers,['payable_due_sdg','payable_due_usd','advance_balance_sdg','advance_balance_usd']) && zeroFields(snapshot.products,['stock_quantity','inventory_value_sdg','inventory_value_usd']), 'لا يمكن إخفاء أرصدة أو مخزون قائم بإسقاطه من المعاينة؛ يلزم ترحيل مضبوط.',409);

  ensure(['dual','sdg_only'].includes(input.currency_policy),'حدد سياسة العملتين للأرصدة.');
  const kinds=['cash','receivables','payables','inventory'] as const;
  ensure(kinds.every(kind=>Array.isArray(input[kind])),'قوائم الأرصدة مطلوبة.');
  const count=kinds.reduce((sum,kind)=>sum+input[kind].length,0);
  ensure(count>0 && count<=97,'معاينة الأرصدة تتطلب 1 إلى 97 مصدراً؛ الدفعات الكبيرة تحتاج مسار استيراد مضبوط.',413);
  exact(input.capital,['sdg','usd']); const capital={sdg:money(input.capital.sdg,0),usd:money(input.capital.usd,2)};
  ensure(input.currency_policy!=='sdg_only'||capital.usd===0,'رأس المال الأجنبي غير متاح في الوضع السوداني فقط.');
  const equityAccount=control(snapshot,'3900','EQUITY','capital');
  const capitalAccount=capital.sdg||capital.usd?control(snapshot,'3100','EQUITY','capital'):undefined;
  const sources:OpeningSource[]=[], seen=new Set<string>();
  for(const kind of kinds) for(const item of input[kind]) {
    const row:Document=item;
    exact(row,kind==='inventory'?['id','quantity','unit_cost','currency','exchange_rate_used']:['id','amount','currency','exchange_rate_used']);
    identifier(row.id); const key=`${kind}:${row.id}`; ensure(!seen.has(key),'مصدر الرصيد الافتتاحي مكرر.');seen.add(key);
    let code:string,values:Pair,native:number,extra:Partial<OpeningSource>={};
    if(kind==='cash') {
      const master=selected(snapshot.financial_accounts,row.id,snapshot.org_id);validateFinancialAccount(master,snapshot.accounts);ensure(master.status==='active' && master.currency===row.currency,'الحساب النقدي غير نشط أو عملة الرصيد لا تطابق عملته.');
      const accounts=snapshot.accounts.filter(account=>account.code===master.account_code);ensure(accounts.length===1 && accounts[0].org_id===snapshot.org_id && accounts[0].is_active,'حساب النقدية غير صالح للمؤسسة.');
      ensure(snapshot.financial_accounts.filter(account=>account.account_code===master.account_code).length===1,'ربط الحساب النقدي مكرر.');
      code=master.account_code; native=row.amount;values=quoteAmount(row as OpeningAmount,input.currency_policy);extra.financial_kind=master.kind;
    } else if(kind==='receivables'||kind==='payables') {
      const master=selected(snapshot[kind==='receivables'?'customers':'suppliers'],row.id,snapshot.org_id);
      ensure(master.status===undefined||master.status==='active','العميل أو المورد غير نشط.');
      const fields=kind==='receivables'?['balance_sdg','balance_usd']:['payable_due_sdg','payable_due_usd','advance_balance_sdg','advance_balance_usd'];
      ensure(fields.every(field=>master[field]===undefined||master[field]===0),'لا تضف رصيداً افتتاحياً فوق رصيد طرف قائم.',409);
      code=kind==='receivables'?'1200':'2110';control(snapshot,code,kind==='receivables'?'ASSET':'LIABILITY',kind==='receivables'?'receivables':'payables');
      native=row.amount;values=quoteAmount(row as OpeningAmount,input.currency_policy);
    } else {
      const master=selected(snapshot.products,row.id,snapshot.org_id);
      ensure(master.is_active===true && master.track_inventory===true && master.stock_quantity===0 && (master.inventory_value_sdg===undefined||master.inventory_value_sdg===0) && (master.inventory_value_usd===undefined||master.inventory_value_usd===0),'المخزون الافتتاحي يتطلب صنفاً نشطاً متتبّعاً بلا كمية أو قيمة قائمة.',409);
      money(row.quantity,6,true);money(row.unit_cost,6,true);
      ensure(['SDG','USD'].includes(row.currency),'عملة تكلفة المخزون غير مدعومة.');
      native=round(new BigNumber(row.quantity).times(row.unit_cost),row.currency==='SDG'?0:2);money(native,row.currency==='SDG'?0:2,true);
      values=quoteAmount({currency:row.currency,amount:native,exchange_rate_used:row.exchange_rate_used},input.currency_policy);
      code='1300';control(snapshot,code,'ASSET','inventory');extra={quantity:row.quantity,unit_cost:row.unit_cost};
    }
    sources.push({kind:kind==='receivables'?'receivable':kind==='payables'?'payable':kind,source_id:row.id,account_code:code,currency:row.currency,native_amount:native,exchange_rate_used:row.exchange_rate_used||0,...values,...extra});
  }
  sources.sort((a,b)=>{const aa=`${a.kind}:${a.source_id}`,bb=`${b.kind}:${b.source_id}`;return aa<bb?-1:aa>bb?1:0;});
  const assets={sdg:new BigNumber(0),usd:new BigNumber(0)},liabilities={sdg:new BigNumber(0),usd:new BigNumber(0)};
  const lines:JournalEntryLine[]=sources.map(source=>{
    const target=source.kind==='payable'?liabilities:assets;for(const book of ['sdg','usd'] as const)target[book]=target[book].plus(source[book]);
    const account=snapshot.accounts.find(row=>row.code===source.account_code)!;
    return {...journalLine(source.account_code,account.name_ar,source.kind==='payable'?0:source.sdg,source.kind==='payable'?source.sdg:0,source.kind==='payable'?0:source.usd,source.kind==='payable'?source.usd:0),description:`رصيد افتتاحي ${source.kind}:${source.source_id}`};
  });
  const equity={sdg:assets.sdg.minus(liabilities.sdg).minus(capital.sdg),usd:assets.usd.minus(liabilities.usd).minus(capital.usd)};
  for(const book of ['sdg','usd'] as const){money(assets[book].toNumber(),book==='sdg'?0:2);money(liabilities[book].toNumber(),book==='sdg'?0:2);money(equity[book].abs().toNumber(),book==='sdg'?0:2);}
  if(capitalAccount)lines.push(journalLine(capitalAccount.code,capitalAccount.name_ar,0,capital.sdg,0,capital.usd));
  // Journal lines have one direction across books; opposite opening differences require two lines.
  if(equity.sdg.lt(0)||equity.usd.lt(0))lines.push(journalLine(equityAccount.code,equityAccount.name_ar,Math.max(0,equity.sdg.negated().toNumber()),0,Math.max(0,equity.usd.negated().toNumber()),0));
  if(equity.sdg.gt(0)||equity.usd.gt(0))lines.push(journalLine(equityAccount.code,equityAccount.name_ar,0,Math.max(0,equity.sdg.toNumber()),0,Math.max(0,equity.usd.toNumber())));
  const totals=validateJournal(lines),equityReason=input.equity_difference_reason===undefined?'':text(input.equity_difference_reason,1000);
  return {schema_version:1 as const,org_id:snapshot.org_id,batch_id:input.batch_id,date,reason,currency_policy:input.currency_policy,sources,lines,...totals,assets:{sdg:assets.sdg.toNumber(),usd:assets.usd.toNumber()},liabilities:{sdg:liabilities.sdg.toNumber(),usd:liabilities.usd.toNumber()},capital,opening_equity:{sdg:equity.sdg.toNumber(),usd:equity.usd.toNumber()},requires_equity_review:!equity.sdg.isZero()||!equity.usd.isZero(),equity_review_complete:(equity.sdg.isZero()&&equity.usd.isZero())||!!equityReason,equity_difference_reason:equityReason};
}
