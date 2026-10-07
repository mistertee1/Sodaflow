import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { correctionDocumentFixture } from './ui/helpers/correctionDocuments';
import { guestActor, guestId } from '../src/services/guestStore';
import { Operations } from '../src/domain/operations';
import type { Store } from '../src/domain/store';
import { createApi } from '../server/api';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';
import { ledgerTrialBalance, ledgerBalanceSheet } from '../src/domain/ledgerReports';

const financial = ['products','invoices','payments','credit_notes','customer_refunds','suppliers','purchase_bills','supplier_payments','purchase_returns','supplier_refunds','journal_entries','inventory_movements','financial_accounts','internal_transfers'];
test('B3 correction exports re-prove saved sources, preserve both books and audit exact source IDs without mutating financial history', async () => {
  const f = await correctionDocumentFixture(), before = f.store.dump();
  for (const [kind,id] of f.documents) {
    const response = await f.run('correctionDocument.export',{kind,id},`export-${id}`), doc = response.result;
    assert.equal(doc.document_type,kind); assert.equal(doc.document.id,id); assert.equal(doc.schema_version,1); assert.equal(doc.organization_id,guestId);
    assert.equal(doc.source.number,kind==='credit_note'||kind==='customer_refund'?f.invoice.invoice_number:f.bill.supplier_reference);
    assert.equal(doc.business.name,'متجر الاختبار');assert.equal(doc.document.created_by,guestActor.uid);
    const audit=f.store.dump()[`${f.root}/audit_logs/audit-export-${id}`];assert.equal(audit.event_type,'DATA_EXPORT_CREATED');assert.equal(audit.export_metadata.document_id,id);assert.equal(audit.export_metadata.source_id,doc.source.id);
    assert.deepEqual(await f.run('correctionDocument.export',{kind,id},`export-${id}`),response);
  }
  for (const [path,row] of Object.entries(before)) if(financial.some(name=>path.startsWith(`${f.root}/${name}/`))) assert.deepEqual(f.store.dump()[path],row);
});
test('B3 correction export rejects unauthorized, expired and suspended cached requests, browser authority and malformed/foreign document inputs',async()=>{
  const f=await correctionDocumentFixture(),data={kind:'purchase_return',id:'pr-return-purchase'};
  await f.run('correctionDocument.export',data,'cached');
  for(const payload of [{kind:'../../journal_entries',id:'pr-return-purchase'},{...data,id:'foreign'},{...data,source:f.bill},{...data,id:'../foreign'}]){const before=f.store.dump();await assert.rejects(f.run('correctionDocument.export',payload,crypto.randomUUID()));assert.deepEqual(f.store.dump(),before);}
  await f.store.transaction(async tx=>tx.set(`${f.root}/members/sales`,{uid:'sales',role:'Sales',status:'active'}));await assert.rejects(f.ops.execute(guestId,{...guestActor,uid:'sales'},{action:'correctionDocument.export',data,operationId:'sales'}),/صلاحية/);
  const browser:Store={authority:'browser',transaction:work=>f.store.transaction(work)};await assert.rejects(new Operations(browser).execute(guestId,guestActor,{action:'correctionDocument.export',data,operationId:'cached'}),/الخادم/);
  const accountant={...guestActor,uid:'document-accountant'};await f.store.transaction(async tx=>tx.set(`${f.root}/members/${accountant.uid}`,{uid:accountant.uid,role:'Accountant',status:'active'}));await f.ops.execute(guestId,accountant,{action:'correctionDocument.export',data,operationId:'accountant-cached'});await f.store.transaction(async tx=>tx.set(`${f.root}/members/${accountant.uid}`,{uid:accountant.uid,role:'Accountant',status:'suspended'}));await assert.rejects(f.ops.execute(guestId,accountant,{action:'correctionDocument.export',data,operationId:'accountant-cached'}),/عضوية|معلق|موقوف|نشط/);
  await f.store.transaction(async tx=>{tx.set(`${f.root}/members/guest`,{uid:'guest',role:'Owner',status:'active'});tx.set(f.root,{...await tx.get(f.root),planId:'Enterprise',subscriptionEnd:'2026-10-01'});});await assert.rejects(f.run('correctionDocument.export',data,'cached'),/اشتراك|انتهى|منتهي/);
});
test('B3 correction export refuses altered posted amounts, missing original acquisition and other-tenant source records before audit commit',async()=>{
  const f=await correctionDocumentFixture(),path=`${f.root}/purchase_returns/pr-return-purchase`,saved=f.store.dump()[path];
  await f.store.transaction(async tx=>tx.set(path,{...saved,supplier_credit_usd:61}));const before=f.store.dump();await assert.rejects(f.run('correctionDocument.export',{kind:'purchase_return',id:saved.id},'tampered'),/تطابق/);assert.deepEqual(f.store.dump(),before);await f.store.transaction(async tx=>tx.set(path,saved));
  const movement=Object.entries(f.store.dump()).find(([,row])=>row.type==='PURCHASE'&&row.reference_id===f.bill.id)!;await f.store.transaction(async tx=>tx.delete(movement[0]));await assert.rejects(f.run('correctionDocument.export',{kind:'supplier_refund',id:'sr-refund-supplier'},'missing'),/استلام الشراء/);await f.store.transaction(async tx=>tx.set(movement[0],movement[1]));
  await f.store.transaction(async tx=>tx.set(path,{...saved,org_id:'foreign'}));await assert.rejects(f.run('correctionDocument.export',{kind:'purchase_return',id:saved.id},'tenant'),/مؤسسة أخرى/);
});
test('B3 real HTTP correction export returns authorized evidence only and refuses forged content and unauthenticated calls',async()=>{
  const f=await correctionDocumentFixture(),app=express();app.use(express.json());app.use('/api',createApi({operations:f.ops,verify:async token=>{if(token!=='valid')throw Error('bad');return guestActor;}}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${(server.address() as any).port}/api/organizations/${guestId}/operations`,send=(data:any,id:string,auth=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer valid'}:{})},body:JSON.stringify({action:'correctionDocument.export',data,operationId:id})});
  try{assert.equal((await send({kind:'credit_note',id:'cn-price'},'unauth',false)).status,401);assert.equal((await send({kind:'credit_note',id:'cn-price',html:'<script>'},'forged')).status,400);const response=await send({kind:'credit_note',id:'cn-price'},'http');assert.equal(response.status,200);const doc=(await response.json()).result;assert.equal(doc.document.credit_usd,20);assert.equal(doc.lines[0].description,'منتج الاختبار');assert.equal(doc.accounts,undefined);assert.equal(doc.settings,undefined);assert.equal(doc.source.currency,'USD');}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
test('B3 integrated purchases, partial/final payments, returns/refunds, expense, cash reconciliation and restore leave zero dual-book source differences',async()=>{
  const f=await correctionDocumentFixture(),buy={supplier_id:f.supplier.id,supplier_reference:'FULL-CREDIT',issue_date:'2026-10-07',due_date:'2026-10-07',currency:'USD',exchange_rate_used:2000,settlement:'credit',reason:'شراء الدورة',items:[{product_id:f.product.id,quantity:4,unit_cost:10}]};
  const bill=(await f.run('purchase.create',buy,'cycle-buy')).result;
  const invoice=(await f.run('invoice.create',{customer_id:f.invoice.customer_id,issue_date:'2026-10-07',currency_mode:'single_usd',exchange_rate_used:2000,discount_type:'fixed',discount_value:0,items:[{product_id:f.product.id,description:'بيع الدورة',unit:'قطعة',quantity:2,unit_price:50,currency:'USD',tax_rate:0,discount_percent:0}]},'cycle-sale')).result;
  const check=async()=>{const snap=await f.ops.snapshot(guestId,guestActor,true);assert.deepEqual(reconcileFinancialData(snap.collections as FinancialData,snap.settings,{requireCosting:true}),[]);assert.equal(ledgerTrialBalance(snap.collections.accounts as any,snap.collections.journal_entries as any).isBalanced,true);return snap;};
  await check();
  for(const [index,amount] of [40,60].entries()){await f.run('payment.create',{invoice_id:invoice.id,amount,currency:'USD',exchange_rate_used:index?3000:2500,payment_method:'cash'},`cycle-payment-${index}`);await check();}
  await f.run('creditNote.create',{invoice_id:invoice.id,kind:'sales_return',date:'2026-10-07',reason:'مردود الدورة',lines:[{line_id:'line-1',quantity:1}]},'cycle-sales-return');await f.run('customerRefund.create',{invoice_id:invoice.id,date:'2026-10-07',reason:'رد الدورة',financial_account_id:f.cashId,amount:50,exchange_rate_used:3500},'cycle-customer-refund');await check();
  for(const [index,amount] of [20,20].entries()){await f.run('supplierPayment.create',{bill_id:bill.id,amount,currency:'USD',exchange_rate_used:index?3000:2500,payment_date:'2026-10-07',payment_method:'cash'},`cycle-supplier-payment-${index}`);await check();}
  await f.run('purchaseReturn.create',{bill_id:bill.id,date:'2026-10-07',reason:'مردود شراء الدورة',lines:[{line_id:'line-1',quantity:1}]},'cycle-purchase-return');await f.run('supplierRefund.create',{bill_id:bill.id,date:'2026-10-07',reason:'استرداد الدورة',financial_account_id:f.cashId,amount:10,exchange_rate_used:3500},'cycle-supplier-refund');
  const bank=(await f.run('financialAccount.create',{name:'بنك الدورة',account_code:'1130',currency:'USD',kind:'bank'},'cycle-bank')).result;
  await f.run('cashTransfer.create',{from_id:f.cashId,to_id:bank.id,date:'2026-10-07',amount:40,reason:'تحويل للبنك'},'cycle-transfer');
  await f.run('expense.create',{title:'مصروف الدورة',category:'rent',date:'2026-10-07',amount:5,currency:'USD',exchange_rate_used:3000,payment_method:'custom',payment_account_code:'1130'},'cycle-expense');let snap=await check();
  const bankLedger=await f.ops.operationalReport(guestId,guestActor,'ledger',{accountCode:'1130',start:'2026-10-07',end:'2026-10-07'}),statementLines=bankLedger.rows.map((row,i)=>({id:`bank-line-${i}`,date:row.date,direction:row.debit.USD>0?'inflow':'outflow',amount:Math.abs(row.debit.USD-row.credit.USD),reference:row.reference_id,description:row.description}));
  const bankMatch=await f.run('bankReconciliation.create',{financial_account_id:bank.id,period:{start:'2026-10-07',end:'2026-10-07'},statement_opening:bankLedger.opening.USD,statement_closing:bankLedger.closing.USD,statement_lines:statementLines,matches:bankLedger.rows.map((row,i)=>({statement_line_id:`bank-line-${i}`,journal_id:row.journal_id,line_index:row.line_index})),difference_reason:''},'cycle-bank-match');assert.equal(bankMatch.result.status,'matched');assert.equal(bankMatch.result.difference,0);

  const cash=await f.ops.operationalReport(guestId,guestActor,'ledger',{accountCode:'1120',end:'2026-10-07'});const count=await f.run('cashCount.create',{financial_account_id:f.cashId,date:'2026-10-07',actual_count:cash.closing.USD,difference_reason:''},'cycle-count');assert.equal(count.result.difference,0);assert.equal(count.result.status,'matched');snap=await check();
  assert.equal((await f.ops.payableReports(guestId,guestActor)).unallocated_usd,0);assert.equal((await f.ops.payableReports(guestId,guestActor)).total_usd,0);const ar=await f.ops.operationalReport(guestId,guestActor,'receivables',{end:'2026-10-07'});assert.equal(ar.total_usd,0);assert.equal(ar.unallocated_usd,0);
  const balance=ledgerBalanceSheet(snap.collections.accounts as any,snap.collections.journal_entries as any);assert.equal(balance.is_balanced,true);assert.equal(balance.variance_sdg,0);assert.equal(balance.variance_usd,0);
  const actor={...guestActor,uid:'restore-cycle',email:'restore-cycle@example.com',emailVerified:true},target=await new Organizations(f.store).create(actor,'استعادة الدورة',INITIAL_SETTINGS,'restore-org',true);await f.store.transaction(async tx=>tx.set(`organizations/${target.id}`,{...await tx.get(`organizations/${target.id}`),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));const dropped=structuredClone(snap);delete dropped.collections.audit_logs;await assert.rejects(f.ops.execute(target.id,actor,{action:'backup.restore',operationId:'dropped-audit',data:{backup:dropped}}),/تدقيق النسخة ناقصة/);await f.ops.execute(target.id,actor,{action:'backup.restore',operationId:'restore-cycle',data:{backup:snap}});const restored=await f.ops.snapshot(target.id,actor,true);assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData,restored.settings,{requireCosting:true}),[]);
  const normalize=(rows:any[])=>rows.map(row=>{const copy=structuredClone(row);delete copy.org_id;return copy;}).sort((a,b)=>String(a.id||a.code).localeCompare(String(b.id||b.code)));
  for(const name of [...financial,'cash_reconciliations','bank_reconciliations'])assert.deepEqual(normalize(restored.collections[name]),normalize(snap.collections[name]),name);
  assert.deepEqual(normalize(restored.collections.audit_archives.map(row=>row.source_event)),normalize(snap.collections.audit_logs));assert.equal(restored.org.owner_uid,actor.uid);assert.equal(restored.collections.audit_logs.some(row=>row.action==='backup.restore'),true);
  const secondActor={...actor,uid:'restore-cycle-second'},second=await new Organizations(f.store).create(secondActor,'استعادة ثانية',INITIAL_SETTINGS,'second-org',true);await f.store.transaction(async tx=>tx.set(`organizations/${second.id}`,{...await tx.get(`organizations/${second.id}`),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));const missing=structuredClone(restored);delete missing.collections.audit_archives;await assert.rejects(f.ops.execute(second.id,secondActor,{action:'backup.restore',operationId:'missing-archives',data:{backup:missing}}),/أرشيف التدقيق ناقص/);const bad=structuredClone(restored);bad.collections.audit_archives[0].source_event.action='forged';const before=f.store.dump();await assert.rejects(f.ops.execute(second.id,secondActor,{action:'backup.restore',operationId:'bad-archive',data:{backup:bad}}),/بصمة أرشيف/);assert.deepEqual(f.store.dump(),before);
  await f.ops.execute(second.id,secondActor,{action:'backup.restore',operationId:'second-restore',data:{backup:restored}});const twice=await f.ops.snapshot(second.id,secondActor,true);for(const old of restored.collections.audit_archives)assert.deepEqual(twice.collections.audit_archives.find(row=>row.id===old.id)?.source_event,old.source_event);

});
