import type { Document } from '../../src/domain/store';
import { getDefaultChartOfAccounts } from '../../src/services/accountingService';
import { costState } from '../../src/domain/inventoryCost';
import { openingBatchEvidence, deriveOpeningSnapshot, openingSettlementEvidence, verifyOpeningSources, type OpeningTerms } from '../../src/domain/openingSources';
import { openingReadCollections, openingBalancesForParty } from '../../src/domain/openingIntegration';
import { financialCollections } from '../../src/domain/reconciliation';
import type { OpeningInput } from '../../src/domain/openingBalances';
const iso='2026-10-01T12:00:00Z';
export function openingBooksFixture(source='source-opening',actorId='opening-owner') {
  const data:Record<string,Document[]>=Object.fromEntries([...financialCollections,...openingReadCollections].map(name=>[name,[]]));
  data.accounts=getDefaultChartOfAccounts(source);
  data.financial_accounts=[{id:'cash',org_id:source,name:'نقد',account_code:'1110',currency:'SDG',kind:'cash',status:'active'},{id:'usd',org_id:source,name:'دولار',account_code:'1120',currency:'USD',kind:'bank',status:'active'}];
  data.customers=['a','b'].map(id=>({id,org_id:source,name:`عميل ${id}`,phone:'',status:'active',preferred_currency:'USD',balance_sdg:0,balance_usd:0}));
  data.suppliers=['s','t'].map(id=>({id,org_id:source,name:`مورد ${id}`,phone:'',email:'',address:'',tax_number:'',default_currency:'USD',payment_terms_days:0,credit_limit:0,status:'active',notes:'',payable_due_sdg:0,payable_due_usd:0,advance_balance_sdg:0,advance_balance_usd:0}));
  data.products=[{id:'p',org_id:source,name:'صنف',unit:'قطعة',price_sdg:2000,price_usd:1,tax_rate:0,is_active:true,track_inventory:true,...costState(0,0,0,'2026-10-01')}];
  const input:OpeningInput={batch_id:'start',date:'2026-10-01',reason:'إثبات افتتاح اختبار',currency_policy:'dual',cash:[{id:'cash',currency:'SDG',amount:100000,exchange_rate_used:2000}],receivables:[{id:'a',currency:'USD',amount:3,exchange_rate_used:2000},{id:'b',currency:'USD',amount:4,exchange_rate_used:1500}],payables:[{id:'s',currency:'USD',amount:2,exchange_rate_used:2000},{id:'t',currency:'SDG',amount:1000,exchange_rate_used:1000}],inventory:[{id:'p',quantity:10,currency:'USD',unit_cost:2,exchange_rate_used:2000}],capital:{sdg:147000,usd:74}};
  const terms:OpeningTerms[]=[{kind:'receivable',source_id:'a',due_date:'2026-09-15',reference:'AR-A'},{kind:'receivable',source_id:'b',due_date:'2026-11-15',reference:'AR-B'},{kind:'payable',source_id:'s',due_date:'2026-09-01',reference:'AP-S'},{kind:'payable',source_id:'t',due_date:'2026-11-01',reference:'AP-T'}];
  const evidence=openingBatchEvidence(input,deriveOpeningSnapshot(data,source,2),terms,{operation_id:'opening-operation',actor_id:actorId,created_at:iso});
  data.opening_batches=[evidence.batch];data.opening_lots=evidence.lots;data.inventory_movements=evidence.movements;data.journal_entries=[evidence.journal];data.products[0]={...data.products[0],...evidence.movements[0].after};
  refresh(data);return data;
}
function refresh(data:Record<string,Document[]>) {
  for(const party of data.customers){const n=openingBalancesForParty(data,'receivable',party.id);Object.assign(party,{balance_sdg:n.sdg,balance_usd:n.usd,receivable_due_sdg:n.sdg,receivable_due_usd:n.usd,credit_balance_sdg:0,credit_balance_usd:0});}
  for(const party of data.suppliers){const n=openingBalancesForParty(data,'payable',party.id);Object.assign(party,{payable_due_sdg:n.sdg,payable_due_usd:n.usd});}
}
export function settleOpeningBooks(data:Record<string,Document[]>,party:string,amount:number,date='2026-10-02',rate=2500) {
  const source=data.opening_batches[0].org_id,actorId=data.opening_batches[0].created_by;
  const lot=data.opening_lots.find(row=>row.party_id===party)! as any,state=verifyOpeningSources(data,source).states.get(lot.id)!,id=`settle-${party}-${state.sequence+1}`;
  const proof=openingSettlementEvidence(lot,state,{id,date,financial_account_id:'usd',currency:'USD',amount,exchange_rate_used:rate,reason:'تسوية اختبار',reference_number:'REF'},data.financial_accounts[1],data.accounts as any,'dual',{operation_id:id,actor_id:actorId,created_at:`${date}T12:00:00Z`});
  data.opening_settlements.push(proof.event);data.journal_entries.push(proof.journal);refresh(data);return proof;
}
