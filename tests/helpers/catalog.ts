import { MemoryStore, type Store } from '../../src/domain/store';
import { Operations, type Actor } from '../../src/domain/operations';
import { Organizations } from '../../server/organizations';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
export async function catalogFixture(store: Store = new MemoryStore(), suffix = 'memory', verify?: ConstructorParameters<typeof Operations>[3]) {
  const clock=new Date('2026-10-23T18:00:00Z'),actor:Actor={uid:`catalog-${suffix}`,email:`catalog-${suffix}@example.test`,emailVerified:true,authTime:Math.floor(clock.getTime()/1000)-30};
  const org=await new Organizations(store).create(actor,'كتالوج اصطناعي',INITIAL_SETTINGS,`setup-${suffix}`,true),root=`organizations/${org.id}`;
  const ops=new Operations(store,()=>clock,undefined,verify,false);
  const run=(action:string,data:Record<string,unknown>,operationId:string=crypto.randomUUID(),who=actor)=>ops.execute(org.id,who,{action,data,operationId});
  const input=(name:string)=>({name,unit:'قطعة',price_sdg:1000,price_usd:.5,tax_rate:0,is_active:true,track_inventory:false,stock_quantity:0});
  const create=(name:string,id:string=crypto.randomUUID())=>run('product.create',input(name),id);
  const snapshot=()=>ops.snapshot(org.id,actor,true);
  return {store,ops,org,root,actor,run,input,create,snapshot};
}
