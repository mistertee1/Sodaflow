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
