import { MemoryStore, type Document } from '../domain/store';
import { getDefaultChartOfAccounts } from './accountingService';
import { INITIAL_SETTINGS } from '../data/initialData';
import { createDefaultSubscription, getPlanConfig } from '../lib/plans';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../types';

export const guestId = 'local-guest-org';
// Local-only domain actor; signed-in cloud identities still require verified token claims.
export const guestActor = { uid: 'guest', email: '', emailVerified: true, name: 'ضيف' };
const storageKey = 'sudaflow_guest_transactions_v3';
export function createGuestStore() {
  const saved = localStorage.getItem(storageKey);
  if (saved) return new MemoryStore(JSON.parse(saved), data => localStorage.setItem(storageKey, JSON.stringify(data)));
  const read = (key: string, fallback: unknown) => { const raw = localStorage.getItem(`hisabuk_guest_v1_${key}`); return raw ? JSON.parse(raw) : fallback; };
  const root = `organizations/${guestId}`, now = new Date().toISOString(), settings = read('settings', INITIAL_SETTINGS) as typeof INITIAL_SETTINGS;
  const seed: Record<string, Document> = { [root]: { id: guestId, name: settings.business_name || 'تجربة سودافلو', display_name: settings.business_name || 'تجربة سودافلو', settings, owner_uid: 'guest', base_currency: 'SDG', secondary_currency: 'USD', timezone: 'Africa/Khartoum', fiscal_year: now.slice(0, 4), status: 'active', schema_version: 3, created_at: now, updated_at: now } };
  const counters = { ...DEFAULT_ORGANIZATION_COUNTERS };
  for (const [name, key] of Object.entries({ customers: 'customers', products: 'products', invoices: 'invoices', payments: 'payments', expenses: 'expenses', inventory_movements: 'movements', accounts: 'accounts', journal_entries: 'journal_entries' })) {
    const rows = read(key, name === 'accounts' ? getDefaultChartOfAccounts(guestId) : []) as Document[];
    for (const row of rows) seed[`${root}/${name}/${row.id || row.code}`] = { ...row, org_id: guestId };
    const field = ({ customers: 'customer_count', products: 'product_count', invoices: 'invoice_count', payments: 'payment_count', expenses: 'expense_count', inventory_movements: 'inventory_movement_count' } as Record<string, string>)[name];
    if (field) (counters as any)[field] = rows.length;
  }
  // Guest is a local demonstration; it never grants this tier to a signed-in organization.
  const tier = getPlanConfig('Enterprise');
  seed[`${root}/meta/subscription`] = { ...createDefaultSubscription(guestId), ...tier, plan: 'Enterprise', org_id: guestId };
  seed[`${root}/meta/counters`] = counters;
  seed[`${root}/members/guest`] = { uid: 'guest', org_id: guestId, email: '', display_name: 'ضيف', role: 'Owner', status: 'active', joined_at: now };
  return new MemoryStore(seed, data => localStorage.setItem(storageKey, JSON.stringify(data)));
}

