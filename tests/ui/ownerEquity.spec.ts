import { test, expect, type Page, cloudRecords, seedCloudMerchant, openMerchant } from './helpers/cloudMerchant';
import{freshOpeningBooksFixture}from'../fixtures/openingBooks';
import{INITIAL_SETTINGS}from'../../src/data/initialData';
import{createDefaultSubscription,getPlanConfig}from'../../src/lib/plans';
async function seed(page:Page,role='Owner'){
 const org='local-guest-org',root=`organizations/${org}`,{data}=freshOpeningBooksFixture(org,'guest'),records:Record<string,any>={[root]:{id:org,owner_uid:role==='Owner'?'guest':'other',name:'حقوق ملكية اختبارية',status:'active',accounting_version:2,settings:INITIAL_SETTINGS},[`${root}/members/guest`]:{uid:'guest',role,status:'active'},[`${root}/meta/subscription`]:{...createDefaultSubscription(org),...getPlanConfig('Enterprise'),plan:'Enterprise',org_id:org},[`${root}/accounting_periods/year`]:{schema_version:1,operation_id:'period',id:'year',org_id:org,start_date:'2026-01-01',end_date:'2026-12-31',status:'OPEN',revision:1,reason:'اختبار',created_by:'guest',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}};
 for(const[name,rows]of Object.entries(data))for(const row of rows)records[`${root}/${name}/${name==='accounts'?row.code:row.id}`]=row;
 for(const row of data.financial_accounts)records[`${root}/financial_account_mappings/${row.account_code}`]={id:row.id};
 await seedCloudMerchant(page, records);await openMerchant(page);await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'رأس المال والمسحوبات',exact:true}).click();
}
const records=(p:Page)=>cloudRecords(p);
async function save(page: Page, kind: 'contribution' | 'drawing', amount: string) {
 const c = page.getByRole('region', { name: 'رأس المال والمسحوبات' });
 const countEvents = async () => Object.keys(await records(page)).filter(path => path.includes('/owner_equity_events/')).length;
 const before = await countEvents();
 await c.getByLabel('نوع حركة المالك').selectOption(kind);
 await c.getByLabel('تاريخ حركة المالك').fill(kind === 'contribution' ? '2026-10-01' : '2026-10-02');
 await c.getByLabel('حساب حركة المالك').selectOption('cash');
 await c.getByLabel('مبلغ حركة المالك').fill(amount);
 await c.getByLabel('سبب حركة المالك').fill(kind === 'contribution' ? 'تمويل موثق' : 'سحب شخصي');
 await c.getByLabel('مرجع حركة المالك').fill(kind === 'contribution' ? 'CAP-1' : 'DRAW-1');
 await c.getByRole('button', { name: 'مراجعة وتحقق المالك' }).click();
 const d = page.getByRole('dialog', { name: 'تحقق المالك وحفظ الحركة' });
 await expect(d).toBeVisible();
 // A prior save must not appear to confirm this new, still unverified movement.
 await expect(c.getByRole('status')).toHaveCount(0);
 let release!: () => void;
 const held = new Promise<void>(resolve => { release = resolve; });
 const pattern = '**/api/organizations/*/operations';
 const holdWrite = async (route: import('@playwright/test').Route) => { await held; await route.fallback(); };
 await page.route(pattern, holdWrite);
 try {
  await d.getByLabel('كلمة مرور الحساب').fill('synthetic-password');
  const requested = page.waitForRequest(request => request.url().includes('/operations') && request.postDataJSON()?.action === 'ownerEquity.create');
  await d.getByRole('button', { name: 'التحقق وحفظ الحركة' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await requested;
  await expect(d.getByRole('button', { name: 'جارٍ التحقق والتنفيذ…' })).toBeDisabled();
  await expect(c.getByRole('status')).toHaveCount(0);
  expect(await countEvents()).toBe(before);
  release();
  await expect(d).not.toBeVisible();
  await expect(c.getByRole('status')).toContainText('تم حفظ');
  await expect.poll(countEvents).toBe(before + 1);
 } finally { release(); await page.unroute(pattern, holdWrite); }
}
test('C2.3 Owner capital and drawings save exactly once and persist after reload',async({page})=>{await page.setViewportSize({width:390,height:844});await seed(page);await save(page,'contribution','1000');await save(page,'drawing','250');let saved=await records(page);expect(Object.keys(saved).filter(x=>x.includes('/owner_equity_events/'))).toHaveLength(2);expect(Object.keys(saved).filter(x=>x.includes('/journal_entries/jv-oe-'))).toHaveLength(2);await page.reload();await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'رأس المال والمسحوبات',exact:true}).click();await expect(page.getByRole('region',{name:'سجل حركات المالك'}).getByRole('row')).toHaveCount(3);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)});
test('C2.3 non-owner sees history but cannot create owner transactions',async({page})=>{await seed(page,'Accountant');const c=page.getByRole('region',{name:'رأس المال والمسحوبات'});await expect(c.getByText('إنشاء الحركة متاح لمالك المؤسسة فقط. السجل للعرض.')).toBeVisible();await expect(c.getByRole('form',{name:'إضافة حركة مالك'})).toHaveCount(0);expect(Object.keys(await records(page)).filter(x=>x.includes('/owner_equity_events/'))).toHaveLength(0)});
