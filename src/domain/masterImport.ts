import type { ActionType } from '../services/rbacService';
import type { Document } from './store';
import { BusinessError, ensure, text } from './validation';

export type MasterImportModule = 'customers' | 'suppliers' | 'products';
export type ImportIssueLevel = 'blocking' | 'warning' | 'autofix';
export interface ImportCell { value: unknown; formula?: string; }
export interface MasterImportInput {
  module: MasterImportModule;
  file_name: string;
  file_hash: string;
  headers: string[];
  rows: Array<Array<unknown | ImportCell>>;
  mapping: Record<string, string>;
}
export interface ImportIssue { row: number; field: string; level: ImportIssueLevel; code: string; message: string; original?: unknown; normalized?: unknown; }
export interface ImportPreviewRow { row_number: number; data: Document; status: 'valid' | 'warning' | 'blocking' | 'duplicate'; duplicate_keys: string[]; issues: ImportIssue[]; }

interface FieldDefinition { field: string; label: string; required?: boolean; example: unknown; aliases: string[]; type?: 'email' | 'phone' | 'currency' | 'number' | 'boolean'; }
const common = {
  customer_code: { field:'customer_code',label:'رمز العميل',example:'C-001',aliases:['customer code','code','رمز العميل'] },
  supplier_code: { field:'supplier_code',label:'رمز المورد',example:'S-001',aliases:['supplier code','code','رمز المورد'] },
  name: { field:'name',label:'الاسم',required:true,example:'شركة النيل',aliases:['customer name','supplier name','name','الاسم','اسم العميل','اسم المورد'] },
  phone: { field:'phone',label:'الهاتف',example:'+249912345678',aliases:['mobile','telephone','phone','الهاتف','الجوال'],type:'phone' },
  email: { field:'email',label:'البريد الإلكتروني',example:'accounts@example.com',aliases:['e-mail','email address','email','البريد الإلكتروني'],type:'email' },
  address: { field:'address',label:'العنوان',example:'الخرطوم',aliases:['location','address','العنوان'] },
  currency: { field:'currency',label:'العملة',example:'SDG',aliases:['preferred currency','default currency','currency','العملة'],type:'currency' },
  opening_balance: { field:'opening_balance',label:'الرصيد الافتتاحي',example:0,aliases:['opening balance','الرصيد الافتتاحي'],type:'number' },
  payment_terms: { field:'payment_terms',label:'شروط السداد بالأيام',example:30,aliases:['payment terms','payment terms days','شروط السداد'],type:'number' },
} satisfies Record<string, FieldDefinition>;

export const MASTER_IMPORT_FIELDS: Record<MasterImportModule, FieldDefinition[]> = {
  customers: [common.customer_code,common.name,common.phone,common.email,common.address,common.currency,{field:'credit_limit',label:'حد الائتمان',example:0,aliases:['credit limit','حد الائتمان'],type:'number'},common.opening_balance,common.payment_terms],
  suppliers: [common.supplier_code,common.name,common.phone,common.email,common.address,common.currency,common.opening_balance,common.payment_terms,{field:'tax_number',label:'الرقم الضريبي',example:'TN-100',aliases:['tax no','tax number','vat number','الرقم الضريبي']}],
  products: [
    {field:'sku',label:'SKU',required:true,example:'SKU-001',aliases:['product code','item code','sku','رمز المنتج']},
    {field:'product_name',label:'اسم المنتج',required:true,example:'منتج تجريبي',aliases:['product name','item name','name','اسم المنتج']},
    {field:'category',label:'التصنيف',example:'عام',aliases:['category','التصنيف']},
    {field:'unit',label:'الوحدة',required:true,example:'قطعة',aliases:['uom','unit','الوحدة']},
    {field:'selling_price_sdg',label:'سعر البيع SDG',example:1000,aliases:['price sdg','selling price sdg','سعر البيع sdg'],type:'number'},
    {field:'selling_price_usd',label:'سعر البيع USD',example:0,aliases:['price usd','selling price usd','سعر البيع usd'],type:'number'},
    {field:'opening_quantity',label:'الكمية الافتتاحية',example:0,aliases:['opening quantity','opening stock','الكمية الافتتاحية'],type:'number'},
    {field:'unit_cost',label:'تكلفة الوحدة',example:0,aliases:['cost','unit cost','تكلفة الوحدة'],type:'number'},
    {field:'track_inventory',label:'تتبع المخزون',example:true,aliases:['track inventory','inventory tracked','تتبع المخزون'],type:'boolean'},
    {field:'tax_rate',label:'نسبة الضريبة',example:0,aliases:['tax rate','vat rate','نسبة الضريبة'],type:'number'},
  ],
};

