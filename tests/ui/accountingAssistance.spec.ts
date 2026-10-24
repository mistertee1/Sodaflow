import { test, expect, type Page, seedCloudMerchant, openMerchant } from './helpers/cloudMerchant';
import { periodGuestFixture } from './helpers/accountingPeriods';

async function open(page:Page,role:'Owner'|'Accountant'|'Viewer'='Owner'){
  const records=await periodGuestFixture(true,role);
  await seedCloudMerchant(page, records);
  await openMerchant(page);await page.locator('#tab-accounting').click();
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

test('E2.2 Accountant can read accounting assistance',async({page})=>{
  await open(page,'Accountant');await expect(page.getByTestId('accounting-assistance-tab')).toBeVisible();await page.getByTestId('accounting-assistance-tab').click();await expect(page.getByRole('region',{name:'مساعد المحاسبة'})).toContainText('مهام المراجعة');
});
test('E2.2 Viewer cannot discover accounting assistance',async({page})=>{
  await open(page,'Viewer');await expect(page.getByTestId('accounting-assistance-tab')).toHaveCount(0);
});

test('E2.3 assistance exposes review-only account and close guidance',async({page})=>{
  const records=await periodGuestFixture(true,'Owner'),org='local-guest-org',root=`organizations/${org}`;
  records[`${root}/expenses/expense-rent`]={id:'expense-rent',org_id:org,title:'إيجار أكتوبر',category:'إيجار',amount:500,currency:'SDG',date:'2026-10-10',created_at:'2026-10-10T08:00:00Z'};
  records[`${root}/accounting_periods/sep-2026`]={id:'sep-2026',org_id:org,schema_version:1,start_date:'2026-09-01',end_date:'2026-09-30',status:'OPEN',revision:1,created_by:'guest',created_at:'2026-09-01T00:00:00Z',operation_id:'period-seed'};
  await seedCloudMerchant(page, records);
  await openMerchant(page);await page.locator('#tab-accounting').click();await page.getByTestId('accounting-assistance-tab').click();const center=page.getByRole('region',{name:'مساعد المحاسبة'});
  await expect(center.getByLabel('اقتراحات الحسابات')).toContainText('5200');
  await expect(center.getByLabel('مساعدة الإقفال')).toContainText('لا ينفذ هذا المساعد الإقفال');
  await expect(center.getByRole('button')).toHaveCount(1);
});
