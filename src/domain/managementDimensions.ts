import BigNumber from 'bignumber.js';
import type { Account, JournalEntry } from '../types';
import { classifyAccount } from './accountClassification';
import { dateOnly, ensure, identifier, text } from './validation';
import type { Document } from './store';

export type DimensionKind = 'branch' | 'cost_center' | 'project';
export interface ManagementDimension {
  id: string; org_id: string; kind: DimensionKind; code: string; name_ar: string; name_en?: string;
  status: 'active' | 'inactive'; created_by: string; created_at: string; updated_at: string; revision: number;
}
export const dimensionCollection = (kind: DimensionKind) => kind === 'branch' ? 'branches' : kind === 'cost_center' ? 'cost_centers' : 'projects';
export const dimensionField = (kind: DimensionKind) => kind === 'branch' ? 'branch_id' : kind === 'cost_center' ? 'cost_center_id' : 'project_id';
export function dimensionKind(value: unknown): DimensionKind { ensure(['branch','cost_center','project'].includes(String(value)), 'نوع البعد الإداري غير صالح.'); return value as DimensionKind; }
export function createDimension(data: Document, orgId: string, actor: string, now: string): ManagementDimension {
  ensure(Object.keys(data).every(key => ['kind','id','code','name_ar','name_en','status'].includes(key)), 'حقول البعد الإداري غير صالحة أو محمية.');
  const kind=dimensionKind(data.kind),id=identifier(data.id),code=text(data.code,40,true).trim().toUpperCase(),name_ar=text(data.name_ar,200,true).trim(),name_en=data.name_en?text(data.name_en,200).trim():undefined,status=data.status||'active';
  ensure(['active','inactive'].includes(status),'حالة البعد الإداري غير صالحة.');
  return {id,org_id:orgId,kind,code,name_ar,...(name_en?{name_en}:{}),status,created_by:actor,created_at:now,updated_at:now,revision:1};
}
export function updateDimension(old: ManagementDimension, data: Document, now: string): ManagementDimension {
  ensure(Object.keys(data).every(key => ['kind','id','expected_revision','updates'].includes(key)), 'حقول تحديث البعد الإداري غير صالحة أو محمية.');
  ensure(data.kind===old.kind && data.id===old.id && data.expected_revision===old.revision,'إصدار البعد الإداري تغير؛ حدّث البيانات.',409);
  const updates=data.updates;ensure(updates&&typeof updates==='object'&&!Array.isArray(updates)&&Object.keys(updates).every(key=>['name_ar','name_en','status'].includes(key)),'تحديث البعد الإداري غير صالح.');
  const status=updates.status??old.status;ensure(['active','inactive'].includes(status),'حالة البعد الإداري غير صالحة.');
  return {...old,...(updates.name_ar!==undefined?{name_ar:text(updates.name_ar,200,true).trim()}:{}),...(updates.name_en!==undefined?{name_en:text(updates.name_en,200).trim()||undefined}:{}),status,updated_at:now,revision:old.revision+1};
}

export function branchProfitAndLoss(accounts: Account[], entries: JournalEntry[], branch: ManagementDimension, period: {start?:string;end?:string}={}) {
  const start=period.start?dateOnly(period.start):undefined,end=period.end?dateOnly(period.end):undefined;ensure(!start||!end||start<=end,'بداية الفترة يجب أن تسبق نهايتها.');
  const chart=new Map(accounts.map(account=>[account.code,account])),sales={sdg:new BigNumber(0),usd:new BigNumber(0)},cogs={sdg:new BigNumber(0),usd:new BigNumber(0)},expenses={sdg:new BigNumber(0),usd:new BigNumber(0)};
  for(const entry of entries){const date=dateOnly(entry.date);if(start&&date<start||end&&date>end)continue;for(const line of entry.lines||[]){if(line.branch_id!==branch.id)continue;const account=chart.get(line.account_code);ensure(account,`الحساب ${line.account_code} غير موجود؛ راجع الدليل قبل إصدار التقرير.`);const group=classifyAccount(account).reporting_group,net={sdg:new BigNumber(line.debit_sdg).minus(line.credit_sdg),usd:new BigNumber(line.debit_usd).minus(line.credit_usd)};if(account.type==='REVENUE'){sales.sdg=sales.sdg.minus(net.sdg);sales.usd=sales.usd.minus(net.usd);}else if(account.type==='EXPENSE'&&group==='cogs'){cogs.sdg=cogs.sdg.plus(net.sdg);cogs.usd=cogs.usd.plus(net.usd);}else if(account.type==='EXPENSE'){expenses.sdg=expenses.sdg.plus(net.sdg);expenses.usd=expenses.usd.plus(net.usd);}}}
  const gross={sdg:sales.sdg.minus(cogs.sdg),usd:sales.usd.minus(cogs.usd)},net={sdg:gross.sdg.minus(expenses.sdg),usd:gross.usd.minus(expenses.usd)};
  return {branch,period:{start,end},sales_sdg:sales.sdg.toNumber(),sales_usd:sales.usd.toNumber(),cogs_sdg:cogs.sdg.toNumber(),cogs_usd:cogs.usd.toNumber(),gross_profit_sdg:gross.sdg.toNumber(),gross_profit_usd:gross.usd.toNumber(),expenses_sdg:expenses.sdg.toNumber(),expenses_usd:expenses.usd.toNumber(),net_profit_sdg:net.sdg.toNumber(),net_profit_usd:net.usd.toNumber()};
}
