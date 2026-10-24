import { test, expect, type Page, seedCloudMerchant, openMerchant } from './helpers/cloudMerchant';
import { periodGuestFixture } from './helpers/accountingPeriods';

async function open(page:Page,role:'Owner'|'Accountant'|'Viewer'='Owner'){
  const records=await periodGuestFixture(true,role);
  await seedCloudMerchant(page, records);
  await openMerchant(page);await page.locator('#tab-accounting').click();
}

test('E1.2 Owner sees evidence, refreshes the date and reloads the accounting health center',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  await page.getByTestId('accounting-health-tab').click();const center=page.getByRole('region',{name:'مركز صحة المحاسبة'});
  await expect(center.getByLabel('ملخص صحة المحاسبة')).toContainText('تنبيهات');
  await expect(center.getByTestId('health-check')).toHaveCount(6);
  await expect(center.getByTestId('health-item').filter({hasText:'فرق مطابقة نقد أو بنك'})).toBeVisible();
  await center.getByLabel('تاريخ فحص صحة المحاسبة').fill('2026-10-08');
  await center.getByRole('button',{name:'تحديث الفحص'}).click();await expect(center).toContainText('الحالة كما في 2026-10-08');
  await page.reload();await page.locator('#tab-accounting').click();await page.getByTestId('accounting-health-tab').click();
  await expect(page.getByRole('region',{name:'مركز صحة المحاسبة'}).getByTestId('health-item').filter({hasText:'فرق مطابقة نقد أو بنك'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('E1.2 Accountant can read the accounting health center',async({page})=>{
  await open(page,'Accountant');await expect(page.getByTestId('accounting-health-tab')).toBeVisible();await page.getByTestId('accounting-health-tab').click();await expect(page.getByRole('region',{name:'مركز صحة المحاسبة'})).toContainText('الفحوص المحاسبية');
});
test('E1.2 Viewer cannot discover the advanced health tab',async({page})=>{
  await open(page,'Viewer');await expect(page.getByTestId('accounting-health-tab')).toHaveCount(0);
});
