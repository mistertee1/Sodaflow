import { MemoryStore } from '../../../src/domain/store';
import { Operations } from '../../../src/domain/operations';
import { INITIAL_SETTINGS } from '../../../src/data/initialData';
import { getDefaultChartOfAccounts } from '../../../src/services/accountingService';
import { getPlanConfig, createDefaultSubscription } from '../../../src/lib/plans';
import { DEFAULT_ORGANIZATION_COUNTERS } from '../../../src/types';
import { guestId, guestActor } from '../../../src/services/guestStore';

export async function correctionGuestFixture() {
  const root = `organizations/${guestId}`, settings = { ...INITIAL_SETTINGS, business_name: 'متجر الاختبار', default_exchange_rate: 2000 };
  const store = new MemoryStore({ [root]: { id: guestId, owner_uid: 'guest', name: 'متجر الاختبار', status: 'active', settings, schema_version: 3 },
    [`${root}/members/guest`]: { uid: 'guest', role: 'Owner', status: 'active' },
    [`${root}/meta/subscription`]: { ...createDefaultSubscription(guestId), ...getPlanConfig('Enterprise'), plan: 'Enterprise', org_id: guestId },
    [`${root}/meta/counters`]: DEFAULT_ORGANIZATION_COUNTERS,
    ...Object.fromEntries(getDefaultChartOfAccounts(guestId).map(account => [`${root}/accounts/${account.code}`, account])),
  });
  const ops = new Operations(store, () => new Date('2026-10-07T12:00:00Z'));
  const run = (action: string, data: Record<string, unknown>, operationId: string) => ops.execute(guestId, guestActor, { action, data, operationId });
  const customer = (await run('customer.create', { name: 'عميل الاختبار', phone: '', preferred_currency: 'USD' }, 'customer')).result;
  const product = (await run('product.create', { name: 'منتج الاختبار', unit: 'قطعة', price_sdg: 200000, price_usd: 100, is_active: true, track_inventory: true, stock_quantity: 10 }, 'product')).result;
  await run('product.cost.establish', { id: product.id, cost_currency: 'USD', unit_cost: 2, exchange_rate_used: 2000, reason: 'رصيد افتتاحي' }, 'cost'); await run('accounting.activate', { reason: 'مطابقة' }, 'activate');
  const item = { product_id: product.id, description: 'منتج الاختبار', unit: 'قطعة', quantity: 1, unit_price: 100, currency: 'USD', tax_rate: 0, discount_percent: 0 };
  const invoice = (await run('invoice.create', { customer_id: customer.id, issue_date: '2026-10-07', currency_mode: 'single_usd', exchange_rate_used: 2000, discount_type: 'fixed', discount_value: 0, items: [item, { ...item, quantity: 2 }] }, 'sale')).result;
  await run('payment.create', { invoice_id: invoice.id, amount: 300, currency: 'USD', exchange_rate_used: 2000, payment_method: 'cash' }, 'pay');
  const cash = (await run('financialAccount.create', { name: 'صندوق دولار', account_code: '1120', currency: 'USD', kind: 'cash' }, 'cash')).result;
  return { records: store.dump(), invoiceNumber: invoice.invoice_number as string, cashId: cash.id as string };
}
