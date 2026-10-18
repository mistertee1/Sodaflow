import type { Document, Store } from '../src/domain/store';
import { LargeExportWorker, type LargeExportArtifactStore, type LargeExportContentBuilder } from '../src/domain/largeExportWorker';
import { Operations, membership, type Actor } from '../src/domain/operations';
import { buildAccountingExport } from '../src/domain/accountingExport';
import { ensure } from '../src/domain/validation';
import { hasPermission } from '../src/services/rbacService';
import { adminServices } from './admin';
import { FirestoreStore } from './firestoreStore';
import { resolveSubscription } from './subscriptions';
import { verifyDeployedAccountingRules } from './accountingSecurity';
import type { Account, JournalEntry } from '../src/types';
import { assertFeature, assertSubscriptionActive, loadSubscription } from '../src/domain/subscriptions';

export class FirebaseLargeExportArtifacts implements LargeExportArtifactStore{
  private bucket=adminServices().bucket;
  async put(path:string,content:{bytes:Uint8Array;mimeType:string}){await this.bucket.file(path).save(Buffer.from(content.bytes),{resumable:false,metadata:{contentType:content.mimeType,cacheControl:'private,no-store',metadata:{sudaflowExport:'true'}}});}
  async delete(path:string){await this.bucket.file(path).delete({ignoreNotFound:true});}
  async signedUrl(path:string,expiresAt:Date){const [url]=await this.bucket.file(path).getSignedUrl({action:'read',expires:expiresAt});return url;}
}

export class ServerLargeExportBuilder implements LargeExportContentBuilder{
  constructor(private operations:Operations){}
  async build(job:Document){
    const actor:Actor={uid:String(job.requested_by),email:'worker@sudaflow.internal',emailVerified:true},snapshot=await this.operations.snapshot(String(job.org_id),actor,job.kind==='company');
    if(job.kind==='company'){const bytes=new TextEncoder().encode(JSON.stringify(snapshot));return{bytes,filename:`sudaflow-company-${job.org_id}-${String(job.created_at).slice(0,10)}.json`,mimeType:'application/json',recordCount:Object.values(snapshot.collections).reduce((sum,rows)=>sum+(rows as Document[]).length,0)};}
    const exported=buildAccountingExport({orgId:String(job.org_id),role:snapshot.role,createdAt:String(job.created_at),operationId:String(job.id),period:job.period||{},accounts:snapshot.collections.accounts as Account[],entries:snapshot.collections.journal_entries as JournalEntry[],reconciliations:[...snapshot.collections.bank_reconciliations,...snapshot.collections.cash_reconciliations],settings:snapshot.settings,maxEntries:50_000,maxBytes:25_000_000});
    return{bytes:Buffer.from(exported.workbook_base64,'base64'),filename:exported.filename,mimeType:exported.mime_type,recordCount:exported.record_count};
  }
}

export function firebaseLargeExportWorker(){const store:Store=new FirestoreStore(adminServices().db),operations=new Operations(store,undefined,resolveSubscription,verifyDeployedAccountingRules);return new LargeExportWorker(store,new FirebaseLargeExportArtifacts(),new ServerLargeExportBuilder(operations));}

export async function authorizedLargeExportDownload(store:Store,worker:LargeExportWorker,orgId:string,collection:string,jobId:string,actor:Actor){
  const role=await store.transaction(async tx=>{const value=await membership(tx,orgId,actor),permission=collection==='company_export_jobs'?'export:company':'export:accounting',subscription=await loadSubscription(tx,orgId,value.org,new Date(),resolveSubscription);assertSubscriptionActive(subscription);assertFeature(subscription,'accounting');if(collection==='accounting_export_jobs')assertFeature(subscription,'advanced_reports');ensure(hasPermission(value.role,permission), 'تنزيل التصدير غير مسموح.',403);ensure(collection!=='company_export_jobs'||value.role==='Owner'&&value.org.owner_uid===actor.uid,'تنزيل حزمة الشركة متاح للمالك الفعلي فقط.',403);return value.role;});return worker.download(orgId,collection,jobId,actor.uid,role);
}
