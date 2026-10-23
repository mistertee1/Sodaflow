import {readFile} from 'node:fs/promises';
import {test,expect,openMerchant,defaultMerchantRecords,seedCloudMerchant,cloudRecords,cloudMerchant,guestId,guestActor,type Page} from './helpers/cloudMerchant';
import {purchaseCorrectionGuestFixture} from './helpers/purchaseCorrections';
test.use({controlsEnabled:false});const root=`organizations/${guestId}`;
const dialog=(page:Page)=>page.getByRole('dialog',{name:'إعدادات المؤسسة',exact:true});
async function settings(page:Page){await page.getByTitle('الإعدادات',{exact:true}).click();return dialog(page);}
async function choose(page:Page,currency='KWD',rate='.3') { const d=dialog(page);await d.getByLabel('عملة التعامل الافتراضية',{exact:true}).selectOption(currency);if(!['USD','SDG'].includes(currency))await d.getByLabel('سعر عملة التعامل لكل دولار',{exact:true}).fill(rate);}
async function apply(page:Page){const d=dialog(page);await d.getByRole('button',{name:'تطبيق العملة والسعر',exact:true}).click();await expect(d.getByRole('status').filter({hasText:'تم تطبيق'})).toBeVisible();}
async function close(page:Page){await dialog(page).getByRole('button',{name:'إغلاق النافذة',exact:true}).click();}

test('manual currency drafts and cancellation do not affect the app; Apply persists to the real API and reload without local business storage',async({page})=>{
 await openMerchant(page);await settings(page);await choose(page);await expect(page.getByTestId('display-currency-notice')).toHaveCount(0);expect((await cloudRecords(page))[root].settings.display_currency).toBeUndefined();await close(page);
 await settings(page);await expect(dialog(page).getByLabel('عملة التعامل الافتراضية',{exact:true})).toHaveValue('SDG');await choose(page);await apply(page);await close(page);
 await expect(page.getByTestId('display-currency-notice')).toContainText('0.3 KWD');await page.locator('#tab-products').click();await expect(page.locator('[data-product-id="product"]')).toContainText('0.300 KWD');
 const saved=await cloudRecords(page);expect(saved[root].settings.display_currency).toEqual({currency:'KWD',units_per_usd:.3,sdg_per_usd:2000});expect(saved[root].settings.phone).toBe('+249912345678');expect(saved[root].settings.primary_currency).toBe('SDG');
 await page.reload();await expect(page.getByTestId('display-currency-notice')).toContainText('KWD');expect(await page.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter(key=>/^(sudaflow_|hisabuk_|mohasbasd_|sudanese_merchant_)/.test(key)))).toEqual([]);
});

test('missing manual quote and failed cloud Apply leave the previous currency active until a successful retry',async({page,merchant})=>{
 await openMerchant(page);await settings(page);await choose(page,'KWD','');await dialog(page).getByRole('button',{name:'تطبيق العملة والسعر',exact:true}).click();await expect(dialog(page).getByRole('alert')).toContainText('أدخل');expect(merchant.mutations.filter(x=>x.action==='settings.update')).toHaveLength(0);
 await dialog(page).getByLabel('سعر عملة التعامل لكل دولار',{exact:true}).fill('.3');merchant.failNextWrite();await dialog(page).getByRole('button',{name:'تطبيق العملة والسعر',exact:true}).click();await expect(dialog(page).getByRole('alert')).toBeVisible();await expect(page.getByTestId('display-currency-notice')).toHaveCount(0);expect((await cloudRecords(page))[root].settings.display_currency).toBeUndefined();
 await apply(page);await close(page);await expect(page.getByTestId('display-currency-notice')).toContainText('KWD');expect(Object.entries(await cloudRecords(page)).filter(([p,x])=>p.includes('/audit_logs/')&&x.action==='settings.update')).toHaveLength(1);
});

test('Gulf and Egyptian system selections require their entered rate and apply as one shared display preference',async({page})=>{
 test.setTimeout(60000);await openMerchant(page);await settings(page);
 for(const [currency,rate] of [['SAR','4'],['AED','4'],['KWD','.3'],['QAR','4'],['BHD','.4'],['OMR','.4'],['EGP','50'],['EUR','2'],['GBP','2'],['USD','1'],['SDG','2000']]){await choose(page,currency,rate);await apply(page);await expect(page.getByTestId('display-currency-notice')).toContainText(currency);expect((await cloudRecords(page))[root].settings.display_currency.currency).toBe(currency);}
 await close(page);expect((await cloudRecords(page))[root].settings.phone).toBe('+249912345678');
});

