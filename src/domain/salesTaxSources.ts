import BigNumber from 'bignumber.js';
import type {Invoice, MerchantSettings} from '../types';
import {clean} from './store';
import {invoiceFinancials} from './financial';
import {configuredTaxQuote, type TaxConfiguration, type TaxSnapshot} from './taxConfiguration';
import {dateOnly, ensure, identifier} from './validation';

export interface SalesTaxSourceInput {configuration_id:string;expected_configuration_revision:number;issue_date:string;currency_mode:Invoice['currency_mode'];exchange_rate_used:number;discount_type:Invoice['discount_type'];discount_value:number;items:Invoice['items'];}

/** Derives immutable tax evidence from the server-validated sale lines used by invoice posting. */
export function salesTaxSourceQuote(input:SalesTaxSourceInput,snapshot:TaxSnapshot,settings:MerchantSettings){
  const id=identifier(input.configuration_id),date=dateOnly(input.issue_date);
  ensure(date===input.issue_date&&Number.isSafeInteger(input.expected_configuration_revision)&&input.expected_configuration_revision>0,'مرجع إعداد ضريبة المبيعات غير صالح.');
  ensure(Array.isArray(input.items)&&input.items.length>0&&input.items.every(item=>!item.tax_rate),'ضريبة المبيعات مشتقة من الإعداد ولا تقبل نسبة ضريبة من العميل.');
  const currencies=new Set(input.items.map(item=>item.currency));ensure(currencies.size===1,'المعاملة الضريبية الواحدة تتطلب عملة مصدر واحدة؛ افصل البنود متعددة العملات.');
  const currency=[...currencies][0] as 'SDG'|'USD';ensure(currency==='SDG'||currency==='USD','عملة مصدر الضريبة غير مدعومة.');
  const untaxed=invoiceFinancials({...input,items:input.items.map(item=>({...item,tax_rate:0}))},settings);
  const amount=currency==='USD'?new BigNumber(untaxed.subtotal_usd).minus(untaxed.discount_total_usd).toNumber():new BigNumber(untaxed.subtotal_sdg).minus(untaxed.discount_total_sdg).toNumber();
  const quote=configuredTaxQuote({configuration_id:id,expected_configuration_revision:input.expected_configuration_revision,date,direction:'sales',amount,currency,currency_policy:input.currency_mode==='single_sdg'?'sdg_only':'dual',exchange_rate_used:input.currency_mode==='single_sdg'?undefined:input.exchange_rate_used},snapshot);
  const configuration=quote.configuration as TaxConfiguration;ensure(configuration.direction==='sales'&&quote.tax_treatment==='payable'&&!!quote.tax_account_code,'إعداد ضريبة المبيعات لا ينتج التزاماً ضريبياً صالحاً.');
  return clean({schema_version:1,configuration_id:id,configuration_revision:configuration.revision,calculation:configuration.calculation,rate:configuration.rate,rounding:configuration.rounding,jurisdiction:configuration.jurisdiction,effective_on:date,source_currency:currency,exchange_rate_used:quote.exchange_rate_used,tax_account_code:quote.tax_account_code,native:quote.native,sdg:quote.sdg,usd:quote.usd,conversion_base_adjustment_sdg:quote.conversion_base_adjustment_sdg,conversion_base_adjustment_usd:quote.conversion_base_adjustment_usd});
}
