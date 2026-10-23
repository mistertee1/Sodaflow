import { test, expect, openMerchant, defaultMerchantRecords, seedCloudMerchant, cloudRecords, cloudMerchant, guestId } from './helpers/cloudMerchant';
import { costState } from '../../src/domain/inventoryCost';

test.use({ controlsEnabled:false });
const root=`organizations/${guestId}`;
const formFor=(page:import('@playwright/test').Page)=>page.locator('form').filter({has:page.getByLabel('عميل الفاتورة')});

test('USD cost-plus uses a real cash receipt, updates draft FX, preserves manual overrides and freezes the saved cloud invoice',async({page})=>{
  test.setTimeout(60000);await page.setViewportSize({width:390,height:844});
  const records=defaultMerchantRecords();records[root].accounting_version=2;
  Object.assign(records[`${root}/products/product`],costState(0,0,0,'2026-01-01'),{pricing_mode:'usd_cost_plus',pricing_markup_percent:0});
  await seedCloudMerchant(page,records);await openMerchant(page);await page.locator('#tab-products').click();
  await page.getByRole('button',{name:'تسجيل تكلفة أو استلام مخزون',exact:true}).click();
  const receipt=page.getByRole('dialog',{name:'تكلفة المخزون',exact:true});
  await receipt.getByLabel('عملية المخزون',{exact:true}).selectOption('receipt');await receipt.getByLabel('منتج التكلفة',{exact:true}).selectOption('product');
  await receipt.getByLabel('كمية عملية التكلفة').fill('3');await receipt.getByLabel('تكلفة الوحدة الموثقة',{exact:true}).fill('1000');
  await receipt.getByLabel('سعر صرف التكلفة').fill('2000');await receipt.getByLabel('سبب العملية ومرجع وثيقة التكلفة').fill('شراء اصطناعي أصلي بسعر 1000 جنيه على صرف 2000');
  await receipt.getByRole('button',{name:'حفظ عملية التكلفة',exact:true}).click();await expect(receipt).toHaveCount(0);
  await page.locator('#btn-quick-new-invoice').click();const form=formFor(page);
  await form.getByLabel('منتج البند 1').selectOption('product');await expect(form.getByLabel('سعر البند 1')).toHaveValue('1000');
  await form.getByLabel('سعر صرف الفاتورة').fill('3000');await expect(form.getByLabel('سعر البند 1')).toHaveValue('1500');
  await expect(form.getByTestId('usd-price-line-1')).toContainText('0.5 USD');await expect(form.getByTestId('usd-price-line-1')).toContainText('500 SDG');
  await form.getByLabel('سعر البند 1').fill('1750');await form.getByLabel('سعر صرف الفاتورة').fill('4000');
  await expect(form.getByLabel('سعر البند 1')).toHaveValue('1750');await expect(form.getByTestId('usd-price-line-1')).toContainText('سعر يدوي');
  await form.getByRole('button',{name:'تحديث السعر من مرجع الدولار',exact:true}).click();await expect(form.getByLabel('سعر البند 1')).toHaveValue('2000');
  await form.getByLabel('سعر صرف الفاتورة').fill('3000');await expect(form.getByLabel('سعر البند 1')).toHaveValue('1500');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/usd-reference-mobile.png',fullPage:true});
  await form.evaluate(node=>(node as HTMLFormElement).requestSubmit());await expect(form).toHaveCount(0);
  let saved=await cloudRecords(page);const rows=(name:string)=>Object.entries(saved).filter(([path])=>path.includes(`/${name}/`)).map(([,row])=>row);
  const invoice=rows('invoices')[0];expect(invoice.grand_total_sdg).toBe(1500);expect(invoice.cogs_sdg).toBe(1000);expect(invoice.cogs_usd).toBe(.5);
  expect(invoice.items[0].price_reference.reference_usd).toBe(.5);expect(saved[`${root}/products/product`].average_cost_usd).toBe(.5);
  expect(rows('inventory_movements').find(row=>row.type==='PURCHASE')?.value_delta_sdg).toBe(3000);
  await page.reload();await expect(page.getByRole('button',{name:'فاتورة جديدة',exact:true}).first()).toBeVisible();
  saved=await cloudRecords(page);expect(saved[`${root}/invoices/${invoice.id}`]).toEqual(invoice);
});

