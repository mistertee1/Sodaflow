import assert from 'node:assert/strict';
import test from 'node:test';
import {INITIAL_SETTINGS} from '../src/data/initialData';
import {Operations,type Actor} from '../src/domain/operations';
import {reconcileFinancialData,type FinancialData} from '../src/domain/reconciliation';
import {MemoryStore} from '../src/domain/store';
import {defaultPlatformPlans} from '../src/lib/plans';
import {Organizations} from '../server/organizations';

const now=new Date('2026-10-11T21:00:00Z');
const owner:Actor={uid:'purchase-tax-owner',email:'purchase-tax@example.com',emailVerified:true,authTime:Math.floor(now.getTime()/1000)-30};

async function fixture(){
  const store=new MemoryStore(),org=await new Organizations(store,undefined,()=>now).create(owner,'مشتريات ضريبية',INITIAL_SETTINGS,'purchase-tax-org',true),root=`organizations/${org.id}`;
  await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'});tx.set('plans/Enterprise',defaultPlatformPlans(now.toISOString()).find(plan=>plan.id==='Enterprise')!);});
  const ops=new Operations(store,()=>now),run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(org.id,owner,{action,data,operationId});
  const product=(await run('product.create',{name:'صنف ضريبي',unit:'قطعة',price_sdg:5000,price_usd:5,tax_rate:0,is_active:true,track_inventory:true,stock_quantity:0},'product')).result;
  await run('product.cost.establish',{id:product.id,cost_currency:'SDG',unit_cost:0,exchange_rate_used:0,zero_cost_reason:'مخزون ابتدائي صفري',reason:'تهيئة'},'basis');
  await run('accounting.activate',{reason:'تفعيل الشراء الضريبي'},'activate');
  await run('period.create',{id:'oct',start_date:'2026-10-01',end_date:'2026-10-31',reason:'أكتوبر'},'period');
  await run('account.create',{code:'1350',name_ar:'ضريبة مشتريات مستردة',name_en:'Recoverable purchase tax',type:'ASSET',nature:'DEBIT',reporting_group:'other_assets',cash_flow_category:'operating',normal_balance:'DEBIT',is_active:true},'tax-account');
  const supplier=(await run('supplier.create',{name:'مورد ضريبي',default_currency:'SDG',payment_terms_days:30},'supplier')).result;
  const config=(id:string,patch:Record<string,unknown>={})=>({id,name:'ضريبة مشتريات',jurisdiction:'اختبار المؤسسة',direction:'purchases',rate:15,calculation:'exclusive',rounding:'half_up',recoverable:true,tax_account_code:'1350',effective_from:'2026-01-01',effective_to:null,active:true,reason:'اعتماد',...patch});
  const purchase=(ref:string,configurationId:string,patch:Record<string,unknown>={})=>({supplier_id:supplier.id,supplier_reference:ref,issue_date:'2026-10-11',due_date:'2026-11-10',currency:'SDG',exchange_rate_used:0,settlement:'credit',reason:'فاتورة ضريبية موثقة',tax_configuration_id:configurationId,expected_tax_configuration_revision:1,items:[{product_id:product.id,quantity:2,unit_cost:1000}],...patch});
  return{store,org,root,ops,run,product,supplier,config,purchase};
}

test('C5.2c posts recoverable purchase tax outside inventory and freezes version evidence',async()=>{
  const f=await fixture();await f.run('taxConfiguration.create',f.config('purchase-vat'),'tax');
  const bill=(await f.run('purchase.create',f.purchase('PT-1','purchase-vat'),'buy')).result,snapshot=await f.ops.snapshot(f.org.id,owner,true);
  assert.equal(bill.subtotal_sdg,2000);assert.equal(bill.tax_total_sdg,300);assert.equal(bill.grand_total_sdg,2300);
  assert.equal(bill.items[0].value_sdg,2000);assert.equal(bill.items[0].supplier_credit_sdg,2300);assert.match(bill.tax_evidence.configuration_version_hash,/^[a-f0-9]{64}$/);
  const entry=snapshot.collections.journal_entries.find(row=>row.reference_id===bill.id)!;
  assert.equal(entry.lines.find((line:any)=>line.account_code==='1300').debit_sdg,2000);
  assert.equal(entry.lines.find((line:any)=>line.account_code==='1350').debit_sdg,300);
  assert.equal(entry.lines.find((line:any)=>line.account_code==='2110').credit_sdg,2300);
  assert.equal(snapshot.collections.products.find(row=>row.id===f.product.id)!.inventory_value_sdg,2000);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
});

