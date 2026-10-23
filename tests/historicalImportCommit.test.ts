import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/domain/store';
import { Operations, type Actor } from '../src/domain/operations';
import { Organizations } from '../server/organizations';
import { INITIAL_SETTINGS } from '../src/data/initialData';
import type { HistoricalImportRow } from '../src/domain/historicalImport';
import type { HistoricalDocumentEvidence } from '../src/domain/historicalDocumentEvidence';
import { costState } from '../src/domain/inventoryCost';
import { journal, journalLine } from '../src/domain/financial';
import { reconcileFinancialData, type FinancialData } from '../src/domain/reconciliation';

const now=new Date('2026-10-18T23:30:00Z');
const owner:Actor={uid:'owner',email:'owner@example.com',emailVerified:true,authTime:Math.floor(now.getTime()/1000)};
const accountant:Actor={uid:'accountant',email:'accountant@example.com',emailVerified:true};
const journalRow=(overrides:Partial<HistoricalImportRow>={}):HistoricalImportRow=>({row_number:1,kind:'journal',reference:'HIST-J-1',date:'2026-01-10',currency:'SDG',branch_id:'main',lines:[{account_code:'5200',debit:100,credit:0},{account_code:'4100',debit:0,credit:100}],...overrides});

async function fixture(){
  const store=new MemoryStore(),org=await new Organizations(store).create(owner,'Historical commit',{...INITIAL_SETTINGS},'setup',true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{
    tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionEnd:'2027-01-01'});
    tx.set(`${root}/members/accountant`,{uid:'accountant',role:'Accountant',status:'active',org_id:org.id});
    tx.set(`${root}/accounting_periods/2026`,{id:'2026',org_id:org.id,schema_version:1,start_date:'2026-01-01',end_date:'2026-01-31',status:'OPEN',revision:1,created_by:'owner',created_at:'2026-01-01',operation_id:'period'});
  });
  const ops=new Operations(store,()=>now),stage=async(rows:HistoricalImportRow[],operationId='history-stage',document_evidence?:Record<string,HistoricalDocumentEvidence>)=>(await ops.execute(org.id,accountant,{action:'historicalImport.stage',operationId,data:{file_name:'history.xlsx',file_hash:'e'.repeat(64),schema_version:1,rows,...(document_evidence?{document_evidence}:{})}})).result;
  const commit=async(session:Record<string,any>,operationId='history-commit')=>ops.execute(org.id,accountant,{action:'historicalImport.commit',operationId,data:{id:session.id,expected_rows_sha256:session.rows_sha256,expected_validation_context_sha256:session.validation_context_sha256,...(session.document_evidence_sha256?{expected_document_evidence_sha256:session.document_evidence_sha256}:{}),reason:'اعتماد تاريخي مراجع'}});
  return{store,org,root,ops,stage,commit};
}

async function seedSalesBaseline(f:Awaited<ReturnType<typeof fixture>>){
  const date='2026-01-01',opening=journal('jv-opening-product-1',f.org.id,'owner',date,'inventory','opening-product-1','مخزون افتتاحي موثق',[journalLine('1300','المخزون',1000),journalLine('3100','رأس المال',0,1000)]);
  await f.store.transaction(async tx=>{
    tx.set(`${f.root}/customers/customer-1`,{id:'customer-1',org_id:f.org.id,name:'Historical customer',phone:'',preferred_currency:'SDG',balance_sdg:0,balance_usd:0,created_at:date,updated_at:date,schema_version:3});
    tx.set(`${f.root}/products/product-1`,{id:'product-1',org_id:f.org.id,name:'Historical product',unit:'قطعة',price_sdg:50,price_usd:0,tax_rate:0,is_active:true,track_inventory:true,...costState(10,1000,0,date),created_at:date,created_by:'owner',schema_version:3});
    tx.set(`${f.root}/inventory_movements/opening-product-1`,{id:'opening-product-1',org_id:f.org.id,product_id:'product-1',product_name:'Historical product',type:'OPENING_BALANCE',quantity:10,previous_stock:0,resulting_stock:10,reference_type:'manual',reference_id:'opening-product-1',value_delta_sdg:1000,value_delta_usd:0,unit_cost_sdg:100,unit_cost_usd:0,costing_version:2,journal_id:opening.id,operation_id:'opening-product-1',branch_id:'main',created_by:'owner',created_at:date,schema_version:3});
    tx.set(`${f.root}/journal_entries/${opening.id}`,opening as unknown as Record<string,unknown>);
  });
  const snapshot=await f.ops.snapshot(f.org.id,owner,true);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
}

