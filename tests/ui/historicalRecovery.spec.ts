import { test, expect, openMerchant, seedCloudMerchant, cloudMerchant, cloudRecords, guestId, guestActor, type Page } from './helpers/cloudMerchant';
import { periodGuestFixture } from './helpers/accountingPeriods';
test.use({serverAuthority:true});
const root=`organizations/${guestId}`;
async function openHistory(page:Page){await page.locator('#tab-accounting').click();await page.getByTestId('data-import-tab').click();return page.getByTestId('historical-workbook-center');}
async function setup(page:Page,other=false){
 const records=await periodGuestFixture(false,'Owner');
 // The real organization index determines the initial company. Seed the
 // intended company first instead of depending on a browser preference.
 records[`user_organizations/${guestActor.uid}/orgs/${guestId}`]={org_id:guestId};
 records[`${root}/accounting_periods/2026`]={id:'2026',org_id:guestId,schema_version:1,start_date:'2026-01-01',end_date:'2026-01-31',status:'OPEN',revision:1,created_by:guestActor.uid,created_at:'2026-01-01',operation_id:'period'};
 if(other){const id='recovery-other';records[`organizations/${id}`]={...records[root],id,owner_uid:guestActor.uid,name:'المؤسسة الثانية',settings:{...records[root].settings,business_name:'المؤسسة الثانية'}};records[`organizations/${id}/members/${guestActor.uid}`]={uid:guestActor.uid,role:'Owner',status:'active',org_id:id};records[`organizations/${id}/meta/subscription`]={...records[`${root}/meta/subscription`],org_id:id};records[`user_organizations/${guestActor.uid}/orgs/${id}`]={org_id:id};}
 await seedCloudMerchant(page,records);await openMerchant(page);
 const session=(await cloudMerchant(page).executeCommand('historicalImport.stage',{file_name:'recovered-history.xlsx',file_hash:'a'.repeat(64),schema_version:1,rows:[{row_number:1,kind:'journal',reference:'CLOUD-RECOVERY-1',date:'2026-01-10',currency:'SDG',branch_id:'main',lines:[{account_code:'5200',debit:100,credit:0},{account_code:'4100',debit:0,credit:100}]}]},'recover-stage')).result;
 await page.reload();await expect(page.locator('.sf-app-shell')).toBeVisible();return session;
}
async function selectSession(page:Page,id:string){const center=await openHistory(page);await center.getByLabel('جلسة الاستيراد المحفوظة').selectOption(id);await center.getByTestId('recover-historical-session').click();return center;}

test('staged cloud session survives reload, requires a new review, then recovers its confirmed receipt without duplicate posting',async({page})=>{
 const session=await setup(page),before=await cloudRecords(page),center=await selectSession(page,session.id);
 await expect(center.getByTestId('historical-server-session')).toContainText('recovered-history.xlsx');
 await expect(center.getByTestId('commit-historical-workbook')).toHaveCount(0);expect(await cloudRecords(page)).toEqual(before);
 await center.getByTestId('preview-historical-workbook').click();await expect(center.getByTestId('historical-server-preview')).toBeVisible();await expect(center.getByTestId('commit-historical-workbook')).toBeDisabled();
 await center.getByTestId('confirm-historical-approval').check();await center.getByTestId('commit-historical-workbook').click();await expect(center.getByTestId('historical-approval-receipt')).toContainText('اكتمل الاعتماد');
 const saved=await cloudRecords(page);expect(Object.values(saved).filter(row=>row.historical_import_session_id===session.id&&row.lines)).toHaveLength(1);
 await page.reload();await expect(page.locator('.sf-app-shell')).toBeVisible();const recovered=await selectSession(page,session.id);await expect(recovered.getByTestId('historical-approval-receipt')).toContainText('اكتمل الاعتماد');await expect(recovered.getByTestId('preview-historical-workbook')).toHaveCount(0);await expect(recovered.getByTestId('commit-historical-workbook')).toHaveCount(0);expect(await cloudRecords(page)).toEqual(saved);
 expect(await page.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter(key=>/^(sudaflow_|hisabuk_|mohasbasd_|sudanese_merchant_)/.test(key)))).toEqual([]);
});

