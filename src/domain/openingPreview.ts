import type { Document, Transaction } from './store';
import { openingBalancePlan, deriveOpeningSnapshot, openingActivityCollections, type OpeningTerms } from './openingSources';
import type { OpeningInput } from './openingBalances';
import type { MerchantSettings, OrgRole } from '../types';
import { assertPeriodPosting, validatePeriods } from './periodContracts';
import { assertOpenPeriod, ensure } from './validation';
import { hasPermission } from '../services/rbacService';
import { merchantDay } from './operationalReports';

/** This digest is a freshness check for the protected commit, never a permission token or persistent approval. */
export async function openingPreviewHash(value: unknown) {
  const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v && typeof v==='object'?`{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`:JSON.stringify(v)??'null';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function prepareOpeningPreview(tx: Transaction, root: string, orgId: string, accountingVersion: number, role: OrgRole, settings: MerchantSettings, now: Date, request: {input:OpeningInput;terms:OpeningTerms[]}) {
  const names=['accounts','financial_accounts','customers','suppliers','products',...openingActivityCollections];
  const data=Object.fromEntries(await Promise.all(names.map(async name=>[name,await tx.list(`${root}/${name}`)]))) as Record<string,Document[]>;
  const snapshot=deriveOpeningSnapshot(data,orgId,accountingVersion),plan=openingBalancePlan(request.input,snapshot,request.terms);
  const periods=validatePeriods(await tx.list(`${root}/accounting_periods`),orgId);
  ensure(periods.length>0,'أنشئ فترة محاسبية مفتوحة تغطي تاريخ الأرصدة الافتتاحية أولاً.',409);
  assertOpenPeriod(plan.quote.date,settings); assertPeriodPosting(periods,plan.quote.date,role,false,undefined);
  ensure(plan.quote.date<=merchantDay(now,settings.timezone||'Africa/Khartoum'),'لا يمكن بدء الأرصدة الافتتاحية في تاريخ مستقبلي.',409);
  const period=periods.find(row=>row.start_date<=plan.quote.date && plan.quote.date<=row.end_date)!;
  const periodProof={id:period.id,revision:period.revision,status:period.status,start_date:period.start_date,end_date:period.end_date};
  const basis={schema_version:1,plan,period:periodProof,legacy_lock_date:settings.period_lock_date||'',precision:{sdg:settings.sdg_decimals,usd:settings.usd_decimals}};
  const bytes=new TextEncoder().encode(JSON.stringify(basis)).length;ensure(bytes<=650000,'حجم معاينة الأرصدة يتجاوز حد المستند؛ يلزم مسار استيراد مضبوط.',413);
  const preview={schema_version:1,organizationId:orgId,generatedAt:now.toISOString(),preview_hash:await openingPreviewHash(basis),period:periodProof,quote:plan.quote,terms:plan.terms,source_count:plan.quote.sources.length,requires_owner_confirmation:true,posting_available:hasPermission(role,'opening:write') && plan.quote.equity_review_complete};
  return {data,plan,preview};
}
export async function readOpeningPreview(...args: Parameters<typeof prepareOpeningPreview>) {
  return (await prepareOpeningPreview(...args)).preview;
}
