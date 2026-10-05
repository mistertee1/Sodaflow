import 'dotenv/config';
import { FieldPath } from 'firebase-admin/firestore';
import { adminServices } from '../server/admin';
import { FirestoreStore } from '../server/firestoreStore';
import { initializeBillingPlans, migrateBillingOrganization } from '../server/billingMigration';

// Read-only preview by default. --apply is a separate reviewed technical action.
const apply = process.argv.includes('--apply'), { db } = adminServices(), store = new FirestoreStore(db);
const options = { apply, operator: process.env.GITHUB_ACTOR || 'technical-migration', now: new Date() };
await initializeBillingPlans(store, options);
let query = db.collection('organizations').orderBy(FieldPath.documentId()).limit(100), migrated = 0, unchanged = 0, blocked = 0;
for (;;) {
  const page = await query.get();
  for (const document of page.docs) {
    try {
      const root = document.ref.path;
      const count = async (path: string) => (await db.collection(path).count().get()).data().count;
      const [invoiceCount, numberCount, invoiceEvents, firstInvoice] = await Promise.all([
        count(`${root}/invoices`), count(`${root}/invoice_numbers`),
        db.collection(`${root}/audit_logs`).where('action', '==', 'invoice.create').count().get().then(snapshot => snapshot.data().count),
        db.collection(`${root}/invoices`).orderBy('created_at').select('created_at').limit(1).get(),
      ]);
      const firstInvoiceAt = firstInvoice.docs[0]?.data().created_at;
      const evidence = { invoiceCount, numberCount, invoiceEvents, ...(typeof firstInvoiceAt === 'string' ? { firstInvoiceAt } : {}) };
      const outcome = await store.transaction(tx => migrateBillingOrganization(tx, document.id, evidence, options));
      if (outcome === 'unchanged') unchanged++; else migrated++;
    } catch (error) { blocked++; console.error(JSON.stringify({ organizationId: document.id, error: error instanceof Error ? error.message : 'Migration failed' })); }
  }
  if (page.size < 100) break;
  query = query.startAfter(page.docs.at(-1)!);
}
console.log(JSON.stringify({ apply, migrated, unchanged, blocked }));
if (blocked) process.exitCode = 2;