test('a lost approval response recovers the already committed cloud receipt after reload instead of submitting another financial command',async({page})=>{
 const session=await setup(page),center=await selectSession(page,session.id);await expect(center.getByTestId('historical-server-session')).toBeVisible();await center.getByTestId('preview-historical-workbook').click();await expect(center.getByTestId('historical-server-preview')).toBeVisible();await center.getByTestId('confirm-historical-approval').check();cloudMerchant(page).abortAfterCommit();await center.getByTestId('commit-historical-workbook').click();await expect(center.getByTestId('historical-pending-approval')).toBeVisible();
 await expect.poll(()=>cloudMerchant(page).mutations.filter(row=>row.action==='historicalImport.commit').length).toBe(1);
 await expect(center.getByTestId('retry-historical-approval')).toBeEnabled();
 const saved=await cloudRecords(page),commits=cloudMerchant(page).mutations.filter(row=>row.action==='historicalImport.commit').length;
 expect(commits).toBe(1);expect(Object.values(saved).filter(row=>row.action==='historicalImport.commit')).toHaveLength(1);
 await page.reload();await expect(page.locator('.sf-app-shell')).toBeVisible();const recovered=await selectSession(page,session.id);await expect(recovered.getByTestId('historical-approval-receipt')).toContainText('اكتمل الاعتماد');expect(cloudMerchant(page).mutations.filter(row=>row.action==='historicalImport.commit')).toHaveLength(commits);expect(await cloudRecords(page)).toEqual(saved);
});

test('cloud recovery failure keeps an actionable error and never fabricates a receipt or a local fallback',async({page,merchant})=>{
 const session=await setup(page),before=await cloudRecords(page),center=await openHistory(page);await center.getByLabel('جلسة الاستيراد المحفوظة').selectOption(session.id);merchant.failCloudReads();await center.getByTestId('recover-historical-session').click();await expect(center.getByRole('alert')).toContainText('غير متاحة');await expect(center.getByTestId('historical-approval-receipt')).toHaveCount(0);await expect(center.getByTestId('historical-server-session')).toHaveCount(0);expect(await cloudRecords(page)).toEqual(before);merchant.recoverCloudReads();await center.getByTestId('recover-historical-session').click();await expect(center.getByTestId('historical-server-session')).toBeVisible();expect(await cloudRecords(page)).toEqual(before);
});

test('a delayed recovery from the previous company cannot appear after switching companies',async({page})=>{
 const session=await setup(page,true),center=await openHistory(page);await center.getByLabel('جلسة الاستيراد المحفوظة').selectOption(session.id);
 let started!:()=>void,release!:()=>void;const pending=new Promise<void>(resolve=>started=resolve),held=new Promise<void>(resolve=>release=resolve);
 await page.route('**/historical-import/sessions/**',async route=>{started();await held;await route.fallback();});
 try {
 await center.getByTestId('recover-historical-session').click();await pending;await page.getByTitle('الإعدادات',{exact:true}).click();const settings=page.getByRole('dialog',{name:'إعدادات المؤسسة'});await settings.locator('select').filter({has:page.locator('option[value="recovery-other"]')}).selectOption('recovery-other');await expect(page.locator('header')).toContainText('المؤسسة الثانية');
 const late=page.waitForResponse(response=>response.url().includes('/historical-import/sessions/'));release();await(await late).finished();await settings.getByRole('button',{name:'إغلاق النافذة',exact:true}).click();
 await expect(page.getByTestId('historical-server-session')).toHaveCount(0);await expect(page.getByTestId('historical-approval-receipt')).toHaveCount(0);expect(Object.keys(await cloudRecords(page)).some(path=>path.startsWith('organizations/recovery-other/journal_entries/'))).toBe(false);
 } finally {release();}
});