const salesRow=(overrides:Partial<HistoricalImportRow>={}):HistoricalImportRow=>({row_number:7,kind:'invoice',reference:'INV-H-7',date:'2026-01-10',currency:'SDG',branch_id:'main',account_code:'4100',counterparty_code:'customer-1',total:100,paid:40,debit:100,credit:100,...overrides});
const salesEvidence=(overrides:Partial<HistoricalDocumentEvidence>={}):HistoricalDocumentEvidence=>({party_id:'customer-1',due_date:'2026-02-10',exchange_rate_used:0,control_account_code:'1200',lines:[{product_id:'product-1',description:'بضاعة تاريخية',quantity:2,net:100,tax:0,cogs:200}],payments:[{date:'2026-01-20',amount:40,account_code:'1110',exchange_rate_used:0,reference:'RCPT-H-7'}],...overrides});

const purchaseRow=(overrides:Partial<HistoricalImportRow>={}):HistoricalImportRow=>({row_number:11,kind:'purchase',reference:'PB-H-11',date:'2026-01-10',currency:'SDG',branch_id:'main',account_code:'1300',counterparty_code:'supplier-1',total:100,paid:40,debit:100,credit:100,...overrides});
const purchaseEvidence=(overrides:Partial<HistoricalDocumentEvidence>={}):HistoricalDocumentEvidence=>({party_id:'supplier-1',due_date:'2026-02-10',exchange_rate_used:0,control_account_code:'2110',lines:[{product_id:'product-1',description:'استلام تاريخي',quantity:2,net:100,tax:0,inventory_value:100}],payments:[{date:'2026-01-20',amount:40,account_code:'1110',exchange_rate_used:0,reference:'SP-H-11'}],...overrides});
async function seedPurchaseBaseline(f:Awaited<ReturnType<typeof fixture>>){
  await seedSalesBaseline(f);
  await f.store.transaction(async tx=>tx.set(`${f.root}/suppliers/supplier-1`,{id:'supplier-1',org_id:f.org.id,name:'مورد تاريخي',phone:'',email:'',address:'',tax_number:'',default_currency:'SDG',payment_terms_days:0,credit_limit:0,status:'active',notes:'',payable_due_sdg:0,payable_due_usd:0,advance_balance_sdg:0,advance_balance_usd:0}));
}

test('Excel4.1d.3b.4 commits native purchases, AP, receipt, WAC and retry atomically',async()=>{
  const f=await fixture();await seedPurchaseBaseline(f);
  const staged=await f.stage([purchaseRow()],'purchase-stage',{'11':purchaseEvidence()}),first=await f.commit(staged,'purchase-commit');
  assert.deepEqual(await f.commit(staged,'purchase-commit'),first);assert.equal(first.result.purchase_bills_created,1);assert.equal(first.result.supplier_payments_created,1);assert.equal(first.result.reconciliation.findings_count,0);
  const dump=f.store.dump(),session=dump[`${f.root}/historical_import_sessions/${staged.id}`],bill=dump[`${f.root}/purchase_bills/${session.commit_purchase_bill_ids[0]}`];
  assert.equal(bill.remaining_sdg,60);assert.equal(bill.payment_sequence,1);assert.equal(bill.items[0].value_sdg,100);assert.equal(dump[`${f.root}/suppliers/supplier-1`].payable_due_sdg,60);assert.equal(dump[`${f.root}/products/product-1`].stock_quantity,12);assert.equal(dump[`${f.root}/products/product-1`].inventory_value_sdg,1100);assert.equal(dump[`${f.root}/purchase_numbers/supplier-1.pb-h-11`].id,bill.id);
  const snapshot=await f.ops.snapshot(f.org.id,owner,true);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
});

