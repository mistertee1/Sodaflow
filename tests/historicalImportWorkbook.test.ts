import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createHistoricalImportTemplate, parseHistoricalImportWorkbook } from '../src/services/historicalImportWorkbook';

const context={validation:{orgId:'org',accounts:['4100','1300','1200','2110','1110','1120','1350'],branches:['main'],currencies:['SDG','USD'],periods:[{start_date:'2026-01-01',end_date:'2026-01-31',status:'OPEN' as const}]},documents:{customers:['c1'],suppliers:['s1'],products:['p1'],accounts:['4100','1300','1200','2110','1110','1120','1350']}};
async function book(kind='invoice'){
  const template=await createHistoricalImportTemplate(),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(template.bytes as never);
  workbook.getWorksheet('Documents')!.addRow([7,kind,'HIST-7','2026-01-10','SDG','main',kind==='invoice'?'4100':'1300',kind==='invoice'?'c1':'s1','2026-01-31',0,kind==='invoice'?'1200':'2110','','',100,40]);
  workbook.getWorksheet('Lines')!.addRow([7,1,'p1','بضاعة مثبتة',2,100,0,kind==='invoice'?60:'',kind==='purchase'?100:'']);
  workbook.getWorksheet('Payments')!.addRow([7,1,'2026-01-20',40,'1110',0,'PAY-7']);
  return workbook;
}
async function file(workbook:ExcelJS.Workbook){const bytes=await workbook.xlsx.writeBuffer();return new File([new Uint8Array(bytes as ArrayBuffer)],'history.xlsx');}
async function parse(workbook:ExcelJS.Workbook){return parseHistoricalImportWorkbook(await file(workbook),context);}

test('Excel4.1e.1 XLSX template reconstructs complete historical sales evidence without posting',async()=>{
  const template=await createHistoricalImportTemplate();assert.equal(template.mime_type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook=await book(),before=structuredClone(context),result=await parse(workbook);
  assert.deepEqual(context,before);assert.equal(result.validation.can_stage,true);assert.match(result.request.file_hash,/^[a-f0-9]{64}$/);
  assert.deepEqual(result.request.rows,[{row_number:7,kind:'invoice',reference:'HIST-7',date:'2026-01-10',currency:'SDG',branch_id:'main',account_code:'4100',counterparty_code:'c1',total:100,paid:40,debit:100,credit:100}]);
  assert.deepEqual(result.request.document_evidence['7'],{party_id:'c1',due_date:'2026-01-31',exchange_rate_used:0,control_account_code:'1200',lines:[{product_id:'p1',description:'بضاعة مثبتة',quantity:2,net:100,tax:0,cogs:60}],payments:[{date:'2026-01-20',amount:40,account_code:'1110',exchange_rate_used:0,reference:'PAY-7'}]});
});

test('Excel4.1e.1 USD purchase keeps original tax version, acquisition and payment FX separate',async()=>{
  const workbook=await book('purchase'),docs=workbook.getWorksheet('Documents')!,lines=workbook.getWorksheet('Lines')!,payments=workbook.getWorksheet('Payments')!;
  docs.getRow(2).values=[7,'purchase','PB-USD','2026-01-10','USD','main','1300','s1','2026-01-31',2500,'2110','1350','a'.repeat(64),115,50];
  lines.getRow(2).values=[7,1,'p1','مخزون موثق',2,100,15,'',100];payments.getRow(2).values=[7,1,'2026-01-20',50,'1120',2600,'SP-USD'];
  const result=await parse(workbook),evidence=result.request.document_evidence['7'];assert.equal(result.validation.can_stage,true);assert.equal(evidence.tax_configuration_version_hash,'a'.repeat(64));assert.equal(evidence.exchange_rate_used,2500);assert.equal(evidence.payments![0].exchange_rate_used,2600);assert.equal(evidence.lines[0].inventory_value,100);
});

test('Excel4.1e.1 refuses formulas even with cached results, merged cells, changed headers and extra sheets',async()=>{
  for(const mutate of [
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Documents')!.getCell('N2').value={formula:'100',result:100};},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Lines')!.mergeCells('D2:E2');},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Documents')!.getCell('A1').value='renamed';},
    (w:ExcelJS.Workbook)=>{w.addWorksheet('Foreign');},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Payments')!.state='hidden';},
  ]){const workbook=await book();mutate(workbook);await assert.rejects(parse(workbook));}
});

test('Excel4.1e.1 blocks orphan links, duplicated document/sequence and missing source values',async()=>{
  for(const mutate of [
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Lines')!.getCell('A2').value=8;},
    (w:ExcelJS.Workbook)=>{const s=w.getWorksheet('Documents')!;s.addRow(s.getRow(2).values);},
    (w:ExcelJS.Workbook)=>{const s=w.getWorksheet('Payments')!;s.addRow(s.getRow(2).values);},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Lines')!.getCell('B2').value=2;},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Lines')!.getCell('H2').value=null;},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Payments')!.getCell('D2').value=39;},
  ]){const workbook=await book();mutate(workbook);await assert.rejects(parse(workbook));}
});

test('Excel4.1e.1 preserves numeric/date integrity and returns live validation blocks',async()=>{
  for(const mutate of [
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Documents')!.getCell('N2').value='100';},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Documents')!.getCell('N2').value=100.5;},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Documents')!.getCell('D2').value='10/01/2026';},
    (w:ExcelJS.Workbook)=>{w.getWorksheet('Payments')!.getCell('C2').value='2026-01-01';},
  ]){const workbook=await book();mutate(workbook);await assert.rejects(parse(workbook));}
  const result=await parseHistoricalImportWorkbook(await file(await book()),{...context,validation:{...context.validation,periodLockDate:'2026-01-31'}});assert.equal(result.validation.can_stage,false);assert.ok(result.validation.blocking_issues.some(issue=>issue.code==='CLOSED_PERIOD'));
});

test('Excel4.1e.1 rejects blank, oversized, mixed and unknown-party document workbooks',async()=>{
  const template=await createHistoricalImportTemplate();await assert.rejects(parseHistoricalImportWorkbook(new File([template.bytes],'history.xlsx'),context),/200/);
  await assert.rejects(parseHistoricalImportWorkbook(new File(['text'],'history.csv'),context),/XLSX/);
  await assert.rejects(parseHistoricalImportWorkbook(new File([new Uint8Array(2*1024*1024+1)],'history.xlsx'),context),/2MB/);
  const mixed=await book();mixed.getWorksheet('Documents')!.addRow([8,'purchase','PB-8','2026-01-10','SDG','main','1300','s1','2026-01-31',0,'2110','','',100,0]);await assert.rejects(parse(mixed),/افصل/);
  const foreign=await book();foreign.getWorksheet('Documents')!.getCell('H2').value='foreign';await assert.rejects(parse(foreign),/غير موجود/);
});
