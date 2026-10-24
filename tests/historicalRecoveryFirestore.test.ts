import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ResilientStore } from '../server/resilientStore';
import { verifyAccountingRulesSource } from '../server/accountingSecurity';
import { historicalRecoveryFixture } from './helpers/historicalRecovery';
let app:App,env:RulesTestEnvironment,store:ResilientStore;
before(async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8091$/,'Synthetic historical recovery writes only to demo-sudaflow Emulator');
  env=await initializeTestEnvironment({projectId:'demo-sudaflow',firestore:{host:'127.0.0.1',port:8091,rules:readFileSync('firestore.rules','utf8')}});
  app=initializeApp({projectId:'demo-sudaflow'},'historical-recovery');store=new ResilientStore(getFirestore(app));
});
after(async()=>{if(env)await env.cleanup();if(app)await deleteApp(app);});

test('Firestore recovers staged and confirmed historical imports without writes or duplicate posting; direct SDK access stays denied',async()=>{
  const f=await historicalRecoveryFixture(store,'emulator',async()=>verifyAccountingRulesSource([{content:readFileSync('firestore.rules','utf8')}]));
  const beforeStage=await f.ops.snapshot(f.org.id,f.owner,true);assert.equal((await f.recover()).requires_fresh_review,true);
  assert.deepEqual((await f.ops.snapshot(f.org.id,f.owner,true)).collections,beforeStage.collections);
  const saved=await f.commit(),before=await f.ops.snapshot(f.org.id,f.owner,true);
  const [one,two]=await Promise.all([f.recover(),f.recover()]);assert.deepEqual(one,two);assert.equal(one.receipt?.id,saved.result.id);assert.equal(one.receipt?.review_status,'verified');
  const after=await f.ops.snapshot(f.org.id,f.owner,true);assert.deepEqual(after.collections,before.collections);assert.deepEqual(after.counters,before.counters);
  assert.equal(after.collections.journal_entries.length,1);assert.equal(after.collections.audit_logs.filter(row=>row.action==='historicalImport.commit').length,1);
  const client=env.authenticatedContext(f.owner.uid,{email:f.owner.email,email_verified:true}).firestore();
  await assertFails(getDoc(doc(client,`${f.root}/historical_import_staging/${f.session.id}`)));
  await assertFails(getDoc(doc(client,`${f.root}/idempotency/history-commit`)));
  await assertFails(setDoc(doc(client,`${f.root}/historical_import_sessions/${f.session.id}`),{status:'staged'},{merge:true}));
  const audit=getFirestore(app).doc(`${f.root}/audit_logs/audit-history-commit`);await audit.delete();
  await assert.rejects(f.recover(),(error:any)=>error.code==='historical_recovery_inconsistent');assert.equal((await getFirestore(app).collection(`${f.root}/journal_entries`).get()).size,1);
});