test('one applied KWD quote reaches dashboard, inventory, customers, invoices, expenses and all core accounting reports',async({page})=>{
 test.setTimeout(90000);const f=await purchaseCorrectionGuestFixture();await seedCloudMerchant(page,f.records);await openMerchant(page);
 await cloudMerchant(page).executeCommand('expense.create',{title:'مصروف عرض اصطناعي',date:'2026-10-07',amount:1,currency:'USD',exchange_rate_used:2000,category:'تشغيلي',payment_method:'cash'},'display-expense');await page.reload();
 await settings(page);await choose(page);await apply(page);await close(page);await expect(page.locator('main')).toContainText('90.000 KWD');
 await page.locator('#tab-products').click();await expect(page.locator('[data-product-id]')).toContainText('30.000 KWD');
 await page.locator('#tab-customers').click();await expect(page.locator('main')).toContainText('0.000 KWD');
 await page.locator('#tab-invoices').click();await expect(page.getByRole('region',{name:'ملخص الفواتير الصادرة'})).toContainText('90.000 KWD');
 await page.locator('#tab-expenses').click();await expect(page.locator('main')).toContainText('0.300 KWD');
 await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'دفتر الأستاذ',exact:true}).click();const gl=page.getByRole('region',{name:'دفتر الأستاذ العام',exact:true});await gl.getByLabel('حساب الأستاذ',{exact:true}).selectOption('1200');await expect(gl.getByRole('columnheader',{name:'مدين دفتر SDG ← KWD',exact:true})).toBeVisible();await expect(gl).toContainText('90.000 KWD');
 for(const tab of ['ميزان المراجعة','قائمة الدخل','الميزانية العمومية','التدفقات النقدية']){await page.getByRole('button',{name:tab,exact:true}).click();await expect(page.locator('main').locator('td, dd, .font-mono').filter({hasText:/\d[,.\d]* KWD/}).first()).toBeVisible();}
 await page.getByRole('button',{name:'الموردون والمشتريات',exact:true}).click();await expect(page.getByRole('region',{name:'مركز الموردين والمشتريات',exact:true})).toContainText('18.000 KWD');
 const saved=await cloudRecords(page);for(const collection of ['invoices','payments','purchase_bills','supplier_payments','inventory_movements'])for(const [path,row]of Object.entries(f.records).filter(([p])=>p.startsWith(`${root}/${collection}/`)))expect(saved[path]).toEqual(row);
});

test('report CSV and PDF use the selected display quote while keeping original ledger source columns',async({page},info)=>{
 test.setTimeout(60000);const f=await purchaseCorrectionGuestFixture();f.records[root].settings.display_currency={currency:'KWD',units_per_usd:.3,sdg_per_usd:2000};await seedCloudMerchant(page,f.records);await openMerchant(page);await page.locator('#tab-accounting').click();await page.getByRole('button',{name:'دفتر الأستاذ',exact:true}).click();const gl=page.getByRole('region',{name:'دفتر الأستاذ العام',exact:true});await gl.getByLabel('حساب الأستاذ',{exact:true}).selectOption('1200');await expect(gl).toContainText('90.000 KWD');
 const wait=page.waitForEvent('download');await gl.getByRole('button',{name:'تصدير الكشف CSV',exact:true}).click();const download=await wait,path=info.outputPath('display-ledger.csv');await download.saveAs(path);const text=await readFile(path,'utf8');expect(text).toContain('display_quote');expect(text).toContain('90.000 KWD');expect(text).toContain('600000');expect(text).toContain('عرض KWD');
 const pdfWait=page.waitForEvent('download');await gl.getByRole('button',{name:'تصدير الكشف PDF',exact:true}).click();const pdfPath=info.outputPath('display-ledger.pdf');await(await pdfWait).saveAs(pdfPath);expect((await readFile(pdfPath)).subarray(0,5).toString()).toBe('%PDF-');
});

