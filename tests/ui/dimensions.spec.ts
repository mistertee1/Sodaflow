import { test, expect, type Page } from '@playwright/test';
import { periodGuestFixture } from './helpers/accountingPeriods';

async function seed(page: Page, role: 'Owner' | 'Accountant' = 'Owner', existing = false) {
  const records = await periodGuestFixture(false, role), root = 'organizations/local-guest-org';
  if (existing) records[`${root}/branches/north`] = { id:'north', org_id:'local-guest-org', kind:'branch', code:'NORTH', name_ar:'الفرع الشمالي', status:'active', created_by:'guest', created_at:'2026-10-05T12:00:00.000Z', updated_at:'2026-10-05T12:00:00.000Z', revision:1 };
  await page.addInitScript(records => { localStorage.setItem('mohasbasd_guest_session','true'); localStorage.setItem('sudanese_merchant_has_seen_tour_v2','true'); localStorage.setItem('sudaflow_guest_transactions_v3',JSON.stringify(records)); }, records);
  await page.goto('/'); await page.locator('#tab-accounting').click(); await page.getByTestId('dimensions-center-tab').click();
}
const rows = (page: Page, name: string) => page.evaluate(name => Object.entries(JSON.parse(localStorage.getItem('sudaflow_guest_transactions_v3') || '{}')).filter(([path]) => path.includes(`/${name}/`)).map(([,row]) => row as any), name);

test('D1.2b Owner creates, versions and deactivates a dimension which survives reload', async ({ page }) => {
  await seed(page); const center = page.getByRole('region',{name:'إدارة الأبعاد الإدارية'}), form = center.getByRole('form',{name:'حفظ فرع'});
  await form.getByLabel('رمز فرع').fill('north'); await form.getByLabel('اسم فرع بالعربية').fill('الفرع الشمالي'); await form.getByLabel('اسم فرع بالإنجليزية').fill('North Branch'); await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
  await expect(center).toContainText('NORTH — الفرع الشمالي'); let saved = await rows(page,'branches'); expect(saved).toHaveLength(1); expect(saved[0].revision).toBe(1);
  await center.getByRole('button',{name:'تعديل'}).click(); await form.getByLabel('اسم فرع بالعربية').fill('فرع الشمال'); await form.getByLabel('حالة فرع').selectOption('inactive'); await form.evaluate(node => (node as HTMLFormElement).requestSubmit());
  await expect(center).toContainText('NORTH — فرع الشمال'); await expect(center).toContainText('غير نشط'); saved = await rows(page,'branches'); expect(saved[0].revision).toBe(2); expect(saved[0].status).toBe('inactive');
  const snapshot=await page.evaluate(()=>localStorage.getItem('sudaflow_guest_transactions_v3'));await page.addInitScript(snapshot=>localStorage.setItem('sudaflow_guest_transactions_v3',snapshot!),snapshot);await page.reload();await page.locator('#tab-accounting').click();await page.getByTestId('dimensions-center-tab').click();await expect(page.getByRole('region',{name:'إدارة الأبعاد الإدارية'})).toContainText('NORTH — فرع الشمال');
});

test('D1.2b Accountant reads dimensions without management controls', async ({ page }) => {
  await seed(page,'Accountant',true); const center=page.getByRole('region',{name:'إدارة الأبعاد الإدارية'});await expect(center).toContainText('NORTH — الفرع الشمالي');await expect(center.getByRole('form',{name:'حفظ فرع'})).toHaveCount(0);await expect(center.getByRole('button',{name:'تعديل'})).toHaveCount(0);
});
