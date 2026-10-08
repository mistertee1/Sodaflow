import BigNumber from 'bignumber.js';
import type { Document, Transaction } from './store';
import { verifyOpeningSources, type OpeningLot } from './openingSources';
import { openingCollections } from './openingCollections';
import { ensure, identifier } from './validation';

export const openingReadCollections = ['accounts','financial_accounts','customers','suppliers','products',...openingCollections,'journal_entries','inventory_movements'] as const;
export function hasOpeningSources(data: Record<string,Document[]>) {
  return openingCollections.some(name => (data[name] || []).length > 0) || (data.journal_entries || []).some(row => ['opening_batch','opening_settlement'].includes(row.reference_type)) || (data.inventory_movements || []).some(row => row.reference_type === 'opening_batch');
}
export function openingOrganization(data: Record<string,Document[]>) {
  return identifier(data.opening_batches?.[0]?.org_id || data.opening_lots?.[0]?.org_id || data.opening_settlements?.[0]?.org_id || data.journal_entries?.find(row => ['opening_batch','opening_settlement'].includes(row.reference_type))?.org_id || data.inventory_movements?.find(row => row.reference_type === 'opening_batch')?.org_id);
}
/** No fallback to caches or counters. Legacy tenants without opening evidence need no new source collections. */
export function openingBalancesForParty(data: Record<string,Document[]>, kind: 'receivable'|'payable', partyId?: string) {
  const total = {sdg:0,usd:0};
  for(const [id,balance] of openingBalancesByParty(data,kind))if(!partyId || id===partyId)for(const book of ['sdg','usd'] as const)total[book]=new BigNumber(total[book]).plus(balance[book]).toNumber();
  return total;
}
export function openingBalancesByParty(data:Record<string,Document[]>,kind:'receivable'|'payable') {
  const parties=new Map<string,{sdg:number;usd:number}>();
  if(!hasOpeningSources(data))return parties;
  const verified=verifyOpeningSources(data,openingOrganization(data));
  for(const lot of verified.lots.filter(row=>row.kind===kind)){
    const state=verified.states.get(lot.id)!,balance=parties.get(lot.party_id)||{sdg:0,usd:0};
    for(const book of ['sdg','usd'] as const)balance[book]=new BigNumber(balance[book]).plus(state[book]).toNumber();
    parties.set(lot.party_id,balance);
  }
  return parties;
}
export async function readOpeningData(tx:Transaction, root:string) {
  return Object.fromEntries(await Promise.all(openingReadCollections.map(async name => [name,await tx.list(`${root}/${name}`)]))) as Record<string,Document[]>;
}
/** Allocate per source line: a single opening journal can carry several different parties. */
export function openingLineAllocations(data:Record<string,Document[]>, kind:'receivable'|'payable') {
  const allocations = new Map<string,OpeningLot>();
  if (!hasOpeningSources(data)) return allocations;
  const verified = verifyOpeningSources(data,openingOrganization(data));
  for (const lot of verified.lots.filter(row => row.kind === kind)) {
    allocations.set(`${lot.journal_id}:${lot.line_index}`,lot);
    for (const event of data.opening_settlements.filter(row => row.lot_id === lot.id)) event.quote.lines.forEach((line:Document,index:number) => {
      if (line.account_code === lot.account_code) allocations.set(`${event.journal_id}:${index}`,lot);
    });
  }
  return allocations;
}
export function openingBackupCounts(data:Record<string,Document[]>) {
  return Object.fromEntries(openingCollections.map(name => [`${name === 'opening_batches' ? 'opening_batch' : name === 'opening_lots' ? 'opening_lot' : 'opening_settlement'}_count`,(data[name] || []).length]));
}
/** Declared sources cannot disappear silently. Counts are completeness evidence, not an external signature. */
export function validateOpeningBackup(backup:Document) {
  const data=backup.collections;
  ensure(data && typeof data === 'object' && !Array.isArray(data),'مصادر النسخة غير صالحة.');
  for (const name of openingCollections) if (data[name] !== undefined) ensure(Array.isArray(data[name]),'مصادر الافتتاح في النسخة غير صالحة.');
  const declared=backup.opening_schema_version !== undefined || Object.keys(openingBackupCounts({})).some(key => backup.counters?.[key] !== undefined) || hasOpeningSources(data);
  if (declared) {
    ensure(backup.opening_schema_version === 1 && openingCollections.every(name => Array.isArray(data[name])),'أدلة الافتتاح في النسخة ناقصة أو إصدارها غير صالح.',409);
    for (const [key,count] of Object.entries(openingBackupCounts(data))) ensure(Number.isSafeInteger(backup.counters?.[key]) && backup.counters[key] === count,'عدد مصادر الافتتاح في النسخة ناقص أو مختلف.',409);
    if (hasOpeningSources(data)) {ensure(backup.org?.accounting_version === 2,'مصادر الافتتاح تتطلب نسخة V2.',409);verifyOpeningSources(data,identifier(backup.org?.id));}
  }
  return Object.fromEntries(openingCollections.map(name => [name,data[name] || []])) as Record<string,Document[]>;
}
/** Remap only verified tenant fields; actor/source identities and audit provenance remain unchanged. */
export function remapOpeningCollections(data:Record<string,Document[]>, destination:string) {
  identifier(destination);
  const org=(row:Document)=>({...row,org_id:destination});
  return Object.fromEntries(openingCollections.map(name=>[name,(data[name] || []).map(row=>{
    if(name==='opening_batches') return {...org(row),snapshot:{...row.snapshot,org_id:destination,...Object.fromEntries(['accounts','financial_accounts','customers','suppliers','products'].map(key=>[key,row.snapshot[key].map(org)]))},quote:{...row.quote,org_id:destination}};
    if(name==='opening_settlements') return {...org(row),financial_basis:org(row.financial_basis),account_basis:row.account_basis.map(org)};
    return org(row);
  })]));
}