test('Excel4.1d.3b.4 rolls back reserved references and backdated receipts without partial financial state',async()=>{
  for(const mode of ['reference','chronology']){
    const f=await fixture();await seedPurchaseBaseline(f);const staged=await f.stage([purchaseRow()],'purchase-stage',{'11':purchaseEvidence()});
    await f.store.transaction(async tx=>{if(mode==='reference')tx.set(`${f.root}/purchase_numbers/supplier-1.pb-h-11`,{id:'reserved'});else{const product=await tx.get(`${f.root}/products/product-1`);tx.set(`${f.root}/products/product-1`,{...product,cost_last_movement_date:'2026-01-11'});}});
    const before=f.store.dump();await assert.rejects(f.commit(staged,'purchase-blocked'),mode==='reference'?/محجوز/:/يسبق/);assert.deepEqual(f.store.dump(),before);
  }
});

test('Excel4.1d.3b.4 replays frozen recoverable purchase tax and reconciles native sources',async()=>{
  const f=await fixture();await seedPurchaseBaseline(f);
  await f.ops.execute(f.org.id,owner,{action:'account.create',operationId:'tax-account',data:{code:'1350',name_ar:'ضريبة مشتريات',name_en:'Input tax',type:'ASSET',nature:'DEBIT',reporting_group:'other_assets',is_active:true}});
  const tax=(await f.ops.execute(f.org.id,owner,{action:'taxConfiguration.create',operationId:'purchase-tax',data:{id:'input-vat',name:'ضريبة تاريخية',jurisdiction:'اختبار',direction:'purchases',rate:15,calculation:'exclusive',rounding:'half_up',recoverable:true,tax_account_code:'1350',effective_from:'2026-01-01',effective_to:null,active:true,reason:'إثبات ضريبة قديمة'}})).result;
  const proof=purchaseEvidence({tax_account_code:'1350',tax_configuration_version_hash:tax.version_hash,lines:[{product_id:'product-1',description:'خاضع',quantity:2,net:100,tax:15,inventory_value:100}],payments:[]});
  const staged=await f.stage([purchaseRow({total:115,paid:0,debit:115,credit:115})],'tax-purchase-stage',{'11':proof}),result=await f.commit(staged,'tax-purchase-commit');
  assert.equal(result.result.reconciliation.findings_count,0);
  const bill=Object.entries(f.store.dump()).find(([path])=>path.includes('/purchase_bills/'))![1];assert.equal(bill.tax_evidence.configuration_version_hash,tax.version_hash);assert.equal(bill.items[0].supplier_credit_sdg,115);assert.equal(bill.items[0].value_sdg,100);
});