test('C5.2c capitalizes nonrecoverable inclusive purchase tax without a fake receivable',async()=>{
  const f=await fixture();await f.run('taxConfiguration.create',f.config('purchase-cost',{calculation:'inclusive',recoverable:false,tax_account_code:null}),'tax-cost');
  const bill=(await f.run('purchase.create',f.purchase('PT-2','purchase-cost',{currency:'USD',exchange_rate_used:2000,items:[{product_id:f.product.id,quantity:1,unit_cost:115}]}),'buy-cost')).result,snapshot=await f.ops.snapshot(f.org.id,owner,true);
  assert.equal(bill.subtotal_usd,100);assert.equal(bill.tax_total_usd,15);assert.equal(bill.grand_total_usd,115);assert.equal(bill.items[0].value_usd,115);
  const entry=snapshot.collections.journal_entries.find(row=>row.reference_id===bill.id)!;
  assert.equal(entry.lines.length,2);assert.equal(entry.lines.find((line:any)=>line.account_code==='1300').debit_usd,115);assert.equal(entry.lines.find((line:any)=>line.account_code==='2110').credit_usd,115);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
  const returned=(await f.run('purchaseReturn.create',{bill_id:bill.id,date:'2026-10-11',reason:'عكس تكلفة شاملة',lines:[{line_id:'line-1',quantity:1}]},'return-cost')).result,after=await f.ops.snapshot(f.org.id,owner,true),reversal=after.collections.journal_entries.find(row=>row.reference_id===returned.id)!;
  assert.deepEqual([returned.supplier_credit_usd,returned.inventory_out_usd,returned.recoverable_tax_usd,returned.variance_usd],[115,115,0,0]);assert.equal(reversal.lines.find((line:any)=>line.account_code==='2110').debit_usd,115);assert.equal(reversal.lines.find((line:any)=>line.account_code==='1300').credit_usd,115);assert.equal(reversal.lines.some((line:any)=>line.account_code==='1350'),false);assert.deepEqual(reconcileFinancialData(after.collections as FinancialData,after.settings,{requireCosting:true}),[]);
});

test('C5.2c rejects forged policy but reverses recoverable purchase tax outside WAC variance',async()=>{
  const f=await fixture();await f.run('taxConfiguration.create',f.config('purchase-vat'),'tax');
  await assert.rejects(f.run('purchase.create',{...f.purchase('FORGED','purchase-vat'),tax_amount:1},'forged'),/مشتقة/);
  await assert.rejects(f.run('purchase.create',{...f.purchase('STALE','purchase-vat'),expected_tax_configuration_revision:2},'stale'),/تغير/);
  const docs=f.store.dump();docs[`${f.root}/tax_configuration_versions/purchase-vat-r1`].rate=99;const damaged=new MemoryStore(docs),ops=new Operations(damaged,()=>now);
  await assert.rejects(ops.execute(f.org.id,owner,{action:'purchase.create',operationId:'damaged',data:f.purchase('DAMAGED','purchase-vat')}),/بصمة|يطابق/);
  const bill=(await f.run('purchase.create',f.purchase('TAX-RETURN','purchase-vat'),'buy')).result,returned=(await f.run('purchaseReturn.create',{bill_id:bill.id,date:'2026-10-11',reason:'عكس ضريبة مستردة',lines:[{line_id:'line-1',quantity:1}]},'return')).result,snapshot=await f.ops.snapshot(f.org.id,owner,true),entry=snapshot.collections.journal_entries.find(row=>row.reference_id===returned.id)!;
  assert.deepEqual([returned.supplier_credit_sdg,returned.inventory_out_sdg,returned.recoverable_tax_sdg,returned.variance_sdg],[1150,1000,150,0]);
  assert.equal(entry.lines.find((line:any)=>line.account_code==='2110').debit_sdg,1150);assert.equal(entry.lines.find((line:any)=>line.account_code==='1300').credit_sdg,1000);assert.equal(entry.lines.find((line:any)=>line.account_code==='1350').credit_sdg,150);assert.equal(entry.lines.some((line:any)=>line.account_code==='5910'),false);
  assert.deepEqual(reconcileFinancialData(snapshot.collections as FinancialData,snapshot.settings,{requireCosting:true}),[]);
});

test('C5.2c restores taxed purchase hashes and keeps AP, tax and inventory reconciled',async()=>{
  const f=await fixture();await f.run('taxConfiguration.create',f.config('purchase-vat'),'tax');const source=(await f.run('purchase.create',f.purchase('RESTORE','purchase-vat'),'buy')).result;await f.run('purchaseReturn.create',{bill_id:source.id,date:'2026-10-11',reason:'مردود محفوظ',lines:[{line_id:'line-1',quantity:1}]},'return');
  const backup=await f.ops.snapshot(f.org.id,owner,true),oldHash=backup.collections.purchase_bills[0].tax_evidence.configuration_version_hash;
  const target={...owner,uid:'purchase-tax-restore'},org=await new Organizations(f.store,undefined,()=>now).create(target,'استعادة شراء ضريبي',INITIAL_SETTINGS,'purchase-tax-restore',true),root=`organizations/${org.id}`;
  await f.store.transaction(async tx=>tx.set(root,{...await tx.get(root),planId:'Enterprise',subscriptionStatus:'active',subscriptionEnd:'2027-01-01'}));
  await f.ops.execute(org.id,target,{action:'backup.restore',operationId:'restore',data:{backup}});
  const restored=await f.ops.snapshot(org.id,target,true),bill=restored.collections.purchase_bills[0];
  assert.notEqual(bill.tax_evidence.configuration_version_hash,oldHash);assert.equal(bill.tax_evidence.configuration_version_hash,restored.collections.tax_configurations[0].version_hash);
  assert.equal(restored.collections.purchase_returns[0].recoverable_tax_sdg,150);
  assert.deepEqual(reconcileFinancialData(restored.collections as FinancialData,restored.settings,{requireCosting:true}),[]);
});
