import { test, expect, type Page, cloudRecords, seedCloudMerchant, openMerchant } from './helpers/cloudMerchant';
import {periodGuestFixture} from './helpers/accountingPeriods';
import {createMasterImportTemplate} from '../../src/services/masterImportWorkbook';
import ExcelJS from 'exceljs';
import { largeImportStagingSha256 } from '../../src/domain/largeImportEvidence';

async function open(page:Page,role:'Owner'|'Viewer'='Owner'){
  const records=await periodGuestFixture(true,role);
  await seedCloudMerchant(page, records);
  await openMerchant(page);await page.locator('#tab-accounting').click();
}

test('Excel1.2 owner uploads an official XLSX and gets staging preview without master writes',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);const before=await (async ()=>Object.keys((await cloudRecords(page))).filter(path=>path.includes('/customers/')).length)();
  await page.getByTestId('data-import-tab').click();const center=page.getByTestId('data-import-center'),template=await createMasterImportTemplate('customers');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(template.bytes as never);const data=workbook.getWorksheet('Data')!;data.addRow(['C-NEW',' عميل جديد ','0912345678','NEW@EXAMPLE.COM','الخرطوم','sdg',5000,0,30]);const bytes=await workbook.xlsx.writeBuffer();
  await center.getByTestId('master-import-file').setInputFiles({name:'customers.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes as ArrayBuffer)});
  await expect(center.getByTestId('import-mapping')).toBeVisible();await center.getByTestId('stage-import-preview').click();await expect(center.getByTestId('import-preview')).toContainText('عميل جديد');await expect(center).toContainText('لم تتغير البيانات الرئيسية');
  const after=await (async ()=>{const records=(await cloudRecords(page));return{customers:Object.keys(records).filter(path=>path.includes('/customers/')).length,sessions:Object.keys(records).filter(path=>path.includes('/import_sessions/')).length,staging:Object.keys(records).filter(path=>path.includes('/import_staging/')).length};})();expect(after).toEqual({customers:before,sessions:1,staging:1});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Excel1.2 viewer cannot discover the import center',async({page})=>{await open(page,'Viewer');await expect(page.getByTestId('data-import-tab')).toHaveCount(0);});

test('Excel3.2c.1 owner reviews preview, queues import and sees reload-safe recovery controls',async({page,context})=>{
  await open(page);await page.getByTestId('data-import-tab').click();const center=page.getByTestId('data-import-center'),template=await createMasterImportTemplate('customers');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(template.bytes as never);workbook.getWorksheet('Data')!.addRow(['C-JOB','عميل مهمة','0912345678','job@example.com','الخرطوم','SDG',100,0,30]);const bytes=await workbook.xlsx.writeBuffer();
  await center.getByTestId('master-import-file').setInputFiles({name:'large-customers.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes as ArrayBuffer)});
  await center.getByTestId('stage-import-preview').click();await expect(center.getByTestId('large-import-review')).toBeVisible();await center.getByRole('button',{name:'تأكيد المراجعة وجدولة المهمة'}).click();
  await expect(center.getByRole('status')).toContainText('تمت جدولة');
  const saved=await (async ()=>Object.values((await cloudRecords(page))).filter((row:any)=>row?.status==='queued'&&String(row?.id||'').startsWith('import-job-')).length)();expect(saved).toBe(1);
  const restored=await context.newPage();await restored.goto('/');await restored.locator('#tab-accounting').click();await restored.getByTestId('data-import-tab').click();await expect(restored.getByTestId('large-import-jobs')).toContainText('queued');
});

test('Excel3.2c.2b owner commits a validated job then reauthenticates to undo it',async({page})=>{
  const records=await periodGuestFixture(true,'Owner'),orgPath=Object.keys(records).find(path=>/^organizations\/[^/]+$/.test(path))!,orgId=orgPath.split('/')[1],root=`organizations/${orgId}`,jobId='import-job-ui-commit';
  records[`${root}/import_sessions/ui-session`]={id:'ui-session',org_id:orgId,status:'previewed',import_type:'customers',file_hash:'b'.repeat(64),schema_version:1,totals:{rows:1,valid:1,errors:0}};
  const stagedRows=[{row_number:2,status:'valid',issues:[],data:{customer_code:'C-UI',name:'عميل اعتماد',email:'commit@example.com'}}];
  records[`${root}/import_staging/ui-session`]={id:'ui-session',org_id:orgId,session_id:'ui-session',rows:stagedRows};
  records[`${root}/large_import_jobs/${jobId}`]={id:jobId,org_id:orgId,session_id:'ui-session',module:'customers',status:'awaiting_commit',stage:'review_commit',duplicate_policy:'skip',validated_rows:1,validated_staging_sha256:await largeImportStagingSha256(stagedRows),total_rows:1,processed_rows:1,progress:100,created_at:'2026-10-18T12:00:00Z'};
  await seedCloudMerchant(page, records);await openMerchant(page);await page.locator('#tab-accounting').click();await page.getByTestId('data-import-tab').click();
  await page.getByTestId(`commit-import-${jobId}`).click();await expect(page.getByRole('status')).toContainText('تم اعتماد السجلات');await expect(page.getByTestId(`undo-import-${jobId}`)).toBeVisible();await page.getByTestId(`undo-import-${jobId}`).click();
  await page.getByLabel('سبب التراجع').fill('اختبار تراجع الواجهة');await page.getByLabel('كلمة مرور الحساب').fill('synthetic-password');await page.getByRole('button',{name:'التحقق وتنفيذ التراجع'}).click();await expect(page.getByRole('status')).toContainText('تم التراجع');
  const persisted=await (async ()=>Object.values((await cloudRecords(page))).find((row:any)=>row?.id==='import-job-ui-commit') as any)();expect(persisted.status).toBe('rolled_back');
});