test('changing display currency after an issued KWD invoice preserves its original quote, receipt and WhatsApp PDF',async({page},info)=>{
 test.setTimeout(60000);const records=defaultMerchantRecords();records[root].settings={...records[root].settings,phone:'+249912345678',default_transaction_currency:'KWD',currency_rates:{KWD:.3}};records[root].accounting_version=2;await seedCloudMerchant(page,records);await openMerchant(page);
 const invoice=(await cloudMerchant(page).executeCommand('invoice.create',{customer_id:'customer',issue_date:'2026-10-23',currency_mode:'single_foreign',exchange_rate_used:2000,currency_rates_used:{KWD:.3},discount_type:'fixed',discount_value:0,items:[{description:'خدمة تاريخية',unit:'ساعة',quantity:1,unit_price:1.234,currency:'KWD',tax_rate:0,discount_percent:0}]},'native-invoice')).result;
 await cloudMerchant(page).executeCommand('payment.create',{invoice_id:invoice.id,amount:.2,currency:'KWD',currency_rates_used:{KWD:.4},exchange_rate_used:2500,payment_method:'cash'},'native-receipt');const before=await cloudRecords(page);await page.reload();await settings(page);await choose(page,'SAR','4');await apply(page);await close(page);
 await page.locator('#tab-invoices').click();await page.getByRole('button',{name:`معاينة وطباعة ${invoice.invoice_number}`,exact:true}).click();await expect(page.getByTestId('invoice-native-workspace')).toContainText('1.234 KWD');await expect(page.getByTestId('invoice-native-workspace')).toContainText('1.034 KWD');
 await page.getByRole('button',{name:'معاينة المستند',exact:true}).click();const doc=page.getByRole('dialog',{name:'معاينة الفاتورة',exact:true});await expect(doc.getByTestId('invoice-native-summary')).toContainText('1.234 KWD');await expect(doc.getByTestId('invoice-native-summary')).not.toContainText('SAR');await doc.getByRole('button',{name:/واتساب/}).click();const share=page.getByRole('dialog',{name:'مشاركة الفاتورة مع PDF'});await share.getByText('تنزيل الملف أو الإرفاق اليدوي',{exact:true}).click();const link=share.getByRole('link',{name:'فتح واتساب للإرفاق اليدوي',exact:true});expect(new URL((await link.getAttribute('href'))!).searchParams.get('text')).toContain('1.034 KWD');const wait=page.waitForEvent('download');await share.getByRole('button',{name:'تنزيل PDF',exact:true}).click();const path=info.outputPath('original-kwd.pdf');await(await wait).saveAs(path);expect((await readFile(path)).subarray(0,5).toString()).toBe('%PDF-');
 const after=await cloudRecords(page);for(const[p,row]of Object.entries(before).filter(([p])=>/\/(invoices|payments|journal_entries)\//.test(p)))expect(after[p]).toEqual(row);
});

test('changing only the manual presentation quote reprices the UI after Apply and retains all stored products and stock on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});const records=defaultMerchantRecords();records[root].settings={...records[root].settings,phone:'+249912345678',default_transaction_currency:'KWD',currency_rates:{KWD:.3},display_currency:{currency:'KWD',units_per_usd:.3,sdg_per_usd:2000}};await seedCloudMerchant(page,records);await openMerchant(page);await page.locator('#tab-products').click();const card=page.locator('[data-product-id="product"]');await expect(card).toContainText('0.300 KWD');await settings(page);await dialog(page).getByLabel('سعر عملة التعامل لكل دولار',{exact:true}).fill('.4');await expect(card).toContainText('0.300 KWD');await apply(page);await close(page);await expect(card).toContainText('0.400 KWD');expect((await cloudRecords(page))[`${root}/products/product`]).toEqual(records[`${root}/products/product`]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/display-currency-mobile.png',fullPage:true});
});

test('switching companies discards the former company currency draft and reads the new company setting',async({page})=>{
 const records=defaultMerchantRecords(),other='currency-other-org';records[`organizations/${other}`]={...records[root],id:other,name:'مؤسسة أخرى',owner_uid:guestActor.uid,settings:{...records[root].settings,business_name:'مؤسسة أخرى',default_transaction_currency:'SAR',currency_rates:{SAR:4},display_currency:{currency:'SAR',units_per_usd:4,sdg_per_usd:2000}}};records[`organizations/${other}/members/${guestActor.uid}`]={uid:guestActor.uid,org_id:other,role:'Owner',status:'active'};records[`user_organizations/${guestActor.uid}/orgs/${other}`]={org_id:other};await seedCloudMerchant(page,records);await openMerchant(page);await settings(page);await choose(page,'KWD','.3');const select=dialog(page).locator('select').filter({has:page.locator(`option[value="${other}"]`)});await select.selectOption(other);await expect(dialog(page).getByLabel('عملة التعامل الافتراضية',{exact:true})).toHaveValue('SAR');await expect(dialog(page).getByLabel('سعر عملة التعامل لكل دولار',{exact:true})).toHaveValue('4');await close(page);await expect(page.getByTestId('display-currency-notice')).toContainText('SAR');expect((await cloudRecords(page))[root].settings.display_currency).toBeUndefined();expect(cloudMerchant(page).mutations.filter(x=>x.action==='settings.update')).toHaveLength(0);
});
