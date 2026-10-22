import type { CellValue, Worksheet } from 'exceljs';
import type { HistoricalImportContext, HistoricalImportRow } from '../domain/historicalImport';
import { validateHistoricalImport } from '../domain/historicalImport';
import type { HistoricalDocumentEvidence, HistoricalDocumentEvidenceContext } from '../domain/historicalDocumentEvidence';
import { validateHistoricalDocumentEvidence } from '../domain/historicalDocumentEvidence';
import { dateOnly, ensure, money, text } from '../domain/validation';
import { sha256Hex, IMPORT_TEMPLATE_MIME } from './masterImportWorkbook';

export const historicalWorkbookHeaders={
  Documents:['row_number','kind','reference','date','currency','branch_id','account_code','party_id','due_date','exchange_rate_used','control_account_code','tax_account_code','tax_configuration_version_hash','total','paid'],
  Lines:['row_number','line_number','product_id','description','quantity','net','tax','cogs','inventory_value'],
  Payments:['row_number','payment_number','date','amount','account_code','exchange_rate_used','reference'],
} as const;
type SheetName=keyof typeof historicalWorkbookHeaders;
type Row=Record<string,string|number>;
const sheets=Object.keys(historicalWorkbookHeaders) as SheetName[];
const numeric=new Set(['row_number','line_number','payment_number','exchange_rate_used','total','paid','quantity','net','tax','cogs','inventory_value','amount']);
const optional=new Set(['tax_account_code','tax_configuration_version_hash','product_id','cogs','inventory_value']);
const integer=(value:unknown)=>{ensure(typeof value==='number'&&Number.isSafeInteger(value)&&value>0,'معرف الصف أو تسلسل البند يجب أن يكون عدداً صحيحاً موجباً.');return value as number;};

export async function createHistoricalImportTemplate(){
  const {default:ExcelJS}=await import('exceljs');
  const workbook=new ExcelJS.Workbook();workbook.creator='SudaFlow';workbook.created=new Date(0);
  const instructions=workbook.addWorksheet('Instructions');instructions.getColumn(1).width=110;
  [
    'SudaFlow historical document evidence — schema 1',
    'قالب للفواتير invoice أو المشتريات purchase فقط. لا تخلط النوعين في جلسة واحدة.',
    'Documents: مستند واحد لكل row_number فريد. اربط Lines وPayments بنفس الرقم، ورتب line_number وpayment_number من 1 بلا فجوات.',
    'استخدم معرفات الطرف والمنتج والحساب والفرع الموجودة في المؤسسة. التواريخ YYYY-MM-DD والعملات SDG أو USD.',
    'الأموال أرقام Excel ثابتة: SDG بلا كسور وUSD بدقتين؛ الكميات حتى 6 وسعر الصرف حتى 8 منازل. الصيغ والخلايا المدمجة ممنوعة.',
    'البيع المخزني يحتاج cogs موثقاً؛ الشراء يحتاج inventory_value مساوياً للصافي. الضريبة غير الصفرية تحتاج حساباً وبصمة إصدار إعداد محفوظ.',
    'لا تخمّن تكلفة أو ضريبة أو سعر صرف قديم. شراء سابق لآخر حركة تكلفة يحتاج replay مستقلاً.',
    'رفع الملف أو قراءته لا يحفظ أي بيانات. الخادم يعيد التحقق قبل staging، ثم يلزم معاينة واعتماد مستقل ومطابقة.',
    'الحد 200 مستند، و100 بند و100 دفعة لكل مستند، و2MB. سقف الحفظ الذري 400 كتابة قد يتطلب دفعة أصغر.',
  ].forEach(value=>instructions.addRow([value]));
  const examples=workbook.addWorksheet('Examples');examples.getColumn(1).width=110;
  ['مثال ربط: Documents row_number=7، وLines row_number=7 مع line_number=1، وPayments row_number=7 مع payment_number=1.',
   'البيع: kind=invoice، account_code=4100، control_account_code=1200. الشراء: kind=purchase، account_code=1300، control_account_code=2110.',
   'الأمثلة شرح فقط وليست سجلات مالية، ولا تدخل في بيانات الاستيراد.'].forEach(value=>examples.addRow([value]));
  for(const name of sheets){
    const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});
    sheet.columns=historicalWorkbookHeaders[name].map(header=>({header,key:header,width:Math.max(18,header.length+3)}));
    sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:historicalWorkbookHeaders[name].length}};
    sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
    sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF174A5B'}};
    for(const header of historicalWorkbookHeaders[name])if(numeric.has(header))sheet.getColumn(header).numFmt='0.########';
  }
  const bytes=await workbook.xlsx.writeBuffer();
  return{filename:'sudaflow_historical_documents_template.xlsx',mime_type:IMPORT_TEMPLATE_MIME,bytes:new Uint8Array(bytes as ArrayBuffer)};
}

