import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalDecision, validateApprovalPolicy } from '../src/domain/approvalPolicies';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { createDefaultSubscription, getPlanConfig } from '../src/lib/plans';

const now = new Date('2026-10-14T05:10:00Z');
const owner: Actor = { uid: 'owner', email: 'owner@example.test', emailVerified: true, authTime: Math.floor(now.getTime() / 1000) };
const base = { id: 'discount-standard', subject: 'discount', currency: 'PERCENT', active: true, tiers: [{ max_value: 5, required_role: 'Sales' }, { max_value: 15, required_role: 'Admin' }, { max_value: null, required_role: 'Owner' }] };

test('D4.3.1 validates tiers and derives frozen approval evidence', () => {
  const policy = validateApprovalPolicy({ ...base, revision: 1, created_at: now.toISOString(), created_by: 'owner', updated_at: now.toISOString(), updated_by: 'owner', operation_id: 'create' }, 'org');
  assert.equal(approvalDecision(policy, 5, 'Sales', 'sales', 'خصم ضمن الصلاحية').required_role, 'Sales');
  assert.equal(approvalDecision(policy, 10, 'Accountant').approved, false);
  assert.equal(approvalDecision(policy, 20, 'Owner', 'owner', 'صفقة موثقة').approval_reason, 'صفقة موثقة');
  for (const patch of [{ tiers: [{ max_value: null, required_role: 'Owner' }, { max_value: 10, required_role: 'Admin' }] }, { tiers: [{ max_value: 10, required_role: 'Admin' }, { max_value: 5, required_role: 'Owner' }, { max_value: null, required_role: 'Owner' }] }, { currency: 'USD' }, { tiers: [{ max_value: 101, required_role: 'Admin' }, { max_value: null, required_role: 'Owner' }] }]) assert.throws(() => validateApprovalPolicy({ ...base, ...patch }, 'org'));
});

test('D4.3.1 registry requires recent actual Owner, revision and unique active subject/currency', async () => {
  const store = new MemoryStore(), org = await new Organizations(store).create(owner, 'اعتمادات', INITIAL_SETTINGS, 'setup', true), root = `organizations/${org.id}`;
  await store.transaction(async tx => { const plan = getPlanConfig('Enterprise'); tx.set(`${root}/meta/subscription`, { ...createDefaultSubscription(org.id), ...plan, plan: plan.name }); tx.set(root, { ...await tx.get(root), accounting_version: 2, planId: plan.name, subscriptionStatus: 'active', subscriptionEnd: '2027-01-01' }); });
  const ops = new Operations(store, () => now, saved => saved as any), run = (action: string, data: Record<string, unknown>, id: string, actor = owner) => ops.execute(org.id, actor, { action, data, operationId: id });
  const data = { ...base, reason: 'اعتماد سياسة الخصومات' };
  assert.equal((await run('approvalPolicy.create', data, 'create')).result.revision, 1);
  const admin = { uid: 'admin', email: 'admin@example.test', emailVerified: true, authTime: owner.authTime };
  await store.transaction(async tx => tx.set(`${root}/members/admin`, { uid: admin.uid, role: 'Admin', status: 'active' }));
  await assert.rejects(run('approvalPolicy.update', { ...data, expected_revision: 1, active: false }, 'admin-update', admin), /صلاحية|المالك/);
  await assert.rejects(run('approvalPolicy.update', { ...data, expected_revision: 0, active: false }, 'stale'), /تغيرت/);
  await assert.rejects(run('approvalPolicy.create', { ...data, id: 'duplicate' }, 'duplicate'), /نشطة/);
  const updated = (await run('approvalPolicy.update', { ...data, expected_revision: 1, active: false, reason: 'إيقاف موثق' }, 'update')).result; assert.equal(updated.revision, 2);
  const snap = await ops.snapshot(org.id, owner, true); assert.equal(snap.collections.approval_policies[0].revision, 2);
});
