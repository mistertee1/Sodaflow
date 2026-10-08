import BigNumber from 'bignumber.js';
import { openingBalancesForParty, readOpeningData } from './openingIntegration';
import type { Account, Invoice, JournalEntry, JournalEntryLine, Product } from '../types';
import type { Document, Transaction } from './store';
import type { PayableContext, PurchaseBill } from './payables';
import { assertOpenPeriod, dateOnly, ensure, identifier, money, text, validateJournal } from './validation';
import { journal, journalLine, paymentQuote } from './financial';
import { buildPurchaseReturnBases, returnSourceId } from './returnSources';
import { creditRefundLines, purchaseReturnLines, quoteCreditRefund, quoteReturnAllocation, type BookAmount, type ReturnAllocation } from './returnQuotes';
import { issueCost, validateCostState } from './inventoryCost';
import { validateFinancialAccount } from './cashManagement';
import { classifyAccount } from './accountClassification';
import { getDefaultChartOfAccounts } from '../services/accountingService';

export const purchaseCorrectionCollections = ['purchase_returns', 'supplier_refunds'] as const;
export const purchaseVarianceAccount = '5910';
const books = ['sdg', 'usd'] as const;
const zero = (): BookAmount => ({ sdg: 0, usd: 0 });
const add = (a: BookAmount, b: BookAmount): BookAmount => ({ sdg: new BigNumber(a.sdg).plus(b.sdg).toNumber(), usd: new BigNumber(a.usd).plus(b.usd).toNumber() });
const negate = (a: BookAmount): BookAmount => ({ sdg: -a.sdg, usd: -a.usd });
const same = (a: BookAmount, b: BookAmount) => books.every(book => typeof a?.[book] === 'number' && typeof b?.[book] === 'number' && new BigNumber(a[book]).eq(b[book]));
const value = (row: Document, prefix: string): BookAmount => {
  const result: BookAmount = { sdg: row[`${prefix}_sdg`] === undefined ? 0 : row[`${prefix}_sdg`], usd: row[`${prefix}_usd`] === undefined ? 0 : row[`${prefix}_usd`] };
  for (const book of books) { ensure(typeof result[book] === 'number', 'قيم دفتر المورد يجب أن تكون أرقاماً.'); money(Math.abs(result[book]), book === 'sdg' ? 0 : 2); } return result;
};
export const billSignedBalance = (bill: Document) => add(value(bill, 'remaining'), negate(value(bill, 'advance_balance')));
const sides = (lines: JournalEntryLine[]) => lines.map(line => [line.account_code, line.debit_sdg, line.credit_sdg, line.debit_usd, line.credit_usd]);
function postingAccounts(lines: JournalEntryLine[], accounts: Document[], active: boolean) {
  const groups: Record<string, string> = { '2110': 'payables', '1300': 'inventory', '5910': 'operating_expense', '4200': 'fx_gain', '5500': 'fx_loss' };
  for (const line of lines) { const account = accounts.find(row => row.code === line.account_code); ensure(account && (!active || account.is_active) && classifyAccount(account as Account).reporting_group === (groups[line.account_code] || 'cash_bank'), 'حساب مردود/استرداد المورد غير صالح.', 409); }
}
export function supplierPaymentLines(settled: BookAmount, cash: BookAmount, code: string) {
  const difference = add(cash, negate(settled));
  return [journalLine('2110', 'ذمم الموردين', settled.sdg, 0, settled.usd, 0), journalLine(code, 'النقد والبنوك', 0, cash.sdg, 0, cash.usd),
    ...((difference.sdg > 0 || difference.usd > 0) ? [journalLine('5500', 'خسائر فروق العملة', Math.max(0, difference.sdg), 0, Math.max(0, difference.usd), 0)] : []),
    ...((difference.sdg < 0 || difference.usd < 0) ? [journalLine('4200', 'أرباح فروق العملة', 0, Math.max(0, -difference.sdg), 0, Math.max(0, -difference.usd))] : [])];
}
/** Proves original receipt, sequenced settlements, frozen return WAC and supplier reimbursements. */
export function verifyPurchaseSource(bill: Document, data: Record<string, Document[]>, checkCaches = true) {
  const entries = data.journal_entries || [], payments = (data.supplier_payments || []).filter(row => row.bill_id === bill.id), returns = (data.purchase_returns || []).filter(row => row.bill_id === bill.id), refunds = (data.supplier_refunds || []).filter(row => row.bill_id === bill.id), accounts = data.accounts || [];
  const originals = entries.filter(entry => entry.reference_type === 'purchase_bill' && entry.reference_id === bill.id);
  const source = buildPurchaseReturnBases(bill as PurchaseBill & { payment_account_code: string }, originals as JournalEntry[], identifier(bill.org_id));
  postingAccounts(originals.flatMap(row => row.lines), accounts, false);
  const received = new Map<string, { quantity: BigNumber; cost: BookAmount }>();
  for (const line of bill.items) { const old = received.get(line.product_id) || { quantity: new BigNumber(0), cost: zero() }; received.set(line.product_id, { quantity: old.quantity.plus(line.quantity), cost: add(old.cost, { sdg: line.value_sdg, usd: line.value_usd }) }); }
  const originalMovements = (data.inventory_movements || []).filter(row => row.reference_type === 'purchase_bill' && row.reference_id === bill.id);
  ensure(originalMovements.length === received.size, 'حركات استلام الشراء الأصلية ناقصة أو مكررة.', 409);
  const usedProducts = new Set<string>();
  for (const movement of originalMovements) { const expected = received.get(movement.product_id); ensure(expected && !usedProducts.has(movement.product_id) && movement.type === 'PURCHASE' && movement.org_id === bill.org_id && movement.costing_version === 2 && movement.journal_id === bill.journal_id && typeof movement.quantity === 'number' && expected.quantity.eq(movement.quantity) && same(expected.cost, value(movement, 'value_delta')), 'حركة استلام الشراء لا تطابق المصدر.', 409); usedProducts.add(movement.product_id); }
  ensure(payments.length + returns.length + refunds.length <= 200, 'سجل الشراء تجاوز حد المعاملة؛ يلزم إجراء ترحيل خادمي.', 409);
  const events = [...payments.map(row => ({ row, kind: 'payment', sequence: row.source_sequence ?? row.sequence })), ...returns.map(row => ({ row, kind: 'return', sequence: row.source_sequence })), ...refunds.map(row => ({ row, kind: 'refund', sequence: row.source_sequence }))].sort((a,b) => a.sequence - b.sequence);
  let balance = bill.settlement === 'credit' ? value(bill, 'grand_total') : zero(), paid = bill.settlement === 'cash' ? value(bill, 'grand_total') : zero(), returned = zero(), refunded = zero(), lastDate = dateOnly(bill.issue_date), paymentSequence = 0, lastPaymentDate = '', correctionCount = 0;
  const histories = new Map<string, ReturnAllocation[]>(), eventIds = new Set<string>();
  const posting = (row: Document, type: string, date: string, lines: JournalEntryLine[], rate: number) => {
    const matches = entries.filter(entry => entry.reference_type === type && entry.reference_id === row.id);
    if (!lines.length) { ensure(!row.journal_id && !matches.length, 'المردود الصفري لا يجيز قيداً مختلقاً.', 409); return; }
    ensure(matches.length === 1, 'قيد تصحيح المورد ناقص أو مكرر.', 409); const entry = matches[0], totals = validateJournal(entry.lines); postingAccounts(lines, accounts, false);
    ensure(entry.id === row.journal_id && entry.org_id === bill.org_id && dateOnly(entry.date) === date && entry.exchange_rate_used === rate && entry.is_balanced && JSON.stringify(sides(entry.lines)) === JSON.stringify(sides(lines)) && Object.entries(totals).every(([key, amount]) => entry[key] === amount), 'قيد تصحيح المورد لا يطابق المصدر.', 409);
  };
  for (const [index, event] of events.entries()) {
    const row = event.row, date = dateOnly(event.kind === 'payment' ? row.payment_date : row.date); identifier(row.id);
    ensure(event.sequence === index + 1 && !eventIds.has(row.id) && row.org_id === bill.org_id && row.bill_id === bill.id && row.supplier_id === bill.supplier_id && date >= lastDate, 'تسلسل/تاريخ/مؤسسة حركة المورد غير صالح.', 409); eventIds.add(row.id); lastDate = date;
    if (event.kind === 'payment') {
      ensure(bill.settlement === 'credit' && row.sequence === ++paymentSequence && ['SDG','USD'].includes(row.currency), 'سند سداد المورد غير صالح.', 409); lastPaymentDate = date;
      const quote = paymentQuote({ ...bill, receivable_currency: bill.currency, remaining_sdg: balance.sdg, remaining_usd: balance.usd } as Invoice, row.amount, row.currency, row.exchange_rate_used);
      const settled = { sdg: quote.settledSdg, usd: quote.settledUsd }, cash = { sdg: quote.cashSdg, usd: quote.cashUsd };
      ensure(same(settled, value(row, 'settled_amount')) && same(cash, value(row, 'cash_amount')), 'قيمة سداد المورد لا تطابق تاريخ المصدر.', 409);
      posting(row, 'supplier_payment', date, supplierPaymentLines(settled, cash, row.payment_account_code), row.exchange_rate_used); balance = add(balance, negate(settled)); paid = add(paid, settled);
    } else if (event.kind === 'return') {
      text(row.reason, 500, true); ensure(row.native_currency === bill.currency && row.variance_account_code === purchaseVarianceAccount && Array.isArray(row.lines) && row.lines.length > 0 && row.lines.length <= 100 && Array.isArray(row.stock), 'مستند مردود المورد غير صالح.');
      const selected = new Set<string>(), expectedStock = new Map<string, BigNumber>(); let credit = zero(), inventory = zero();
      for (const line of row.lines) {
        ensure(line && Object.keys(line).every(key => ['line_id','sequence','quantity','components'].includes(key)), 'حقول مردود المورد غير صالحة.');
        const basis = source.bases.find(basis => basis.source_id === returnSourceId(bill.id, identifier(line.line_id))); ensure(basis && !selected.has(line.line_id), 'بند مردود المورد مفقود أو مكرر.'); selected.add(line.line_id);
        const previous = histories.get(basis.source_id) || [], quote = quoteReturnAllocation(basis, previous, line.quantity);
        ensure(line.sequence === quote.sequence && Object.keys(line.components || {}).length === 1 && same(line.components.supplier_credit, quote.components.supplier_credit), 'توزيع مردود المورد لا يطابق المصدر.', 409);
        const item = bill.items.find((item: Document) => item.id === line.line_id)!;
        expectedStock.set(item.product_id, (expectedStock.get(item.product_id) || new BigNumber(0)).plus(line.quantity)); credit = add(credit, quote.components.supplier_credit);
        histories.set(basis.source_id, [...previous, { id: row.id, source_id: basis.source_id, sequence: line.sequence, quantity: line.quantity, components: quote.components }]);
      }
      ensure(row.stock.length === expectedStock.size, 'تفاصيل مخزون المردود ناقصة أو مكررة.'); const stockIds = new Set<string>();
      for (const stock of row.stock) {
        const qty = expectedStock.get(stock.product_id); ensure(qty && !stockIds.has(stock.product_id) && qty.eq(stock.quantity), 'كمية مخزون مردود المورد مختلفة.', 409); stockIds.add(stock.product_id);
        const issued = issueCost({ ...stock.before, id: stock.product_id, track_inventory: true } as Product, stock.quantity, date);
        ensure(same(issued.delta, value(stock, 'inventory_out')) && Object.entries(issued.after).every(([key, val]) => stock.after?.[key] === val), 'تكلفة WAC المحفوظة للمردود غير صالحة.', 409); inventory = add(inventory, issued.delta);
        const movements = (data.inventory_movements || []).filter(m => m.reference_type === 'purchase_return' && m.reference_id === row.id && m.product_id === stock.product_id);
        ensure(movements.length === 1 && movements[0].type === 'PURCHASE_RETURN' && movements[0].org_id === bill.org_id && dateOnly(movements[0].date) === date && movements[0].journal_id === row.journal_id && movements[0].costing_version === 2 && typeof movements[0].quantity === 'number' && qty.negated().eq(movements[0].quantity) && same(negate(issued.delta), value(movements[0], 'value_delta')) && movements[0].previous_stock === stock.before.stock_quantity && movements[0].resulting_stock === issued.after.stock_quantity, 'حركة مخزون مردود المورد لا تطابق المصدر.', 409);
      }
      ensure((data.inventory_movements || []).filter(m => m.reference_type === 'purchase_return' && m.reference_id === row.id).length === row.stock.length, 'حركات مردود المورد مكررة.');
      const variance = add(credit, negate(inventory)); ensure(same(credit, value(row, 'supplier_credit')) && same(inventory, value(row, 'inventory_out')) && same(variance, value(row, 'variance')), 'إجماليات مردود المورد لا تطابق المصدر.', 409);
      const lines = credit.sdg || credit.usd || inventory.sdg || inventory.usd ? purchaseReturnLines(credit, inventory, purchaseVarianceAccount) : [];
      posting(row, 'purchase_return', date, lines, bill.exchange_rate_used); balance = add(balance, negate(credit)); returned = add(returned, credit); correctionCount++;
    } else {
      text(row.reason, 500, true); ensure(row.native_currency === bill.currency && balance.sdg <= 0 && balance.usd <= 0, 'لا يوجد رصيد مورد مدين قابل للاسترداد.', 409);
      const account = (data.financial_accounts || []).find(account => account.id === row.financial_account_id); ensure(account && row.payment_account_code === account.account_code && row.currency === account.currency, 'حساب استرداد المورد مختلف.'); validateFinancialAccount(account, accounts);
      const quote = quoteCreditRefund(negate(balance), bill.currency, row.amount, row.currency, row.exchange_rate_used);
      ensure(same(negate(balance), value(row, 'available_advance')) && same(quote.settled, value(row, 'settled_amount')) && same(quote.cash, value(row, 'cash_amount')), 'قيمة استرداد المورد لا تطابق رصيد المصدر.', 409);
      posting(row, 'supplier_refund', date, creditRefundLines(quote, account.account_code, 'supplier'), row.exchange_rate_used); balance = add(balance, quote.settled); refunded = add(refunded, quote.settled);
    }
  }
  if (checkCaches) {
    for (const book of books) { money(bill[`remaining_${book}`], book === 'sdg' ? 0 : 2); money(bill[`advance_balance_${book}`] ?? 0, book === 'sdg' ? 0 : 2); ensure(!(bill[`remaining_${book}`] > 0 && bill[`advance_balance_${book}`] > 0), 'الدين والسلفة لا يجتمعان للمصدر.'); }
    ensure(same(balance, billSignedBalance(bill)) && same(paid, value(bill, 'paid_amount')) && same(returned, value(bill, 'returned_amount')) && same(refunded, value(bill, 'refunded_amount')), 'رصيد فاتورة المورد لا يطابق مصادره.', 409);
    ensure((bill.source_event_sequence ?? payments.length) === events.length && (bill.payment_sequence || 0) === paymentSequence && (!paymentSequence || bill.last_payment_date === lastPaymentDate) && (bill.correction_count || 0) === correctionCount, 'عداد مصدر المورد لا يطابق سجله.', 409);
    ensure(bill.status === (balance.sdg > 0 || balance.usd > 0 ? paid.sdg || paid.usd ? 'partially_paid' : 'open' : 'paid'), 'حالة المورد لا تطابق المصدر.', 409);
  }
  return { source, balance, paid, returned, refunded, lastDate, sequence: events.length, paymentSequence, correctionCount, histories, entries: entries as JournalEntry[], accounts: accounts as Account[] };
}
export async function loadPurchaseSource(tx: Transaction, root: string, bill: Document) {
  ensure(bill.org_id === root.split('/')[1], 'مصدر المورد يتبع مؤسسة أخرى.', 403);
  const names = ['journal_entries','supplier_payments','purchase_returns','supplier_refunds','inventory_movements','accounts','financial_accounts'];
  const rows = await Promise.all(names.map(name => name === 'supplier_payments' || name === 'purchase_returns' || name === 'supplier_refunds' ? tx.find(`${root}/${name}`, 'bill_id', bill.id) : tx.list(`${root}/${name}`)));
  return verifyPurchaseSource(bill, Object.fromEntries(names.map((name,i) => [name, rows[i]])));
}
export function purchaseCaches(bill: Document, state: ReturnType<typeof verifyPurchaseSource>, iso: string) {
  return { ...bill, remaining_sdg: Math.max(0,state.balance.sdg), remaining_usd: Math.max(0,state.balance.usd), advance_balance_sdg: Math.max(0,-state.balance.sdg), advance_balance_usd: Math.max(0,-state.balance.usd), paid_amount_sdg: state.paid.sdg, paid_amount_usd: state.paid.usd, returned_amount_sdg: state.returned.sdg, returned_amount_usd: state.returned.usd, refunded_amount_sdg: state.refunded.sdg, refunded_amount_usd: state.refunded.usd, source_event_sequence: state.sequence, payment_sequence: state.paymentSequence, correction_count: state.correctionCount, status: state.balance.sdg > 0 || state.balance.usd > 0 ? state.paid.sdg || state.paid.usd ? 'partially_paid' : 'open' : 'paid', updated_at: iso };
}
export async function savePurchaseSupplier(c: PayableContext, supplier: Document, updated: Document) {
  const existing = (await c.tx.list(`${c.root}/purchase_bills`)).filter(row => row.supplier_id === supplier.id);
  const opening=openingBalancesForParty(await readOpeningData(c.tx,c.root),'payable',supplier.id);
  for (const book of books) for (const prefix of ['payable_due','advance_balance']) if (supplier[`${prefix}_${book}`] !== undefined) ensure(existing.reduce((sum,row) => sum.plus(row[`${prefix === 'payable_due' ? 'remaining' : prefix}_${book}`] || 0), new BigNumber(prefix==='payable_due'?opening[book]:0)).eq(supplier[`${prefix}_${book}`]), 'رصيد المورد المفصل لا يطابق مصادره.', 409);
  const bills = [...existing.filter(row => row.id !== updated.id), updated]; const due = bills.reduce<BookAmount>((sum,row) => add(sum,value(row,'remaining')), opening), advance = bills.reduce<BookAmount>((sum,row) => add(sum,value(row,'advance_balance')), zero());
  c.set(`${c.root}/suppliers/${supplier.id}`, { ...supplier, payable_due_sdg: due.sdg, payable_due_usd: due.usd, advance_balance_sdg: advance.sdg, advance_balance_usd: advance.usd, updated_at: c.iso });
}
export async function purchaseCorrectionCommand(action: string, data: Document, c: PayableContext) {
  const bill = await c.required('purchase_bills', data.bill_id), state = await loadPurchaseSource(c.tx,c.root,bill), supplier = await c.required('suppliers',bill.supplier_id);
  const date = dateOnly(data.date), reason = text(data.reason,500,true); assertOpenPeriod(date,c.settings); ensure(date >= state.lastDate, 'تاريخ تصحيح المورد قبل آخر حركة للمصدر.',409); ensure(state.sequence < 200, 'سجل الشراء تجاوز حد المعاملة.',409);
  const stamp = { org_id:c.orgId, bill_id:bill.id, supplier_id:bill.supplier_id, supplier_reference:bill.supplier_reference, native_currency:bill.currency, date, reason, source_sequence:state.sequence+1, created_by:c.actor, created_at:c.iso, operation_id:c.operationId, schema_version:3 };
  let result: Document;
  const chart = [...getDefaultChartOfAccounts(c.orgId).filter(account=>!state.accounts.some(row=>row.code===account.code)),...state.accounts];
  if (action === 'purchaseReturn.create') {
    ensure(Object.keys(data).every(key=>['bill_id','date','reason','lines'].includes(key)) && Array.isArray(data.lines) && data.lines.length>0 && data.lines.length<=100,'أرسل مصدر وكمية المردود فقط.');
    const id = `pr-${c.operationId}`; ensure(!await c.tx.get(`${c.root}/purchase_returns/${id}`),'معرّف المردود موجود؛ لا يجوز استبدال مستند مالي.',409);
    let credit = zero(), inventory = zero(); const selected = new Set<string>(), quantities = new Map<string,BigNumber>();
    const lines = data.lines.map((line: Document)=>{
      ensure(line && Object.keys(line).every(key=>['line_id','quantity'].includes(key)),'حقول بند مردود المورد غير صالحة.'); const lineId = identifier(line.line_id), basis = state.source.bases.find(basis=>basis.source_id===returnSourceId(bill.id,lineId)); ensure(basis && !selected.has(lineId),'بند مردود المورد مفقود أو مكرر.'); selected.add(lineId);
      const quote = quoteReturnAllocation(basis,state.histories.get(basis.source_id)||[],line.quantity), item = bill.items.find((item:Document)=>item.id===lineId)!; credit = add(credit,quote.components.supplier_credit); quantities.set(item.product_id,(quantities.get(item.product_id)||new BigNumber(0)).plus(line.quantity)); return { line_id:lineId, quantity:line.quantity, sequence:quote.sequence, components:quote.components };
    });
    const stock: Document[] = [];
    for (const [productId,quantity] of quantities) { const product=await c.required('products',productId) as Product, before=validateCostState(product), issued=issueCost(product,quantity.toNumber(),date); inventory=add(inventory,issued.delta); stock.push({ product_id:productId, product_name:product.name, quantity:quantity.toNumber(), before, after:issued.after, inventory_out_sdg:issued.delta.sdg, inventory_out_usd:issued.delta.usd }); }
    const posting = credit.sdg || credit.usd || inventory.sdg || inventory.usd ? purchaseReturnLines(credit,inventory,purchaseVarianceAccount) : [], journalId = posting.length ? `jv-purchase-return-${c.operationId}` : undefined;
    postingAccounts(posting,chart,true); if(journalId) await c.post(journal(journalId,c.orgId,c.actor,date,'purchase_return',id,`مردود شراء ${bill.supplier_reference}: ${reason}`,posting,bill.exchange_rate_used));
    for(const [index,row] of stock.entries()) { c.set(`${c.root}/products/${row.product_id}`,{ ...await c.required('products',row.product_id),...row.after }); const movementId=`mov-purchase-return-${c.operationId}-${index+1}`; c.set(`${c.root}/inventory_movements/${movementId}`,{ ...stamp,id:movementId,product_id:row.product_id,product_name:row.product_name,type:'PURCHASE_RETURN',quantity:-row.quantity,previous_stock:row.before.stock_quantity,resulting_stock:row.after.stock_quantity,reference_type:'purchase_return',reference_id:id,value_delta_sdg:-row.inventory_out_sdg,value_delta_usd:-row.inventory_out_usd,costing_version:2,...(journalId?{journal_id:journalId}:{}) }); c.counterAdd('inventory_movement_count',1); }
    const variance=add(credit,negate(inventory)); result={ ...stamp,id,lines,stock,supplier_credit_sdg:credit.sdg,supplier_credit_usd:credit.usd,inventory_out_sdg:inventory.sdg,inventory_out_usd:inventory.usd,variance_sdg:variance.sdg,variance_usd:variance.usd,variance_account_code:purchaseVarianceAccount,...(journalId?{journal_id:journalId}:{}) }; state.balance=add(state.balance,negate(credit)); state.returned=add(state.returned,credit); state.correctionCount++;
    c.set(`${c.root}/purchase_returns/${id}`,result); c.counterAdd('purchase_return_count',1);
  } else {
    ensure(action==='supplierRefund.create' && Object.keys(data).every(key=>['bill_id','date','reason','amount','financial_account_id','exchange_rate_used'].includes(key)),'طلب استرداد المورد غير صالح.'); ensure(state.balance.sdg<=0 && state.balance.usd<=0,'لا يوجد رصيد مورد مدين قابل للاسترداد.',409);
    const account=await c.required('financial_accounts',data.financial_account_id); validateFinancialAccount(account,state.accounts); ensure(account.status==='active' && state.accounts.find(row=>row.code===account.account_code)?.is_active,'حساب الاسترداد غير نشط.'); ensure((await c.tx.get(`${c.root}/financial_account_mappings/${account.account_code}`))?.id===account.id,'ربط حساب الاسترداد يحتاج مراجعة.');
    const available=negate(state.balance), rate=data.exchange_rate_used??bill.exchange_rate_used, quote=quoteCreditRefund(available,bill.currency,data.amount,account.currency,rate), posting=creditRefundLines(quote,account.account_code,'supplier'), id=`sr-${c.operationId}`, journalId=`jv-supplier-refund-${c.operationId}`; ensure(!await c.tx.get(`${c.root}/supplier_refunds/${id}`),'معرّف الاسترداد موجود؛ لا يجوز استبدال مستند مالي.',409); postingAccounts(posting,chart,true); await c.post(journal(journalId,c.orgId,c.actor,date,'supplier_refund',id,`استرداد مورد ${bill.supplier_reference}: ${reason}`,posting,rate));
    result={ ...stamp,id,financial_account_id:account.id,payment_account_code:account.account_code,currency:account.currency,amount:data.amount,exchange_rate_used:rate,available_advance_sdg:available.sdg,available_advance_usd:available.usd,settled_amount_sdg:quote.settled.sdg,settled_amount_usd:quote.settled.usd,cash_amount_sdg:quote.cash.sdg,cash_amount_usd:quote.cash.usd,journal_id:journalId }; state.balance=add(state.balance,quote.settled); state.refunded=add(state.refunded,quote.settled); c.set(`${c.root}/supplier_refunds/${id}`,result); c.counterAdd('supplier_refund_count',1); c.set(`${c.root}/financial_accounts/${account.id}`,{ ...account,revision:(account.revision||0)+1,last_supplier_refund_id:id,updated_at:c.iso });
  }
  state.sequence++; const updated=purchaseCaches(bill,state,c.iso); await savePurchaseSupplier(c,supplier,updated); c.set(`${c.root}/purchase_bills/${bill.id}`,updated); return result;
}
export function reconcilePurchaseCorrections(data: Record<string,Document[]>) {
  const findings: {code:string;collection:string;id:string;message:string}[]=[];
  const inspect=(collection:string,id:string,work:()=>void)=>{try{work();}catch(error){findings.push({code:'invalid_record',collection,id,message:error instanceof Error?error.message:'غير صالح'});}};
  for(const bill of data.purchase_bills||[]) if(bill.source_event_sequence!==undefined || (data.purchase_returns||[]).some(row=>row.bill_id===bill.id) || (data.supplier_refunds||[]).some(row=>row.bill_id===bill.id)) inspect('purchase_bills',bill.id,()=>{verifyPurchaseSource(bill,data);});
  for(const name of purchaseCorrectionCollections) for(const row of data[name]||[]) inspect(name,row.id,()=>{ensure((data.purchase_bills||[]).some(bill=>bill.id===row.bill_id),'مصدر تصحيح المورد مفقود.');});
  for(const entry of data.journal_entries||[]) if(['purchase_return','supplier_refund'].includes(entry.reference_type)) inspect('journal_entries',entry.id,()=>{ensure((data[entry.reference_type==='purchase_return'?'purchase_returns':'supplier_refunds']||[]).some(row=>row.id===entry.reference_id),'مستند تصحيح المورد مفقود.');});
  for(const movement of data.inventory_movements||[]) if(movement.reference_type==='purchase_return' || movement.type==='PURCHASE_RETURN') inspect('inventory_movements',movement.id,()=>{ensure(movement.reference_type==='purchase_return' && (data.purchase_returns||[]).some(row=>row.id===movement.reference_id),'مصدر حركة مردود المورد مفقود.');});
  return findings;
}
