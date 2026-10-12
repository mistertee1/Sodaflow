import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { Operations, type Actor } from '../src/domain/operations';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { MemoryStore } from '../src/domain/store';
import { validateTaxConfigurationBackup } from '../src/domain/taxConfigurationTransactions';
import { defaultPlatformPlans } from '../src/lib/plans';
import { Organizations } from '../server/organizations';

const now = new Date('2026-10-11T15:45:00Z');
const owner: Actor = { uid: 'tax-backup-owner', email: 'tax-backup@example.com', emailVerified: true, authTime: Math.floor(now.getTime() / 1000) - 30 };

async function fixture() {
  const store = new MemoryStore();
  const org = await new Organizations(store, undefined, () => now).create(owner, 'دورة الضريبة', INITIAL_SETTINGS, 'tax-backup', true);
  const root = `organizations/${org.id}`;
  await store.transaction(async tx => {
    tx.set(root, { ...await tx.get(root), accounting_version: 2, planId: 'Enterprise', subscriptionStatus: 'active', subscriptionEnd: '2027-01-01' });
    tx.set('plans/Enterprise', defaultPlatformPlans(now.toISOString()).find(plan => plan.id === 'Enterprise')!);
  });
  const ops = new Operations(store, () => now);
  const run = (action: string, data: Record<string, unknown>, operationId: string, actor = owner, orgId = org.id) => ops.execute(orgId, actor, { action, data, operationId });
  await run('period.create', { id: 'oct', start_date: '2026-10-01', end_date: '2026-10-31', reason: 'أكتوبر' }, 'period');
  const baseTax = { id: 'vat', name: 'ضريبة القيمة المضافة', jurisdiction: 'السودان', direction: 'sales', calculation: 'exclusive', rounding: 'half_up', recoverable: false, tax_account_code: '2130', effective_from: '2026-01-01', effective_to: null, active: true };
  await run('taxConfiguration.create', { ...baseTax, rate: 15, reason: 'اعتماد أول' }, 'tax-v1');
  await run('taxConfiguration.update', { ...baseTax, expected_revision: 1, rate: 17.5, reason: 'اعتماد ثانٍ' }, 'tax-v2');
  const customer = (await run('customer.create', { name: 'عميل ضريبي', phone: '' }, 'customer')).result;
  const product = (await run('product.create', { name: 'خدمة', unit: 'خدمة', price_sdg: 1000, price_usd: 0, tax_rate: 0, is_active: true, track_inventory: false, stock_quantity: 0 }, 'product')).result;
  const invoice = (await run('invoice.create', { customer_id: customer.id, issue_date: '2026-10-11', currency_mode: 'single_sdg', exchange_rate_used: 0, discount_type: 'fixed', discount_value: 0, tax_configuration_id: 'vat', expected_tax_configuration_revision: 2, items: [{ product_id: product.id, description: 'خدمة', unit: 'خدمة', quantity: 1, unit_price: 1000, currency: 'SDG', tax_rate: 0, discount_percent: 0 }] }, 'invoice')).result;
  await run('creditNote.create', { invoice_id: invoice.id, date: '2026-10-11', reason: 'تصحيح ضريبي محفوظ', kind: 'price_credit', lines: [{ line_id: 'line-1', amount: 235 }] }, 'tax-credit');
  return { store, org, ops, run, backup: await ops.snapshot(org.id, owner, true) };
}

test('C5.2c1 backup exports exact tax counts, complete hash history and reconciled invoice evidence', async () => {
  const f = await fixture();
  assert.equal(f.backup.tax_configuration_schema_version, 1);
  assert.equal(f.backup.counters.tax_configuration_count, 1);
  assert.equal(f.backup.counters.tax_configuration_version_count, 2);
  assert.equal(f.backup.collections.tax_configuration_versions[1].previous_version_hash, f.backup.collections.tax_configuration_versions[0].version_hash);
  assert.equal(f.backup.collections.invoices[0].tax_evidence.configuration_version_hash, f.backup.collections.tax_configurations[0].version_hash);
  assert.equal(f.backup.collections.credit_notes.length, 1);
  assert.equal(f.backup.collections.credit_notes[0].credit_sdg, 235);
  await validateTaxConfigurationBackup(f.backup);
  assert.deepEqual(reconcileFinancialData(f.backup.collections as FinancialData, f.backup.settings, { requireCosting: true }), []);
});