test('precise USD selling reference is saved through product UI and follows SDG and KWD quotes',async({page})=>{
  const records=defaultMerchantRecords();records[root].settings.default_exchange_rate=3000;
  Object.assign(records[`${root}/products/product`],{track_inventory:false,stock_quantity:0});
  await seedCloudMerchant(page,records);await openMerchant(page);await page.locator('#tab-products').click();
  await page.getByTitle('تعديل المنتج والكمية',{exact:true}).click();const product=page.getByRole('dialog',{name:'إضافة أو تعديل منتج'});
  await product.getByLabel('طريقة تسعير المنتج').selectOption('usd_reference');await product.getByLabel('سعر بيع المنتج بالجنيه').fill('1000');
  await expect(product.getByLabel('مرجع سعر البيع بالدولار')).toHaveValue('0.33333333');
  await product.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();await expect(product).toHaveCount(0);
  expect((await cloudRecords(page))[`${root}/products/product`].pricing_reference_usd).toBe(.33333333);
  await page.locator('#btn-quick-new-invoice').click();const form=formFor(page);await form.getByLabel('منتج البند 1').selectOption('product');
  await form.getByLabel('سعر صرف الفاتورة').fill('6000');await expect(form.getByLabel('سعر البند 1')).toHaveValue('2000');
  await form.getByLabel('عملة تسعير الفاتورة',{exact:true}).selectOption('KWD');await form.getByLabel('سعر عملة الفاتورة لكل دولار',{exact:true}).fill('0.3');
  await expect(form.getByLabel('سعر البند 1')).toHaveValue('0.1');await form.getByLabel('سعر عملة الفاتورة لكل دولار',{exact:true}).fill('0.4');
  await expect(form.getByLabel('سعر البند 1')).toHaveValue('0.133');
  await form.evaluate(node=>(node as HTMLFormElement).requestSubmit());await expect(form).toHaveCount(0);
  const invoice=Object.entries(await cloudRecords(page)).find(([path])=>path.includes('/invoices/'))![1];
  expect(invoice.pricing.currency).toBe('KWD');expect(invoice.items[0].price_reference.reference_usd).toBe(.33333333);
  expect(invoice.items[0].price_reference.currency_rate_per_usd).toBe(.4);
});

test('stale catalog price is rejected by the real API before any invoice or journal is saved',async({page})=>{
  const records=defaultMerchantRecords();Object.assign(records[`${root}/products/product`],{track_inventory:false,stock_quantity:0});
  await seedCloudMerchant(page,records);await openMerchant(page);await page.locator('#btn-quick-new-invoice').click();
  const form=formFor(page);await form.getByLabel('منتج البند 1').selectOption('product');await expect(form.getByLabel('سعر البند 1')).toHaveValue('2000');
  await cloudMerchant(page).executeCommand('product.update',{id:'product',updates:{pricing_reference_usd:2}},'second-client-price');
  await form.evaluate(node=>(node as HTMLFormElement).requestSubmit());await expect(form).toContainText('تغير مرجع سعر المنتج');
  const rows=Object.keys(await cloudRecords(page));expect(rows.some(path=>path.includes('/invoices/'))).toBe(false);expect(rows.some(path=>path.includes('/journal_entries/'))).toBe(false);
});

