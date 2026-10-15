import {test,expect,type Page} from '@playwright/test';
import {periodGuestFixture} from './helpers/accountingPeriods';

async function open(page:Page,role:'Owner'|'Accountant'='Owner'){
  const records=await periodGuestFixture(true,role),root='organizations/local-guest-org';
  records[`${root}/recurring_cash_sources/rent`]={id:'rent',org_id:'local-guest-org',name:'إيجار شهري',frequency:'monthly',next_date:'2026-10-20',amount_sdg:100,amount_usd:0,status:'active',revision:1,created_by:'guest',created_at:'2026-10-01T00:00:00Z',updated_by:'guest',updated_at:'2026-10-01T00:00:00Z'};
  records[`${root}/fixed_assets/asset`]={id:'asset',org_id:'local-guest-org',name:'حاسوب المكتب',status:'active',next_depreciation_sequence:1,schedule:[{sequence:1,date:'2026-10-31',depreciation_sdg:10,depreciation_usd:0}]};
  await page.addInitScript(records=>{localStorage.setItem('mohasbasd_guest_session','true');localStorage.setItem('sudanese_merchant_has_seen_tour_v2','true');localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records));},records);await page.goto('/');await page.locator('#tab-accounting').click();
}

test('E3 Owner refreshes the financial summary and sees review-only recurring reminders',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);await page.getByTestId('owner-financial-summary-tab').click();const center=page.getByRole('region',{name:'ملخص المالك المالي'});await center.getByLabel('تاريخ ملخص المالك').fill('2026-10-15');await center.getByRole('button',{name:'تحديث الملخص'}).click();await expect(center).toContainText('صافي الربح');await expect(center.getByRole('region',{name:'تذكيرات المالك'})).toContainText('إيجار شهري');await expect(center.getByRole('region',{name:'تذكيرات المالك'})).toContainText('قيد إهلاك حاسوب المكتب');await expect(center).toContainText('لا ينشئ النظام مصروفاً أو قيداً تلقائياً');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('E3 Accountant cannot discover the Owner financial summary',async({page})=>{await open(page,'Accountant');await expect(page.getByTestId('owner-financial-summary-tab')).toHaveCount(0);});
