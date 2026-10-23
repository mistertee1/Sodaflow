import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { automaticImportMapping, buildMasterImportPreview } from '../src/domain/masterImport';
import { createMasterImportTemplate, parseMasterImportWorkbook } from '../src/services/masterImportWorkbook';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';

test('Excel1.2 maps aliases, normalizes values and classifies duplicates without mutating inputs',()=>{
  const headers=['Customer Code','Name','EMAIL','Currency','Opening Balance'],mapping=automaticImportMapping('customers',headers),rows=[[' C-1 ',' عميل  أول ','USER@EXAMPLE.COM','sdg',0],['C-1','ثان','','SAR',50]],before=structuredClone(rows);
  const preview=buildMasterImportPreview({module:'customers',file_name:'customers.xlsx',file_hash:'a'.repeat(64),headers,rows,mapping},[{id:'old',org_id:'org',email:'user@example.com'}],[{id:'prior',org_id:'org',file_hash:'a'.repeat(64)}],{orgId:'org',actor:'owner',operationId:'op',createdAt:'2026-10-15T00:00:00Z'});
  assert.deepEqual(rows,before);assert.equal(preview.result.totals.rows,2);assert.equal(preview.result.totals.errors,1);assert.equal(preview.result.totals.duplicates,2);assert.equal(preview.result.file_duplicate,true);assert.match(preview.result.file_duplicate_warning,/سبق رفع/);assert.equal(preview.staging.rows[0].data.email,'user@example.com');assert.ok(preview.staging.rows[0].issues.some(issue=>issue.code==='DUPLICATE_EXISTING'));assert.ok(preview.staging.rows[1].issues.some(issue=>issue.code==='INVALID_CURRENCY'));assert.ok(preview.staging.rows[1].issues.some(issue=>issue.code==='OPENING_DEFERRED'));assert.ok(preview.staging.rows[1].issues.some(issue=>issue.code==='DUPLICATE_IN_FILE'));
});

test('Excel1.2 creates true XLSX templates with stable sheets, headers and numeric example cells',async()=>{
  const template=await createMasterImportTemplate('products'),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(template.bytes as never);
  assert.equal(template.filename,'products_import_template.xlsx');assert.deepEqual(workbook.worksheets.map(sheet=>sheet.name),['Instructions','Data','Examples']);
  const data=workbook.getWorksheet('Data')!,examples=workbook.getWorksheet('Examples')!;assert.equal(data.getCell('A1').value,'sku');assert.equal(data.getCell('B1').value,'product_name');assert.equal(typeof examples.getCell('E2').value,'number');assert.equal(data.model.merges.length,0);
});

test('Excel1.2 parser preserves formula evidence so validation blocks executable spreadsheet input',async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Data');sheet.addRow(['customer_code','name','email','currency','opening_balance']);sheet.addRow(['C-1',{formula:'CONCAT("ع","ميل")',result:'عميل'},'a@example.com','SDG',0]);const bytes=await workbook.xlsx.writeBuffer(),file=new File([bytes],'customers.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),parsed=await parseMasterImportWorkbook(file),mapping=automaticImportMapping('customers',parsed.headers),preview=buildMasterImportPreview({module:'customers',...parsed,mapping},[],[],{orgId:'org',actor:'owner',operationId:'formula',createdAt:'2026-10-15T00:00:00Z'});assert.ok(preview.staging.rows[0].issues.some(issue=>issue.code==='FORMULA_NOT_ALLOWED'));
});

test('Excel1.2 command writes staging only, is idempotent, audits and denies unauthorized roles',async()=>{
  const owner:Actor={uid:'owner',email:'owner@example.com',emailVerified:true},store=new MemoryStore(),org=await new Organizations(store).create(owner,'Import',INITIAL_SETTINGS,'setup',true),root=`organizations/${org.id}`;await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionEnd:'2027-01-01'});tx.set(`${root}/members/viewer`,{uid:'viewer',role:'Viewer',status:'active',org_id:org.id});tx.set(`${root}/customers/existing`,{id:'existing',org_id:org.id,name:'قائم',email:'existing@example.com'});});
  const ops=new Operations(store,()=>new Date('2026-10-15T12:00:00Z')),data={module:'customers',file_name:'customers.xlsx',file_hash:'b'.repeat(64),headers:['customer_code','name','email','currency','opening_balance'],rows:[['C-2',' جديد ','NEW@EXAMPLE.COM','SDG',0]],mapping:{customer_code:'customer_code',name:'name',email:'email',currency:'currency',opening_balance:'opening_balance'}},before=(store.dump() as any)[`${root}/customers/existing`],command={action:'masterImport.stage',operationId:'preview-1',data};
  const first=await ops.execute(org.id,owner,command),again=await ops.execute(org.id,owner,command);assert.deepEqual(again,first);const dump=store.dump();assert.deepEqual(dump[`${root}/customers/existing`],before);assert.equal(Object.keys(dump).filter(path=>path.startsWith(`${root}/customers/`)).length,1);assert.equal(dump[`${root}/import_sessions/imp-preview-1`].status,'previewed');assert.equal(dump[`${root}/import_staging/imp-preview-1`].rows[0].data.email,'new@example.com');assert.equal(dump[`${root}/audit_logs/audit-preview-1`].event_type,'DATA_IMPORT_STARTED');
  await assert.rejects(ops.execute(org.id,{...owner,uid:'viewer'},{...command,operationId:'denied'}),/صلاحية/);
});