function cellValue(value:CellValue):string|number{
  if(value===null||value===undefined)return'';
  ensure(typeof value==='string'||typeof value==='number','الصيغ والروابط وكائنات الخلايا غير مقبولة؛ استخدم قيماً ثابتة.');
  if(typeof value==='number'){ensure(Number.isFinite(value),'خلية رقمية غير منتهية.');return value;}
  ensure(value.length<=2000,'نص الخلية يتجاوز الحد.');return value.trim();
}
function readSheet(sheet:Worksheet,name:SheetName):Row[]{
  const headers=historicalWorkbookHeaders[name];
  ensure(sheet.state==='visible'&&sheet.columnCount<=headers.length&&sheet.rowCount<=(name==='Documents'?201:20001),'ورقة مخفية أو تتجاوز حدود القالب.');
  for(const [index,header] of headers.entries())ensure(!sheet.getRow(1).getCell(index+1).isMerged&&cellValue(sheet.getRow(1).getCell(index+1).value)===header,`عناوين ورقة ${name} لا تطابق القالب.`);
  const rows:Row[]=[];
  for(let index=2;index<=sheet.rowCount;index++){
    const cells=headers.map((header,column)=>{const cell=sheet.getRow(index).getCell(column+1);ensure(!cell.isMerged,'الخلايا المدمجة غير مقبولة.');return[header,cellValue(cell.value)] as const;});
    if(cells.every(([,value])=>value===''))continue;
    for(const [header,value] of cells){
      ensure(value!==''||optional.has(header),`الحقل ${header} مفقود في ${name}:${index}.`);
      if(value!==''&&numeric.has(header))ensure(typeof value==='number',`الحقل ${header} يجب أن يكون رقماً فعلياً في Excel.`);
      else if(value!==''&&!numeric.has(header))ensure(typeof value==='string',`الحقل ${header} يجب أن يكون نصاً.`);
    }
    rows.push(Object.fromEntries(cells));
  }
  return rows;
}

/** Local preview only. Context is a UI hint; historicalImport.stage re-derives authority on the server. */
export async function parseHistoricalImportWorkbook(file:File,context:{validation:HistoricalImportContext;documents:HistoricalDocumentEvidenceContext}){
  ensure(/\.xlsx$/i.test(file.name)&&file.size>0&&file.size<=2*1024*1024,'استخدم ملف XLSX غير فارغ بحد أقصى 2MB.');
  const {default:ExcelJS}=await import('exceljs');const buffer=await file.arrayBuffer();
  ensure(buffer.byteLength===file.size,'حجم الملف لا يطابق محتواه.');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as never);
  ensure(workbook.worksheets.length===5&&['Instructions','Examples',...sheets].every(name=>workbook.getWorksheet(name)),'استخدم القالب الرسمي بأوراقه الخمس فقط.');
  const data=Object.fromEntries(sheets.map(name=>[name,readSheet(workbook.getWorksheet(name)!,name)])) as Record<SheetName,Row[]>;
  ensure(data.Documents.length>0&&data.Documents.length<=200,'القالب يحتاج من 1 إلى 200 مستند.');
  const rows:HistoricalImportRow[]=[],document_evidence:Record<string,HistoricalDocumentEvidence>={};
  for(const row of data.Documents){
    const id=integer(row.row_number);ensure(!document_evidence[id],'رقم مستند مكرر.');
    ensure(row.kind==='invoice'||row.kind==='purchase','القالب مخصص للبيع والشراء فقط.');
    ensure(row.currency==='SDG'||row.currency==='USD','عملة المستند غير مدعومة.');
    const decimals=row.currency==='USD'?2:0;money(row.total as number,decimals,true);money(row.paid as number,decimals);money(row.exchange_rate_used as number,8);
    const date=dateOnly(String(row.date)),due=dateOnly(String(row.due_date));ensure(date===row.date&&due===row.due_date,'استخدم تواريخ نصية YYYY-MM-DD.');
    rows.push({row_number:id,kind:row.kind,reference:text(row.reference,100,true),date,currency:row.currency,branch_id:String(row.branch_id),account_code:String(row.account_code),counterparty_code:String(row.party_id),total:row.total as number,paid:row.paid as number,debit:row.total as number,credit:row.total as number});
    document_evidence[id]={party_id:String(row.party_id),due_date:due,exchange_rate_used:row.exchange_rate_used as number,control_account_code:String(row.control_account_code),...(row.tax_account_code?{tax_account_code:String(row.tax_account_code)}:{}),...(row.tax_configuration_version_hash?{tax_configuration_version_hash:String(row.tax_configuration_version_hash)}:{}),lines:[],payments:[]};
  }
  ensure(new Set(rows.map(row=>row.kind)).size===1,'افصل المبيعات والمشتريات في ملفين مستقلين.');
  for(const [name,sequenceField] of [['Lines','line_number'],['Payments','payment_number']] as const){
    const ordered=new Map<number,Row[]>();
    for(const row of data[name]){const id=integer(row.row_number);ensure(document_evidence[id],'بند أو دفعة بلا مستند أصلي.');integer(row[sequenceField]);ordered.set(id,[...(ordered.get(id)||[]),row]);}
    for(const [id,records] of ordered){
      ensure(records.length<=100,'عدد البنود أو الدفعات يتجاوز 100 للمستند.');records.sort((a,b)=>Number(a[sequenceField])-Number(b[sequenceField]));
      for(const [index,row] of records.entries()){
        ensure(row[sequenceField]===index+1,'تسلسل البنود أو الدفعات مكرر أو غير مكتمل.');
        if(name==='Lines')document_evidence[id].lines.push({...(row.product_id?{product_id:String(row.product_id)}:{}),description:String(row.description),quantity:row.quantity as number,net:row.net as number,tax:row.tax as number,...(row.cogs!==''?{cogs:row.cogs as number}:{}),...(row.inventory_value!==''?{inventory_value:row.inventory_value as number}:{})});
        else{ensure(dateOnly(String(row.date))===row.date,'استخدم تواريخ دفعات YYYY-MM-DD.');document_evidence[id].payments!.push({date:String(row.date),amount:row.amount as number,account_code:String(row.account_code),exchange_rate_used:row.exchange_rate_used as number,reference:String(row.reference)});}
      }
    }
  }
  for(const row of rows)validateHistoricalDocumentEvidence(row,document_evidence[row.row_number],context.documents);
  const validation=validateHistoricalImport(rows,context.validation);
  return{request:{file_name:file.name,file_hash:await sha256Hex(buffer),schema_version:1,rows,document_evidence},validation};
}
