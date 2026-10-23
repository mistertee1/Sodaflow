import { MemoryStore, type Store } from '../../src/domain/store';
import { Operations, type Actor } from '../../src/domain/operations';
import { Organizations } from '../../server/organizations';
import { INITIAL_SETTINGS } from '../../src/data/initialData';
import type { Currency } from '../../src/types';
export const syntheticCurrencyRates = { SAR:4,AED:4,KWD:.3,QAR:4,BHD:.4,OMR:.4,EGP:50,EUR:2,GBP:2 };
export async function displayFixture(store: Store = new MemoryStore(), suffix='memory') {
  const now=()=>new Date('2026-10-23T18:00:00Z'),actor:Actor={uid:`display-${suffix}`,email:`display-${suffix}@example.test`,emailVerified:true,authTime:Math.floor(now().getTime()/1000)-30};
  const org=await new Organizations(store,undefined,now,false).create(actor,'عرض عملات اصطناعي',{...INITIAL_SETTINGS,default_exchange_rate:2000,currency_rates:syntheticCurrencyRates},`setup-${suffix}`,true),root=`organizations/${org.id}`;
  const ops=new Operations(store,now,undefined,undefined,false);
  const run=(action:string,data:Record<string,unknown>,id:string=crypto.randomUUID(),who=actor)=>ops.execute(org.id,who,{action,data,operationId:id});
  const customer=(await run('customer.create',{name:'عميل اصطناعي',phone:'50012345',preferred_currency:'KWD'},'customer')).result;
  await run('accounting.activate',{reason:'بيانات اصطناعية'},'activate');
  const sale=(currency:Currency='KWD')=>({customer_id:customer.id,issue_date:'2026-10-23',currency_mode:currency==='KWD'?'single_foreign':'dual',exchange_rate_used:2000,discount_type:'fixed',discount_value:0,...(currency==='KWD'?{currency_rates_used:{KWD:.3}}:{}),items:[{description:'خدمة اصطناعية',unit:'ساعة',quantity:1,unit_price:currency==='KWD'?1.234:1000,currency,tax_rate:0,discount_percent:0}]});
  const apply=(currency:Currency='KWD',units=.3,id:string=crypto.randomUUID())=>run('settings.update',{updates:{display_currency:{currency,units_per_usd:units,sdg_per_usd:2000},default_transaction_currency:currency,currency_rates:!['USD','SDG'].includes(currency)?{[currency]:units}:{}},reason:'تطبيق سعر عرض يدوي اصطناعي'},id);
  return {store,actor,now,org,root,ops,run,customer,sale,apply,snapshot:()=>ops.snapshot(org.id,actor,true)};
}
