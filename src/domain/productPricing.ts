import BigNumber from 'bignumber.js';
import type { Currency, CurrencyRates, Invoice, InvoiceItem, Product } from '../types';
import { applyRounding, validateExchangeRate } from '../lib/currency';
import { currencyDecimals, isSupportedCurrency } from '../lib/currencyCatalog';
import { validateCostState } from './inventoryCost';
import { ensure, money } from './validation';

export type ProductPricingMode = NonNullable<Product['pricing_mode']>;
type PricingProduct = Pick<Product, 'price_usd' | 'price_sdg' | 'pricing_mode' | 'pricing_reference_usd' | 'pricing_markup_percent'> & Partial<Product>;

// Existing, explicitly recorded USD prices are valid references. Never invent an
// original USD purchase cost by dividing an SDG-only balance by today's FX.
export function productPricingMode(product: PricingProduct): ProductPricingMode {
  return product.pricing_mode ?? (product.pricing_reference_usd !== undefined || product.price_usd > 0 ? 'usd_reference' : 'manual');
}

export function validateProductPricing(product: PricingProduct) {
  ensure(product.pricing_mode === undefined || ['usd_reference', 'usd_cost_plus', 'manual'].includes(product.pricing_mode), 'طريقة التسعير غير صالحة.');
  if (product.pricing_reference_usd !== undefined) money(product.pricing_reference_usd, 8);
  if (product.pricing_markup_percent !== undefined) { money(product.pricing_markup_percent, 4); ensure(product.pricing_markup_percent <= 10000, 'نسبة الربح تتجاوز الحد المسموح.'); }
  if (productPricingMode(product) === 'usd_reference') ensure((product.pricing_reference_usd ?? product.price_usd) > 0 || product.price_sdg === 0, 'حدد مرجع سعر البيع بالدولار؛ لا يكفي سعر جنيه بدون مرجع موثق.');
  if (productPricingMode(product) === 'usd_cost_plus') ensure(product.track_inventory === true, 'التسعير فوق التكلفة يتطلب منتج مخزون متتبعاً.');
}

export function productPriceQuote(product: PricingProduct, currency: Currency, rate: number, rates?: CurrencyRates, rounding: 'round' | 'ceil' | 'floor' = 'round') {
  validateProductPricing(product); ensure(isSupportedCurrency(currency), 'عملة التسعير غير صالحة.');
  const mode = productPricingMode(product);
  ensure(mode !== 'manual', 'هذا المنتج بسعر يدوي؛ حدد مرجع الدولار في إعدادات المنتج.');
  ensure(validateExchangeRate(rate).isValid, 'التسعير بمرجع الدولار يتطلب سعر صرف موجباً.');
  let reference = new BigNumber(product.pricing_reference_usd ?? product.price_usd);
  let usdCost: number | undefined, historicalCostSdg: number | undefined;
  if (mode === 'usd_cost_plus') {
    const state = validateCostState(product as Product);
    ensure(state.stock_quantity > 0, 'استلم مخزوناً بتكلفة دولار موثقة قبل التسعير فوق التكلفة.');
    ensure(state.inventory_value_usd > 0 || state.inventory_value_sdg === 0, 'تكلفة الدولار غير موثقة؛ أثبت سعر صرف الشراء الأصلي، ولا تستخدم سعر اليوم لتقدير تكلفة قديمة.');
    usdCost = state.average_cost_usd; historicalCostSdg = state.average_cost_sdg;
    reference = new BigNumber(usdCost).times(new BigNumber(product.pricing_markup_percent ?? 0).div(100).plus(1));
  }
  // More precise than USD cents, so an SDG input does not lose its FX anchor.
  const referenceUsd = reference.decimalPlaces(8, BigNumber.ROUND_HALF_UP).toNumber();
  money(referenceUsd, 8);
  const currencyRate = currency === 'USD' ? 1 : currency === 'SDG' ? rate : rates?.[currency];
  ensure(validateExchangeRate(currencyRate).isValid, 'حدد سعر عملة التسعير لكل دولار.');
  const unitPrice = applyRounding(new BigNumber(referenceUsd).times(currencyRate!), currencyDecimals(currency), rounding);
  money(unitPrice, currencyDecimals(currency));
  ensure(referenceUsd === 0 || unitPrice > 0, 'السعر المرجعي أقل من دقة عملة الفاتورة؛ راجع الوحدة والسعر.');
  const evidence: NonNullable<InvoiceItem['price_reference']> = { version: 1, mode, reference_usd: referenceUsd, exchange_rate_used: rate, currency_rate_per_usd: currencyRate!, rounding_rule: rounding };
  const currentCostSdg = usdCost === undefined ? undefined : applyRounding(new BigNumber(usdCost).times(rate), 0, rounding);
  const fxCostDifferenceSdg = historicalCostSdg === undefined ? undefined : new BigNumber(currentCostSdg!).minus(historicalCostSdg).decimalPlaces(0, BigNumber.ROUND_HALF_UP).toNumber();
  return { unit_price: unitPrice, evidence, usd_cost: usdCost, current_cost_sdg: currentCostSdg, fx_cost_difference_sdg: fxCostDifferenceSdg };
}

