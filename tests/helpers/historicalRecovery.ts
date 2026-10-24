import { MemoryStore, type Store, type Document } from '../../src/domain/store';
import { Operations, type Actor } from '../../src/domain/operations';
import { Organizations } from '../../server/organizations';
import { INITIAL_SETTINGS } from '../../src/data/initialData';

export async function historicalRecoveryFixture(store: Store = new MemoryStore(), suffix = 'memory', verify: () => Promise<void> = async () => {}) {
  const now = () => new Date('2026-10-24T06:00:00Z');
  const owner: Actor = { uid: `recovery-${suffix}`, email: `recovery-${suffix}@example.test`, emailVerified: true, authTime: Math.floor(now().getTime()/1000) };
  const org = await new Organizations(store).create(owner, 'استرداد اصطناعي', INITIAL_SETTINGS, `setup-${suffix}`, true), root = `organizations/${org.id}`;
  await store.transaction(async tx => {
    tx.set(root, { ...await tx.get(root), accounting_version: 2, planId: 'Enterprise', subscriptionEnd: '2027-01-01' });
    for (const role of ['Accountant', 'Viewer']) tx.set(`${root}/members/${role}`, { uid: role, role, status: 'active', org_id: org.id });
    tx.set(`${root}/accounting_periods/2026`, { id:'2026',org_id:org.id,schema_version:1,start_date:'2026-01-01',end_date:'2026-01-31',status:'OPEN',revision:1,created_by:owner.uid,created_at:'2026-01-01',operation_id:'period' });
  });
  const server: Store = { authority: 'server', transaction: work => store.transaction(work) };
  const ops = new Operations(server, now, undefined, verify);
  const run = (action: string, data: Document, operationId: string) => ops.execute(org.id, owner, {action,data,operationId});
  const session = (await run('historicalImport.stage', {file_name:'recovery.xlsx',file_hash:'a'.repeat(64),schema_version:1,rows:[{row_number:1,kind:'journal',reference:'RECOVERY-1',date:'2026-01-10',currency:'SDG',branch_id:'main',lines:[{account_code:'5200',debit:100,credit:0},{account_code:'4100',debit:0,credit:100}]}]}, 'history-stage')).result;
  const input = {id:session.id,expected_rows_sha256:session.rows_sha256,expected_validation_context_sha256:session.validation_context_sha256,expected_document_evidence_sha256:session.document_evidence_sha256,reason:'اعتماد استرداد اصطناعي'};
  const preview = () => ops.historicalImportPreview(org.id,owner,{input,operationId:'history-commit'});
  const commit = async () => { const review = await preview(); return run('historicalImport.commit',{...input,expected_review_sha256:review.review_sha256},'history-commit'); };
  const recover = (actor = owner) => ops.historicalImportRecovery(org.id, actor, session.id);
  return {store,server,ops,owner,org,root,session,input,run,preview,commit,recover,now};
}