test('Excel4.1d.3b.4 USD inclusive purchase retains frozen tax through FX payments, return and restore',async()=>{
  const f=await fixture();await seedPurchaseBaseline(f);
  await f.ops.execute(f.org.id,owner,{action:'account.create',operationId:'tax-account',data:{code:'1350',name_ar:'ضريبة مشتريات',name_en:'Input tax',type:'ASSET',nature:'DEBIT',reporting_group:'other_assets',is_active:true}});
  const policy={id:'input-vat',name:'ضريبة تاريخية',jurisdiction:'اختبار',direction:'purchases',rate:15,calculation:'inclusive',rounding:'half_up',recoverable:true,tax_account_code:'1350',effective_from:'2026-01-01',effective_to:null,active:true,reason:'إثبات ضريبة قديمة'};
  const tax=(await f.ops.execute(f.org.id,owner,{action:'taxConfiguration.create',operationId:'tax-create',data:policy})).result;
  const proof=purchaseEvidence({exchange_rate_used:2500,tax_account_code:'1350',tax_configuration_version_hash:tax.version_hash,lines:[{product_id:'product-1',description:'الأول',quantity:1,net:40,tax:6,inventory_value:40},{product_id:'product-1',description:'الثاني',quantity:1,net:60,tax:9,inventory_value:60}],payments:[{date:'2026-01-15',amount:20,account_code:'1120',exchange_rate_used:2550,reference:'SP-1'},{date:'2026-01-20',amount:30,account_code:'1120',exchange_rate_used:2600,reference:'SP-2'}]});
  const staged=await f.stage([purchaseRow({currency:'USD',total:115,paid:50,debit:115,credit:115})],'usd-purchase-stage',{'11':proof});
  await f.ops.execute(f.org.id,owner,{action:'taxConfiguration.update',operationId:'tax-update',data:{...policy,expected_revision:1,rate:20,reason:'سياسة حالية جديدة'}});
  const result=await f.commit(staged,'usd-purchase-commit');assert.equal(result.result.inventory_movements_created,1);assert.equal(result.result.supplier_payments_created,2);assert.equal(result.result.reconciliation.findings_count,0);
  const dump=f.store.dump(),session=dump[`${f.root}/historical_import_sessions/${staged.id}`],billId=session.commit_purchase_bill_ids[0],bill=dump[`${f.root}/purchase_bills/${billId}`];
  assert.equal(bill.remaining_usd,65);assert.equal(bill.remaining_sdg,162500);assert.equal(bill.tax_evidence.configuration_revision,1);assert.equal(bill.tax_evidence.configuration_version_hash,tax.version_hash);
  assert.equal(session.commit_journal_ids.reduce((n:number,id:string)=>n+dump[`${f.root}/journal_entries/${id}`].lines.filter((l:any)=>l.account_code==='5500').reduce((s:number,l:any)=>s+l.debit_sdg,0),0),4000);
  const returned=(await f.ops.execute(f.org.id,owner,{action:'purchaseReturn.create',operationId:'historical-return',data:{bill_id:billId,date:'2026-01-25',reason:'مردود مثبت',lines:[{line_id:'line-1',quantity:1}]}})).result;
  assert.equal(returned.supplier_credit_usd,46);assert.equal(returned.recoverable_tax_usd,6);
  const snapshot=await f.ops.snapshot(f.org.id,owner,true);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
  const restoreOwner={...owner,uid:'historical-restore-owner',email:'historical-restore@example.com'};
  const target=await new Organizations(f.store).create(restoreOwner,'Restored historical purchase',{...INITIAL_SETTINGS},'restore-target',true);
  await f.store.transaction(async tx=>tx.set(`organizations/${target.id}`,{...await tx.get(`organizations/${target.id}`),planId:'Enterprise',subscriptionEnd:'2027-01-01'}));
  await f.ops.execute(target.id,restoreOwner,{action:'backup.restore',operationId:'historical-restore',data:{backup:snapshot}});
  const restored=await f.ops.snapshot(target.id,restoreOwner,true);assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData,restored.settings,{requireCosting:true}),[]);
});

test('Excel4.1d.3b.4 rejects an altered frozen tax chain without any partial writes',async()=>{
  const f=await fixture();await seedPurchaseBaseline(f);
  await f.ops.execute(f.org.id,owner,{action:'account.create',operationId:'tax-account',data:{code:'1350',name_ar:'ضريبة مشتريات',name_en:'Input tax',type:'ASSET',nature:'DEBIT',reporting_group:'other_assets',is_active:true}});
  const tax=(await f.ops.execute(f.org.id,owner,{action:'taxConfiguration.create',operationId:'tax-create',data:{id:'input-vat',name:'ضريبة تاريخية',jurisdiction:'اختبار',direction:'purchases',rate:15,calculation:'exclusive',rounding:'half_up',recoverable:true,tax_account_code:'1350',effective_from:'2026-01-01',effective_to:null,active:true,reason:'إثبات ضريبة قديمة'}})).result;
  const proof=purchaseEvidence({tax_account_code:'1350',tax_configuration_version_hash:tax.version_hash,lines:[{product_id:'product-1',description:'خاضع',quantity:2,net:100,tax:15,inventory_value:100}],payments:[]});
  const staged=await f.stage([purchaseRow({total:115,paid:0,debit:115,credit:115})],'tax-stage',{'11':proof});
  await f.store.transaction(async tx=>{const path=`${f.root}/tax_configuration_versions/input-vat-r1`;tx.set(path,{...await tx.get(path),reason:'tampered chain metadata'});});
  const before=f.store.dump();await assert.rejects(f.commit(staged,'tax-rejected'),/بصمة سلسلة/);assert.deepEqual(f.store.dump(),before);
});

