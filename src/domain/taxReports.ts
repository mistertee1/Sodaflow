import BigNumber from 'bignumber.js';
import type { JournalEntry } from '../types';
import type { TaxConfiguration } from './taxConfiguration';
import { dateOnly, ensure } from './validation';

export interface TaxReportPeriod { start?: string; end?: string; }
type Books = { sdg: number; usd: number };
export interface TaxControlLine {
  direction: 'sales' | 'purchases'; account_code: string; jurisdictions: string[]; configuration_ids: string[];
  opening: Books; debit: Books; credit: Books; movement: Books; closing: Books;
}
export interface TaxPeriodReport {
  period: { start: string | null; end: string | null };
  sales_tax: Books; purchase_tax: Books; tax_payable: Books; tax_receivable: Books; net_tax_payable: Books;
  controls: TaxControlLine[]; journal_entry_count: number;
}

const books = (sdg = 0, usd = 0): Books => ({ sdg, usd });
const add = (a: Books, b: Books): Books => ({ sdg: new BigNumber(a.sdg).plus(b.sdg).toNumber(), usd: new BigNumber(a.usd).plus(b.usd).toNumber() });
const sub = (a: Books, b: Books): Books => ({ sdg: new BigNumber(a.sdg).minus(b.sdg).toNumber(), usd: new BigNumber(a.usd).minus(b.usd).toNumber() });

/** Journal-backed tax report. Configurations identify control accounts; postings remain the accounting source of truth. */
export function taxPeriodReport(configurations: TaxConfiguration[], entries: JournalEntry[], period: TaxReportPeriod = {}): TaxPeriodReport {
  const start = period.start ? dateOnly(period.start) : null, end = period.end ? dateOnly(period.end) : null;
  ensure(!period.start || start === period.start, 'بداية فترة الضريبة غير صالحة.');
  ensure(!period.end || end === period.end, 'نهاية فترة الضريبة غير صالحة.');
  ensure(!start || !end || start <= end, 'بداية فترة الضريبة يجب ألا تتجاوز نهايتها.');
  ensure(configurations.length <= 1200 && entries.length <= 100000, 'بيانات تقرير الضريبة تتجاوز الحد الآمن.');

  const groups = new Map<string, {direction:'sales'|'purchases'; account_code:string; jurisdictions:Set<string>; configuration_ids:Set<string>}>();
  for (const configuration of configurations) {
    if (!configuration.tax_account_code) continue;
    const key = `${configuration.direction}:${configuration.tax_account_code}`;
    const group = groups.get(key) || { direction: configuration.direction, account_code: configuration.tax_account_code, jurisdictions: new Set<string>(), configuration_ids: new Set<string>() };
    group.jurisdictions.add(configuration.jurisdiction); group.configuration_ids.add(configuration.id); groups.set(key, group);
  }

  const reportEntries = new Set<string>();
  const controls = [...groups.values()].sort((a,b) => a.direction.localeCompare(b.direction) || a.account_code.localeCompare(b.account_code)).map(group => {
    let openingDebit = books(), openingCredit = books(), debit = books(), credit = books();
    for (const entry of entries) {
      const entryDate = dateOnly(entry.date); ensure(entryDate === entry.date, 'يوجد قيد بتاريخ غير صالح في تقرير الضريبة.');
      const lines = entry.lines.filter(line => line.account_code === group.account_code);
      if (!lines.length || end && entryDate > end) continue;
      if (!start || entryDate >= start) reportEntries.add(entry.id);
      for (const line of lines) {
        const d = books(line.debit_sdg || 0, line.debit_usd || 0), c = books(line.credit_sdg || 0, line.credit_usd || 0);
        if (start && entryDate < start) { openingDebit = add(openingDebit,d); openingCredit = add(openingCredit,c); }
        else { debit = add(debit,d); credit = add(credit,c); }
      }
    }
    const opening = group.direction === 'sales' ? sub(openingCredit,openingDebit) : sub(openingDebit,openingCredit);
    const movement = group.direction === 'sales' ? sub(credit,debit) : sub(debit,credit);
    return { direction:group.direction, account_code:group.account_code, jurisdictions:[...group.jurisdictions].sort(), configuration_ids:[...group.configuration_ids].sort(), opening, debit, credit, movement, closing:add(opening,movement) };
  });
  const total = (direction:'sales'|'purchases', field:'movement'|'closing') => controls.filter(row=>row.direction===direction).reduce((sum,row)=>add(sum,row[field]),books());
  const salesTax=total('sales','movement'), purchaseTax=total('purchases','movement'), payable=total('sales','closing'), receivable=total('purchases','closing');
  return { period:{start,end}, sales_tax:salesTax, purchase_tax:purchaseTax, tax_payable:payable, tax_receivable:receivable, net_tax_payable:sub(payable,receivable), controls, journal_entry_count:reportEntries.size };
}
