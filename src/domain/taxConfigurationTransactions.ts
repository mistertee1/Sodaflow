import type {Account} from '../types';
import type {Document, Transaction} from './store';
import {clean} from './store';
import {validateTaxConfiguration, validateTaxControlAccount, type TaxConfiguration} from './taxConfiguration';
import {ensure, identifier, text} from './validation';

const inputKeys = ['id','expected_revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active','reason'];
const policyKeys = ['schema_version','id','org_id','revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active'] as const;
const policy = (row: Document) => Object.fromEntries(policyKeys.map(key => [key, row[key]])) as unknown as TaxConfiguration;
const comparable = (row: TaxConfiguration) => clean({...row, revision: 0});
const stable = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value).filter(([,item]) => item !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value) ?? 'null';
const digest = async (value: unknown) => {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(result)].map(value => value.toString(16).padStart(2,'0')).join('');
};
const versionHashBasis = (row: Document) => ({
  schema_version: 1,
  configuration: {...policy(row), id: row.configuration_id},
  created_at: row.created_at,
  created_by: row.created_by,
  updated_at: row.updated_at,
  updated_by: row.updated_by,
  reason: row.reason,
  operation_id: row.operation_id,
  versioned_at: row.versioned_at,
  versioned_by: row.versioned_by,
  previous_version_hash: row.previous_version_hash ?? null
});

export const taxConfigurationCollections = ['tax_configurations','tax_configuration_versions'] as const;
export async function verifyTaxConfigurationSources(data: Record<string,Document[]>, orgId: string) {
  const configurations=data.tax_configurations||[],versions=data.tax_configuration_versions||[];ensure(configurations.length<=250&&versions.length<=1200,'أرشيف إعدادات الضريبة يتجاوز حد التحقق.',413);const ids=new Set<string>();
  for(const current of configurations){const id=identifier(current.id);ensure(!ids.has(id),'معرف إعداد ضريبة مكرر.',409);ids.add(id);ensure(current.org_id===orgId&&Number.isSafeInteger(current.revision)&&current.revision>0,'إعداد الضريبة الحالي تالف أو أجنبي.');const validatedCurrent=validateTaxConfiguration(policy(current),orgId),chain=versions.filter(row=>row.configuration_id===id).sort((a,b)=>a.revision-b.revision);ensure(chain.length===current.revision,'سلسلة إصدارات إعداد الضريبة ناقصة.',409);let previousVersionHash:string|null=null;
    for(let index=0;index<chain.length;index++){const row=chain[index],revision=index+1;ensure(row.id===`${id}-r${revision}`&&row.org_id===orgId&&row.revision===revision,'سلسلة إصدارات إعداد الضريبة غير صالحة.',409);validateTaxConfiguration({...policy(row),id} as TaxConfiguration,orgId);text(row.reason,1000,true);identifier(row.operation_id);identifier(row.versioned_by);ensure(row.previous_version_hash===previousVersionHash&&typeof row.version_hash==='string'&&/^[a-f0-9]{64}$/.test(row.version_hash)&&row.version_hash===await digest(versionHashBasis(row)),'بصمة سلسلة إصدارات إعداد الضريبة لا تطابق محتواها.',409);previousVersionHash=row.version_hash;}
    const last=chain.at(-1)!;ensure(JSON.stringify({...policy(last),id:last.configuration_id})===JSON.stringify(validatedCurrent)&&last.operation_id===current.operation_id&&last.versioned_by===current.updated_by&&last.version_hash===current.version_hash,'الإعداد الحالي لا يطابق آخر إصدار محفوظ.',409);
  }
  ensure(versions.every(row=>ids.has(identifier(row.configuration_id))),'يوجد إصدار ضريبة بلا إعداد حالي.',409);return{configurations,versions};
}
export function taxConfigurationBackupCounts(data:Record<string,Document[]>){return{tax_configuration_count:(data.tax_configurations||[]).length,tax_configuration_version_count:(data.tax_configuration_versions||[]).length};}
export async function validateTaxConfigurationBackup(backup:Document){const data=backup.collections,declared=backup.tax_configuration_schema_version!==undefined||backup.counters?.tax_configuration_count!==undefined||(data?.tax_configurations||[]).length||(data?.tax_configuration_versions||[]).length;if(declared){ensure(backup.tax_configuration_schema_version===1&&Array.isArray(data?.tax_configurations)&&Array.isArray(data?.tax_configuration_versions),'مصادر إعدادات الضريبة في النسخة ناقصة.',409);const counts=taxConfigurationBackupCounts(data);ensure(backup.counters?.tax_configuration_count===counts.tax_configuration_count&&backup.counters?.tax_configuration_version_count===counts.tax_configuration_version_count,'عدادات إعدادات الضريبة في النسخة مختلفة.',409);await verifyTaxConfigurationSources(data,identifier(backup.org?.id));}return{tax_configurations:data?.tax_configurations||[],tax_configuration_versions:data?.tax_configuration_versions||[]};}
export async function remapTaxConfigurations(data:Record<string,Document[]>,orgId:string){
  const versions:Document[]=[];const currents:Document[]=[];
  for(const current of data.tax_configurations||[]){let previous_version_hash:string|null=null;let lastHash='';for(const original of (data.tax_configuration_versions||[]).filter(row=>row.configuration_id===current.id).sort((a,b)=>a.revision-b.revision)){const row={...original,org_id:orgId,source_org_id:original.source_org_id||original.org_id,previous_version_hash};lastHash=await digest(versionHashBasis(row));versions.push({...row,version_hash:lastHash});previous_version_hash=lastHash;}currents.push({...current,org_id:orgId,source_org_id:current.source_org_id||current.org_id,version_hash:lastHash});}
  return{tax_configurations:currents,tax_configuration_versions:versions};
}