test('Excel4.1c atomically commits reviewed journals once with immutable proof and audit',async()=>{
  const f=await fixture(),staged=await f.stage([journalRow()]),first=await f.commit(staged),again=await f.commit(staged);
  assert.deepEqual(again,first);assert.equal(first.result.status,'completed');assert.equal(first.result.accounting_block,false);assert.equal(first.result.rows_imported,1);assert.equal(first.result.journals_created,1);
  const dump=f.store.dump(),session=dump[`${f.root}/historical_import_sessions/${staged.id}`],entry=dump[`${f.root}/journal_entries/${first.result.reconciliation.findings_count===0?`jv-hist-${staged.rows_sha256.slice(0,16)}-1`:''}`];
  assert.equal(session.status,'completed');assert.deepEqual(session.commit_journal_ids,[`jv-hist-${staged.rows_sha256.slice(0,16)}-1`]);assert.equal(entry.historical_import_session_id,staged.id);assert.equal(entry.created_at,now.toISOString());assert.equal(entry.date,'2026-01-10');
  assert.equal(dump[`${f.root}/audit_logs/audit-history-commit`].event_type,'DATA_IMPORT_COMPLETED');assert.equal(dump[`${f.root}/audit_logs/audit-history-commit`].import_metadata.rows_imported,1);
});

test('Excel4.1c aggregates each balanced legacy trial-balance group into one journal',async()=>{
  const f=await fixture(),rows:HistoricalImportRow[]=[
    {row_number:1,kind:'trial_balance',reference:'TB-1',date:'2026-01-01',currency:'USD',branch_id:'main',account_code:'5200',debit:4.25,credit:0},
    {row_number:2,kind:'trial_balance',reference:'TB-2',date:'2026-01-01',currency:'USD',branch_id:'main',account_code:'4100',debit:0,credit:4.25},
  ],staged=await f.stage(rows,'tb-stage'),result=await f.commit(staged,'tb-commit');
  assert.equal(result.result.journals_created,1);const entry=Object.values(f.store.dump()).find((row:any)=>row.historical_import_session_id===staged.id) as any;assert.equal(entry.total_debit_usd,4.25);assert.equal(entry.total_credit_usd,4.25);assert.deepEqual(entry.historical_import_row_numbers,[1,2]);
});

test('Excel4.1c rejects changed staging, blocked previews and unsupported subsidiary documents without partial writes',async()=>{
  const changed=await fixture(),changedStage=await changed.stage([journalRow()]);await changed.store.transaction(async tx=>{const saved=await tx.get(`${changed.root}/historical_import_staging/${changedStage.id}`);tx.set(`${changed.root}/historical_import_staging/${changedStage.id}`,{...saved,rows:[journalRow({reference:'TAMPERED'})]});});
  let before=changed.store.dump();await assert.rejects(changed.commit(changedStage),/بصمة/);assert.deepEqual(changed.store.dump(),before);

  const blocked=await fixture(),blockedStage=await blocked.stage([{row_number:1,kind:'trial_balance',reference:'TB-1',date:'2026-01-01',currency:'SDG',branch_id:'main',account_code:'5200',debit:100,credit:0},{row_number:2,kind:'trial_balance',reference:'TB-2',date:'2026-01-01',currency:'SDG',branch_id:'main',account_code:'4100',debit:0,credit:90}]);
  before=blocked.store.dump();await assert.rejects(blocked.commit(blockedStage),/غير جاهز/);assert.deepEqual(blocked.store.dump(),before);

  const documents=await fixture();before=documents.store.dump();
  await assert.rejects(documents.stage([{row_number:1,kind:'invoice',reference:'INV-H-1',date:'2026-01-01',currency:'SDG',branch_id:'main',account_code:'4100',counterparty_code:'customer-1',total:100,paid:0,debit:100,credit:100}]),/دليلاً أصلياً كاملاً/);
  assert.deepEqual(documents.store.dump(),before);
});

