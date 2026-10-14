import BigNumber from 'bignumber.js';
import { openingBalancesByParty, openingLineAllocations, readOpeningData } from './openingIntegration';
import type { Account, Invoice, JournalEntry, MerchantSettings, OrgRole, Product } from '../types';
import type { Document, Transaction } from './store';
import { acquisitionCost, receiveCost, validateCostState } from './inventoryCost';
import { assertOpenPeriod, dateOnly, ensure, identifier, money, text, validateJournal } from './validation';
import { journal, journalLine, paymentQuote } from './financial';
import { getAccountCodeForPaymentMethod, getDefaultChartOfAccounts } from '../services/accountingService';
import { classifyAccount } from './accountClassification';
import { safeAdd, safeSub } from '../lib/currency';
import { billSignedBalance, loadPurchaseSource, purchaseCaches, savePurchaseSupplier, verifyPurchaseSource } from './purchaseCorrections';
import { allocatePurchaseTaxInventory, purchaseTaxSourceQuote } from './purchaseTaxSources';
import { validateTaxConfigurationVersions } from './taxConfigurationTransactions';
import { dimensionTags } from './managementDimensions';

export const payableCollections = ['suppliers', 'purchase_bills', 'supplier_payments'] as const;
export interface PurchaseLine { id: string; product_id: string; product_name: string; quantity: number; unit_cost: number; value_sdg: number; value_usd: number; zero_cost_reason?: string; }
export interface Supplier { id: string; name: string; phone: string; email: string; address: string; tax_number: string; default_currency: 'SDG' | 'USD'; payment_terms_days: number; credit_limit: number; status: 'active' | 'inactive'; notes: string; org_id: string; created_at: string; updated_at: string; }
export interface PurchaseBill { branch_id?: string; cost_center_id?: string; project_id?: string; advance_balance_sdg?: number; advance_balance_usd?: number; returned_amount_sdg?: number; returned_amount_usd?: number; refunded_amount_sdg?: number; refunded_amount_usd?: number; source_event_sequence?: number; correction_count?: number; id: string; supplier_id: string; supplier_name: string; supplier_reference: string; issue_date: string; due_date: string; currency: 'SDG' | 'USD'; exchange_rate_used: number; items: PurchaseLine[]; grand_total_sdg: number; grand_total_usd: number; remaining_sdg: number; remaining_usd: number; paid_amount_sdg: number; paid_amount_usd: number; settlement: 'credit' | 'cash'; status: 'open' | 'partially_paid' | 'paid'; journal_id: string; org_id: string; created_at: string; }
export interface SupplierPayment { sequence: number; id: string; bill_id: string; supplier_id: string; amount: number; currency: 'SDG' | 'USD'; exchange_rate_used: number; payment_date: string; payment_method: string; payment_account_code: string; reference_number: string; notes: string; settled_amount_sdg: number; settled_amount_usd: number; cash_amount_sdg: number; cash_amount_usd: number; journal_id: string; org_id: string; created_at: string; }
export interface PayableContext {
  tx: Transaction; root: string; orgId: string; actor: string; iso: string; operationId: string; settings: MerchantSettings;
  role?: OrgRole;
  set: (path: string, value: Document) => void; required: (collection: string, id: string) => Promise<Document>;
  post: (entry: JournalEntry) => Promise<void>; counterAdd: (key: string, delta: number) => void;
}
const fields = ['name', 'phone', 'email', 'address', 'tax_number', 'default_currency', 'payment_terms_days', 'credit_limit', 'status', 'notes'];
export function validateSupplier(data: Document) {
  text(data.name, 200, true); for (const key of ['phone', 'tax_number']) text(data[key], 100);
  text(data.email, 320); ensure(!data.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email), 'بريد المورد غير صالح.');
  text(data.address, 500); text(data.notes, 2000);
  ensure(['SDG', 'USD'].includes(data.default_currency), 'عملة المورد غير مدعومة.');
  money(data.payment_terms_days, 0); ensure(data.payment_terms_days <= 3650, 'أجل السداد يتجاوز الحد المسموح.');
  money(data.credit_limit, data.default_currency === 'USD' ? 2 : 0);
  ensure(['active', 'inactive'].includes(data.status), 'حالة المورد غير صالحة.');
}
async function cashAccount(c: PayableContext, data: Document) {
  ensure(['cash', 'bankak', 'fawry', 'bank_transfer', 'other', 'custom'].includes(data.payment_method), 'اختر طريقة سداد نقدية أو بنكية.');
  ensure(data.payment_method !== 'custom' || data.payment_account_code, 'اختر حساب السداد المخصص.');
  const code = identifier(data.payment_account_code || getAccountCodeForPaymentMethod(data.payment_method, data.currency));
  const account = await c.tx.get(`${c.root}/accounts/${code}`) || getDefaultChartOfAccounts(c.orgId).find(a => a.code === code);
  ensure(account?.is_active && account.type === 'ASSET' && classifyAccount(account as Account).reporting_group === 'cash_bank', 'حساب السداد يجب أن يكون نقدياً/بنكياً نشطاً.');
  return code;
}
export async function payableCommand(action: string, data: Document, c: PayableContext): Promise<Document> {
  const stamp = { org_id: c.orgId, created_by: c.actor, created_at: c.iso, updated_at: c.iso, operation_id: c.operationId, schema_version: 3 };
  if (action.startsWith('supplier.')) {
    const updating = action === 'supplier.update', id = updating ? identifier(data.id) : `sup-${c.operationId}`;
    const old = updating ? await c.required('suppliers', id) : { phone: '', email: '', address: '', tax_number: '', default_currency: 'SDG', payment_terms_days: 0, credit_limit: 0, status: 'active', notes: '' };
    ensure(updating || !await c.tx.get(`${c.root}/suppliers/${id}`), 'المورد موجود مسبقاً.', 409);
    const input = updating ? data.updates : data; ensure(input && typeof input === 'object' && !Array.isArray(input), 'بيانات المورد غير صالحة.');
    ensure(!['balance_sdg', 'balance_usd', 'current_balance'].some(key => input[key] !== undefined), 'رصيد المورد يُحسب من قيود وفواتير موثقة فقط.');
    const result = { ...old, ...Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, input[k]])), ...(!updating ? stamp : {}), id, updated_at: c.iso };
    validateSupplier(result); c.set(`${c.root}/suppliers/${id}`, result); return result;
  }
  assertOpenPeriod(action === 'purchase.create' ? data.issue_date : data.payment_date, c.settings);
  if (action === 'purchase.create') {
    const supplier = await c.required('suppliers', data.supplier_id); ensure(supplier.status === 'active', 'المورد غير نشط.');
    const issueDate = dateOnly(data.issue_date), dueDate = data.due_date ? dateOnly(data.due_date) : new Date(Date.parse(`${issueDate}T00:00:00Z`) + supplier.payment_terms_days * 86400000).toISOString().slice(0, 10);
    ensure(dueDate >= issueDate, 'الاستحقاق يسبق فاتورة الشراء.');
    ensure(['SDG', 'USD'].includes(data.currency) && ['credit', 'cash'].includes(data.settlement), 'عملة أو نوع سداد الشراء غير صالح.');
    money(data.exchange_rate_used || 0, 8); ensure(data.currency !== 'USD' || data.exchange_rate_used > 0, 'شراء الدولار يتطلب سعر صرف موثقاً.');
    const reference = text(data.supplier_reference, 80, true);
    const refPath = `${c.root}/purchase_numbers/${supplier.id}.${encodeURIComponent(reference.toLowerCase())}`;
    ensure(!await c.tx.get(refPath), 'رقم فاتورة المورد مستخدم مسبقاً.', 409);
    ensure(!data.tax_amount && !data.discount_amount, 'مبلغ الضريبة والخصم مشتقان خادمياً ولا يقبلان من العميل.');
    ensure(Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 100, 'فاتورة الشراء تتطلب 1–100 بند.');
    let taxEvidence: Document | undefined;
    if (data.tax_configuration_id !== undefined || data.expected_tax_configuration_revision !== undefined) {
      ensure(data.tax_configuration_id && data.expected_tax_configuration_revision, 'معرف وإصدار إعداد ضريبة المشتريات مطلوبان معاً.');
      const current = await c.required('tax_configurations', data.tax_configuration_id);
      await validateTaxConfigurationVersions(c.tx, c.root, c.orgId, current);
      const configuration = Object.fromEntries(['schema_version','id','org_id','revision','name','jurisdiction','direction','rate','calculation','rounding','recoverable','tax_account_code','effective_from','effective_to','active'].map(key => [key,current[key]]));
      taxEvidence = purchaseTaxSourceQuote({ configuration_id:data.tax_configuration_id, expected_configuration_revision:data.expected_tax_configuration_revision, issue_date:issueDate, currency:data.currency, exchange_rate_used:data.exchange_rate_used||0, items:data.items }, { org_id:c.orgId, configurations:[configuration as any], accounts:await c.tx.list(`${c.root}/accounts`) as Account[] });
      taxEvidence.configuration_version_hash = current.version_hash;
    }
    const nativeAllocations = taxEvidence ? allocatePurchaseTaxInventory({ configuration_id:data.tax_configuration_id, expected_configuration_revision:data.expected_tax_configuration_revision, issue_date:issueDate, currency:data.currency, exchange_rate_used:data.exchange_rate_used||0, items:data.items }, taxEvidence as any) : undefined;
    const raw = data.items.map((item:Document) => new BigNumber(item.quantity).times(item.unit_cost)), rawTotal = raw.reduce((sum:BigNumber,value:BigNumber)=>sum.plus(value),new BigNumber(0));
    const allocateBook = (target:number,decimals:number) => {const values:number[]=[];let used=new BigNumber(0),total=new BigNumber(target);for(let i=0;i<raw.length;i++){const value=i===raw.length-1?total.minus(used):total.times(raw[i]).div(rawTotal).decimalPlaces(decimals,BigNumber.ROUND_HALF_UP);values.push(value.toNumber());used=used.plus(value);}return values;};
    const sdgAllocations = taxEvidence ? allocateBook(taxEvidence.tax_treatment==='receivable'?taxEvidence.sdg.base:taxEvidence.sdg.total,0) : undefined;
    const usdAllocations = taxEvidence ? allocateBook(taxEvidence.tax_treatment==='receivable'?taxEvidence.usd.base:taxEvidence.usd.total,2) : undefined;
    const products = new Map<string, Document>(), quantities = new Map<string, { quantity: number; sdg: number; usd: number }>();
    const items: PurchaseLine[] = [];
    for (const [i, item] of data.items.entries()) {
      const id = identifier(item.product_id); money(item.quantity, 6, true); money(item.unit_cost, 8);
      ensure(!item.tax_rate && !item.discount_percent, 'أدخل تكلفة البند الصافية الموثقة.');
      let product = products.get(id); if (!product) { product = await c.required('products', id); products.set(id, product); }
      ensure(product.is_active && product.track_inventory, 'بند الشراء يتطلب منتج مخزون نشطاً.'); validateCostState(product as Product);
      const delta = taxEvidence ? {sdg:sdgAllocations![i],usd:usdAllocations![i]} : acquisitionCost(item.quantity, { cost_currency: data.currency, unit_cost: item.unit_cost, exchange_rate_used: data.exchange_rate_used || 0, zero_cost_reason: item.zero_cost_reason });
      const previous = quantities.get(id) || { quantity: 0, sdg: 0, usd: 0 };
      quantities.set(id, { quantity: safeAdd(previous.quantity, item.quantity, 6), sdg: safeAdd(previous.sdg, delta.sdg, 0), usd: safeAdd(previous.usd, delta.usd, 2) });
      items.push({ id: `line-${i + 1}`, product_id: id, product_name: product.name, quantity: item.quantity, unit_cost: item.unit_cost, value_sdg: delta.sdg, value_usd: delta.usd, ...(nativeAllocations?{tax_inventory_value_native:nativeAllocations[i]}:{}), ...(item.zero_cost_reason ? { zero_cost_reason: text(item.zero_cost_reason, 500) } : {}) });
    }
    const sdg = items.reduce((n, i) => n.plus(i.value_sdg), new BigNumber(0)).toNumber(), usd = items.reduce((n, i) => n.plus(i.value_usd), new BigNumber(0)).toNumber();
    money(sdg, 0); money(usd, 2); ensure(sdg > 0 || usd > 0, 'إجمالي فاتورة الشراء يجب أن يكون موجباً.');
    const code = data.settlement === 'credit' ? '2110' : await cashAccount(c, data);
    const id = `pb-${c.operationId}`, journalId = `jv-purchase-${c.operationId}`;
    const totalSdg=taxEvidence?.sdg.total??sdg,totalUsd=taxEvidence?.usd.total??usd,dimensions=dimensionTags(data);
    const result = { ...stamp, ...dimensions, id, supplier_id: supplier.id, supplier_name: supplier.name, supplier_reference: reference, issue_date: issueDate, due_date: dueDate, currency: data.currency, exchange_rate_used: data.exchange_rate_used || 0, items, ...(taxEvidence?{tax_evidence:taxEvidence}:{}), grand_total_sdg: totalSdg, grand_total_usd: totalUsd, remaining_sdg: data.settlement === 'credit' ? totalSdg : 0, remaining_usd: data.settlement === 'credit' ? totalUsd : 0, paid_amount_sdg: data.settlement === 'cash' ? totalSdg : 0, paid_amount_usd: data.settlement === 'cash' ? totalUsd : 0, settlement: data.settlement, status: data.settlement === 'cash' ? 'paid' : 'open', journal_id: journalId, payment_account_code: code, notes: text(data.notes || '', 2000), reason: text(data.reason, 500, true) };
    const changed = [...quantities].map(([productId, delta]) => ({ product: products.get(productId)!, delta, after: receiveCost(products.get(productId)! as Product, delta.quantity, delta, issueDate) }));
    const tagged=(line:ReturnType<typeof journalLine>)=>({...line,...dimensions});
    const lines=[tagged(journalLine('1300', 'المخزون', sdg, 0, usd, 0))];if(taxEvidence?.tax_treatment==='receivable')lines.push(tagged(journalLine(taxEvidence.tax_account_code,'ضريبة مشتريات مستردة',taxEvidence.sdg.tax,0,taxEvidence.usd.tax,0)));lines.push(tagged(journalLine(code, data.settlement === 'credit' ? 'ذمم الموردين' : 'النقد والبنوك', 0, totalSdg, 0, totalUsd)));
    await c.post(journal(journalId, c.orgId, c.actor, issueDate, 'purchase_bill', id, `فاتورة شراء ${reference}: ${supplier.name}`, lines, result.exchange_rate_used));
    for (const [index, { product, delta, after }] of changed.entries()) {
      c.set(`${c.root}/products/${product.id}`, { ...product, ...after });
      const movementId = `mov-purchase-${c.operationId}-${index + 1}`;
      c.set(`${c.root}/inventory_movements/${movementId}`, { ...stamp, id: movementId, product_id: product.id, product_name: product.name, type: 'PURCHASE', quantity: delta.quantity, previous_stock: product.stock_quantity, resulting_stock: after.stock_quantity, reference_type: 'purchase_bill', reference_id: id, value_delta_sdg: delta.sdg, value_delta_usd: delta.usd, costing_version: 2, journal_id: journalId, reason: result.reason });
      c.counterAdd('inventory_movement_count', 1);
    }
    await savePurchaseSupplier(c, supplier, result); c.set(refPath, { id, supplier_id: supplier.id, reference }); c.set(`${c.root}/purchase_bills/${id}`, result); return result;
  }
  ensure(action === 'supplierPayment.create', 'عملية المورد غير معروفة.');
  const bill = await c.required('purchase_bills', data.bill_id), state = await loadPurchaseSource(c.tx, c.root, bill);
  ensure(state.sequence < 200, 'سجل الشراء تجاوز حد المعاملة؛ يلزم إجراء ترحيل خادمي.', 409);
  ensure(bill.settlement === 'credit' && bill.status !== 'paid', 'فاتورة الشراء مسددة بالفعل.', 409);
  ensure(dateOnly(data.payment_date) >= bill.issue_date && dateOnly(data.payment_date) >= state.lastDate, 'تاريخ السداد يسبق الفاتورة أو آخر سداد.');
  const supplier = await c.required('suppliers', bill.supplier_id); // Inactive suppliers can still receive payment of existing debt.
  ensure(['SDG', 'USD'].includes(data.currency), 'عملة السداد غير مدعومة.'); money(data.exchange_rate_used || 0, 8);
  const quote = paymentQuote({ ...bill, receivable_currency: bill.currency, remaining_sdg: state.balance.sdg, remaining_usd: state.balance.usd } as Invoice, data.amount, data.currency, data.exchange_rate_used || 0);
  const code = await cashAccount(c, data), id = `sp-${c.operationId}`, journalId = `jv-supplier-pay-${c.operationId}`;
  const result = { ...stamp, id, bill_id: bill.id, sequence: state.paymentSequence + 1, source_sequence: state.sequence + 1, supplier_id: bill.supplier_id, amount: data.amount, currency: data.currency, payment_date: dateOnly(data.payment_date), payment_method: data.payment_method, payment_account_code: code, exchange_rate_used: data.exchange_rate_used || 0, reference_number: text(data.reference_number || '', 200), notes: text(data.notes || '', 2000), settled_amount_sdg: quote.settledSdg, settled_amount_usd: quote.settledUsd, cash_amount_sdg: quote.cashSdg, cash_amount_usd: quote.cashUsd, journal_id: journalId };
  const lines = [journalLine('2110', 'ذمم الموردين', quote.settledSdg, 0, quote.settledUsd, 0), journalLine(code, 'النقد والبنوك', 0, quote.cashSdg, 0, quote.cashUsd)];
  const ds = safeSub(quote.cashSdg, quote.settledSdg, 0), du = safeSub(quote.cashUsd, quote.settledUsd, 2);
  if (ds > 0 || du > 0) lines.push(journalLine('5500', 'خسائر فروق العملة', Math.max(ds, 0), 0, Math.max(du, 0), 0));
  if (ds < 0 || du < 0) lines.push(journalLine('4200', 'أرباح فروق العملة', 0, Math.max(-ds, 0), 0, Math.max(-du, 0)));
  await c.post(journal(journalId, c.orgId, c.actor, result.payment_date, 'supplier_payment', id, `سداد المورد ${bill.supplier_name}: ${bill.supplier_reference}`, lines, result.exchange_rate_used));
  state.balance = { sdg: safeSub(state.balance.sdg, quote.settledSdg, 0), usd: safeSub(state.balance.usd, quote.settledUsd, 2) };
  state.paid = { sdg: safeAdd(state.paid.sdg, quote.settledSdg, 0), usd: safeAdd(state.paid.usd, quote.settledUsd, 2) }; state.sequence++; state.paymentSequence++;
  const updated = { ...purchaseCaches(bill, state, c.iso), last_payment_date: result.payment_date };
  await savePurchaseSupplier(c, supplier, updated); c.set(`${c.root}/purchase_bills/${bill.id}`, updated);
  c.set(`${c.root}/supplier_payments/${id}`, result); return result;
}

