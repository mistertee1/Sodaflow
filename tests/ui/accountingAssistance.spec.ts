import { test, expect, type Page } from '@playwright/test';
import { periodGuestFixture } from './helpers/accountingPeriods';

async function open(page:Page,role:'Owner'|'Accountant'|'Viewer'='Owner'){
  const records=await periodGuestFixture(true,role);
  await page.addInitScript(records=>{localStorage.setItem('mohasbasd_guest_session','true');localStorage.setItem('sudanese_merchant_has_seen_tour_v2','true');localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records));},records);
  await page.goto('/');await page.locator('#tab-accounting').click();
}

test('E2.2 Owner reviews assistance, refreshes its date and reloads without financial actions',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  await page.getByTestId('accounting-assistance-tab').click();const center=page.getByRole('region',{name:'مساعد المحاسبة'});
  await expect(center.getByLabel('ملخص مساعد المحاسبة')).toContainText('عاجلة');
  await expect(center.getByTestId('assistance-task').first()).toBeVisible();
  await expect(center).toContainText('كل إجراء يحتاج مراجعة وتأكيداً صريحاً');
  await expect(center.getByRole('button')).toHaveCount(1);
  await center.getByLabel('تاريخ مساعد المحاسبة').fill('2026-10-08');await center.getByRole('button',{name:'تحديث القائمة'}).click();await expect(center).toContainText('الحالة كما في 2026-10-08');
  await page.reload();await page.locator('#tab-accounting').click();await page.getByTestId('accounting-assistance-tab').click();await expect(page.getByRole('region',{name:'مساعد المحاسبة'}).getByTestId('assistance-task').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('E2.2 Accountant can read assistance while Viewer cannot discover it',async({page})=>{
  await open(page,'Accountant');await expect(page.getByTestId('accounting-assistance-tab')).toBeVisible();await page.getByTestId('accounting-assistance-tab').click();await expect(page.getByRole('region',{name:'مساعد المحاسبة'})).toContainText('مهام المراجعة');
  await page.evaluate(()=>localStorage.clear());await open(page,'Viewer');await expect(page.getByTestId('accounting-assistance-tab')).toHaveCount(0);
});
