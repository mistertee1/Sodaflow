import { MemoryStore, type Store } from '../../src/domain/store';
import { Operations, type Actor } from '../../src/domain/operations';
import { Organizations } from '../../server/organizations';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
import type { Product, InvoiceItem } from '../../src/types';
import { quoteCatalogItem } from '../../src/domain/productPricing';
export async function usdPricingFixture(store: Store = new MemoryStore(), suffix = 'memory', verifyCostingSecurity?: ConstructorParameters<typeof Operations>[3]) {
  const clock = new Date('2026-10-23T15:00:00Z');
  const owner: Actor = { uid: `usd-pricing-${suffix}`, email: 'usd-pricing@example.test', emailVerified: true, authTime: Math.floor(clock.getTime()/1000)-30 };
  const org = await new Organizations(store).create(owner, 'اختبار مرجع الدولار', INITIAL_SETTINGS, `setup-${suffix}`, true), root = `organizations/${org.id}`;
  const ops = new Operations(store, () => clock, undefined, verifyCostingSecurity, false);
  const run = (action: string, data: Record<string, unknown>, operationId: string = crypto.randomUUID(), actor = owner) => ops.execute(org.id, actor, { action, data, operationId });
  const product = (await run('product.create', { name:'منتج مرجع الدولار',unit:'قطعة',price_sdg:0,price_usd:0,pricing_mode:'usd_cost_plus',pricing_markup_percent:0,tax_rate:0,is_active:true,track_inventory:true,stock_quantity:0 }, 'product')).result as Product;
  await run('product.cost.establish', { id:product.id,cost_currency:'SDG',unit_cost:0,exchange_rate_used:2000,reason:'تأكيد المخزون الفارغ اصطناعياً' }, 'basis');
  await run('accounting.activate', { reason:'مطابقة اصطناعية' }, 'activate');
  const supplier = (await run('supplier.create', { name:'مورد اصطناعي',default_currency:'SDG',payment_terms_days:30 }, 'supplier')).result;
  const customer = (await run('customer.create', { name:'عميل اصطناعي',phone:'',preferred_currency:'SDG' }, 'customer')).result;
  const purchase = (reference = 'USD-1', quantity = 10, unitCost = 1000, rate = 2000) => run('purchase.create', { supplier_id:supplier.id,supplier_reference:reference,issue_date:'2026-10-23',currency:'SDG',exchange_rate_used:rate,settlement:'credit',reason:'فاتورة شراء اصطناعية موثقة',items:[{product_id:product.id,quantity,unit_cost:unitCost}] });
  const snapshot = () => ops.snapshot(org.id, owner, true);
  const currentProduct = async () => (await snapshot()).collections.products[0] as Product;
  const line = async (rate = 3000, currency: InvoiceItem['currency'] = 'SDG', rates?: Parameters<typeof quoteCatalogItem>[3]) => quoteCatalogItem({ id:'draft-1',product_id:product.id,description:product.name,unit:'قطعة',quantity:1,unit_price:0,currency,tax_rate:0,discount_percent:0,line_total:0 }, await currentProduct(), rate, rates);
  const invoice = (items: InvoiceItem[], rate = 3000, extras: Record<string,unknown> = {}) => ({ customer_id:customer.id,issue_date:'2026-10-23',currency_mode:items.every(i=>i.currency==='USD')?'single_usd':items.some(i=>!['SDG','USD'].includes(i.currency))?'single_foreign':'dual',exchange_rate_used:rate,discount_type:'fixed',discount_value:0,items,...extras });
  return { store, org, root, owner, ops, run, product, customer, supplier, purchase, snapshot, currentProduct, line, invoice };
}
