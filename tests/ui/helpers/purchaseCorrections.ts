import { correctionGuestFixture } from './salesCorrections';
import { MemoryStore } from '../../../src/domain/store';
import { Operations } from '../../../src/domain/operations';
import { guestId, guestActor } from '../../fixtures/cloudIdentity';
export async function purchaseCorrectionGuestFixture() {
  const seed=await correctionGuestFixture(),store=new MemoryStore(seed.records),ops=new Operations(store,()=>new Date('2026-10-07T12:00:00Z'));
  const run=(action:string,data:Record<string,unknown>,operationId:string)=>ops.execute(guestId,guestActor,{action,data,operationId});
  const product=Object.entries(seed.records).find(([path])=>path.includes('/products/'))![1];
  const supplier=(await run('supplier.create',{name:'مورد المردود',default_currency:'USD'},'supplier')).result;
  const bill=(await run('purchase.create',{supplier_id:supplier.id,supplier_reference:'PUR-RETURN',issue_date:'2026-10-07',due_date:'2026-10-07',currency:'USD',exchange_rate_used:2000,settlement:'cash',payment_method:'cash',reason:'شراء موثق',items:[{product_id:product.id,quantity:1,unit_cost:20},{product_id:product.id,quantity:2,unit_cost:20}]},'buy')).result;
  return {records:store.dump(),billId:bill.id as string,reference:bill.supplier_reference as string,cashId:seed.cashId,supplierId:supplier.id as string};
}
