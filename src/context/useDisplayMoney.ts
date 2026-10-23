import { useApp } from './AppContext';
import type { MerchantSettings } from '../types';
import { formatMoney as nativeMoney } from '../lib/currency';
import { displayAmount, displayBookLabel, displayQuote, displayQuoteDescription, formatDisplayMoney, formatDisplayPair } from '../lib/displayCurrency';

export function useDisplayMoney(override?: Partial<MerchantSettings>) {
  const app = useApp();
  const settings = override || app.settings;
  const quote = displayQuote(settings);
  return {
    quote, enabled: !!quote, code: quote?.currency || 'SDG',
    formatMoney: (value: number | undefined | null, source: string, sourceSettings?: Partial<MerchantSettings>) => formatDisplayMoney(value, source, { ...settings, ...sourceSettings, display_currency: settings.display_currency }),
    nativeMoney: (value: number | undefined | null, source: string, sourceSettings?: Partial<MerchantSettings>) => nativeMoney(value, source, { ...settings, ...sourceSettings }),
    pair: (sdg: number, usd: number) => formatDisplayPair(sdg, usd, settings),
    amount: (value: number, source: string) => displayAmount(value, source, settings),
    bookLabel: (source: string) => displayBookLabel(source, settings),
    description: displayQuoteDescription(settings),
  };
}
