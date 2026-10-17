import {test,expect,type Page} from '@playwright/test';
import {periodGuestFixture} from './helpers/accountingPeriods';
import {createMasterImportTemplate} from '../../src/services/masterImportWorkbook';
import ExcelJS from 'exceljs';

async function open(page:Page,role:'Owner'|'Viewer'='Owner'){
  const records=await periodGuestFixture(true,role);
  await page.addInitScript(records=>{localStorage.setItem('mohasbasd_guest_session','true');localStorage.setItem('sudanese_merchant_has_seen_tour_v2','true');localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records));},records);
  await page.goto('/');await page.locator('#tab-accounting').click();
}

test('Excel1.2 owner uploads an official XLSX and gets staging preview without master writes',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);const before=await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}')).filter(path=>path.includes('/customers/')).length);
  await page.getByTestId('data-import-tab').click();const center=page.getByTestId('data-import-center'),template=await createMasterImportTemplate('customers');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(template.bytes as never);const data=workbook.getWorksheet('Data')!;data.addRow(['C-NEW',' عميل جديد ','0912345678','NEW@EXAMPLE.COM','الخرطوم','sdg',5000,0,30]);const bytes=await workbook.xlsx.writeBuffer();
  await center.getByTestId('master-import-file').setInputFiles({name:'customers.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes as ArrayBuffer)});
  await expect(center.getByTestId('import-mapping')).toBeVisible();await center.getByTestId('stage-import-preview').click();await expect(center.getByTestId('import-preview')).toContainText('عميل جديد');await expect(center).toContainText('لم تتغير البيانات الرئيسية');
  const after=await page.evaluate(()=>{const records=JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}');return{customers:Object.keys(records).filter(path=>path.includes('/customers/')).length,sessions:Object.keys(records).filter(path=>path.includes('/import_sessions/')).length,staging:Object.keys(records).filter(path=>path.includes('/import_staging/')).length};});expect(after).toEqual({customers:before,sessions:1,staging:1});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Excel1.2 viewer cannot discover the import center',async({page})=>{await open(page,'Viewer');await expect(page.getByTestId('data-import-tab')).toHaveCount(0);});
