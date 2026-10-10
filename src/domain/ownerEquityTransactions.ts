import BigNumber from 'bignumber.js';
import { accountLedger } from './operationalReports';
import type { Account, JournalEntry, MerchantSettings } from '../types';
import type { Document, Transaction } from './store';
import { clean } from './store';
import { equityEvidence, verifyEquitySources } from './ownerEquitySources';
import { readOpeningFinancialData, assertOpeningFinancialData } from './openingTransactions';
import { ensure, identifier, money } from './validation';
import { openingPreviewHash } from './openingPreview';
import type { OwnerEquityInput } from './ownerEquity';
/** Reads all source records and validates an explicit overlay; no dependence on transaction read-your-writes. */
export async function ownerEquityTransaction(data:Document,c:{tx:Transaction;root:string;orgId:string;settings:MerchantSettings;actor:string;operationId:string;now:Date}) {
  const original=await readOpeningFinancialData(c.tx,c.root,c.orgId);
  await assertOpeningFinancialData(original,c.settings);verifyEquitySources(original,c.orgId);
  const cash=original.financial_accounts.find(row=>row.id===data.financial_account_id);
  ensure(cash && (await c.tx.get(`${c.root}/financial_account_mappings/${identifier(cash.account_code)}`))?.id===cash.id,'ربط النقدية يحتاج مراجعة.',409);
  const evidence=equityEvidence(data as OwnerEquityInput,{org_id:c.orgId,accounts:original.accounts as Account[],financial_accounts:original.financial_accounts,journal_entries:original.journal_entries as JournalEntry[],accounting_periods:original.accounting_periods,settings:c.settings},{operation_id:c.operationId,created_by:c.actor,created_at:c.now.toISOString(),sequence:original.owner_equity_events.length+1});
  for(const code of [evidence.event.quote.account_code,evidence.event.quote.equity_account_code]) {
    const record=original.accounts.find(row=>row.code===code);ensure(record && await openingPreviewHash(await c.tx.get(`${c.root}/accounts/${code}`))===await openingPreviewHash(record),'مسار حساب الدليل لا يطابق مصدر العملية.',409);
  }
  const ledger=accountLedger(original.accounts as Account[],original.journal_entries as JournalEntry[],{accountCode:cash.account_code},'9999-12-31'),daily=new Map<string,Document>();
  for(const row of ledger.rows)if(row.date>=data.date)daily.set(row.date,row);
  const at=accountLedger(original.accounts as Account[],original.journal_entries as JournalEntry[],{accountCode:cash.account_code,end:data.date},data.date).closing;
  for(const balance of [at,...[...daily.values()].map(row=>row.balance)])for(const [book,key] of [['sdg','SDG'],['usd','USD']] as const){const after=new BigNumber(balance[key]).plus(data.kind==='contribution'?evidence.event.quote[`amount_${book}`]:-evidence.event.quote[`amount_${book}`]);if(data.kind==='drawing')ensure(after.gte(0),'عجز النقدية بعد المسحوبات.',409);money(after.abs().toNumber(),book==='sdg'?0:2);}
  const staged=clean(original);staged.owner_equity_events.push(evidence.event);staged.journal_entries.push(evidence.entry);
  const updated={...cash,revision:(cash.revision||0)+1,last_owner_equity_event_id:evidence.event.id,updated_at:c.now.toISOString()};staged.financial_accounts=staged.financial_accounts.map(row=>row.id===cash.id?updated:row);
  await assertOpeningFinancialData(staged,c.settings);
  for(const [name,id] of [['owner_equity_events',evidence.event.id],['journal_entries',evidence.entry.id]])ensure(!await c.tx.get(`${c.root}/${name}/${id}`),'معرف المصدر أو القيد موجود مسبقاً.',409);
  ensure(await openingPreviewHash(await c.tx.get(`${c.root}/financial_accounts/${cash.id}`))===await openingPreviewHash(cash),'مسار حساب النقدية لا يطابق السجل.',409);
  return {...evidence,cash,updated};
}
