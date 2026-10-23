import {test,expect,openMerchant,defaultMerchantRecords,seedCloudMerchant,cloudRecords,cloudMerchant,guestId} from './helpers/cloudMerchant';
test.use({controlsEnabled:false});const root=`organizations/${guestId}`;
const dialogFor=(page:import('@playwright/test').Page)=>page.getByRole('dialog',{name:'إضافة أو تعديل منتج'});
const nameInput=(dialog:import('@playwright/test').Locator)=>dialog.getByPlaceholder('مثال: سكر كنانة (جوال 50 كيلو)');

test('catalog UI blocks a decorative Arabic duplicate without changing stock or creating another product',async({page})=>{
  const records=defaultMerchantRecords();records[`${root}/products/product`].name='سكر';await seedCloudMerchant(page,records);await openMerchant(page);await page.locator('#tab-products').click();
  await page.getByRole('button',{name:/إضافة منتج/}).first().click();const dialog=dialogFor(page);await nameInput(dialog).fill('سُكــر');await dialog.getByRole('button',{name:'إضافة المنتج',exact:true}).click();
  await expect(dialog).toContainText('مسجل بالفعل');const saved=await cloudRecords(page);expect(Object.keys(saved).filter(p=>p.startsWith(`${root}/products/`))).toHaveLength(1);expect(saved[`${root}/products/product`].stock_quantity).toBe(100);
  expect(cloudMerchant(page).mutations.filter(cmd=>cmd.action==='product.create')).toHaveLength(0);
});

test('a product created by a second client is rejected by the real API when the stale add-product form submits',async({page})=>{
  await openMerchant(page);await page.locator('#tab-products').click();await page.getByRole('button',{name:/إضافة منتج/}).first().click();const dialog=dialogFor(page);await nameInput(dialog).fill(' RACE  SKU ');
  await cloudMerchant(page).executeCommand('product.create',{name:'Race SKU',unit:'قطعة',price_sdg:1000,price_usd:.5,tax_rate:0,is_active:true,track_inventory:false,stock_quantity:0},'second-client-product');
  await dialog.getByRole('button',{name:'إضافة المنتج',exact:true}).click();await expect(dialog).toContainText('مسجل بالفعل');
  expect(cloudMerchant(page).mutations.filter(cmd=>cmd.action==='product.create')).toHaveLength(2);const saved=await cloudRecords(page);expect(Object.keys(saved).filter(p=>p.startsWith(`${root}/products/`))).toHaveLength(2);expect(saved[`${root}/products/product`].stock_quantity).toBe(100);
});

test('renaming to an existing name is blocked while ordinary product-price edits keep stock unchanged',async({page})=>{
  const records=defaultMerchantRecords();records[`${root}/products/product`].name='First';records[`${root}/products/second`]={...records[`${root}/products/product`],id:'second',name:'Second',stock_quantity:7};
  await seedCloudMerchant(page,records);await openMerchant(page);await page.locator('#tab-products').click();await page.locator('[data-product-id="second"]').getByTitle('تعديل المنتج والكمية').click();const dialog=dialogFor(page);
  await nameInput(dialog).fill(' FIRST ');await dialog.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();await expect(dialog).toContainText('مسجل بالفعل');
  await nameInput(dialog).fill('Second');await dialog.getByLabel('مرجع سعر البيع بالدولار').fill('2');await dialog.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();await expect(dialog).toHaveCount(0);
  const saved=await cloudRecords(page);expect(saved[`${root}/products/second`].pricing_reference_usd).toBe(2);expect(saved[`${root}/products/second`].stock_quantity).toBe(7);
});

test('existing duplicates are reviewable on mobile and can be renamed without dropping product IDs or inventory history',async({page})=>{
  await page.setViewportSize({width:390,height:844});const records=defaultMerchantRecords();records[`${root}/products/duplicate`]={...records[`${root}/products/product`],id:'duplicate',name:' منتج   الاختبار ',stock_quantity:7};records[`${root}/products/other`]={...records[`${root}/products/product`],id:'other',name:'صنف مختلف',stock_quantity:3};
  await seedCloudMerchant(page,records);await openMerchant(page);await page.locator('#tab-products').click();const review=page.getByRole('region',{name:'مراجعة المنتجات المكررة'});await expect(review).toContainText('1 أسماء');await review.getByRole('button',{name:'عرض المنتجات المكررة',exact:true}).click();
  await expect(page.locator('[data-product-id]')).toHaveCount(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/product-duplicates-mobile.png',fullPage:true});
  await page.locator('[data-product-id="duplicate"]').getByTitle('تعديل المنتج والكمية').click();const dialog=dialogFor(page);await nameInput(dialog).fill('منتج الاختبار 5 كجم');await dialog.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(review).toHaveCount(0);await expect(page.locator('[data-product-id]')).toHaveCount(3);const saved=await cloudRecords(page);expect(saved[`${root}/products/duplicate`].stock_quantity).toBe(7);expect(saved[`${root}/products/product`].stock_quantity).toBe(100);
});
