import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {periodGuestFixture} from './helpers/accountingPeriods';

async function open(page:Page,role:'Owner'|'Accountant'|'Viewer'){
  const records=await periodGuestFixture(true,role);
  await page.addInitScript(records=>{localStorage.setItem('mohasbasd_guest_session','true');localStorage.setItem('sudanese_merchant_has_seen_tour_v2','true');localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records));},records);
  await page.goto('/');await page.locator('#tab-accounting').click();
}

test('Excel2.1 accountant downloads the scoped dual-book workbook and export survives reload',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await open(page,'Accountant');await page.getByTestId('data-export-tab').click();
  const center=page.getByTestId('accounting-export');await expect(center).toBeVisible();await center.getByLabel('بداية فترة التصدير المحاسبي').fill('2026-10-01');await center.getByLabel('نهاية فترة التصدير المحاسبي').fill('2026-10-31');
  const waiting=page.waitForEvent('download');await center.getByRole('button',{name:'تصدير دفتر المحاسب'}).click();const download=await waiting,path=testInfo.outputPath('accounting-export.xml');await download.saveAs(path);const xml=await readFile(path,'utf8');
  expect(xml).toContain('Journal_Entries');expect(xml).toContain('Trial_Balance');expect(xml).toContain('Reconciliation');expect(xml).toContain('Export_Summary');expect(xml).not.toContain('<Formula');await expect(page.getByRole('status')).toContainText('تم تجهيز دفتر المحاسب');
  await page.reload();await page.locator('#tab-accounting').click();await page.getByTestId('data-export-tab').click();await expect(page.getByTestId('accounting-export')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Excel2.1 viewer cannot discover accountant export',async({page})=>{await open(page,'Viewer');await expect(page.getByTestId('data-export-tab')).toHaveCount(0);});

test('Excel3.1 owner exports the full company package, saves a preset and sees transfer history after reload',async({page},testInfo)=>{
  await open(page,'Owner');await page.getByTestId('data-export-tab').click();const center=page.getByTestId('data-export-center');
  await center.getByLabel('اسم إعداد التصدير').fill('نسخة شهرية');await center.getByLabel('نوع إعداد التصدير').selectOption('company');await center.getByRole('button',{name:'حفظ الإعداد'}).click();await expect(center).toContainText('نسخة شهرية — company');
  const waiting=page.waitForEvent('download');await center.getByRole('button',{name:'تصدير الشركة كاملة'}).click();const download=await waiting,path=testInfo.outputPath('company.json');await download.saveAs(path);const json=JSON.parse(await readFile(path,'utf8'));
  expect(json.schema_version).toBe(3);expect(json.org.id).toBe('local-guest-org');await expect(center.getByRole('status')).toContainText('تم تجهيز حزمة الشركة الكاملة');await expect(center.getByTestId('data-transfer-history')).toContainText('company');
  await page.reload();await page.locator('#tab-accounting').click();await page.getByTestId('data-export-tab').click();await expect(page.getByTestId('export-presets')).toContainText('نسخة شهرية');await expect(page.getByTestId('data-transfer-history')).toContainText('DATA_EXPORT_CREATED');
});
