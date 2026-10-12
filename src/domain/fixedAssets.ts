import BigNumber from 'bignumber.js';
import type { Account, JournalEntry } from '../types';
import type { Document } from './store';
import { classifyAccount } from './accountClassification';
import { dateOnly, ensure, identifier, money, text, validateJournal } from './validation';

export interface FixedAssetRegistrationInput {
  id: string; name: string; category: string; purchase_date: string; in_service_date: string;
  source_journal_id: string; source_line_index: number; useful_life_months: number;
  residual_value_sdg: number; residual_value_usd: number; asset_account_code: string;
  accumulated_depreciation_account_code: string; depreciation_expense_account_code: string;
  reason: string; reference_number: string;
}
export interface FixedAssetSnapshot {
  org_id: string; accounts: Account[]; journal_entries: JournalEntry[]; fixed_assets: Document[];
}

const monthEnd = (start: string, offset: number) => {
  const value = new Date(`${start.slice(0,7)}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + offset + 1, 0);
  return value.toISOString().slice(0,10);
};
const allocation = (cost: number, residual: number, months: number, decimals: number) => {
  const depreciable = new BigNumber(cost).minus(residual), regular = depreciable.dividedBy(months).decimalPlaces(decimals,BigNumber.ROUND_HALF_UP);
  let used = new BigNumber(0);
  return Array.from({length:months},(_,index)=>{const remaining=depreciable.minus(used),amount=index===months-1?remaining:BigNumber.minimum(regular,remaining);used=used.plus(amount);return amount.toNumber();});
};

/** Pure source-backed registration and straight-line schedule. It grants no permission and writes nothing. */
export function fixedAssetRegistrationQuote(input: FixedAssetRegistrationInput, snapshot: FixedAssetSnapshot) {
  ensure(input && typeof input==='object' && !Array.isArray(input),'صيغة سجل الأصل غير صالحة.');
  ensure(Object.keys(input).every(key=>['id','name','category','purchase_date','in_service_date','source_journal_id','source_line_index','useful_life_months','residual_value_sdg','residual_value_usd','asset_account_code','accumulated_depreciation_account_code','depreciation_expense_account_code','reason','reference_number'].includes(key)),'حقول سجل الأصل غير مسموحة.');
  const orgId=identifier(snapshot.org_id),id=identifier(input.id),name=text(input.name,200,true),category=text(input.category,100,true),reason=text(input.reason,1000,true),reference=text(input.reference_number,200);
  const purchaseDate=dateOnly(input.purchase_date),serviceDate=dateOnly(input.in_service_date);
  ensure(purchaseDate===input.purchase_date&&serviceDate===input.in_service_date&&serviceDate>=purchaseDate,'تاريخ شراء/تشغيل الأصل غير صالح.');
  ensure(Number.isSafeInteger(input.useful_life_months)&&input.useful_life_months>=1&&input.useful_life_months<=600,'العمر الإنتاجي يجب أن يكون من 1 إلى 600 شهر.');
  ensure(Number.isSafeInteger(input.source_line_index)&&input.source_line_index>=0&&input.source_line_index<100,'طرف قيد شراء الأصل غير صالح.');
  ensure(Array.isArray(snapshot.fixed_assets)&&snapshot.fixed_assets.length<=1200&&!snapshot.fixed_assets.some(row=>row.id===id),'معرف الأصل مستخدم أو السجل يتجاوز الحد.');
  const codes=new Set<string>();
  for(const account of snapshot.accounts){identifier(account.code);ensure(account.org_id===orgId&&!codes.has(account.code),'دليل حسابات الأصل مكرر أو أجنبي.');codes.add(account.code);}
  const assetCode=identifier(input.asset_account_code),accumulatedCode=identifier(input.accumulated_depreciation_account_code),expenseCode=identifier(input.depreciation_expense_account_code);
  ensure(new Set([assetCode,accumulatedCode,expenseCode]).size===3,'حسابات الأصل والإهلاك يجب أن تكون منفصلة.');
  const asset=snapshot.accounts.find(row=>row.code===assetCode),accumulated=snapshot.accounts.find(row=>row.code===accumulatedCode),expense=snapshot.accounts.find(row=>row.code===expenseCode);
  ensure(asset?.is_active&&asset.type==='ASSET'&&asset.nature==='DEBIT'&&classifyAccount(asset).reporting_group==='fixed_assets','حساب تكلفة الأصل غير صالح.');
  ensure(accumulated?.is_active&&accumulated.type==='ASSET'&&accumulated.nature==='CREDIT'&&classifyAccount(accumulated).reporting_group==='fixed_assets','حساب مجمع الإهلاك غير صالح.');
  ensure(expense?.is_active&&expense.type==='EXPENSE'&&expense.nature==='DEBIT'&&classifyAccount(expense).reporting_group==='operating_expense','حساب مصروف الإهلاك غير صالح.');
  const sourceId=identifier(input.source_journal_id),matches=snapshot.journal_entries.filter(row=>row.id===sourceId);
  ensure(matches.length===1&&matches[0].org_id===orgId,'قيد شراء الأصل مفقود أو مكرر أو أجنبي.');
  const source=matches[0];dateOnly(source.date);ensure(source.date===purchaseDate,'تاريخ الأصل لا يطابق قيد الشراء.');validateJournal(source.lines);
  const line=source.lines[input.source_line_index];
  ensure(line?.account_code===assetCode&&line.debit_sdg>=0&&line.debit_usd>=0&&line.credit_sdg===0&&line.credit_usd===0&&(line.debit_sdg>0||line.debit_usd>0),'طرف تكلفة الأصل يجب أن يكون مديناً في قيد الشراء.');
  ensure(!snapshot.fixed_assets.some(row=>row.source_journal_id===sourceId&&row.source_line_index===input.source_line_index),'طرف قيد الشراء مربوط بأصل آخر.');
  const costSdg=money(line.debit_sdg,0),costUsd=money(line.debit_usd,2),residualSdg=money(input.residual_value_sdg,0),residualUsd=money(input.residual_value_usd,2);
  ensure(residualSdg<=costSdg&&residualUsd<=costUsd&&(costSdg>residualSdg||costUsd>residualUsd),'القيمة التخريدية يجب أن تكون أقل من التكلفة في دفتر واحد على الأقل.');
  const sdg=allocation(costSdg,residualSdg,input.useful_life_months,0),usd=allocation(costUsd,residualUsd,input.useful_life_months,2),schedule=sdg.map((amount,index)=>({sequence:index+1,date:monthEnd(serviceDate,index),depreciation_sdg:amount,depreciation_usd:usd[index],accumulated_sdg:sdg.slice(0,index+1).reduce((a,b)=>a+b,0),accumulated_usd:usd.slice(0,index+1).reduce((a,b)=>new BigNumber(a).plus(b).toNumber(),0)}));
  return {schema_version:1 as const,org_id:orgId,id,name,category,purchase_date:purchaseDate,in_service_date:serviceDate,method:'straight_line' as const,useful_life_months:input.useful_life_months,residual_value_sdg:residualSdg,residual_value_usd:residualUsd,purchase_cost_sdg:costSdg,purchase_cost_usd:costUsd,depreciable_sdg:costSdg-residualSdg,depreciable_usd:new BigNumber(costUsd).minus(residualUsd).toNumber(),source_journal_id:sourceId,source_line_index:input.source_line_index,asset_account_code:assetCode,accumulated_depreciation_account_code:accumulatedCode,depreciation_expense_account_code:expenseCode,reason,reference_number:reference,schedule};
}