// Used by UI previews and the authoritative invoice transaction. Explicit manual
// prices remain possible; callers must mark them rather than retain an auto tag.
export function quoteCatalogItem(item: InvoiceItem, product: Product, rate: number, rates?: CurrencyRates, rounding: 'round' | 'ceil' | 'floor' = 'round'): InvoiceItem {
  const quote = productPriceQuote(product, item.currency, rate, rates, rounding);
  return { ...item, unit_price: quote.unit_price, price_source: 'catalog_usd', price_reference: quote.evidence };
}

export function assertUsdCostRate(product: PricingProduct, input: { cost_currency?: string; unit_cost?: number; exchange_rate_used?: number; unit_cost_sdg?: number; unit_cost_usd?: number }) {
  if (productPricingMode(product) === 'usd_cost_plus' && product.cost_status === 'valued') ensure(!product.inventory_value_sdg || !!product.inventory_value_usd, 'المخزون القديم بلا تكلفة دولار موثقة؛ راجع مصدره قبل خلطه باستلام جديد، أو استخدم مرجع بيع بالدولار مستقلاً.');
  if (productPricingMode(product) === 'usd_cost_plus' && !input.cost_currency && (input.unit_cost_sdg ?? 0) > 0) ensure((input.unit_cost_usd ?? 0) > 0, 'حدد تكلفة الدولار المرجعية الموثقة أو سعر صرف الشراء الأصلي.');
  if (productPricingMode(product) === 'usd_cost_plus' && input.cost_currency === 'SDG' && (input.unit_cost ?? 0) > 0) {
    ensure(validateExchangeRate(input.exchange_rate_used).isValid, 'سجل سعر صرف الشراء الأصلي لحفظ تكلفة الدولار المرجعية.');
  }
}

export function validateInvoicePriceReferences(invoice: Pick<Invoice, 'items' | 'exchange_rate_used' | 'currency_rates_used'>) {
  for (const item of invoice.items) {
    ensure(item.price_source === undefined || ['catalog_usd', 'manual'].includes(item.price_source), 'مصدر سعر البند غير صالح.');
    if (item.price_source !== 'catalog_usd') { ensure(item.price_reference === undefined, 'مرجع دولار مرتبط ببند يدوي.'); continue; }
    const ref = item.price_reference;
    ensure(item.product_id && ref && typeof ref === 'object' && !Array.isArray(ref) && ref.version === 1 && ['usd_reference','usd_cost_plus'].includes(ref.mode), 'مرجع دولار الفاتورة ناقص أو غير صالح.');
    ensure(['round', 'ceil', 'floor'].includes(ref.rounding_rule), 'تقريب مرجع الدولار غير صالح.');
    money(ref.reference_usd, 8); money(ref.exchange_rate_used, 8, true); money(ref.currency_rate_per_usd, 8, true);
    const currencyRate = item.currency === 'USD' ? 1 : item.currency === 'SDG' ? invoice.exchange_rate_used : invoice.currency_rates_used?.[item.currency];
    ensure(ref.exchange_rate_used === invoice.exchange_rate_used && ref.currency_rate_per_usd === currencyRate, 'مرجع الدولار لا يطابق سعر صرف الفاتورة المحفوظ.');
    ensure(item.unit_price === applyRounding(new BigNumber(ref.reference_usd).times(currencyRate!), currencyDecimals(item.currency), ref.rounding_rule), 'سعر البند لا يطابق مرجع الدولار المحفوظ.');
  }
}
