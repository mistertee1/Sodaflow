import { correctionGuestFixture } from './salesCorrections';
import { MemoryStore } from '../../../src/domain/store';
import { Operations } from '../../../src/domain/operations';
import { guestActor, guestId } from '../../fixtures/cloudIdentity';
export async function correctionDocumentFixture() {
  const fixture = await correctionGuestFixture(), store = new MemoryStore(fixture.records), ops = new Operations(store, () => new Date('2026-10-07T12:00:00Z')), root = `organizations/${guestId}`;
  const run = (action: string, data: Record<string, unknown>, operationId: string) => ops.execute(guestId, guestActor, { action, data, operationId });
  const rows = (name: string) => Object.entries(store.dump()).filter(([path]) => path.startsWith(`${root}/${name}/`)).map(([,row]) => row);
  const product = rows('products')[0], invoice = rows('invoices')[0];
  await run('journal.create', { reference_type:'opening_balance', date: '2026-10-07', description: 'افتتاح نقدي للمطابقة', lines: [{ account_code:'1120',debit_sdg:2000000,credit_sdg:0,debit_usd:1000,credit_usd:0 },{ account_code:'3900',debit_sdg:0,credit_sdg:2000000,debit_usd:0,credit_usd:1000 }] }, 'opening-cash');
  const supplier = (await run('supplier.create', { name:'مورد مستندات التصحيح',default_currency:'USD' }, 'supplier')).result;
  const bill = (await run('purchase.create', {supplier_id:supplier.id,supplier_reference:'PUR-DOC',issue_date:'2026-10-07',due_date:'2026-10-07',currency:'USD',exchange_rate_used:2000,settlement:'cash',payment_method:'cash',reason:'شراء موثق',items:[{product_id:product.id,quantity:1,unit_cost:20},{product_id:product.id,quantity:2,unit_cost:20}]}, 'buy')).result;
  await run('creditNote.create', {invoice_id:invoice.id,kind:'price_credit',date:'2026-10-07',reason:'تصحيح سعر متفق عليه',lines:[{line_id:'line-1',amount:20}]}, 'price');
  await run('creditNote.create', {invoice_id:invoice.id,kind:'sales_return',date:'2026-10-07',reason:'إرجاع بضاعة فعلية',lines:[{line_id:'line-1',quantity:1},{line_id:'line-2',quantity:2}]}, 'return-sale');
  await run('customerRefund.create', {invoice_id:invoice.id,date:'2026-10-07',reason:'رد نقدي للعميل',financial_account_id:fixture.cashId,amount:300,exchange_rate_used:3000}, 'refund-client');
  await run('purchaseReturn.create', {bill_id:bill.id,date:'2026-10-07',reason:'مردود بضاعة للمورد',lines:[{line_id:'line-1',quantity:1},{line_id:'line-2',quantity:2}]}, 'return-purchase');
  await run('supplierRefund.create', {bill_id:bill.id,date:'2026-10-07',reason:'تحصيل الاسترداد',financial_account_id:fixture.cashId,amount:60,exchange_rate_used:3000}, 'refund-supplier');
  return { ...fixture, store, ops, run, root, product, invoice, supplier, bill, records:store.dump(), documents:[['credit_note','cn-price'],['credit_note','cn-return-sale'],['customer_refund','refund-refund-client'],['purchase_return','pr-return-purchase'],['supplier_refund','sr-refund-supplier']] as const };
}
