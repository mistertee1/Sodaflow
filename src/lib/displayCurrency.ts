import BigNumber from 'bignumber.js';
import type { Currency, MerchantSettings } from '../types';
import { applyRounding, formatMoney, validateExchangeRate } from './currency';
import { currencyDecimals, isSupportedCurrency } from './currencyCatalog';

type Settings = Partial<MerchantSettings>;
export function displayQuote(settings: Settings) {
  const quote = settings.display_currency;
  if (!quote || !isSupportedCurrency(quote.currency) || !validateExchangeRate(quote.units_per_usd).isValid || !validateExchangeRate(quote.sdg_per_usd).isValid || quote.currency === 'USD' && quote.units_per_usd !== 1 || quote.currency === 'SDG' && quote.units_per_usd !== quote.sdg_per_usd) return undefined;
  return quote;
}
/** Project once at the presentation boundary. Never use this in posting or document pricing. */
export function displayAmount(value: number | null | undefined, source: Currency | string, settings: Settings): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value) || !isSupportedCurrency(source)) return undefined;
  const quote = displayQuote(settings);
  if (!quote) return value;
  const units = source === 'USD' ? 1 : source === 'SDG' ? quote.sdg_per_usd : source === quote.currency ? quote.units_per_usd : settings.currency_rates?.[source];
  if (!validateExchangeRate(units).isValid) return undefined;
  const decimals = quote.currency === 'SDG' ? settings.sdg_decimals ?? 0 : quote.currency === 'USD' ? settings.usd_decimals ?? 2 : currencyDecimals(quote.currency);
  return applyRounding(new BigNumber(value).dividedBy(units!).times(quote.units_per_usd), decimals, settings.rounding_rule);
}
export function formatDisplayMoney(value: number | null | undefined, source: Currency | string, settings: Settings) {
  const quote = displayQuote(settings);
  if (!quote) return formatMoney(value, source, settings);
  const amount = displayAmount(value, source, settings);
  return amount === undefined ? `— ${quote.currency} (سعر ${source} غير محدد)` : formatMoney(amount, quote.currency, settings);
}
/** Independent books are never additive. Collapse equivalent projections, otherwise identify both. */
export function formatDisplayPair(sdg: number, usd: number, settings: Settings) {
  const quote = displayQuote(settings);
  if (!quote) return `${formatMoney(sdg, 'SDG', settings)} / ${formatMoney(usd, 'USD', settings)}`;
  const local = formatDisplayMoney(sdg, 'SDG', settings), reference = formatDisplayMoney(usd, 'USD', settings);
  return displayAmount(sdg, 'SDG', settings) === displayAmount(usd, 'USD', settings) ? local : `${local} (دفتر SDG) / ${reference} (دفتر USD)`;
}
export function displayBookLabel(source: string, settings: Settings) {
  const quote = displayQuote(settings);
  return quote ? `دفتر ${source} ← ${quote.currency}` : source;
}
export function displayQuoteDescription(settings: Settings) {
  const quote = displayQuote(settings);
  return quote ? `عرض ${quote.currency} بسعر يدوي: 1 USD = ${quote.units_per_usd} ${quote.currency}؛ 1 USD = ${quote.sdg_per_usd} SDG. الأعمدة التي تحمل اسم دفتر تعكس مصدرها بصورة مستقلة؛ لا تجمع الدفترين.` : 'الدفاتر الأصلية SDG / USD';
}
/** Keep exact original CSV columns, and append clearly identified presentation equivalents. */
export function appendDisplayColumns(headers: string[], rows: unknown[][], settings: Settings) {
  const quote = displayQuote(settings);
  if (!quote) return { headers, rows };
  const columns = headers.flatMap((header, index) => {
    const source = header.match(/(?:\b|_)(SDG|USD)$/i)?.[1].toUpperCase();
    return source ? [{ header, index, source }] : [];
  });
  return {
    headers: [...headers, ...columns.map(column => `عرض ${quote.currency}: ${column.header}`)],
    rows: rows.map(row => [...row, ...columns.map(column => formatDisplayMoney(typeof row[column.index] === 'number' ? row[column.index] as number : undefined, column.source, settings))]),
  };
}