test('an SDG-only historical cost gives an explicit missing-source error and never a false zero-price sale',async({page})=>{
  const records=defaultMerchantRecords();Object.assign(records[`${root}/products/product`],costState(2,2000,0,'2026-01-01'),{pricing_mode:'usd_cost_plus',pricing_markup_percent:0});
  await seedCloudMerchant(page,records);await openMerchant(page);await page.locator('#btn-quick-new-invoice').click();
  const form=formFor(page);await form.getByLabel('منتج البند 1').selectOption('product');await expect(form).toContainText('تكلفة الدولار غير موثقة');
  await form.evaluate(node=>(node as HTMLFormElement).requestSubmit());await expect(form).toContainText('تكلفة الدولار غير موثقة');
  expect(Object.keys(await cloudRecords(page)).some(path=>path.includes('/invoices/'))).toBe(false);
});


test('USD-default invoices keep new product lines in USD and accept a fractional current exchange rate',async({page})=>{
  const records=defaultMerchantRecords();records[root].settings.default_transaction_currency='USD';records[root].settings.manual_exchange_rate=2000;
  Object.assign(records[`${root}/products/product`],{track_inventory:false,stock_quantity:0,price_usd:.5,price_sdg:1000});
  await seedCloudMerchant(page,records);await openMerchant(page);
  await page.getByPlaceholder('أدخل السعر يدويًا...').fill('3000');await page.getByRole('button',{name:'تثبيت السعر',exact:true}).click();
  await expect.poll(async()=>(await cloudRecords(page))[root].settings.manual_exchange_rate).toBe(0);
  await page.locator('#btn-quick-new-invoice').click();const form=formFor(page);await expect(form.getByLabel('سعر صرف الفاتورة')).toHaveValue('3000');
  await form.getByLabel('منتج البند 1').selectOption('product');await expect(form.getByLabel('سعر البند 1')).toHaveValue('0.5');
  await form.getByRole('button',{name:'+ إضافة بند جديد',exact:true}).click();await expect(form.getByLabel('عملة البند 2')).toHaveValue('USD');
  await form.getByLabel('منتج البند 2').selectOption('product');await expect(form.getByLabel('سعر البند 2')).toHaveValue('0.5');
  await form.getByLabel('سعر صرف الفاتورة').fill('2000.5');await form.evaluate(node=>(node as HTMLFormElement).requestSubmit());await expect(form).toHaveCount(0);
  const invoice=Object.entries(await cloudRecords(page)).find(([path])=>path.includes('/invoices/'))![1];
  expect(invoice.items.every((item:any)=>item.currency==='USD')).toBe(true);expect(invoice.exchange_rate_used).toBe(2000.5);expect(invoice.grand_total_usd).toBe(1);
});


test('settings rate changes clear an obsolete manual override and the next automatic invoice uses the newly saved cloud rate',async({page})=>{
  const records=defaultMerchantRecords();records[root].settings.manual_exchange_rate=2500;
  Object.assign(records[`${root}/products/product`],{track_inventory:false,stock_quantity:0,price_usd:.5,price_sdg:1000});
  await seedCloudMerchant(page,records);await openMerchant(page);await page.getByTitle('الإعدادات',{exact:true}).click();
  const settings=page.getByRole('dialog',{name:'إعدادات المؤسسة'});await settings.getByLabel('سعر الصرف الافتراضي',{exact:true}).fill('3000.5');
  await settings.getByRole('button',{name:'حفظ كافة الإعدادات',exact:true}).click();await expect(settings).toHaveCount(0);
  const saved=await cloudRecords(page);expect(saved[root].settings.default_exchange_rate).toBe(3000.5);expect(saved[root].settings.manual_exchange_rate).toBe(0);
  await page.locator('#btn-quick-new-invoice').click();const form=formFor(page);await expect(form.getByLabel('سعر صرف الفاتورة')).toHaveValue('3000.5');
  await form.getByLabel('منتج البند 1').selectOption('product');await expect(form.getByLabel('سعر البند 1')).toHaveValue('1500');
  await form.evaluate(node=>(node as HTMLFormElement).requestSubmit());await expect(form).toHaveCount(0);
  const invoice=Object.entries(await cloudRecords(page)).find(([path])=>path.includes('/invoices/'))![1];expect(invoice.exchange_rate_used).toBe(3000.5);expect(invoice.grand_total_sdg).toBe(1500);
});
