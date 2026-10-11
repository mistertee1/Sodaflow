import type {Account} from '../types';
import type {Document, Transaction} from './store';
import {clean} from './store';
import {validateTaxConfiguration, validateTaxControlAccount, type TaxConfiguration} from './taxConfiguration';
import {ensure, identifier, text} from './validation';

const inputKeys = ['id','expected_revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active','reason'];
const policyKeys = ['schema_version','id','org_id','revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active'] as const;
const policy = (row: Document) => Object.fromEntries(policyKeys.map(key => [key, row[key]])) as unknown as TaxConfiguration;
const comparable = (row: TaxConfiguration) => clean({...row, revision: 0});

/** Proves the current materialized policy still has a complete immutable version chain. */
export async function validateTaxConfigurationVersions(tx: Transaction, root: string, orgId: string, current: Document) {
  const id = identifier(current.id);
  ensure(current.org_id === orgId && Number.isSafeInteger(current.revision) && current.revision > 0, 'إعداد الضريبة الحالي تالف أو أجنبي.');
  const validatedCurrent = validateTaxConfiguration(policy(current), orgId);
  const versions = await tx.find(`${root}/tax_configuration_versions`, 'configuration_id', id);
  ensure(versions.length === current.revision && versions.length <= 1200, 'سلسلة إصدارات إعداد الضريبة ناقصة أو تتجاوز حد التحقق.', 409);
  const revisions = new Set<number>();
  for (const row of versions) {
    ensure(row.id === `${id}-r${row.revision}` && row.configuration_id === id && Number.isSafeInteger(row.revision) && row.revision > 0 && row.revision <= current.revision && !revisions.has(row.revision), 'سلسلة إصدارات إعداد الضريبة غير صالحة.', 409);
    revisions.add(row.revision);
    validateTaxConfiguration({...policy(row), id} as TaxConfiguration, orgId);
    text(row.reason, 1000, true); identifier(row.operation_id); identifier(row.versioned_by);
  }
  for (let revision = 1; revision <= current.revision; revision++) ensure(revisions.has(revision), 'سلسلة إصدارات إعداد الضريبة غير مكتملة.', 409);
  const last = versions.find(row => row.revision === current.revision)!;
  ensure(JSON.stringify({...policy(last), id:last.configuration_id}) === JSON.stringify(validatedCurrent), 'الإعداد الحالي لا يطابق آخر إصدار محفوظ.', 409);
  ensure(last.operation_id === current.operation_id && last.versioned_by === current.updated_by, 'دليل آخر إصدار لا يطابق الإعداد الحالي.', 409);
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
  const saved=clean({...configuration,created_at:current?.created_at||c.iso,created_by:current?.created_by||c.actor,updated_at:c.iso,updated_by:c.actor,operation_id:c.operationId});
  const version=clean({...saved,id:versionId,configuration_id:id,reason,versioned_at:c.iso,versioned_by:c.actor});
  return {result:saved,before:current,changes:[{path,value:saved},{path:versionPath,value:version}]};
}
