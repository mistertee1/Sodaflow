import test from 'node:test';
import assert from 'node:assert/strict';
import BigNumber from 'bignumber.js';
import type {Account} from '../src/types';
import {configuredTaxQuote, validateTaxConfiguration, type TaxConfiguration, type TaxQuoteInput, type TaxSnapshot} from '../src/domain/taxConfiguration';
const org = 'tax-org';
const account = (code: string, type: Account['type'], nature: Account['nature'], reporting_group: Account['reporting_group']): Account => ({code, type, nature, reporting_group, org_id: org, name_ar: code, name_en: code, is_active: true, is_system: false, balance_sdg: 0, balance_usd: 0});
const rule: TaxConfiguration = {schema_version: 1, id: 'sales-tax', org_id: org, revision: 1, name: 'ضريبة اختبار قابلة للتخصيص', jurisdiction: 'إعداد المؤسسة للاختبار', direction: 'sales', rate: 15, calculation: 'exclusive', rounding: 'half_up', recoverable: false, tax_account_code: '2130', effective_from: '2026-01-01', effective_to: '2026-12-31', active: true};
const snapshot: TaxSnapshot = {org_id: org, configurations: [rule], accounts: [account('2130', 'LIABILITY', 'CREDIT', 'tax_payable'), account('1350', 'ASSET', 'DEBIT', 'other_assets')]};
const input: TaxQuoteInput = {configuration_id: rule.id, expected_configuration_revision: 1, date: '2026-10-11', direction: 'sales', amount: 1000, currency: 'SDG', currency_policy: 'dual', exchange_rate_used: 2000};

