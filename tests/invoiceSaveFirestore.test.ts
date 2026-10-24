import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ResilientStore } from '../server/resilientStore';
import { invoiceSaveFixture, assertSavedInvoice } from './helpers/invoiceSave';
let app: App, env: RulesTestEnvironment, store: ResilientStore;
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8091$/, 'Synthetic writes only to demo-sudaflow Emulator');
  env = await initializeTestEnvironment({ projectId: 'demo-sudaflow', firestore: { host: '127.0.0.1', port: 8091, rules: fs.readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: 'demo-sudaflow' }, 'invoice-save-acceptance'); store = new ResilientStore(getFirestore(app));
});
after(async () => { if (env) await env.cleanup(); if (app) await deleteApp(app); });

test('reported invoice commits atomically on Firestore, survives concurrent retries and cannot be forged through a direct client', async () => {
  const f = await invoiceSaveFixture(store, 'emulator'), data = f.input();
  const [one, two] = await Promise.all([f.run('invoice.create', data, 'reported-invoice'), f.run('invoice.create', data, 'reported-invoice')]);
  assert.deepEqual(two, one); await assertSavedInvoice(f, one.result.id);
  const client = env.authenticatedContext(f.actor.uid, { email: f.actor.email, email_verified: true }).firestore();
  await assertFails(setDoc(doc(client, `${f.root}/invoices/${one.result.id}`), { grand_total_sdg: 1 }, { merge: true }));
  await assertFails(setDoc(doc(client, `${f.root}/products/${f.product.id}`), { stock_quantity: 50 }, { merge: true }));
  await assertSavedInvoice(f, one.result.id);
});
