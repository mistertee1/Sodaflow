import test from 'node:test';
import './approvalPolicies.test';
import './approvalGates.test';
import assert from 'node:assert/strict';
import { authorizeCreditDecision, customerCreditDecision } from '../src/domain/customerCredit';
import type { Customer } from '../src/types';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { createDefaultSubscription, getPlanConfig } from '../src/lib/plans';

const owner: Actor = { uid: 'owner', email: 'owner@example.test', emailVerified: true };
async function fixture() {
  const now = new Date('2026-10-14T00:00:00Z'), store = new MemoryStore(), org = await new Organizations(store).create(owner, 'ائتمان', INITIAL_SETTINGS, 'setup', true);
  await store.transaction(async tx => { const plan = getPlanConfig('Enterprise'), root = `organizations/${org.id}`; tx.set(`${root}/meta/subscription`, { ...createDefaultSubscription(org.id), ...plan, plan: plan.name }); tx.set(root, { ...await tx.get(root), planId: plan.name, subscriptionStatus: 'active', subscriptionEnd: '2027-01-01' }); });
  const ops = new Operations(store, () => now, saved => saved as any), run = (action: string, data: Record<string, unknown>, operationId: string, actor = owner) => ops.execute(org.id, actor, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل', phone: '', preferred_currency: 'USD', balance_sdg: 0, balance_usd: 0 }, 'customer')).result;
  const product = (await run('product.create', { name: 'خدمة', unit: 'خدمة', price_sdg: 2000, price_usd: 1, tax_rate: 0, is_active: true, track_inventory: false, stock_quantity: 0 }, 'product')).result;
  const invoice = (amount: number) => ({ customer_id: customer.id, issue_date: '2026-10-14', currency_mode: 'single_usd', exchange_rate_used: 2000, discount_type: 'fixed', discount_value: 0, items: [{ product_id: product.id, description: 'خدمة', unit: 'خدمة', quantity: 1, unit_price: amount, currency: 'USD', tax_rate: 0, discount_percent: 0 }] });
  return { store, org, run, customer, invoice };
}

test('D4.1 credit quote is currency-specific, deterministic and disabled when no limit exists', () => {
  const customer = { balance_sdg: 600, balance_usd: 4, credit_limit_sdg: 1000, credit_limit_usd: null, credit_policy: 'approval_required' } as Customer;
  assert.deepEqual(customerCreditDecision(customer, 'SDG', 500), { currency: 'SDG', balance_before: 600, invoice_amount: 500, exposure_after: 1100, limit: 1000, exceeded: true, policy: 'approval_required' });
  assert.equal(customerCreditDecision(customer, 'USD', 999).exceeded, false);
});

test('D4.1 protected customer limits require Owner/Admin and validate precision', async () => {
  const f = await fixture();
  const sales = { uid: 'sales', email: 'sales@example.test', emailVerified: true };
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/members/sales`, { uid: 'sales', role: 'Sales', status: 'active' }));
  await assert.rejects(f.run('customer.update', { id: f.customer.id, updates: { credit_limit_usd: 100 } }, 'sales-limit', sales), /المالك أو المدير|للمالك أو المدير/);
  const saved = (await f.run('customer.update', { id: f.customer.id, updates: { credit_limit_usd: 100, credit_policy: 'approval_required' } }, 'owner-limit')).result;
  assert.equal(saved.credit_limit_usd, 100);
  const path = `organizations/${f.org.id}/customers/${f.customer.id}`;
  const audit = f.store.dump()[`organizations/${f.org.id}/audit_logs/audit-owner-limit`];
  assert.equal(audit.new_state[path].credit_limit_usd, 100);
  assert.equal(audit.new_state[path].credit_policy, 'approval_required');
  const before = f.store.dump();
  await assert.rejects(f.run('customer.update', { id: f.customer.id, updates: { credit_limit_usd: 1.001 } }, 'bad-precision'), /الدقة/);
  await assert.rejects(f.run('customer.update', { id: f.customer.id, updates: { credit_policy: 'ignore' } }, 'bad-policy'), /سياسة حد الائتمان/);
  assert.deepEqual(f.store.dump(), before);
});

test('D4.1 approval policy rejects sales over-limit atomically and records Owner evidence', async () => {
  const f = await fixture();
  await f.run('customer.update', { id: f.customer.id, updates: { credit_limit_usd: 100, credit_policy: 'approval_required' } }, 'limit');
  const sales = { uid: 'sales', email: 'sales@example.test', emailVerified: true };
  await f.store.transaction(async tx => tx.set(`organizations/${f.org.id}/members/sales`, { uid: 'sales', role: 'Sales', status: 'active' }));
  const before = f.store.dump();
  await assert.rejects(f.run('invoice.create', f.invoice(101), 'sales-over', sales), /اعتماد المالك أو المدير/);
  assert.deepEqual(f.store.dump(), before);
  await assert.rejects(f.run('invoice.create', f.invoice(101), 'owner-no-reason'), /النص المطلوب/);
  const issued = (await f.run('invoice.create', { ...f.invoice(101), credit_limit_override_reason: 'عميل موثوق بعقد ساري' }, 'owner-approved', owner)).result;
  assert.equal(issued.credit_decision.approved_by, owner.uid);
  assert.equal(issued.credit_decision.exposure_after, 101);
});

test('D4.1 warning policy permits posting but freezes the exceeded decision on invoice', async () => {
  const f = await fixture();
  await f.run('customer.update', { id: f.customer.id, updates: { credit_limit_usd: 50, credit_policy: 'warning' } }, 'limit');
  const issued = (await f.run('invoice.create', f.invoice(60), 'warn')).result;
  assert.equal(issued.credit_decision.exceeded, true);
  assert.equal(issued.credit_decision.approved_by, undefined);
});

test('D4.1 approval helper accepts Admin evidence and rejects blank reasons', () => {
  const decision = customerCreditDecision({ balance_sdg: 90, credit_limit_sdg: 100, credit_policy: 'approval_required' } as Customer, 'SDG', 20);
  assert.throws(() => authorizeCreditDecision(decision, 'Admin', 'admin', '   '), /النص المطلوب/);
  assert.equal(authorizeCreditDecision(decision, 'Admin', 'admin', 'طلب موثق').approved_by, 'admin');
});