test('Excel4.1c completes with an accounting block and prevents final period close when subsidiary reconciliation differs',async()=>{
  const f=await fixture(),staged=await f.stage([journalRow({lines:[{account_code:'1200',debit:100,credit:0},{account_code:'4100',debit:0,credit:100}]})]),committed=await f.commit(staged);
  assert.equal(committed.result.status,'completed_accounting_block');assert.equal(committed.result.completion_code,'IMPORT_COMPLETED_WITH_ACCOUNTING_BLOCK');assert.ok(committed.result.reconciliation.findings_count>0);
  await f.ops.execute(f.org.id,owner,{action:'period.softClose',operationId:'soft-close',data:{id:'2026',expected_revision:1,reason:'مراجعة'}});
  await assert.rejects(f.ops.execute(f.org.id,owner,{action:'period.close',operationId:'final-close',data:{id:'2026',expected_revision:2,reason:'إغلاق',fx_review_completed:true}}),/فشل فحص الإغلاق/);
  assert.equal(f.store.dump()[`${f.root}/accounting_periods/2026`].status,'SOFT_CLOSED');
});

test('Excel4.1d.3b.2 atomically persists native historical sales and reconciles every source',async()=>{
  const f=await fixture();await seedSalesBaseline(f);
  const staged=await f.stage([salesRow()],'native-sales-stage',{'7':salesEvidence()}),first=await f.commit(staged,'native-sales-commit'),again=await f.commit(staged,'native-sales-commit');
  assert.deepEqual(again,first);assert.equal(first.result.status,'completed');assert.equal(first.result.accounting_block,false);assert.equal(first.result.invoices_created,1);assert.equal(first.result.payments_created,1);assert.equal(first.result.inventory_movements_created,1);assert.equal(first.result.journals_created,2);assert.equal(first.result.reconciliation.findings_count,0);
  const dump=f.store.dump(),session=dump[`${f.root}/historical_import_sessions/${staged.id}`];
  assert.equal(session.status,'completed');assert.equal(session.commit_invoice_ids.length,1);assert.equal(session.commit_payment_ids.length,1);assert.equal(session.commit_inventory_movement_ids.length,1);
  const invoice=dump[`${f.root}/invoices/${session.commit_invoice_ids[0]}`],payment=dump[`${f.root}/payments/${session.commit_payment_ids[0]}`],movement=dump[`${f.root}/inventory_movements/${session.commit_inventory_movement_ids[0]}`];
  assert.equal(invoice.invoice_number,'INV-H-7');assert.equal(invoice.status,'partially_paid');assert.equal(invoice.grand_total_sdg,100);assert.equal(invoice.paid_amount_sdg,40);assert.equal(invoice.remaining_sdg,60);assert.equal(invoice.cogs_sdg,200);assert.equal(invoice.items[0].total_cost_sdg,200);assert.equal(invoice.historical_import_session_id,staged.id);
  assert.equal(payment.invoice_id,invoice.id);assert.equal(payment.settled_amount_sdg,40);assert.equal(payment.cash_amount_sdg,40);assert.equal(payment.source_sequence,1);
  assert.equal(movement.reference_id,invoice.id);assert.equal(movement.quantity,-2);assert.equal(movement.value_delta_sdg,-200);
  assert.equal(dump[`${f.root}/products/product-1`].stock_quantity,8);assert.equal(dump[`${f.root}/products/product-1`].inventory_value_sdg,800);assert.equal(dump[`${f.root}/customers/customer-1`].balance_sdg,60);assert.equal(dump[`${f.root}/invoice_numbers/${encodeURIComponent('INV-H-7')}`].invoice_id,invoice.id);
  const audit=dump[`${f.root}/audit_logs/audit-native-sales-commit`];assert.equal(audit.import_metadata.document_evidence_sha256,staged.document_evidence_sha256);assert.equal(audit.import_metadata.invoices_created,1);assert.equal(audit.import_metadata.reconciliation.findings_count,0);
  const snapshot=await f.ops.snapshot(f.org.id,owner,true);assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
});

test('Excel4.1d.3b.2 rolls back the complete native sales transaction when cost reconciliation cannot be proven',async()=>{
  const f=await fixture();await seedSalesBaseline(f);
  const evidence=salesEvidence({lines:[{product_id:'product-1',description:'تكلفة تتجاوز المخزون',quantity:2,net:100,tax:0,cogs:1200}]});
  const staged=await f.stage([salesRow()],'native-sales-invalid-stage',{'7':evidence}),before=f.store.dump();
  await assert.rejects(f.commit(staged,'native-sales-invalid-commit'),/تتجاوز قيمة المخزون/);assert.deepEqual(f.store.dump(),before);
});

