import type { CellValue } from 'exceljs';
import { MASTER_IMPORT_FIELDS, type ImportCell, type MasterImportModule } from '../domain/masterImport';

export const IMPORT_TEMPLATE_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const titles:Record<MasterImportModule,string>={customers:'العملاء',suppliers:'الموردين',products:'المنتجات'};
const filenames:Record<MasterImportModule,string>={customers:'customers_import_template.xlsx',suppliers:'suppliers_import_template.xlsx',products:'products_import_template.xlsx'};

const valueOf=(value:CellValue):unknown=>{
  if(value===null||value===undefined)return '';
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(typeof value==='object'){
    if('formula' in value)return {value:'result' in value?value.result:'',formula:String(value.formula)} satisfies ImportCell;
    if('richText' in value)return value.richText.map(part=>part.text).join('');
    if('text' in value)return value.text;
    if('error' in value)return value.error;
  }
  return value;
};

export async function createMasterImportTemplate(module:MasterImportModule){
  const {default:ExcelJS}=await import('exceljs');
  const workbook=new ExcelJS.Workbook();workbook.creator='SudaFlow';workbook.created=new Date(0);
  const fields=MASTER_IMPORT_FIELDS[module],instructions=workbook.addWorksheet('Instructions');
  instructions.columns=[{header:'التعليمات',key:'instruction',width:90}];
  [
    `قالب استيراد ${titles[module]} — مرحلة المعاينة والتحقق.`,
    'أدخل البيانات في ورقة Data فقط ولا تغيّر أسماء الأعمدة.',
    'لا تستخدم صيغ Excel؛ حوّل الصيغ إلى قيم ثابتة قبل الرفع.',
    'الرصيد أو المخزون أو التكلفة الافتتاحية يجب أن تكون صفراً في هذه المرحلة؛ تُعالج القيم الافتتاحية في Excel 2.',
    'لن تُكتب بيانات الإنتاج عند الرفع أو المعاينة. الاعتماد والتنفيذ مرحلة منفصلة.',
    'الحد الأقصى 2000 صف، والعملات المقبولة SDG وUSD.',
  ].forEach(instruction=>instructions.addRow({instruction}));
  const data=workbook.addWorksheet('Data',{views:[{state:'frozen',ySplit:1}]});
  data.columns=fields.map(field=>({header:field.field,key:field.field,width:Math.max(16,field.field.length+3)}));
  data.autoFilter={from:{row:1,column:1},to:{row:1,column:fields.length}};
  data.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};data.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF174A5B'}};
  const examples=workbook.addWorksheet('Examples',{views:[{state:'frozen',ySplit:1}]});
  examples.columns=fields.map(field=>({header:field.field,key:field.field,width:Math.max(16,field.field.length+3)}));
  examples.addRow(Object.fromEntries(fields.map(field=>[field.field,field.example])));
  examples.getRow(1).font={bold:true};
  const buffer=await workbook.xlsx.writeBuffer();
  return{filename:filenames[module],mime_type:IMPORT_TEMPLATE_MIME,bytes:new Uint8Array(buffer as ArrayBuffer)};
}

export async function sha256Hex(buffer:ArrayBuffer){
  const digest=await crypto.subtle.digest('SHA-256',buffer);return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function parseMasterImportWorkbook(file:File){
  const {default:ExcelJS}=await import('exceljs');
  if(!/\.xlsx$/i.test(file.name))throw new Error('صيغة الملف يجب أن تكون .xlsx.');
  if(file.size>2*1024*1024)throw new Error('حجم الملف يتجاوز 2MB؛ قسّمه إلى دفعات أصغر.');
  const buffer=await file.arrayBuffer(),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as never);
  if(workbook.worksheets.length>10)throw new Error('عدد أوراق العمل يتجاوز الحد المسموح.');
  const sheet=workbook.getWorksheet('Data')||workbook.worksheets[0];if(!sheet)throw new Error('ورقة Data غير موجودة.');
  if(sheet.columnCount>40||sheet.rowCount>2001)throw new Error('الملف يتجاوز 40 عموداً أو 2000 صف بيانات.');
  const headers:string[]=[];sheet.getRow(1).eachCell({includeEmpty:true},cell=>headers.push(String(valueOf(cell.value)??'').trim()));
  while(headers.length&&headers.at(-1)==='')headers.pop();
  if(!headers.length||headers.some(header=>!header))throw new Error('صف عناوين الأعمدة ناقص.');
  const rows:Array<Array<unknown|ImportCell>>=[];
  for(let rowNumber=2;rowNumber<=sheet.rowCount;rowNumber++){
    const row=sheet.getRow(rowNumber),values=headers.map((_,index)=>valueOf(row.getCell(index+1).value));
    if(values.some(value=>typeof value==='object'||String(value??'').trim()!==''))rows.push(values);
  }
  if(!rows.length)throw new Error('لا توجد صفوف بيانات في ورقة Data.');
  return{file_name:file.name,file_hash:await sha256Hex(buffer),headers,rows};
}
