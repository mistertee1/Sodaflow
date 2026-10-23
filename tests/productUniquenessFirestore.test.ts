import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {initializeTestEnvironment,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
import {ResilientStore} from '../server/resilientStore';
import {catalogFixture} from './helpers/catalog';
import {productNameKey} from '../src/domain/productIdentity';
let app:App,env:RulesTestEnvironment,store:ResilientStore;
before(async()=>{assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/,'Only synthetic demo-sudaflow Emulator writes');env=await initializeTestEnvironment({projectId:'demo-sudaflow',firestore:{host:'127.0.0.1',port:8091,rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'demo-sudaflow'},'product-uniqueness');store=new ResilientStore(getFirestore(app));});
after(async()=>{if(env)await env.cleanup();if(app)await deleteApp(app);});

test('real Firestore concurrent product creation reserves one normalized name and one product; direct clients cannot change products or claims',async()=>{
  const f=await catalogFixture(store,'emulator-race');const results=await Promise.allSettled([f.create('Cloud  Product','race-a'),f.create(' cloud product ','race-b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const snapshot=await f.snapshot();assert.equal(snapshot.collections.products.length,1);assert.equal(snapshot.counters.product_count,1);
  const key=await productNameKey('cloud product'),path=`${f.root}/product_names/${key}`;assert.equal((await getFirestore(app).doc(path).get()).data()?.product_id,snapshot.collections.products[0].id);
  const client=env.authenticatedContext(f.actor.uid,{email:f.actor.email,email_verified:true}).firestore();await assertFails(setDoc(doc(client,`${f.root}/products/bypass`),f.input('Cloud Product')));await assertFails(setDoc(doc(client,path),{product_id:'bypass'}));await assertFails(getDoc(doc(client,path)));
});

test('real Firestore rename conflicts preserve both products; delete and recreate keep tenant-local reservations consistent',async()=>{
  const f=await catalogFixture(store,'emulator-rename');const a=(await f.create('First','first')).result,b=(await f.create('Second','second')).result;
  await assert.rejects(f.run('product.update',{id:a.id,updates:{name:'second'}}),(e:any)=>e.code==='duplicate_product');
  await f.run('product.update',{id:a.id,updates:{name:'Third'}});await f.create('First','reused');
  await f.run('product.delete',{id:b.id});await f.create('Second','second-again');assert.equal((await f.snapshot()).collections.products.length,3);
  const g=await catalogFixture(store,'emulator-other-company');await g.create('Third');assert.equal((await g.snapshot()).collections.products.length,1);
});