test('Excel4.1d.3b.2 freezes a verified historical tax version into the native invoice and posting',async()=>{
  const f=await fixture();await seedSalesBaseline(f);
  const tax=(await f.ops.execute(f.org.id,owner,{action:'taxConfiguration.create',operationId:'historical-tax',data:{id:'historical-vat',name:'ضريبة تاريخية',jurisdiction:'اختبار',direction:'sales',rate:15,calculation:'exclusive',rounding:'half_up',recoverable:false,tax_account_code:'2130',effective_from:'2026-01-01',effective_to:null,active:true,reason:'إثبات سياسة الفاتورة القديمة'}})).result;
  const row=salesRow({total:115,paid:0,debit:115,credit:115}),evidence=salesEvidence({tax_account_code:'2130',tax_configuration_version_hash:tax.version_hash,lines:[{product_id:'product-1',description:'بضاعة خاضعة',quantity:2,net:100,tax:15,cogs:200}],payments:[]});
  const staged=await f.stage([row],'native-tax-sales-stage',{'7':evidence}),committed=await f.commit(staged,'native-tax-sales-commit'),dump=f.store.dump(),session=dump[`${f.root}/historical_import_sessions/${staged.id}`],invoice=dump[`${f.root}/invoices/${session.commit_invoice_ids[0]}`],entry=dump[`${f.root}/journal_entries/${session.commit_journal_ids[0]}`];
  assert.equal(committed.result.reconciliation.findings_count,0);assert.equal(invoice.tax_total_sdg,15);assert.equal(invoice.grand_total_sdg,115);assert.equal(invoice.tax_evidence.configuration_id,'historical-vat');assert.equal(invoice.tax_evidence.configuration_version_hash,tax.version_hash);assert.equal(entry.lines.find((line:Record<string,any>)=>line.account_code==='2130').credit_sdg,15);
});

test('Excel4.1d.3a requires and replays the reviewed document evidence hash before native commit',async()=>{
  const f=await fixture();
  await f.store.transaction(async tx=>{
    tx.set(`${f.root}/customers/customer-1`,{id:'customer-1',org_id:f.org.id,name:'Historical customer',balance_sdg:0,balance_usd:0});
    tx.set(`${f.root}/products/product-1`,{id:'product-1',org_id:f.org.id,name:'Historical product',track_inventory:true,stock_quantity:10,inventory_value_sdg:300,inventory_value_usd:0});
  });
  const row:HistoricalImportRow={row_number:7,kind:'invoice',reference:'INV-H-7',date:'2026-01-10',currency:'SDG',branch_id:'main',account_code:'4100',counterparty_code:'customer-1',total:115,paid:0,debit:115,credit:115};
  const evidence={party_id:'customer-1',due_date:'2026-02-10',exchange_rate_used:0,control_account_code:'1200',tax_account_code:'2130',tax_configuration_version_hash:'a'.repeat(64),lines:[{product_id:'product-1',description:'بضاعة تاريخية',quantity:2,net:100,tax:15,cogs:60}]};
  const staged=(await f.ops.execute(f.org.id,accountant,{action:'historicalImport.stage',operationId:'document-proof-stage',data:{file_name:'documents.xlsx',file_hash:'f'.repeat(64),schema_version:1,rows:[row],document_evidence:{'7':evidence}}})).result;
  await assert.rejects(f.ops.execute(f.org.id,accountant,{action:'historicalImport.commit',operationId:'document-proof-missing',data:{id:staged.id,expected_rows_sha256:staged.rows_sha256,expected_validation_context_sha256:staged.validation_context_sha256,reason:'مراجعة الدليل'}}),/بصمة دليل المستندات/);
  await f.store.transaction(async tx=>{const saved=await tx.get(`${f.root}/historical_import_staging/${staged.id}`);tx.set(`${f.root}/historical_import_staging/${staged.id}`,{...saved,document_evidence:{'7':{...evidence,due_date:'2026-03-01'}}});});
  const before=f.store.dump();
  await assert.rejects(f.ops.execute(f.org.id,accountant,{action:'historicalImport.commit',operationId:'document-proof-tampered',data:{id:staged.id,expected_rows_sha256:staged.rows_sha256,expected_validation_context_sha256:staged.validation_context_sha256,expected_document_evidence_sha256:staged.document_evidence_sha256,reason:'مراجعة الدليل'}}),/بصمة دليل المستندات التاريخية مختلفة/);
  assert.deepEqual(f.store.dump(),before);
});