const modulePermission: Record<MasterImportModule, ActionType> = { customers:'import:customers',suppliers:'import:suppliers',products:'import:products' };
export const masterImportPermission = (module: MasterImportModule) => modulePermission[module];
export function masterImportModule(value: unknown): MasterImportModule {
  ensure(['customers','suppliers','products'].includes(String(value)), 'نوع الاستيراد غير مدعوم.');
  return value as MasterImportModule;
}

const normalizedHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g,' ');
export function automaticImportMapping(module: MasterImportModule, headers: string[]) {
  const used=new Set<string>(),result:Record<string,string>={};
  for(const definition of MASTER_IMPORT_FIELDS[module]){
    const names=[definition.field,...definition.aliases].map(normalizedHeader);
    const match=headers.find(header=>!used.has(header)&&names.includes(normalizedHeader(header)));
    if(match){result[definition.field]=match;used.add(match);}
  }
  return result;
}

const cellValue=(cell:unknown|ImportCell)=>cell&&typeof cell==='object'&&!Array.isArray(cell)&&Object.prototype.hasOwnProperty.call(cell,'value')?(cell as ImportCell).value:cell;
const hasFormula=(cell:unknown|ImportCell)=>Boolean(cell&&typeof cell==='object'&&!Array.isArray(cell)&&(cell as ImportCell).formula);
const cleanString=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ');
const asNumber=(value:unknown)=>{if(value===''||value===null||value===undefined)return null;const cleaned=typeof value==='string'?value.replace(/,/g,'').trim():value;const number=Number(cleaned);return Number.isFinite(number)?number:NaN;};
const asBoolean=(value:unknown)=>{if(typeof value==='boolean')return value;const key=normalizedHeader(value);if(['true','yes','1','نعم','صح'].includes(key))return true;if(['false','no','0','لا','خطأ'].includes(key))return false;return null;};
const comparable=(value:unknown)=>cleanString(value).toLowerCase();
const duplicateFields:Record<MasterImportModule,string[]>={customers:['customer_code','email'],suppliers:['supplier_code','email','tax_number'],products:['sku']};
const existingValue=(module:MasterImportModule,row:Document,field:string)=>{
  if(field==='customer_code')return row.customer_code??row.code??row.id;
  if(field==='supplier_code')return row.supplier_code??row.code??row.id;
  if(field==='sku')return row.sku??row.code??row.id;
  return row[field];
};

function normalizeField(definition:FieldDefinition,value:unknown,row:number,issues:ImportIssue[]){
  const original=value;let normalized:unknown=definition.type?typeof value==='string'?cleanString(value):value:cleanString(value);
  if(typeof original==='string'&&definition.type!=='number'&&definition.type!=='phone'&&/^[=@+\-]/.test(original.trim()))issues.push({row,field:definition.field,level:'blocking',code:'DANGEROUS_TEXT',message:'قيمة نصية تبدأ بعلامة قد تُفسّر كصيغة؛ أزل العلامة أو أدخل قيمة ثابتة آمنة.',original});
  if(definition.type==='email'&&normalized){normalized=cleanString(normalized).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(normalized)))issues.push({row,field:definition.field,level:'blocking',code:'INVALID_EMAIL',message:'صيغة البريد الإلكتروني غير صالحة.',original});}
  if(definition.type==='phone'&&normalized){normalized=cleanString(normalized).replace(/[\s()-]/g,'');if(!/^\+?[0-9]{7,18}$/.test(String(normalized)))issues.push({row,field:definition.field,level:'warning',code:'PHONE_REVIEW',message:'راجع صيغة رقم الهاتف.',original});}
  if(definition.type==='currency'&&normalized){normalized=cleanString(normalized).toUpperCase();if(!['SDG','USD'].includes(String(normalized)))issues.push({row,field:definition.field,level:'blocking',code:'INVALID_CURRENCY',message:'العملة يجب أن تكون SDG أو USD.',original});}
  if(definition.type==='number'){normalized=asNumber(normalized);if(Number.isNaN(normalized))issues.push({row,field:definition.field,level:'blocking',code:'INVALID_NUMBER',message:'القيمة يجب أن تكون رقماً صالحاً.',original});}
  if(definition.type==='boolean'){normalized=asBoolean(normalized);if(normalized===null&&original!==''&&original!==null&&original!==undefined)issues.push({row,field:definition.field,level:'blocking',code:'INVALID_BOOLEAN',message:'القيمة المنطقية غير صالحة.',original});}
  if(original!==normalized&&original!==''&&original!==null&&original!==undefined&&!issues.some(issue=>issue.field===definition.field&&issue.level==='blocking'))issues.push({row,field:definition.field,level:'autofix',code:'NORMALIZED',message:'تم تطبيع القيمة وستظهر بهذه الصورة في المعاينة.',original,normalized});
  return normalized;
}

