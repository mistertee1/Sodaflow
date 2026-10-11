import type {Account} from '../types';
import type {Document, Transaction} from './store';
import {clean} from './store';
import {validateTaxConfiguration, validateTaxControlAccount, type TaxConfiguration} from './taxConfiguration';
import {ensure, identifier} from './validation';

const inputKeys = ['id','expected_revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active','reason'];

export async function taxConfigurationCommand(action:string,data:Document,c:{tx:Transaction;root:string;orgId:string;actor:string;operationId:string;iso:string}) {
  ensure(data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).every(key=>inputKeys.includes(key)),'حقول حفظ إعداد الضريبة غير صالحة.');
  const id=identifier(data.id), path=`${c.root}/tax_configurations/${id}`, current=await c.tx.get(path);
  ensure(action==='taxConfiguration.create'||action==='taxConfiguration.update','عملية إعداد ضريبة غير معروفة.');
  ensure(action==='taxConfiguration.create'?!current:!!current,action==='taxConfiguration.create'?'معرف إعداد الضريبة موجود مسبقاً.':'إعداد الضريبة غير موجود.',action==='taxConfiguration.create'?409:404);
  if(current) ensure(Number.isSafeInteger(data.expected_revision)&&data.expected_revision===current.revision,'إعداد الضريبة تغير؛ حدّث البيانات ثم أعد المحاولة.',409);
  else ensure(data.expected_revision===undefined||data.expected_revision===0,'الإصدار الابتدائي غير صالح.');
  const revision=(current?.revision||0)+1;
  const configuration=validateTaxConfiguration({schema_version:1,id,org_id:c.orgId,revision,name:data.name,jurisdiction:data.jurisdiction,direction:data.direction,rate:data.rate,calculation:data.calculation,rounding:data.rounding,recoverable:data.recoverable,tax_account_code:data.tax_account_code,effective_from:data.effective_from,effective_to:data.effective_to,active:data.active} as TaxConfiguration,c.orgId);
  validateTaxControlAccount(configuration,await c.tx.list(`${c.root}/accounts`) as Account[],c.orgId);
  const versionId=`${id}-r${revision}`, versionPath=`${c.root}/tax_configuration_versions/${versionId}`;
  ensure(!(await c.tx.get(versionPath)),'إصدار إعداد الضريبة موجود مسبقاً.',409);
  const saved=clean({...configuration,created_at:current?.created_at||c.iso,created_by:current?.created_by||c.actor,updated_at:c.iso,updated_by:c.actor,operation_id:c.operationId});
  const version=clean({...saved,id:versionId,configuration_id:id,reason:data.reason,versioned_at:c.iso,versioned_by:c.actor});
  return {result:saved,before:current,changes:[{path,value:saved},{path:versionPath,value:version}]};
}
