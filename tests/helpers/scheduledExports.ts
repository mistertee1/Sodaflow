import { MemoryStore, type Document, type Store } from '../../src/domain/store';
import { Operations, type Actor } from '../../src/domain/operations';
import { Organizations } from '../../server/organizations';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
import { ScheduledExportManagement, type ScheduledAccountIdentity } from '../../src/domain/scheduledExportManagement';
import { readFileSync } from 'node:fs';
import { verifyAccountingRulesSource } from '../../server/accountingSecurity';

export const scheduleInput = (updates: Document = {}) => ({ name: 'تصدير محاسبي اصطناعي', kind: 'accounting', cadence: 'daily', timezone: 'Asia/Kuwait', time: '10:00', start_date: '2026-10-24', period_kind: 'previous_day', retention_hours: 24, active: true, ...updates });
export async function scheduledExportsFixture(store: Store = new MemoryStore(), suffix = 'memory') {
  let clock = new Date('2026-10-24T06:00:00Z');
  const now = () => new Date(clock), owner: Actor = { uid: `schedule-${suffix}`, email: 'synthetic-schedule@example.test', emailVerified: true };
  const org = await new Organizations(store, undefined, now).create(owner, 'جداول اصطناعية', INITIAL_SETTINGS, `setup-${suffix}`, true), root = `organizations/${org.id}`;
  const accounts = new Map<string, ScheduledAccountIdentity>(), lookups: string[] = [];
  for (const uid of [owner.uid, 'Accountant', 'Admin', 'OtherAccountant', 'Viewer', 'Sales', 'Cashier', 'ForgedOwner']) accounts.set(uid, { uid, disabled: false, emailVerified: true });
  await store.transaction(async tx => {
    tx.set(root, { ...await tx.get(root), accounting_version: 2, planId: 'Enterprise', subscriptionStatus: 'active', subscriptionEnd: '2027-01-01T00:00:00.000Z' });
    for (const role of ['Accountant', 'Admin', 'OtherAccountant', 'Viewer', 'Sales', 'Cashier', 'ForgedOwner']) tx.set(`${root}/members/${role}`, { uid: role, org_id: org.id, role: role === 'OtherAccountant' ? 'Accountant' : role === 'ForgedOwner' ? 'Owner' : role, status: 'active' });
  });
  const server: Store = { authority: 'server', transaction: work => store.transaction(work) };
  const lookup = async (uid: string) => { lookups.push(uid); return accounts.get(uid); };
  const verifySecurity = async () => verifyAccountingRulesSource([{ content: readFileSync('firestore.rules', 'utf8') }]);
  const service = new ScheduledExportManagement(server, lookup, undefined, now, verifySecurity);
  const actor = (uid = owner.uid): Actor => ({ ...owner, uid });
  const create = (operationId = 'schedule-create', uid = owner.uid, input = scheduleInput()) => service.create(org.id, actor(uid), { operationId, input });
  const update = (id: string, revision: number, updates: Document, operationId = 'schedule-update', uid = owner.uid) => service.update(org.id, actor(uid), id, { operationId, expected_revision: revision, updates });
  const mutate = (path: string, updates: Document) => store.transaction(async tx => tx.set(path, { ...await tx.get(path), ...updates }));
  return { store, server, service, owner, org, root, actor, accounts, lookups, lookup, verifySecurity, now, create, update, mutate, setNow: (value: string) => { clock = new Date(value); }, operations: new Operations(server, now, undefined, async () => {}, false) };
}
