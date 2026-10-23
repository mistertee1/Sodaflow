import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {initializeTestEnvironment,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
import {ResilientStore} from '../server/resilientStore';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import {displayFixture} from './helpers/displayCurrency';
const verify = async () => verifyAccountingRulesSource([{ content: fs.readFileSync('firestore.rules', 'utf8') }]);
let app:App,env:RulesTestEnvironment,store:ResilientStore;
before(async()=>{assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/,'Synthetic demo-sudaflow Emulator only');env=await initializeTestEnvironment({projectId:'demo-sudaflow',firestore:{host:'127.0.0.1',port:8091,rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'demo-sudaflow'},'display-currency');store=new ResilientStore(getFirestore(app));});
after(async()=>{if(env)await env.cleanup();if(app)await deleteApp(app);});
test('Firestore persists the manual display setting without rewriting issued invoice/native rates, receipts or journals; SDK bypass is denied',async()=>{
 const f=await displayFixture(store,'emulator-original',verify);const invoice=(await f.run('invoice.create',f.sale(),'sale')).result;await f.run('payment.create',{invoice_id:invoice.id,currency:'KWD',amount:.2,currency_rates_used:{KWD:.4},exchange_rate_used:2500,payment_method:'cash'},'receipt');
 const before=await f.snapshot();await f.apply('SAR',4,'display');const after=await f.snapshot();assert.equal(after.settings.display_currency!.currency,'SAR');
 for(const name of ['invoices','payments','journal_entries','customers','accounts','inventory_movements'])assert.deepEqual(after.collections[name],before.collections[name],name);
 assert.equal((await getFirestore(app).doc(f.root).get()).data()!.settings.display_currency.units_per_usd,4);
 const client=env.authenticatedContext(f.actor.uid,{email:f.actor.email,email_verified:true}).firestore();await assertFails(setDoc(doc(client,f.root),{settings:{display_currency:{currency:'KWD',units_per_usd:1,sdg_per_usd:1}}},{merge:true}));
 await assertFails(setDoc(doc(client,`${f.root}/invoices/${invoice.id}`),{grand_total_sdg:0},{merge:true}));await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),f.root)));
});
test('Firestore concurrent manual Apply and unrelated settings retain both patches; invalid or foreign-tenant requests are atomic and retries idempotent',async()=>{
 const f=await displayFixture(store,'emulator-concurrent',verify),g=await displayFixture(store,'emulator-other',verify);
 await Promise.all([f.apply('KWD',.3,'apply'),f.run('settings.update',{updates:{address:'عنوان متزامن',currency_rates:{SAR:5}}},'address')]);let current=await f.snapshot();assert.equal(current.settings.address,'عنوان متزامن');assert.equal(current.settings.display_currency!.currency,'KWD');assert.equal(current.settings.currency_rates!.SAR,5);assert.equal((await g.snapshot()).settings.display_currency,undefined);
 await f.apply('KWD',.3,'apply');assert.deepEqual((await f.snapshot()).counters,current.counters);
 await assert.rejects(f.run('settings.update',{updates:{display_currency:{currency:'KWD',units_per_usd:0,sdg_per_usd:2000}}},'invalid'));await assert.rejects(f.run('settings.update',{updates:{address:'تجاوز'}},'foreign',g.actor),(e:any)=>e.status===403);assert.deepEqual(await f.snapshot(),current);
});
