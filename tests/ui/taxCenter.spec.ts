import {test, expect, type Page} from '@playwright/test';
import {INITIAL_SETTINGS} from '../../src/data/initialData';
import {createDefaultSubscription, getPlanConfig} from '../../src/lib/plans';
import {getDefaultChartOfAccounts} from '../../src/services/accountingService';

const org='local-guest-org', root=`organizations/${org}`;
async function seed(page:Page,role:'Owner'|'Accountant'='Owner',configured=false){
  const records:Record<string,any>={
    [root]:{id:org,owner_uid:role==='Owner'?'guest':'owner',name:'اختبار الضرائب',status:'active',accounting_version:2,settings:INITIAL_SETTINGS},
    [`${root}/members/guest`]:{uid:'guest',org_id:org,role,status:'active'},
    [`${root}/meta/subscription`]:{...createDefaultSubscription(org),...getPlanConfig('Enterprise'),plan:'Enterprise',org_id:org},
  };
  for(const account of getDefaultChartOfAccounts(org))records[`${root}/accounts/${account.code}`]=account;
  if(configured)records[`${root}/tax_configurations/vat`]={schema_version:1,id:'vat',org_id:org,revision:1,name:'ضريبة القيمة',jurisdiction:'اختبار',direction:'sales',rate:15,calculation:'exclusive',rounding:'half_up',recoverable:false,tax_account_code:'2130',effective_from:'2026-01-01',effective_to:null,active:true,created_at:'2026-01-01T00:00:00Z',created_by:'guest',updated_at:'2026-01-01T00:00:00Z',updated_by:'guest',operation_id:'seed',version_hash:'a'.repeat(64)};
  await page.addInitScript(records=>{localStorage.setItem('mohasbasd_guest_session','true');localStorage.setItem('sudanese_merchant_has_seen_tour_v2','true');if(!localStorage.getItem('sudaflow_guest_transactions_v3'))localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records));},records);
  await page.goto('/');await page.locator('#tab-accounting').click();await page.getByTestId('tax-center-tab').click();
}
const stored=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3')||'{}'));

test('C5.3.1 Owner creates and versions a tax policy once and it survives reload',async({page})=>{
  await page.setViewportSize({width:390,height:844});await seed(page);const form=page.getByRole('form',{name:'إعداد ضريبة'});
  await form.getByLabel('معرف الضريبة').fill('vat-ui');await form.getByLabel('اسم الضريبة').fill('ضريبة المبيعات');await form.getByLabel('نطاق الضريبة').fill('اختبار');
  await form.getByLabel('نسبة الضريبة').fill('15');await form.getByLabel('حساب الضريبة',{exact:true}).selectOption('2130');await form.getByLabel('بداية سريان الضريبة').fill('2026-01-01');await form.getByLabel('سبب إعداد الضريبة').fill('اعتماد سياسة اختبارية');
  await form.getByRole('button',{name:'اعتماد الإعداد'}).click();let dialog=page.getByRole('dialog',{name:'تحقق المالك وحفظ إعداد الضريبة'});await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'التحقق وحفظ الإعداد'}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});await expect(page.getByRole('status')).toContainText('بالإصدار 1');
  let data=await stored(page);expect(Object.keys(data).filter(key=>key.includes('/tax_configurations/'))).toHaveLength(1);expect(Object.keys(data).filter(key=>key.includes('/tax_configuration_versions/'))).toHaveLength(1);
  await page.getByRole('button',{name:'تعديل إعداد ضريبة المبيعات'}).click();await form.getByLabel('نسبة الضريبة').fill('17.5');await form.getByLabel('سبب إعداد الضريبة').fill('تعديل معتمد');await form.getByRole('button',{name:'حفظ إصدار جديد'}).click();dialog=page.getByRole('dialog',{name:'تحقق المالك وحفظ إعداد الضريبة'});await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'التحقق وحفظ الإعداد'}).click();await expect(page.getByRole('status')).toContainText('بالإصدار 2');
  data=await stored(page);expect(data[`${root}/tax_configurations/vat-ui`].rate).toBe(17.5);expect(Object.keys(data).filter(key=>key.includes('/tax_configuration_versions/'))).toHaveLength(2);
  const saved=await page.evaluate(()=>localStorage.getItem('sudaflow_guest_transactions_v3'));await page.addInitScript(saved=>localStorage.setItem('sudaflow_guest_transactions_v3',saved!),saved);await page.reload();await page.locator('#tab-accounting').click();await page.getByTestId('tax-center-tab').click();await expect(page.getByRole('region',{name:'سجل إعدادات الضرائب'})).toContainText('17.5%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('C5.3.1 Accountant reads tax policies but cannot create or edit them',async({page})=>{
  await seed(page,'Accountant',true);const center=page.getByRole('region',{name:'مركز الضرائب'});await expect(center).toContainText('ضريبة القيمة');await expect(center.getByRole('form',{name:'إعداد ضريبة'})).toHaveCount(0);await expect(center.getByRole('button',{name:/تعديل إعداد/})).toHaveCount(0);
});