export function buildMasterImportPreview(input:MasterImportInput,existing:Document[],previousSessions:Document[],context:{orgId:string;actor:string;operationId:string;createdAt:string}){
  const module=masterImportModule(input.module),definitions=MASTER_IMPORT_FIELDS[module];
  text(input.file_name,180,true);ensure(/\.xlsx$/i.test(input.file_name),'اسم ملف الاستيراد يجب أن ينتهي بـ .xlsx.');ensure(/^[a-f0-9]{64}$/i.test(input.file_hash),'بصمة الملف غير صالحة.');
  ensure(existing.every(record=>record.org_id===context.orgId),'بيانات المقارنة تحتوي سجلاً من مؤسسة أخرى.',409);ensure(previousSessions.every(session=>session.org_id===context.orgId),'جلسات الاستيراد تحتوي سجلاً من مؤسسة أخرى.',409);
  ensure(input.headers.length>0&&input.headers.length<=40,'عدد أعمدة الملف غير مدعوم.');ensure(new Set(input.headers.map(normalizedHeader)).size===input.headers.length,'عناوين الأعمدة مكررة.');
  ensure(input.rows.length>0&&input.rows.length<=2000,'يجب أن يحتوي الملف على 1 إلى 2000 صف.');
  ensure(Object.keys(input.mapping).every(field=>definitions.some(definition=>definition.field===field)),'خريطة الأعمدة تحتوي حقلاً غير مدعوم.');
  ensure(Object.values(input.mapping).every(header=>!header||input.headers.includes(header)),'خريطة الأعمدة تشير إلى عنوان غير موجود.');
  ensure(new Set(Object.values(input.mapping).filter(Boolean)).size===Object.values(input.mapping).filter(Boolean).length,'لا يمكن ربط العمود نفسه بأكثر من حقل.');
  for(const definition of definitions.filter(item=>item.required))ensure(input.mapping[definition.field],'اربط الحقول الإلزامية قبل المعاينة.');
  const indexes=Object.fromEntries(input.headers.map((header,index)=>[header,index]));
  const previewRows:ImportPreviewRow[]=[],seen=new Map<string,number>();
  for(let index=0;index<input.rows.length;index++){
    const rowNumber=index+2,cells=input.rows[index];ensure(Array.isArray(cells)&&cells.length<=40,'صف الاستيراد غير صالح.');
    const data:Document={},issues:ImportIssue[]=[];
    for(const definition of definitions){const header=input.mapping[definition.field];if(!header)continue;const cell=cells[indexes[header]];if(hasFormula(cell))issues.push({row:rowNumber,field:definition.field,level:'blocking',code:'FORMULA_NOT_ALLOWED',message:'الصيغ غير مسموحة في ملفات الاستيراد؛ استخدم قيمة ثابتة.'});data[definition.field]=normalizeField(definition,cellValue(cell),rowNumber,issues);}
    for(const definition of definitions.filter(item=>item.required))if(data[definition.field]===null||data[definition.field]===undefined||data[definition.field]==='')issues.push({row:rowNumber,field:definition.field,level:'blocking',code:'REQUIRED',message:`حقل ${definition.label} مطلوب.`});
    for(const definition of definitions.filter(item=>!item.type||['email','phone','currency'].includes(item.type)))if(data[definition.field]!==undefined&&data[definition.field]!==null)try{text(data[definition.field],200);}catch{issues.push({row:rowNumber,field:definition.field,level:'blocking',code:'TEXT_TOO_LONG',message:`حقل ${definition.label} أطول من الحد المسموح.`});}
    if(!data.phone)issues.push({row:rowNumber,field:'phone',level:'warning',code:'MISSING_PHONE',message:'رقم الهاتف غير موجود.'});
    if(!data.email&&module!=='products')issues.push({row:rowNumber,field:'email',level:'warning',code:'MISSING_EMAIL',message:'البريد الإلكتروني غير موجود.'});
    if(module==='suppliers'&&!data.tax_number)issues.push({row:rowNumber,field:'tax_number',level:'warning',code:'MISSING_TAX_NUMBER',message:'الرقم الضريبي غير موجود.'});
    for(const field of ['selling_price_sdg','selling_price_usd'])if(data[field]===0)issues.push({row:rowNumber,field,level:'warning',code:'ZERO_PRICE',message:'سعر البيع صفر؛ راجعه قبل الاعتماد.'});
    for(const field of ['credit_limit','payment_terms','selling_price_sdg','selling_price_usd','tax_rate'])if(typeof data[field]==='number'&&data[field]<0)issues.push({row:rowNumber,field,level:'blocking',code:'NEGATIVE_VALUE',message:'القيمة السالبة غير صالحة لهذا الحقل.'});
    if(typeof data.tax_rate==='number'&&data.tax_rate>100)issues.push({row:rowNumber,field:'tax_rate',level:'blocking',code:'INVALID_TAX_RATE',message:'نسبة الضريبة يجب ألا تتجاوز 100%.'});
    if(typeof data.opening_balance==='number'&&data.opening_balance!==0)issues.push({row:rowNumber,field:'opening_balance',level:'blocking',code:'OPENING_DEFERRED',message:'الأرصدة الافتتاحية تُستورد في Excel 2 مع القيود والمطابقة، وليست ضمن استيراد البيانات الرئيسية.'});
    if(typeof data.opening_quantity==='number'&&data.opening_quantity<0)issues.push({row:rowNumber,field:'opening_quantity',level:'blocking',code:'NEGATIVE_QUANTITY',message:'الكمية الافتتاحية السالبة غير صالحة.'});
    if(typeof data.opening_quantity==='number'&&data.opening_quantity!==0)issues.push({row:rowNumber,field:'opening_quantity',level:'blocking',code:'OPENING_DEFERRED',message:'مخزون البداية يُستورد في Excel 2 مع التكلفة والمطابقة.'});
    if(typeof data.unit_cost==='number'&&data.unit_cost!==0)issues.push({row:rowNumber,field:'unit_cost',level:'blocking',code:'OPENING_DEFERRED',message:'تكلفة البداية تُستورد في Excel 2 مع المخزون والمطابقة.'});
    const duplicateKeys:string[]=[];
    for(const field of duplicateFields[module]){const value=comparable(data[field]);if(!value)continue;const key=`${field}:${value}`,prior=seen.get(key);if(prior)issues.push({row:rowNumber,field,level:'blocking',code:'DUPLICATE_IN_FILE',message:`القيمة مكررة داخل الملف مع الصف ${prior}.`});else seen.set(key,rowNumber);if(existing.some(record=>comparable(existingValue(module,record,field))===value)){duplicateKeys.push(field);issues.push({row:rowNumber,field,level:'warning',code:'DUPLICATE_EXISTING',message:'تطابق محتمل مع سجل قائم؛ يلزم اختيار سياسة التكرار في مرحلة الاعتماد.'});}}
    const blocking=issues.some(issue=>issue.level==='blocking'),warning=issues.some(issue=>issue.level==='warning');
    previewRows.push({row_number:rowNumber,data,status:blocking?'blocking':duplicateKeys.length?'duplicate':warning?'warning':'valid',duplicate_keys:duplicateKeys,issues});
  }
  const fileDuplicate=previousSessions.some(session=>session.file_hash===input.file_hash);
  const allIssues=previewRows.flatMap(row=>row.issues),totals={rows:previewRows.length,valid:previewRows.filter(row=>row.status==='valid').length,warnings:previewRows.filter(row=>row.issues.some(issue=>issue.level==='warning')).length,errors:previewRows.filter(row=>row.issues.some(issue=>issue.level==='blocking')).length,duplicates:previewRows.filter(row=>row.duplicate_keys.length||row.issues.some(issue=>issue.code==='DUPLICATE_IN_FILE')).length,autofixes:allIssues.filter(issue=>issue.level==='autofix').length};
  const id=`imp-${context.operationId}`;
  const session={id,org_id:context.orgId,schema_version:1,file_name:input.file_name,file_hash:input.file_hash,import_type:module,created_by:context.actor,created_at:context.createdAt,status:'previewed',totals,file_duplicate:fileDuplicate,mapping:input.mapping};
  const staging={id,org_id:context.orgId,session_id:id,schema_version:1,module,rows:previewRows,created_at:context.createdAt};
  ensure(new TextEncoder().encode(JSON.stringify(staging)).length<=620000,'حجم المعاينة كبير؛ قسّم الملف إلى دفعات أصغر.',413);
  return{session,staging,result:{...session,preview_rows:previewRows.slice(0,50),file_duplicate_warning:fileDuplicate?'سبق رفع ملف بالبصمة نفسها؛ راجع الجلسات السابقة قبل المتابعة.':''}};
}

export function assertMasterImportPayload(input:unknown):asserts input is MasterImportInput{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new BusinessError('بيانات الاستيراد غير صالحة.');
  const value=input as MasterImportInput;ensure(Object.keys(value).every(key=>['module','file_name','file_hash','headers','rows','mapping'].includes(key)),'حقول الاستيراد غير صالحة أو محمية.');
  ensure(Array.isArray(value.headers)&&Array.isArray(value.rows)&&value.mapping&&typeof value.mapping==='object'&&!Array.isArray(value.mapping),'هيكل ملف الاستيراد غير صالح.');
}
