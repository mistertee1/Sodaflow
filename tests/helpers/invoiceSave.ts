import assert from 'node:assert/strict';
import { catalogFixture } from './catalog';
import type { Store } from '../../src/domain/store';
import type { Product } from '../../src/types';
import { quoteCatalogItem } from '../../src/domain/productPricing';
import { reconcileFinancialData, type FinancialData } from '../../src/domain/reconciliation';

// Synthetic version of the reported invoice: USD reference 1000, FX 10200,
// quantity 1 and stock 50. Never connect this fixture to a production project.
export async function invoiceSaveFixture(store?: Store, suffix = 'memory') {
  const f = await catalogFixture(store, `invoice-save-${suffix}`);
  await f.run('settings.update', { updates: { default_exchange_rate: 10200 } });
  const customer = (await f.run('customer.create', { name: 'عميل حفظ اصطناعي', phone: '', preferred_currency: 'SDG' }, 'customer')).result;
  const product = (await f.run('product.create', { name: 'منتج حفظ اصطناعي', unit: 'قطعة', price_sdg: 10200000, price_usd: 1000, pricing_mode: 'usd_reference', pricing_reference_usd: 1000, tax_rate: 0, is_active: true, track_inventory: true, stock_quantity: 50 }, 'product')).result;
  const input = (quantity = 1) => ({ customer_id: customer.id, issue_date: '2026-10-23', due_date: '2026-10-30', currency_mode: 'dual', exchange_rate_used: 10200, discount_type: 'fixed', discount_value: 0,
    items: [quoteCatalogItem({ id: 'one', product_id: product.id, description: product.name, quantity, unit: 'قطعة', unit_price: 0, currency: 'SDG', tax_rate: 0, discount_percent: 0, line_total: 0 }, product as Product, 10200, {})] });
  return { ...f, customer, product, input };
}

export async function assertSavedInvoice(f: Awaited<ReturnType<typeof invoiceSaveFixture>>, id: string) {
  const snapshot = await f.snapshot(), invoice = snapshot.collections.invoices.find(row => row.id === id)!;
  assert.ok(invoice);
  assert.equal(invoice.grand_total_sdg, 10200000);
  assert.equal(invoice.grand_total_usd, 1000);
  assert.equal(invoice.items[0].price_reference.reference_usd, 1000);
  assert.equal(snapshot.collections.products.find(row => row.id === f.product.id)!.stock_quantity, 49);
  assert.equal(snapshot.collections.customers.find(row => row.id === f.customer.id)!.balance_sdg, 10200000);
  assert.equal(snapshot.collections.customers.find(row => row.id === f.customer.id)!.balance_usd, 1000);
  assert.equal(snapshot.collections.invoices.length, 1);
  assert.equal(snapshot.collections.journal_entries.filter(row => row.reference_id === id).length, 1);
  assert.equal(snapshot.collections.inventory_movements.filter(row => row.type === 'SALE' && row.reference_id === id).length, 1);
  assert.equal(snapshot.counters.invoice_count, 1);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData, snapshot.settings), []);
  return { snapshot, invoice };
}
