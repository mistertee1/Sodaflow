import type { Currency, MerchantSettings } from '../types';

// ISO 4217 minor units; calling codes follow the ITU national numbering plans.
export const CURRENCIES = [
  { code: 'SDG', name: 'جنيه سوداني', symbol: 'ج.س', decimals: 0, dialCode: '249', example: '0912345678', nationalLength: 9 },
  { code: 'USD', name: 'دولار أمريكي', symbol: '$', decimals: 2, dialCode: '', example: '', nationalLength: 0 },
  { code: 'SAR', name: 'ريال سعودي', symbol: 'ر.س', decimals: 2, dialCode: '966', example: '0501234567', nationalLength: 9 },
  { code: 'AED', name: 'درهم إماراتي', symbol: 'د.إ', decimals: 2, dialCode: '971', example: '0501234567', nationalLength: 9 },
  { code: 'KWD', name: 'دينار كويتي', symbol: 'د.ك', decimals: 3, dialCode: '965', example: '50012345', nationalLength: 8 },
  { code: 'QAR', name: 'ريال قطري', symbol: 'ر.ق', decimals: 2, dialCode: '974', example: '33123456', nationalLength: 8 },
  { code: 'BHD', name: 'دينار بحريني', symbol: 'د.ب', decimals: 3, dialCode: '973', example: '36012345', nationalLength: 8 },
  { code: 'OMR', name: 'ريال عماني', symbol: 'ر.ع', decimals: 3, dialCode: '968', example: '92123456', nationalLength: 8 },
  { code: 'EGP', name: 'جنيه مصري', symbol: 'ج.م', decimals: 2, dialCode: '20', example: '01012345678', nationalLength: 10 },
  { code: 'EUR', name: 'يورو', symbol: '€', decimals: 2, dialCode: '', example: '', nationalLength: 0 },
  { code: 'GBP', name: 'جنيه إسترليني', symbol: '£', decimals: 2, dialCode: '44', example: '07700900123', nationalLength: 10 },
] as const;

export const currencyInfo = (code: string) => CURRENCIES.find(row => row.code === code);
export const isSupportedCurrency = (code: unknown): code is Currency => typeof code === 'string' && !!currencyInfo(code);
export const isForeignCurrency = (code: unknown): code is Currency => isSupportedCurrency(code) && code !== 'SDG' && code !== 'USD';
export const currencyDecimals = (code: string) => currencyInfo(code)?.decimals ?? 2;
export const currencyLabel = (code: string) => { const row = currencyInfo(code); return row ? `${row.name} (${row.code})` : code; };
export const transactionCurrency = (settings: Partial<MerchantSettings>) => settings.default_transaction_currency || 'SDG';
export const phoneRegion = (currency?: string, fallback: string = 'SDG') => currencyInfo(currency || '')?.dialCode ? currencyInfo(currency!)! : currencyInfo(fallback)?.dialCode ? currencyInfo(fallback)! : CURRENCIES[0];

function latinDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) - (char <= '٩' ? 0x660 : 0x6f0)));
}

/** International numbers are never assigned a different country when currency changes. */
export function normalizeWhatsAppPhone(value: string | undefined, currency: string = 'SDG', fallback: string = 'SDG'): string {
  const raw = latinDigits(value || '').trim();
  if (!raw) return '';
  // Reject extensions/letters/URLs rather than sending a message to a truncated number.
  if (!/^[+\d\s().\-\u200e\u200f]+$/.test(raw)) return '';
  const compact = raw.replace(/[\s().\-\u200e\u200f]/g, '');
  if (!/^\+?\d+$/.test(compact)) return '';
  let digits = compact.replace(/^\+/, '');
  const explicit = compact.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!explicit) {
    const known = CURRENCIES.some(row => row.dialCode && digits.startsWith(row.dialCode) && digits.length === row.dialCode.length + row.nationalLength);
    if (!known) {
      const region = phoneRegion(currency, fallback);
      const local = digits.replace(/^0/, '');
      if (local.length !== region.nationalLength) return '';
      digits = region.dialCode + local;
    }
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

export function whatsAppUrl(phone: string | undefined, text: string, currency = 'SDG', fallback = 'SDG') {
  const normalized = normalizeWhatsAppPhone(phone, currency, fallback);
  const query = new URLSearchParams({ ...(normalized ? { phone: normalized } : {}), text });
  return `https://api.whatsapp.com/send?${query}`;
}