test('C5.1 exclusive sale derives tax/account from configuration and preserves native/dual-book totals', () => {
  const q = configuredTaxQuote(input, snapshot); assert.deepEqual(q.native, {base: 1000, tax: 150, total: 1150});
  assert.deepEqual(q.sdg, q.native); assert.deepEqual(q.usd, {base: .5, tax: .08, total: .58}); assert.equal(q.tax_treatment, 'payable'); assert.equal(q.tax_account_code, '2130'); assert.deepEqual(q.configuration, rule);
});
test('C5.1 inclusive USD sale extracts tax instead of charging it a second time', () => {
  const q = configuredTaxQuote({...input, amount: 1.05, currency: 'USD'}, {...snapshot, configurations: [{...rule, rate: 5, calculation: 'inclusive'}]});
  assert.deepEqual(q.native, {base: 1, tax: .05, total: 1.05}); assert.deepEqual(q.usd, q.native); assert.deepEqual(q.sdg, {base: 2000, tax: 100, total: 2100});
});
test('C5.1 configured native rounding differentiates half-up, half-even and floor', () => {
  for (const [rounding, tax] of [['half_up', .01], ['half_even', 0], ['floor', 0]] as const) {
    const q = configuredTaxQuote({...input, amount: .05, currency: 'USD'}, {...snapshot, configurations: [{...rule, rate: 10, rounding}]}); assert.equal(q.native.tax, tax); assert.equal(q.native.base, .05);
  }
});
test('C5.1 purchase recovery uses a separate asset while nonrecoverable tax is part of cost', () => {
  const purchase: TaxConfiguration = {...rule, id: 'purchase-tax', direction: 'purchases', recoverable: true, tax_account_code: '1350'};
  const i: TaxQuoteInput = {...input, configuration_id: purchase.id, direction: 'purchases'};
  const recoverable = configuredTaxQuote(i, {...snapshot, configurations: [purchase]}); assert.equal(recoverable.tax_treatment, 'receivable'); assert.equal(recoverable.tax_account_code, '1350'); assert.equal(recoverable.native.tax, 150);
  const cost = configuredTaxQuote(i, {...snapshot, configurations: [{...purchase, recoverable: false, tax_account_code: null}]}); assert.equal(cost.tax_treatment, 'cost'); assert.equal(cost.tax_account_code, null); assert.deepEqual(cost.native, recoverable.native);
});
test('C5.1 zero-rate and zero-base quotes are explicit, finite and never invent journal entries', () => {
  for (const patch of [{amount: 0}, {}]) {const q = configuredTaxQuote({...input, ...patch}, {...snapshot, configurations: [{...rule, rate: 0}]}); assert.equal(q.native.tax, 0); assert.equal(q.native.total, patch.amount ?? input.amount); assert.equal('journal_entries' in q, false);}
});
test('C5.1 conversion assigns only the documented base remainder and keeps each reporting book balanced', () => {
  const q = configuredTaxQuote({...input, amount: 1, currency: 'USD', exchange_rate_used: 1.5}, {...snapshot, configurations: [{...rule, rate: 50, calculation: 'inclusive'}]});
  assert.deepEqual(q.native, {base: .67, tax: .33, total: 1}); assert.deepEqual(q.sdg, {base: 2, tax: 0, total: 2}); assert.equal(q.conversion_base_adjustment_sdg, 1); assert.equal(q.conversion_base_adjustment_usd, 0);
  const sdg = configuredTaxQuote({...input, currency_policy: 'sdg_only', exchange_rate_used: undefined}, snapshot); assert.deepEqual(sdg.usd, {base: 0, tax: 0, total: 0}); assert.equal(sdg.exchange_rate_used, 0);
});
test('C5.1 rejects missing/forged FX and incompatible native currency policies', () => {
  for (const patch of [{exchange_rate_used: undefined}, {exchange_rate_used: 0}, {exchange_rate_used: NaN}, {exchange_rate_used: Infinity}, {exchange_rate_used: .000000001}, {currency_policy: 'sdg_only', currency: 'USD'}, {currency_policy: 'sdg_only', exchange_rate_used: 1}, {currency: 'EUR'}]) assert.throws(() => configuredTaxQuote({...input, ...patch} as TaxQuoteInput, snapshot));
});
test('C5.1 config expiry/revision/direction/activation are enforced at quote time', () => {
  for (const patch of [{date: '2025-12-31'}, {date: '2027-01-01'}, {date: '2026-10-11T12:00:00Z'}, {expected_configuration_revision: 2}, {expected_configuration_revision: 1.5}, {direction: 'purchases'}]) assert.throws(() => configuredTaxQuote({...input, ...patch} as TaxQuoteInput, snapshot));
  assert.throws(() => configuredTaxQuote(input, {...snapshot, configurations: [{...rule, active: false}]}));
  assert.equal(configuredTaxQuote({...input, date: rule.effective_from}, snapshot).date, rule.effective_from); assert.equal(configuredTaxQuote({...input, date: rule.effective_to!}, snapshot).date, rule.effective_to);
});
test('C5.1 malformed policy fields, dates, unsupported versions and invented legal assumptions are refused', () => {
  for (const patch of [{id: '../tax'}, {org_id: 'foreign'}, {schema_version: 2}, {revision: 0}, {revision: NaN}, {name: ' '}, {jurisdiction: ' '}, {rate: -1}, {rate: 101}, {rate: .00001}, {rate: Infinity}, {active: 'true'}, {recoverable: true}, {tax_account_code: null}, {calculation: 'compound'}, {rounding: 'bank-default'}, {effective_from: '2026-02-30'}, {effective_to: '2025-12-31'}, {country_rate: 15}]) assert.throws(() => validateTaxConfiguration({...rule, ...patch} as TaxConfiguration, org));
});
test('C5.1 source tenant/config/account duplicates and invalid inactive tax controls fail closed', () => {
  for (const mutate of [
    (s: TaxSnapshot) => s.configurations.push({...rule, revision: 2}),
    (s: TaxSnapshot) => s.configurations[0].org_id = 'foreign',
    (s: TaxSnapshot) => s.accounts.push({...s.accounts[0]}),
    (s: TaxSnapshot) => s.accounts[0].org_id = 'foreign',
    (s: TaxSnapshot) => s.accounts[0].is_active = false,
    (s: TaxSnapshot) => s.accounts[0].nature = 'DEBIT',
    (s: TaxSnapshot) => s.accounts[0].reporting_group = 'payables',
    (s: TaxSnapshot) => s.accounts.shift(),
  ]) {const s = structuredClone(snapshot); mutate(s); assert.throws(() => configuredTaxQuote(input, s));}
  const s = structuredClone(snapshot); s.configurations[0] = {...rule, direction: 'purchases', recoverable: true, tax_account_code: '1350'}; s.accounts[1].reporting_group = 'cash_bank';
  assert.throws(() => configuredTaxQuote({...input, direction: 'purchases'}, s));
});
test('C5.1 quote rejects invented tax/balances/precision and bounded-total overflow', () => {
  for (const patch of [{tax_amount: 1}, {tax_rate: 1}, {balance_sdg: 1}, {amount: -1}, {amount: .1}, {amount: Infinity}, {amount: '1000'}, {amount: 1e14}, {currency: 'USD', amount: .001}]) assert.throws(() => configuredTaxQuote({...input, ...patch} as TaxQuoteInput, snapshot));
});
test('C5.1 quote is pure and has deterministic copied evidence with independent configuration ownership', () => {
  const before = structuredClone(snapshot), q = configuredTaxQuote(input, snapshot); assert.deepEqual(snapshot, before); assert.deepEqual(configuredTaxQuote(input, snapshot), q);
  q.configuration.rate = 80; assert.equal(snapshot.configurations[0].rate, 15); assert.equal(configuredTaxQuote(input, snapshot).native.tax, 150);
});
test('C5.1 amount conservation holds for inclusive/exclusive rates in both currencies and rounding modes', () => {
  for (const calculation of ['inclusive','exclusive'] as const) for (const currency of ['SDG','USD'] as const) for (const rate of [0,5,15,33.3333,100]) for (const amount of [0,1,3,99,1000]) {
    const q = configuredTaxQuote({...input, currency, amount, exchange_rate_used: 3333.3333}, {...snapshot, configurations: [{...rule, rate, calculation}]});
    for (const book of [q.native, q.sdg, q.usd]) {assert.equal(new BigNumber(book.base).plus(book.tax).toNumber(), book.total); assert.ok(book.base >= 0 && book.tax >= 0);}
    assert.equal(calculation === 'inclusive' ? q.native.total : q.native.base, amount);
  }
});