const previewRequest=(session:Record<string,any>)=>({operationId:'reviewed-history-commit',input:{id:session.id,expected_rows_sha256:session.rows_sha256,expected_validation_context_sha256:session.validation_context_sha256,...(session.document_evidence_sha256?{expected_document_evidence_sha256:session.document_evidence_sha256}:{}),reason:'معاينة الأثر التاريخي قبل الاعتماد'}});
function serverPreview(f:Awaited<ReturnType<typeof fixture>>,verify:()=>Promise<void>=async()=>{}){
  let writes=0;
  const ops=new Operations({authority:'server',transaction:work=>f.store.transaction(tx=>work({...tx,set:()=>{writes++;throw new Error('Preview attempted a write');},delete:()=>{writes++;throw new Error('Preview attempted a delete');}}))},()=>now,undefined,verify);
  return{ops,writes:()=>writes};
}

test('Excel4.1e.2c preview validates real native sales/purchases without invoking a store write',async()=>{
  for(const kind of ['journal','invoice','purchase']){
    const f=await fixture();if(kind==='invoice')await seedSalesBaseline(f);if(kind==='purchase')await seedPurchaseBaseline(f);
    const session=await f.stage([kind==='journal'?journalRow():kind==='invoice'?salesRow():purchaseRow()],`preview-stage-${kind}`,kind==='invoice'?{'7':salesEvidence()}:kind==='purchase'?{'11':purchaseEvidence()}:undefined);
    let verified=0;const server=serverPreview(f,async()=>{verified++;}),before=f.store.dump(),request=previewRequest(session);
    const review=await server.ops.historicalImportPreview(f.org.id,accountant,request);
    assert.equal(review.dry_run,true);assert.equal(review.session_id,session.id);assert.equal(review.org_id,f.org.id);
    assert.equal(review.proposed_result.reconciliation.findings_count,0);assert.ok(review.proposed_changes.some((change:any)=>change.path.includes('/journal_entries/')));
    assert.deepEqual(f.store.dump(),before);assert.equal(server.writes(),0);assert.ok(verified>0);
    // The same operation ID remains available for the later real command.
    await f.ops.execute(f.org.id,accountant,{action:'historicalImport.commit',operationId:request.operationId,data:request.input});
    await assert.rejects(server.ops.historicalImportPreview(f.org.id,accountant,request),/مستخدم بالفعل/);
  }
});

test('Excel4.1e.2c preview rejects fresh locks and tampered evidence without writes',async()=>{
  for(const mode of ['lock','hash']){
    const f=await fixture(),session=await f.stage([journalRow()]),request=previewRequest(session);
    if(mode==='hash')request.input.expected_rows_sha256='0'.repeat(64);
    else await f.store.transaction(async tx=>{const path=`${f.root}/accounting_periods/2026`;tx.set(path,{...await tx.get(path),status:'CLOSED'});});
    const server=serverPreview(f),before=f.store.dump();await assert.rejects(server.ops.historicalImportPreview(f.org.id,accountant,request));
    assert.deepEqual(f.store.dump(),before);assert.equal(server.writes(),0);
  }
});

test('Excel4.1e.2c preview fails closed for local authority, missing Rules proof and foreign membership',async()=>{
  const f=await fixture(),session=await f.stage([journalRow()]),request=previewRequest(session),before=f.store.dump();
  await assert.rejects(f.ops.historicalImportPreview(f.org.id,accountant,request),/خدمة الخادم/);
  const server=new Operations({authority:'server',transaction:work=>f.store.transaction(work)},()=>now);
  await assert.rejects(server.historicalImportPreview(f.org.id,accountant,request),/قواعد/);
  await assert.rejects(serverPreview(f).ops.historicalImportPreview(f.org.id,{uid:'stranger',email:'stranger@example.com',emailVerified:true},request),/عضوية/);
  await assert.rejects(serverPreview(f).ops.historicalImportPreview(f.org.id,accountant,{...request,extra:true} as never),/حقول/);
  assert.deepEqual(f.store.dump(),before);
});