/** Proves the current materialized policy still has a complete immutable version chain. */
export async function validateTaxConfigurationVersions(tx: Transaction, root: string, orgId: string, current: Document) {
  const id = identifier(current.id);
  ensure(current.org_id === orgId && Number.isSafeInteger(current.revision) && current.revision > 0, 'إعداد الضريبة الحالي تالف أو أجنبي.');
  const validatedCurrent = validateTaxConfiguration(policy(current), orgId);
  const versions = await tx.find(`${root}/tax_configuration_versions`, 'configuration_id', id);
  ensure(versions.length === current.revision && versions.length <= 1200, 'سلسلة إصدارات إعداد الضريبة ناقصة أو تتجاوز حد التحقق.', 409);
  const revisions = new Set<number>();
  let previousVersionHash: string | null = null;
  for (const row of [...versions].sort((a,b) => a.revision - b.revision)) {
    ensure(row.id === `${id}-r${row.revision}` && row.configuration_id === id && Number.isSafeInteger(row.revision) && row.revision > 0 && row.revision <= current.revision && !revisions.has(row.revision), 'سلسلة إصدارات إعداد الضريبة غير صالحة.', 409);
    revisions.add(row.revision);
    validateTaxConfiguration({...policy(row), id} as TaxConfiguration, orgId);
    text(row.reason, 1000, true); identifier(row.operation_id); identifier(row.versioned_by);
    ensure(row.previous_version_hash === previousVersionHash && typeof row.version_hash === 'string' && /^[a-f0-9]{64}$/.test(row.version_hash) && row.version_hash === await digest(versionHashBasis(row)), 'بصمة سلسلة إصدارات إعداد الضريبة لا تطابق محتواها.', 409);
    previousVersionHash = row.version_hash;
  }
  for (let revision = 1; revision <= current.revision; revision++) ensure(revisions.has(revision), 'سلسلة إصدارات إعداد الضريبة غير مكتملة.', 409);
  const last = versions.find(row => row.revision === current.revision)!;
  ensure(JSON.stringify({...policy(last), id:last.configuration_id}) === JSON.stringify(validatedCurrent), 'الإعداد الحالي لا يطابق آخر إصدار محفوظ.', 409);
  ensure(last.operation_id === current.operation_id && last.versioned_by === current.updated_by && last.version_hash === current.version_hash, 'دليل آخر إصدار لا يطابق الإعداد الحالي.', 409);
  return versions;
}

export async function taxConfigurationCommand(action:string,data:Document,c:{tx:Transaction;root:string;orgId:string;actor:string;operationId:string;iso:string}) {
  ensure(data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).every(key=>inputKeys.includes(key)),'حقول حفظ إعداد الضريبة غير صالحة.');
  const id=identifier(data.id), path=`${c.root}/tax_configurations/${id}`, current=await c.tx.get(path), reason=text(data.reason,1000,true);
  ensure(action==='taxConfiguration.create'||action==='taxConfiguration.update','عملية إعداد ضريبة غير معروفة.');
  ensure(action==='taxConfiguration.create'?!current:!!current,action==='taxConfiguration.create'?'معرف إعداد الضريبة موجود مسبقاً.':'إعداد الضريبة غير موجود.',action==='taxConfiguration.create'?409:404);
  if(current) {
    ensure(Number.isSafeInteger(data.expected_revision)&&data.expected_revision===current.revision,'إعداد الضريبة تغير؛ حدّث البيانات ثم أعد المحاولة.',409);
    await validateTaxConfigurationVersions(c.tx,c.root,c.orgId,current);
  } else {
    ensure(data.expected_revision===undefined||data.expected_revision===0,'الإصدار الابتدائي غير صالح.');
    ensure((await c.tx.list(`${c.root}/tax_configurations`)).length < 250,'بلغت إعدادات الضريبة الحد التشغيلي للمؤسسة.',409);
  }
  const revision=(current?.revision||0)+1;
  const configuration=validateTaxConfiguration({schema_version:1,id,org_id:c.orgId,revision,name:data.name,jurisdiction:data.jurisdiction,direction:data.direction,rate:data.rate,calculation:data.calculation,rounding:data.rounding,recoverable:data.recoverable,tax_account_code:data.tax_account_code,effective_from:data.effective_from,effective_to:data.effective_to,active:data.active} as TaxConfiguration,c.orgId);
  validateTaxControlAccount(configuration,await c.tx.list(`${c.root}/accounts`) as Account[],c.orgId);
  if(current) ensure(JSON.stringify(comparable(configuration))!==JSON.stringify(comparable(validateTaxConfiguration(policy(current),c.orgId))),'لم يتغير إعداد الضريبة؛ لا يمكن إنشاء إصدار مطابق.',409);
  const versionId=`${id}-r${revision}`, versionPath=`${c.root}/tax_configuration_versions/${versionId}`;
  ensure(!(await c.tx.get(versionPath)),'إصدار إعداد الضريبة موجود مسبقاً.',409);
  const baseSaved=clean({...configuration,created_at:current?.created_at||c.iso,created_by:current?.created_by||c.actor,updated_at:c.iso,updated_by:c.actor,operation_id:c.operationId});
  const versionBase=clean({...baseSaved,id:versionId,configuration_id:id,reason,versioned_at:c.iso,versioned_by:c.actor,previous_version_hash:current?.version_hash||null});
  const versionHash=await digest(versionHashBasis(versionBase));
  const saved=clean({...baseSaved,version_hash:versionHash});
  const version=clean({...versionBase,version_hash:versionHash});
  return {result:saved,before:current,changes:[{path,value:saved},{path:versionPath,value:version}]};
}
