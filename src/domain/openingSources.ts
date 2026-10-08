import BigNumber from 'bignumber.js';
import type { Account, JournalEntry, JournalEntryLine } from '../types';
import type { Document } from './store';
import { clean } from './store';
import { openingBalanceQuote, type OpeningInput, type OpeningSnapshot } from './openingBalances';
import { classifyAccount } from './accountClassification';
import { validateFinancialAccount } from './cashManagement';
import { costState } from './inventoryCost';
import { journal, journalLine } from './financial';
import { dateOnly, ensure, identifier, money, text, validateJournal } from './validation';

export { openingCollections } from './openingCollections';
import { openingCollections } from './openingCollections';
/** The transaction must read every collection. Missing collections are not evidence of an empty tenant. */
export const openingActivityCollections = ['journal_entries', 'invoices', 'payments', 'expenses', 'purchase_bills', 'supplier_payments', 'internal_transfers', 'bank_reconciliations', 'cash_reconciliations', 'credit_notes', 'customer_refunds', 'purchase_returns', 'supplier_refunds', 'inventory_movements', ...openingCollections] as const;
const masters = ['accounts', 'financial_accounts', 'customers', 'suppliers', 'products'] as const;
const books = ['sdg', 'usd'] as const;
export interface OpeningTerms { kind: 'receivable' | 'payable'; source_id: string; due_date: string; reference: string; }
export interface OpeningIdentity { operation_id: string; actor_id: string; created_at: string; }
export interface OpeningLot extends Document { id: string; org_id: string; batch_id: string; kind: 'receivable' | 'payable'; party_id: string; currency: 'SDG' | 'USD'; sdg: number; usd: number; native_amount: number; date: string; due_date: string; }
export interface OpeningState { sdg: number; usd: number; sequence: number; last_date: string; }
export interface OpeningSettlementInput { id: string; date: string; financial_account_id: string; currency: 'SDG' | 'USD'; amount: number; exchange_rate_used?: number; reason: string; reference_number: string; }
function exact(value: unknown, keys: string[]) {
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)), 'حقول مصدر الأرصدة غير صالحة أو محمية.');
}
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}` : JSON.stringify(value) ?? 'null';
const same = (a: unknown, b: unknown, message: string) => ensure(stable(a) === stable(b), message, 409);
function rows(data: Record<string, Document[]>, name: string, orgId: string) {
  const result = data[name];
  ensure(Array.isArray(result) && result.length <= 1200, 'مصادر إثبات الأرصدة ناقصة أو تتجاوز حد المعاينة.', 413);
  const ids = new Set<string>();
  for (const row of result) {
    ensure(row && typeof row === 'object' && !Array.isArray(row) && row.org_id === orgId, 'مصدر الأرصدة ينتمي لمؤسسة أخرى أو غير صالح.', 403);
    const id = identifier(name === 'accounts' ? row.code : row.id); ensure(!ids.has(id), 'معرف مصدر الأرصدة مكرر.', 409); ids.add(id);
  }
  return result;
}
/** Only verified zero-valued initialization is neutral; positive stock, unexplained movements and any journal are activity. */
export function deriveOpeningSnapshot(data: Record<string, Document[]>, orgId: string, accountingVersion: number): OpeningSnapshot {
  identifier(orgId); for (const name of [...masters, ...openingActivityCollections]) rows(data, name, orgId);
  let count = openingActivityCollections.filter(name=>name !== 'inventory_movements').reduce((n,name)=>n+data[name].length,0);
  for (const movement of data.inventory_movements) {
    const product = data.products.find(row=>row.id===movement.product_id);
    const neutral = product && product.track_inventory === true && product.stock_quantity === 0 && product.cost_status === 'valued' && product.inventory_value_sdg === 0 && product.inventory_value_usd === 0 && product.average_cost_sdg === 0 && product.average_cost_usd === 0 && ['OPENING_BALANCE','COST_ESTABLISHMENT'].includes(movement.type) && movement.reference_type === 'manual' && movement.reference_id === product.id && movement.costing_version === 2 && movement.quantity === 0 && movement.previous_stock === 0 && movement.resulting_stock === 0 && movement.value_delta_sdg === 0 && movement.value_delta_usd === 0 && (movement.journal_id === null || movement.journal_id === undefined);
    if (neutral) { identifier(movement.operation_id); dateOnly(movement.created_at); dateOnly(product.cost_effective_date); dateOnly(product.cost_last_movement_date); }
    else count++;
  }
  return clean({org_id:orgId,accounting_version:accountingVersion,financial_activity_count:count,...Object.fromEntries(masters.map(name=>[name,data[name]]))}) as OpeningSnapshot;
}
function identity(value: OpeningIdentity) {
  identifier(value.operation_id); identifier(value.actor_id); dateOnly(value.created_at);
  ensure(value.created_at.includes('T') && Number.isFinite(Date.parse(value.created_at)), 'وقت إنشاء إثبات الأرصدة غير صالح.');
}
function frozenSnapshot(snapshot: OpeningSnapshot): OpeningSnapshot {
  const select=(list:Document[],keys:string[])=>list.map(row=>Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]))).sort((a,b)=>{const left=a.code??a.id,right=b.code??b.id;return left<right?-1:left>right?1:0;});
  return clean({org_id:snapshot.org_id,accounting_version:snapshot.accounting_version,financial_activity_count:snapshot.financial_activity_count,
    accounts:select(snapshot.accounts,['code','org_id','name_ar','name_en','type','nature','subtype','reporting_group','cash_flow_category','normal_balance','is_system','is_active','balance_sdg','balance_usd']),
    financial_accounts:select(snapshot.financial_accounts,['id','org_id','name','account_code','currency','kind','status']),
    customers:select(snapshot.customers,['id','org_id','status','balance_sdg','balance_usd']),
    suppliers:select(snapshot.suppliers,['id','org_id','status','payable_due_sdg','payable_due_usd','advance_balance_sdg','advance_balance_usd']),
    products:select(snapshot.products,['id','org_id','is_active','track_inventory','stock_quantity','inventory_value_sdg','inventory_value_usd'])}) as OpeningSnapshot;
}
function termsFor(input: OpeningInput, terms: OpeningTerms[]) {
  ensure(Array.isArray(terms) && terms.length === input.receivables.length + input.payables.length, 'تواريخ استحقاق ومراجع الأطراف الافتتاحية مطلوبة.');
  const seen = new Set<string>();
  for (const row of terms) {
    exact(row,['kind','source_id','due_date','reference']); ensure(['receivable','payable'].includes(row.kind), 'نوع طرف الأرصدة غير صالح.'); identifier(row.source_id);
    const key=`${row.kind}:${row.source_id}`; ensure(!seen.has(key), 'مرجع استحقاق الرصيد مكرر.'); seen.add(key);
    ensure(input[row.kind==='receivable'?'receivables':'payables'].some(source=>source.id===row.source_id), 'الاستحقاق لا يتبع طرفاً افتتاحياً.');
    ensure(dateOnly(row.due_date) === row.due_date, 'تاريخ الاستحقاق يجب أن يكون تاريخاً فقط.'); text(row.reference,200,true);
  }
}
/** Preview preserves unresolved equity review. It cannot grant posting authorization. */
export function openingBalancePlan(input: OpeningInput, snapshot: OpeningSnapshot, terms: OpeningTerms[]) {
  const quote=openingBalanceQuote(input,snapshot); termsFor(input,terms);
  return clean({input,snapshot:frozenSnapshot(snapshot),terms,quote});
}
/** Pure evidence factory. No authentication, period approval, idempotency or storage authority is granted here. */
export function openingBatchEvidence(input: OpeningInput, snapshot: OpeningSnapshot, terms: OpeningTerms[], actor: OpeningIdentity) {
  identity(actor); const plan=openingBalancePlan(input,snapshot,terms),quote=plan.quote;
  ensure(quote.equity_review_complete, 'راجع فرق الافتتاح ودوّن سببه قبل إعداد إثبات الترحيل.',409);
  const journalId=`jv-open-${input.batch_id}`; identifier(journalId);
  const batch = clean({schema_version:1,id:input.batch_id,org_id:snapshot.org_id,operation_id:actor.operation_id,created_by:actor.actor_id,created_at:actor.created_at,journal_id:journalId,...plan});
  ensure(new TextEncoder().encode(stable(batch)).length<=650000,'حجم إثبات الأرصدة يتجاوز حد المستند؛ يلزم مسار استيراد مضبوط.',413);
  const stamp={schema_version:1,org_id:snapshot.org_id,batch_id:batch.id,created_by:actor.actor_id,created_at:actor.created_at,operation_id:actor.operation_id};
  const lots:OpeningLot[]=[], movements:Document[]=[];
  quote.sources.forEach((source,index)=>{
    const sourceKey=`ob-${batch.id}-${index+1}`; identifier(sourceKey);
    if(source.kind==='receivable'||source.kind==='payable') {
      const term=terms.find(row=>row.kind===source.kind && row.source_id===source.source_id)!;
      lots.push({...stamp,id:sourceKey,kind:source.kind,party_id:source.source_id,currency:source.currency,native_amount:source.native_amount,sdg:source.sdg,usd:source.usd,exchange_rate_used:source.exchange_rate_used,account_code:source.account_code,date:quote.date,due_date:term.due_date,reference:term.reference,journal_id:journalId,line_index:index});
    }
    if(source.kind==='inventory') {
      const after=costState(source.quantity!,source.sdg,source.usd,quote.date);
      movements.push({...stamp,id:sourceKey,product_id:source.source_id,type:'OPENING_BALANCE',reference_type:'opening_batch',reference_id:batch.id,quantity:source.quantity,previous_stock:0,resulting_stock:source.quantity,value_delta_sdg:source.sdg,value_delta_usd:source.usd,costing_version:2,journal_id:journalId,date:quote.date,currency:source.currency,native_amount:source.native_amount,unit_cost:source.unit_cost,exchange_rate_used:source.exchange_rate_used,after});
    }
  });
  return {batch,lots,movements,journal:journal(journalId,snapshot.org_id,actor.actor_id,quote.date,'opening_batch',batch.id,quote.reason,quote.lines)};
}
function cashBasis(financial: Document, accounts: Account[], orgId: string, currency: string) {
  ensure(financial && financial.org_id===orgId && financial.currency===currency && financial.status==='active','حساب تسوية الأرصدة غير صالح للمؤسسة أو العملة.');
  validateFinancialAccount(financial,accounts);
  ensure(accounts.filter(row=>row.code===financial.account_code && row.org_id===orgId && row.is_active).length===1,'ربط حساب تسوية الأرصدة مفقود أو مكرر.');
}
function control(accounts: Account[], code: string, type: string, group: string, orgId: string) {
  const found=accounts.filter(row=>row.code===code);
  ensure(found.length===1 && found[0].org_id===orgId && found[0].is_active && found[0].type===type && classifyAccount(found[0]).reporting_group===group && found[0].nature===(type==='EXPENSE'?'DEBIT':type==='REVENUE'?'CREDIT':type==='ASSET'?'DEBIT':'CREDIT'),'حساب التحكم أو فرق الصرف غير صالح.');
  return found[0];
}
function stateFor(lot: OpeningLot, state: OpeningState) {
  money(lot.sdg,0); money(lot.usd,2); money(state.sdg,0); money(state.usd,2);
  ensure(['receivable','payable'].includes(lot.kind) && ['SDG','USD'].includes(lot.currency),'مصدر تسوية الأرصدة غير صالح.');
  money(lot.native_amount,lot.currency==='SDG'?0:2,true);
  ensure(lot.native_amount===lot[lot.currency==='SDG'?'sdg':'usd'] && state.sdg<=lot.sdg && state.usd<=lot.usd && Number.isSafeInteger(state.sequence) && state.sequence>=0 && state.sequence<=200 && dateOnly(state.last_date)===state.last_date && state.last_date>=lot.date,'القيمة الدفترية أو تسلسل مصدر التسوية غير صالح.');
  ensure((state[lot.currency==='SDG'?'sdg':'usd']>0)||(state.sdg===0 && state.usd===0),'الرصيد الطبيعي الصفري يجب أن يغلق الدفترين.');
}
/** Historical carrying allocation, separate FX in both books, and exact final closure. Outgoing cash sufficiency remains a transaction check. */
export function openingSettlementQuote(lot: OpeningLot, state: OpeningState, input: OpeningSettlementInput, financial: Document, accounts: Account[], policy: 'dual'|'sdg_only') {
  exact(input,['id','date','financial_account_id','currency','amount','exchange_rate_used','reason','reference_number']);
  identifier(input.id); identifier(input.financial_account_id); stateFor(lot,state);
  ensure(['dual','sdg_only'].includes(policy) && ['SDG','USD'].includes(input.currency),'سياسة أو عملة تسوية الأرصدة غير صالحة.');
  const date=dateOnly(input.date); ensure(date===input.date && date>=state.last_date,'تاريخ تسوية الأرصدة يسبق المصدر أو آخر تسوية.');
  ensure(state.sequence<200,'مصدر الرصيد يتجاوز حد التسويات؛ يلزم إجراء مضبوط.',413);
  const reason=text(input.reason,1000,true),reference=text(input.reference_number,200); cashBasis(financial,accounts,lot.org_id,input.currency);
  ensure(financial.id===input.financial_account_id,'الحساب المالي لا يطابق طلب التسوية.');
  money(input.amount,input.currency==='SDG'?0:2,true);
  const rate=policy==='dual'?money(input.exchange_rate_used,8,true):0;
  if(policy==='sdg_only') ensure(input.currency==='SDG' && lot.currency==='SDG' && lot.usd===0 && (input.exchange_rate_used===undefined||input.exchange_rate_used===0),'الوضع السوداني فقط لا يسمح بتخمين صرف التسوية.');
  const round=(n:BigNumber,precision:number)=>money(n.decimalPlaces(precision,BigNumber.ROUND_HALF_UP).toNumber(),precision);
  const cash={sdg:input.currency==='SDG'?input.amount:round(new BigNumber(input.amount).times(rate),0),usd:input.currency==='USD'?input.amount:rate?round(new BigNumber(input.amount).dividedBy(rate),2):0};
  const native=lot.currency==='SDG'?'sdg':'usd',units=cash[native];
  ensure(units>0 && units<=state[native],'التسوية تتجاوز الرصيد أو أقل من دقة العملة.',409);
  const settled={sdg:0,usd:0},after={...state,sequence:state.sequence+1,last_date:date};
  for(const book of books){settled[book]=units===state[native]?state[book]:round(new BigNumber(state[book]).times(units).dividedBy(state[native]),book==='sdg'?0:2);after[book]=new BigNumber(state[book]).minus(settled[book]).toNumber();}
  const ar=lot.kind==='receivable',account=control(accounts,ar?'1200':'2110',ar?'ASSET':'LIABILITY',ar?'receivables':'payables',lot.org_id);
  const lines:JournalEntryLine[]=[journalLine(financial.account_code,financial.name,ar?cash.sdg:0,ar?0:cash.sdg,ar?cash.usd:0,ar?0:cash.usd),journalLine(account.code,account.name_ar,ar?0:settled.sdg,ar?settled.sdg:0,ar?0:settled.usd,ar?settled.usd:0)].filter(row=>row.debit_sdg||row.credit_sdg||row.debit_usd||row.credit_usd);
  const gain={sdg:new BigNumber(ar?cash.sdg:settled.sdg).minus(ar?settled.sdg:cash.sdg).toNumber(),usd:new BigNumber(ar?cash.usd:settled.usd).minus(ar?settled.usd:cash.usd).toNumber()};
  if(gain.sdg>0||gain.usd>0){const a=control(accounts,'4200','REVENUE','fx_gain',lot.org_id);lines.push(journalLine(a.code,a.name_ar,0,Math.max(0,gain.sdg),0,Math.max(0,gain.usd)));}
  if(gain.sdg<0||gain.usd<0){const a=control(accounts,'5500','EXPENSE','fx_loss',lot.org_id);lines.push(journalLine(a.code,a.name_ar,Math.max(0,-gain.sdg),0,Math.max(0,-gain.usd),0));}
  return {schema_version:1,date,reason,reference_number:reference,currency:input.currency,amount:input.amount,exchange_rate_used:rate,cash,settled,gain,after,lines,...validateJournal(lines)};
}
export function openingSettlementEvidence(lot: OpeningLot, state: OpeningState, input: OpeningSettlementInput, financial: Document, accounts: Account[], policy: 'dual'|'sdg_only', actor: OpeningIdentity) {
  identity(actor); const quote=openingSettlementQuote(lot,state,input,financial,accounts,policy),journalId=`jv-os-${input.id}`; identifier(journalId);
  const used=new Set(quote.lines.map(row=>row.account_code));
  const minimal=frozenSnapshot({org_id:lot.org_id,accounting_version:2,financial_activity_count:0,accounts:accounts.filter(row=>used.has(row.code)),financial_accounts:[financial],customers:[],suppliers:[],products:[]});
  const event=clean({schema_version:1,id:input.id,org_id:lot.org_id,batch_id:lot.batch_id,lot_id:lot.id,sequence:quote.after.sequence,created_at:actor.created_at,created_by:actor.actor_id,operation_id:actor.operation_id,journal_id:journalId,input,financial_basis:minimal.financial_accounts[0],account_basis:minimal.accounts,before:state,quote});
  return {event,journal:journal(journalId,lot.org_id,actor.actor_id,quote.date,'opening_settlement',input.id,quote.reason,quote.lines,quote.exchange_rate_used)};
}
function verifyJournal(expected: JournalEntry, entries: Document[]) {
  const linked=entries.filter(row=>row.reference_type===expected.reference_type && row.reference_id===expected.reference_id);
  ensure(linked.length===1,'قيد مصدر الأرصدة مفقود أو مكرر.',409);
  const actual=linked[0]; for(const key of Object.keys(expected)) same(actual[key],(expected as unknown as Document)[key],'قيد الأرصدة أو قيمته أو بياناته لا يطابق المصدر.');
}
/** Complete replay is required even for a past as-of date; mutable live balances are never the original basis. */
export function verifyOpeningSources(data: Record<string,Document[]>, orgId: string) {
  identifier(orgId); for(const name of [...masters,...openingCollections,'journal_entries','inventory_movements']) rows(data,name,orgId);
  ensure(data.opening_batches.length<=1,'المؤسسة الجديدة لا تتضمن أكثر من دفعة افتتاحية.',409);
  const states=new Map<string,OpeningState>(),expectedLots:OpeningLot[]=[],expectedMovements:Document[]=[],batches=new Map<string,Document>();
  for(const batch of data.opening_batches){
    ensure(batch.schema_version===1 && batch.id===batch.input?.batch_id && batch.snapshot?.org_id===orgId,'صيغة دفعة الأرصدة غير صالحة.');
    const evidence=openingBatchEvidence(batch.input,batch.snapshot,batch.terms,{operation_id:batch.operation_id,actor_id:batch.created_by,created_at:batch.created_at});
    same(batch,evidence.batch,'الدفعة لا تطابق أساسها الافتتاحي المحفوظ.'); verifyJournal(evidence.journal,data.journal_entries);
    for(const source of batch.quote.sources){
      const name=source.kind==='cash'?'financial_accounts':source.kind==='receivable'?'customers':source.kind==='payable'?'suppliers':'products';
      const current=data[name].find(row=>row.id===source.source_id);ensure(current,'مصدر الأرصدة الأصلي مفقود.',409);
      if(source.kind==='cash') ensure(current.account_code===source.account_code && current.currency===source.currency && current.kind===source.financial_kind,'ربط حساب الرصيد الأصلي تغير.',409);
      if(source.kind==='inventory') ensure(current.track_inventory===true,'تتبع مخزون المصدر الأصلي تغير.',409);
    }
    expectedLots.push(...evidence.lots);expectedMovements.push(...evidence.movements);batches.set(batch.id,batch);
  }
  same([...data.opening_lots].sort((a,b)=>a.id<b.id?-1:1),[...expectedLots].sort((a,b)=>a.id<b.id?-1:1),'الأطراف الافتتاحية مفقودة أو معدلة أو مكررة.');
  const actualMovements=data.inventory_movements.filter(row=>row.reference_type==='opening_batch');
  same([...actualMovements].sort((a,b)=>a.id<b.id?-1:1),[...expectedMovements].sort((a,b)=>a.id<b.id?-1:1),'حركة أو تكلفة المخزون الافتتاحي لا تطابق المصدر.');
  for(const lot of expectedLots){
    let state:OpeningState={sdg:lot.sdg,usd:lot.usd,sequence:0,last_date:lot.date};
    const events=data.opening_settlements.filter(row=>row.lot_id===lot.id).sort((a,b)=>a.sequence-b.sequence);
    ensure(events.length<=200,'مصدر الأرصدة يتجاوز حد تسلسله.',413);
    for(const event of events){
      ensure(event.schema_version===1 && event.batch_id===lot.batch_id && event.sequence===state.sequence+1,'تسلسل تسوية الأرصدة ناقص أو مكرر.',409);
      same(event.before,state,'تسوية الأرصدة لم تبدأ بالقيمة التاريخية الصحيحة.');
      const financial=data.financial_accounts.find(row=>row.id===event.financial_basis?.id);
      ensure(financial && financial.account_code===event.financial_basis.account_code && financial.currency===event.financial_basis.currency && financial.kind===event.financial_basis.kind,'مصدر نقدية تسوية الأرصدة مفقود أو تغير ربطه.',409);
      const expected=openingSettlementEvidence(lot,state,event.input,event.financial_basis,event.account_basis,batches.get(lot.batch_id)!.input.currency_policy,{operation_id:event.operation_id,actor_id:event.created_by,created_at:event.created_at});
      same(event,expected.event,'إثبات تسوية الأرصدة لا يطابق مصدره.'); verifyJournal(expected.journal,data.journal_entries); state=expected.event.quote.after;
    }
    states.set(lot.id,state);
  }
  ensure(data.opening_settlements.every(row=>states.has(row.lot_id)),'تسوية مرتبطة برصيد افتتاحي مفقود.',409);
  for(const entry of data.journal_entries){
    if(entry.reference_type==='opening_batch') ensure(batches.has(entry.reference_id),'قيد افتتاح بلا مصدر.',409);
    if(entry.reference_type==='opening_settlement') ensure(data.opening_settlements.some(row=>row.id===entry.reference_id),'قيد تسوية افتتاح بلا مصدر.',409);
  }
  return {states,lots:expectedLots,batches:[...batches.values()]};
}

/** Source-linked historical view for future AR/AP adapters. Verification includes later events before selecting a date. */
export function openingLotReport(data: Record<string,Document[]>, orgId: string, period: {start?:string;end:string}) {
  const end=dateOnly(period.end),start=period.start===undefined?undefined:dateOnly(period.start);
  ensure(period.end===end && (!start||start===period.start && start<=end),'نطاق تقرير الأرصدة غير صالح.');
  const verified=verifyOpeningSources(data,orgId);
  const totals={receivable:{sdg:0,usd:0},payable:{sdg:0,usd:0}};
  const lots=verified.lots.filter(lot=>lot.date<=end).map(lot=>{
    const events=data.opening_settlements.filter(row=>row.lot_id===lot.id && row.quote.date<=end).sort((a,b)=>a.sequence-b.sequence);
    const remaining={sdg:lot.sdg,usd:lot.usd},opening={sdg:0,usd:0},movement={sdg:0,usd:0};
    for(const book of books){
      for(const event of events)remaining[book]=new BigNumber(remaining[book]).minus(event.quote.settled[book]).toNumber();
      opening[book]=start && lot.date<start?lot[book]:0;
      if(start)for(const event of events.filter(row=>row.quote.date<start))opening[book]=new BigNumber(opening[book]).minus(event.quote.settled[book]).toNumber();
      movement[book]=new BigNumber(remaining[book]).minus(opening[book]).toNumber();
      totals[lot.kind][book]=new BigNumber(totals[lot.kind][book]).plus(remaining[book]).toNumber();
    }
    const days=Math.max(0,Math.floor((Date.parse(end)-Date.parse(lot.due_date))/86400000));
    const bucket=days===0?'current':days<=30?'1_30':days<=60?'31_60':days<=90?'61_90':'90_plus';
    const transactions=[{date:lot.date,reference_type:'opening_batch',reference_id:lot.batch_id,journal_id:lot.journal_id,movement:{sdg:lot.sdg,usd:lot.usd}},...events.map(event=>({date:event.quote.date,reference_type:'opening_settlement',reference_id:event.id,journal_id:event.journal_id,movement:{sdg:-event.quote.settled.sdg,usd:-event.quote.settled.usd}}))].filter(row=>!start||row.date>=start);
    return {lot_id:lot.id,batch_id:lot.batch_id,kind:lot.kind,party_id:lot.party_id,currency:lot.currency,date:lot.date,due_date:lot.due_date,reference:lot.reference,opening,movement,remaining,overdue_days:days,aging_bucket:bucket,transactions};
  });
  return {schema_version:1,period:{...(start?{start}:{}),end},lots,totals};
}