test('C5.2c1 protected restore rehashes the tenant-bound chain and invoice reference without changing amounts', async () => {
  const f = await fixture();
  const actor: Actor = { ...owner, uid: 'tax-restore-owner', email: 'tax-restore@example.com' };
  const destination = await new Organizations(f.store, undefined, () => now).create(actor, 'استعادة الضريبة', INITIAL_SETTINGS, 'tax-restore', true);
  const destinationRoot = `organizations/${destination.id}`;
  await f.store.transaction(async tx => tx.set(destinationRoot, { ...await tx.get(destinationRoot), planId: 'Enterprise', subscriptionStatus: 'active', subscriptionEnd: '2027-01-01' }));
  const oldHash = f.backup.collections.tax_configuration_versions[1].version_hash;
  const oldTotal = f.backup.collections.invoices[0].grand_total_sdg;
  await f.run('backup.restore', { backup: f.backup }, 'restore-tax', actor, destination.id);
  const restored = await f.ops.snapshot(destination.id, actor, true);
  assert.equal(restored.collections.tax_configurations[0].org_id, destination.id);
  assert.equal(restored.collections.tax_configuration_versions[0].org_id, destination.id);
  assert.notEqual(restored.collections.tax_configuration_versions[1].version_hash, oldHash);
  assert.equal(restored.collections.invoices[0].tax_evidence.configuration_version_hash, restored.collections.tax_configurations[0].version_hash);
  assert.equal(restored.collections.invoices[0].grand_total_sdg, oldTotal);
  assert.equal(restored.counters.tax_configuration_count, 1);
  assert.equal(restored.counters.tax_configuration_version_count, 2);
  await validateTaxConfigurationBackup(restored);
  assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData, restored.settings, { requireCosting: true }), []);
});

test('C5.2c1 rejects missing, altered or miscounted tax evidence before restore writes', async () => {
  const f = await fixture();
  const mutations = [
    (backup: any) => { delete backup.collections.tax_configuration_versions; },
    (backup: any) => { backup.collections.tax_configuration_versions[0].rate = 99; },
    (backup: any) => { backup.collections.invoices[0].tax_evidence.configuration_version_hash = '0'.repeat(64); },
    (backup: any) => { backup.counters.tax_configuration_version_count = 1; },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(f.backup);
    mutate(bad);
    await assert.rejects(validateTaxConfigurationBackup(bad), /ضريب|بصمة|إصدار|النسخة/);
  }
  const actor: Actor = { ...owner, uid: 'tax-reject-owner', email: 'tax-reject@example.com' };
  const destination = await new Organizations(f.store, undefined, () => now).create(actor, 'رفض نسخة ضريبة', INITIAL_SETTINGS, 'tax-reject', true);
  const destinationRoot = `organizations/${destination.id}`;
  await f.store.transaction(async tx => tx.set(destinationRoot, { ...await tx.get(destinationRoot), planId: 'Enterprise', subscriptionStatus: 'active', subscriptionEnd: '2027-01-01' }));
  const before = f.store.dump(), bad = structuredClone(f.backup);
  bad.collections.tax_configuration_versions[1].version_hash = 'f'.repeat(64);
  await assert.rejects(f.run('backup.restore', { backup: bad }, 'reject-tax', actor, destination.id), /بصمة|يطابق/);
  assert.deepEqual(f.store.dump(), before);
});

test('C5.2c1 reconciliation surfaces a tax policy mismatch as a read-only finding', async () => {
  const f = await fixture(), bad = structuredClone(f.backup.collections);
  bad.invoices[0].tax_evidence.jurisdiction = 'مزور';
  const findings = reconcileFinancialData(bad as FinancialData, f.backup.settings, { requireCosting: true });
  assert.ok(findings.some(finding => finding.code === 'invalid_record' && finding.collection === 'invoices'));
  const brokenChain = structuredClone(f.backup.collections);
  brokenChain.tax_configuration_versions[1].previous_version_hash = '0'.repeat(64);
  assert.ok(reconcileFinancialData(brokenChain as FinancialData, f.backup.settings, { requireCosting: true }).some(finding => finding.code === 'invalid_record' && finding.collection === 'tax_configurations'));
});