export async function readPayableReport(tx: Transaction, root: string, period: { start?: string; end?: string }, asOf: string) {
  const names = ['suppliers','purchase_bills','supplier_payments','journal_entries','purchase_returns','supplier_refunds','inventory_movements','accounts','financial_accounts'];
  const rows = await Promise.all(names.map(name => tx.list(`${root}/${name}`))), data = Object.fromEntries(names.map((name,i) => [name,rows[i]]));
  return payableReports(data.suppliers,data.purchase_bills,data.supplier_payments,data.journal_entries,period,asOf,{...data,...await readOpeningData(tx,root)});
}
export function payableReports(suppliers: Document[], bills: Document[], payments: Document[], entries: Document[], period: { start?: string; end?: string }, asOf: string, corrections: Record<string,Document[]> = {}) {
  const end = dateOnly(period.end || asOf), start = period.start ? dateOnly(period.start) : undefined; ensure(!start || start <= end, 'بداية الكشف بعد نهايته.');
  const returns = corrections.purchase_returns || [], refunds = corrections.supplier_refunds || [];
  const openingData:Record<string,Document[]>={...corrections,journal_entries:entries};const openingLines=openingLineAllocations(openingData,'payable'),openingLots=new Map((openingData.opening_lots||[]).map(row=>[row.id,row]));
  for (const bill of bills) if (returns.some(row=>row.bill_id===bill.id) || refunds.some(row=>row.bill_id===bill.id)) verifyPurchaseSource(bill,{ ...corrections, journal_entries:entries, supplier_payments:payments },false);
  const sourceFor = (entry: Document) => entry.reference_type === 'purchase_bill' ? bills.find(b=>b.id===entry.reference_id) : bills.find(b=>b.id===(entry.reference_type==='supplier_payment'?payments:entry.reference_type==='purchase_return'?returns:entry.reference_type==='supplier_refund'?refunds:[]).find(row=>row.id===entry.reference_id)?.bill_id);
  const sequence = (entry: Document) => entry.reference_type==='opening_batch'?0:entry.reference_type==='opening_settlement'?(openingData.opening_settlements||[]).find(row=>row.id===entry.reference_id)?.sequence ?? Number.MAX_SAFE_INTEGER:entry.reference_type==='purchase_bill'?0:(entry.reference_type==='supplier_payment'?payments:entry.reference_type==='purchase_return'?returns:refunds).find(row=>row.id===entry.reference_id)?.source_sequence ?? payments.find(row=>row.id===entry.reference_id)?.sequence ?? Number.MAX_SAFE_INTEGER;
  const balances = new Map<string,BookBalances>(), supplierBalances = new Map<string,BookBalances>(), openings = new Map<string,BookBalances>(), statementRows = new Map<string,Document[]>();
  let ledger = pair(), allocated = pair();
  const seen = new Set<string>();
  for (const entry of entries) { identifier(entry.id); ensure(!seen.has(entry.id),'معرّف قيد مورد مكرر.'); seen.add(entry.id); validateJournal(entry.lines); }
  const dated = entries.filter(entry=>dateOnly(entry.date)<=end).sort((a,b)=>dateOnly(a.date).localeCompare(dateOnly(b.date)) || String(sourceFor(a)?.id||'').localeCompare(String(sourceFor(b)?.id||'')) || sequence(a)-sequence(b) || a.id.localeCompare(b.id));
  for (const entry of dated) {
    const bill=sourceFor(entry);
    for(const [index,line] of entry.lines.entries()) {
      if(line.account_code!=='2110')continue;
      const movement={sdg:new BigNumber(line.credit_sdg).minus(line.debit_sdg).toNumber(),usd:new BigNumber(line.credit_usd).minus(line.debit_usd).toNumber()};
      ledger=pairAdd(ledger,movement);const lot=openingLines.get(`${entry.id}:${index}`);if(!bill&&!lot)continue;
      const partyId=lot?lot.party_id:bill!.supplier_id,sourceKey=lot?`opening_lot:${lot.id}`:`purchase_bill:${bill!.id}`;
      ensure(suppliers.some(s=>s.id===partyId) && dateOnly(entry.date)>=dateOnly(lot?lot.date:bill!.issue_date),'مرجع/تاريخ قيد المورد غير صالح.');
      allocated=pairAdd(allocated,movement);balances.set(sourceKey,pairAdd(balances.get(sourceKey)||pair(),movement));const balance=pairAdd(supplierBalances.get(partyId)||pair(),movement);supplierBalances.set(partyId,balance);
      if(start && dateOnly(entry.date)<start)openings.set(partyId,balance);
      else statementRows.set(partyId,[...statementRows.get(partyId)||[],{source_key:sourceKey,source_type:lot?'opening_lot':'purchase_bill',source_id:lot?.id||bill!.id,source_reference:lot?.reference||bill!.supplier_reference,opening_lot_id:lot?.id||'',bill_id:lot?'':bill!.id,date:dateOnly(entry.date),reference_type:entry.reference_type,reference_id:entry.reference_id,journal_id:entry.id,line_index:index,description:entry.description,movement_sdg:movement.sdg,movement_usd:movement.usd,balance_sdg:balance.sdg,balance_usd:balance.usd}]);
    }
  }
  const aging=[...balances].map(([sourceKey,balance])=>{const lot=sourceKey.startsWith('opening_lot:')?openingLots.get(sourceKey.slice(12)):undefined,bill=lot?undefined:bills.find(b=>b.id===sourceKey.slice(14))!,partyId=lot?lot.party_id:bill!.supplier_id,dueDate=lot?lot.due_date:bill!.due_date,days=Math.floor((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${dateOnly(dueDate)}T00:00:00Z`))/86400000);return {source_key:sourceKey,source_type:lot?'opening_lot':'purchase_bill',source_id:lot?.id||bill!.id,opening_lot_id:lot?.id||'',bill_id:lot?'':bill!.id,supplier_id:partyId,supplier_name:lot?suppliers.find(s=>s.id===partyId)!.name:bill!.supplier_name,reference:lot?.reference||bill!.supplier_reference,due_date:dueDate,overdue_days:Math.max(0,days),bucket:days<=0?'Current':days<=30?'1-30':days<=60?'31-60':days<=90?'61-90':'90+',remaining_sdg:Math.max(0,balance.sdg),remaining_usd:Math.max(0,balance.usd),advance_sdg:Math.max(0,-balance.sdg),advance_usd:Math.max(0,-balance.usd)};}).filter(row=>row.remaining_sdg||row.remaining_usd||row.advance_sdg||row.advance_usd);
  const statements=suppliers.map(supplier=>{const opening=openings.get(supplier.id)||pair(),closing=supplierBalances.get(supplier.id)||pair();return {supplier_id:supplier.id,supplier_name:supplier.name,opening_sdg:opening.sdg,opening_usd:opening.usd,closing_sdg:closing.sdg,closing_usd:closing.usd,rows:statementRows.get(supplier.id)||[]};});
  return {period:{start:start||'',end},aging,statements,total_sdg:allocated.sdg,total_usd:allocated.usd,ledger_sdg:ledger.sdg,ledger_usd:ledger.usd,unallocated_sdg:new BigNumber(ledger.sdg).minus(allocated.sdg).toNumber(),unallocated_usd:new BigNumber(ledger.usd).minus(allocated.usd).toNumber()};
}
type BookBalances = { sdg:number; usd:number };
const pair = ():BookBalances => ({sdg:0,usd:0});
const pairAdd = (a:BookBalances,b:BookBalances):BookBalances => ({sdg:new BigNumber(a.sdg).plus(b.sdg).toNumber(),usd:new BigNumber(a.usd).plus(b.usd).toNumber()});

/** Source and control-account checks; legacy expense liabilities stay explicit, never silently migrated. */
export function reconcilePayables(data: Record<string, Document[]>) {
  const findings: { code: string; collection: string; id: string; field?: string; expected?: number; actual?: number; message?: string }[] = [];
  const suppliers = data.suppliers || [], bills = data.purchase_bills || [], payments = data.supplier_payments || [], entries = data.journal_entries || [];
  const compare = (collection: string, id: string, field: string, expected: number, actual: number) => { if (!new BigNumber(expected).eq(actual)) findings.push({ code: 'balance_difference', collection, id, field, expected, actual }); };
  const inspect = (collection: string, id: string, work: () => void) => { try { work(); } catch (error) { findings.push({ code: 'invalid_record', collection, id, message: error instanceof Error ? error.message : 'غير صالح' }); } };
  const source = (type: string, id: string) => entries.filter(e => e.reference_type === type && e.reference_id === id);
  const amount = (rows: Document[], code: string, currency: string, credit = true) => rows.flatMap(e => e.lines || []).filter(l => l.account_code === code).reduce((n: BigNumber, l: Document) => credit ? n.plus(l[`credit_${currency}`]).minus(l[`debit_${currency}`]) : n.plus(l[`debit_${currency}`]).minus(l[`credit_${currency}`]), new BigNumber(0)).toNumber();
  let opening=new Map<string,BookBalances>();
  inspect('opening_batches','AP-sources',()=>{opening=openingBalancesByParty(data,'payable');});
  for (const supplier of suppliers) inspect('suppliers', supplier.id, () => {
    validateSupplier(supplier);
    for (const book of ['sdg','usd'] as const) for (const prefix of ['payable_due','advance_balance']) if (supplier[`${prefix}_${book}`] !== undefined) { money(supplier[`${prefix}_${book}`], book === 'sdg' ? 0 : 2); compare('suppliers', supplier.id, `${prefix}_${book}`, bills.filter(row => row.supplier_id === supplier.id).reduce((sum,row) => sum.plus(row[`${prefix === 'payable_due' ? 'remaining' : prefix}_${book}`] || 0), new BigNumber(prefix==='payable_due'?opening.get(supplier.id)?.[book]||0:0)).toNumber(), supplier[`${prefix}_${book}`]); }
  });
  for (const bill of bills) inspect('purchase_bills', bill.id, () => {
    ensure(suppliers.some(s => s.id === bill.supplier_id), 'مرجع المورد ناقص.');
    dateOnly(bill.issue_date); ensure(dateOnly(bill.due_date) >= dateOnly(bill.issue_date), 'تاريخ الاستحقاق غير صالح.');
    ensure(['SDG', 'USD'].includes(bill.currency) && ['credit', 'cash'].includes(bill.settlement), 'عملة أو سداد الشراء غير صالح.');
    text(bill.supplier_reference, 80, true); money(bill.exchange_rate_used, 8);
    ensure(['open', 'partially_paid', 'paid'].includes(bill.status), 'حالة فاتورة الشراء غير صالحة.');
    ensure(Array.isArray(bill.items) && bill.items.length > 0 && bill.items.length <= 100, 'بنود فاتورة الشراء غير صالحة.');
    const originals = source('purchase_bill', bill.id); ensure(originals.length === 1 && originals[0].id === bill.journal_id && dateOnly(originals[0].date) === dateOnly(bill.issue_date), 'قيد الشراء ناقص أو مكرر أو تاريخه مختلف.');
    const received = new Map<string, { q: BigNumber; sdg: BigNumber; usd: BigNumber }>();
    for (const item of bill.items) {
      ensure((data.products || []).some(p => p.id === item.product_id && p.track_inventory), 'مرجع المنتج ناقص.');
      if (bill.tax_evidence) { money(item.value_sdg,0);money(item.value_usd,2);money(item.tax_inventory_value_native,bill.currency==='USD'?2:0); }
      else { const delta = acquisitionCost(item.quantity, { cost_currency: bill.currency, unit_cost: item.unit_cost, exchange_rate_used: bill.exchange_rate_used, zero_cost_reason: item.zero_cost_reason }); compare('purchase_bills', bill.id, `${item.id}:sdg`, delta.sdg, item.value_sdg); compare('purchase_bills', bill.id, `${item.id}:usd`, delta.usd, item.value_usd); }
      const old = received.get(item.product_id) || { q: new BigNumber(0), sdg: new BigNumber(0), usd: new BigNumber(0) };
      received.set(item.product_id, { q: old.q.plus(item.quantity), sdg: old.sdg.plus(item.value_sdg), usd: old.usd.plus(item.value_usd) });
    }
    for (const [productId, value] of received) {
      const movements = (data.inventory_movements || []).filter(m => m.reference_type === 'purchase_bill' && m.reference_id === bill.id && m.product_id === productId);
      ensure(movements.length === 1 && movements[0].journal_id === bill.journal_id && movements[0].type === 'PURCHASE', 'حركة استلام الشراء ناقصة أو مكررة.');
      compare('purchase_bills', bill.id, `${productId}:quantity`, value.q.toNumber(), movements[0].quantity);
      for (const currency of ['sdg', 'usd'] as const) compare('purchase_bills', bill.id, `${productId}:value_${currency}`, value[currency].toNumber(), movements[0][`value_delta_${currency}`]);
    }
    if ((data.purchase_returns || []).some(row => row.bill_id === bill.id) || (data.supplier_refunds || []).some(row => row.bill_id === bill.id)) verifyPurchaseSource(bill, data);
    else {
    const relatedPayments = payments.filter(p => p.bill_id === bill.id);
    if (bill.settlement === 'cash') ensure(!relatedPayments.length, 'شراء نقدي مرتبط بسداد إضافي.');
    const state: Document = { ...bill, receivable_currency: bill.currency, remaining_sdg: bill.grand_total_sdg, remaining_usd: bill.grand_total_usd };
    let sequence = 0, lastDate = dateOnly(bill.issue_date);
    for (const payment of [...relatedPayments].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))) {
      ensure(payment.sequence === ++sequence && dateOnly(payment.payment_date) >= lastDate, 'ترتيب سندات المورد غير صالح.'); lastDate = dateOnly(payment.payment_date);
      const quote = paymentQuote(state as Invoice, payment.amount, payment.currency, payment.exchange_rate_used);
      compare('supplier_payments', payment.id, 'allocated_sdg', quote.settledSdg, payment.settled_amount_sdg); compare('supplier_payments', payment.id, 'allocated_usd', quote.settledUsd, payment.settled_amount_usd);
      state.remaining_sdg = safeSub(state.remaining_sdg, quote.settledSdg, 0); state.remaining_usd = safeSub(state.remaining_usd, quote.settledUsd, 2);
    }
    for (const currency of ['sdg', 'usd']) {
      const inventoryTotal = bill.items.reduce((n: BigNumber, i: Document) => n.plus(i[`value_${currency}`]), new BigNumber(0)).toNumber(); money(inventoryTotal, currency === 'sdg' ? 0 : 2);
      const total=bill.tax_evidence?.[currency]?.total??inventoryTotal;money(total,currency==='sdg'?0:2);
      if(bill.tax_evidence){ensure(bill.tax_evidence.configuration_version_hash&&bill.tax_evidence.effective_on===bill.issue_date,'دليل ضريبة الشراء ناقص أو تاريخه مختلف.');const expectedInventory=bill.tax_evidence.tax_treatment==='receivable'?bill.tax_evidence[currency].base:bill.tax_evidence[currency].total;compare('purchase_bills',bill.id,`tax_inventory_${currency}`,expectedInventory,inventoryTotal);const tax=bill.tax_evidence.tax_treatment==='receivable'?bill.tax_evidence[currency].tax:0;compare('purchase_bills',bill.id,`tax_${currency}`,tax,amount(originals,bill.tax_evidence.tax_account_code||'',''+currency,false));}
      compare('purchase_bills', bill.id, `grand_total_${currency}`, total, bill[`grand_total_${currency}`]);
      compare('purchase_bills', bill.id, `inventory_${currency}`, inventoryTotal, amount(originals, '1300', currency, false));
      compare('purchase_bills', bill.id, `credit_${currency}`, total, amount(originals, bill.settlement === 'credit' ? '2110' : bill.payment_account_code, currency));
      const settled = bill.settlement === 'cash' ? total : relatedPayments.reduce((n: BigNumber, p: Document) => n.plus(p[`settled_amount_${currency}`]), new BigNumber(0)).toNumber();
      compare('purchase_bills', bill.id, `paid_amount_${currency}`, settled, bill[`paid_amount_${currency}`]);
      compare('purchase_bills', bill.id, `remaining_${currency}`, safeSub(total, settled, currency === 'sdg' ? 0 : 2), bill[`remaining_${currency}`]);
    }
    ensure((bill.payment_sequence || 0) === sequence && (!sequence || bill.last_payment_date === lastDate), 'آخر سداد لا يطابق سجل السندات.');
    const expectedStatus = bill.remaining_sdg || bill.remaining_usd ? relatedPayments.length ? 'partially_paid' : 'open' : 'paid'; ensure(bill.status === expectedStatus, 'حالة الشراء لا تطابق السداد.');
    }
  });
  for (const entry of entries) {
    const records = entry.reference_type === 'purchase_bill' ? bills : entry.reference_type === 'supplier_payment' ? payments : undefined;
    if (records && !records.some(r => r.id === entry.reference_id)) findings.push({ code: 'missing_source_document', collection: 'journal_entries', id: entry.id });
  }
  for (const movement of data.inventory_movements || []) if (movement.reference_type === 'purchase_bill' && !bills.some(b => b.id === movement.reference_id)) findings.push({ code: 'missing_purchase_bill', collection: 'inventory_movements', id: movement.id });
  const references = new Set<string>();
  for (const bill of bills) { const ref = `${bill.supplier_id}:${String(bill.supplier_reference).toLowerCase()}`; if (references.has(ref)) findings.push({ code: 'duplicate_supplier_reference', collection: 'purchase_bills', id: bill.id }); references.add(ref); }
  for (const payment of payments) inspect('supplier_payments', payment.id, () => {
    const bill = bills.find(b => b.id === payment.bill_id); ensure(bill && bill.supplier_id === payment.supplier_id && bill.settlement === 'credit', 'مرجع فاتورة سداد المورد ناقص.');
    ensure(dateOnly(payment.payment_date) >= dateOnly(bill.issue_date), 'السداد يسبق فاتورة الشراء.');
    ensure(['SDG', 'USD'].includes(payment.currency) && ['cash', 'bankak', 'fawry', 'bank_transfer', 'other', 'custom'].includes(payment.payment_method), 'سداد المورد غير صالح.');
    money(payment.amount, payment.currency === 'USD' ? 2 : 0, true); money(payment.exchange_rate_used, 8);
    const originals = source('supplier_payment', payment.id); ensure(originals.length === 1 && originals[0].id === payment.journal_id && dateOnly(originals[0].date) === dateOnly(payment.payment_date), 'قيد السداد ناقص أو مكرر أو تاريخه مختلف.');
    const account = (data.accounts || []).find(a => a.code === payment.payment_account_code); ensure(account && classifyAccount(account as Account).reporting_group === 'cash_bank', 'حساب السداد غير نقدي/بنكي.');
    const cashSdg = payment.currency === 'SDG' ? payment.amount : new BigNumber(payment.amount).times(payment.exchange_rate_used).decimalPlaces(0, BigNumber.ROUND_HALF_UP).toNumber();
    const cashUsd = payment.currency === 'USD' ? payment.amount : payment.exchange_rate_used > 0 ? new BigNumber(payment.amount).div(payment.exchange_rate_used).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toNumber() : 0;
    compare('supplier_payments', payment.id, 'cash_amount_sdg', cashSdg, payment.cash_amount_sdg); compare('supplier_payments', payment.id, 'cash_amount_usd', cashUsd, payment.cash_amount_usd);
    for (const currency of ['sdg', 'usd']) {
      money(payment[`settled_amount_${currency}`], currency === 'sdg' ? 0 : 2); money(payment[`cash_amount_${currency}`], currency === 'sdg' ? 0 : 2);
      compare('supplier_payments', payment.id, `settled_amount_${currency}`, amount(originals, '2110', currency, false), payment[`settled_amount_${currency}`]);
      compare('supplier_payments', payment.id, `cash_amount_${currency}`, amount(originals, payment.payment_account_code, currency), payment[`cash_amount_${currency}`]);
    }
  });
  const expenseIds = new Set((data.expenses || []).map(e => e.id));
  const legacy = entries.filter(e => ['expense', 'void'].includes(e.reference_type) && expenseIds.has(e.reference_id));
  const fx=entries.filter(e=>e.reference_type==='fx_revaluation');
  for (const currency of ['sdg', 'usd']) {
    const remaining = bills.reduce((n, b) => n.plus(billSignedBalance(b)[currency as 'sdg' | 'usd']), new BigNumber(0)).plus([...opening.values()].reduce((n,pair)=>n.plus(pair[currency as 'sdg'|'usd']),new BigNumber(0))).plus(amount(legacy, '2110', currency)).plus(amount(fx,'2110',currency)).toNumber();
    compare('journal_entries', 'AP-control', `outstanding_${currency}`, remaining, amount(entries, '2110', currency));
  }
  return findings;
}
