import platformControls from '../src/config/platform-controls.json';
import type { Document, Store, Transaction } from '../src/domain/store';
import { LargeExportWorker, type LargeExportArtifactStore, type LargeExportContentBuilder } from '../src/domain/largeExportWorker';
import { Operations, type Actor } from '../src/domain/operations';
import { buildAccountingExport } from '../src/domain/accountingExport';
import { BusinessError, ensure, identifier } from '../src/domain/validation';
import { adminServices } from './admin';
import { FirestoreStore } from './firestoreStore';
import { resolveSubscription } from './subscriptions';
import { verifyDeployedAccountingRules } from './accountingSecurity';
import type { Account, JournalEntry } from '../src/types';
import { auditorPeriod, buildAuditorPackage, readAuditorSources } from '../src/domain/auditorPackage';
import { scheduledArtifactExpiry } from '../src/domain/scheduledExportPolicy';
import { LiveExportAuthorization, type ExportAuthorizationOptions } from './exportAuthorization';

export class FirebaseLargeExportArtifacts implements LargeExportArtifactStore{
  private bucket=adminServices().bucket;
  async put(path:string,content:{bytes:Uint8Array;mimeType:string}){await this.bucket.file(path).save(Buffer.from(content.bytes),{resumable:false,metadata:{contentType:content.mimeType,cacheControl:'private,no-store',metadata:{sudaflowExport:'true'}}});}
  async delete(path:string){await this.bucket.file(path).delete({ignoreNotFound:true});}
  async signedUrl(path:string,expiresAt:Date){const [url]=await this.bucket.file(path).getSignedUrl({action:'read',expires:expiresAt,responseDisposition:'attachment'});return url;}
}

export class ServerLargeExportBuilder implements LargeExportContentBuilder{
  private authorization: LiveExportAuthorization;
  private cleanupSecurity:()=>Promise<void>;
  constructor(private operations:Operations, options:ExportAuthorizationOptions={}){this.authorization=new LiveExportAuthorization(operations.store,{controlsEnabled:operations.controlsEnabled,...options});this.cleanupSecurity=options.verifySecurity||verifyDeployedAccountingRules;}
  async authorizeCleanup(){
    ensure(this.operations.store.authority==='server','تنظيف ملفات التصدير يتطلب خدمة الخادم.',403);
    try{await this.cleanupSecurity();}catch(error){if(error instanceof BusinessError)throw error;throw new BusinessError('تعذر تأكيد حماية تنظيف الملفات.',503,'accounting_rules_not_verified');}
  }
  async build(job:Document){
    const identity=await this.authorization.identity(identifier(job.requested_by));
    return this.operations.store.transaction(async tx=>{
      const current=await this.authorization.job(tx,job,identity),at=this.authorization.now().toISOString();
      const period=auditorPeriod(job.period===undefined?{}:job.period);
      if(job.kind==='company'){
        ensure(!period.start&&!period.end,'حزمة الشركة لا تقبل نطاقاً جزئياً.');
        // The same transaction proves access and reads the backup. A filtered
        // read-only snapshot is never mistaken for permission to export zero rows.
        const readOnly:Store={authority:'server',transaction:async work=>work({...tx,set:()=>{throw Error('Export is read-only');},delete:()=>{throw Error('Export is read-only');}})};
        const snapshot=await new Operations(readOnly,this.authorization.now,this.authorization.subscriptionPolicy,undefined,this.authorization.controlsEnabled).snapshot(job.org_id,current.actor,true);
        const bytes=new TextEncoder().encode(JSON.stringify(snapshot));return{bytes,filename:`sudaflow-company-${job.org_id}-${at.slice(0,10)}.json`,mimeType:'application/json',recordCount:Object.values(snapshot.collections).reduce((sum,rows)=>sum+(rows as Document[]).length,0)};
      }
      if(job.kind==='auditor'){
        const sources=await readAuditorSources(tx,`organizations/${job.org_id}`),exported=await buildAuditorPackage({orgId:job.org_id,operationId:job.id,createdAt:at,period,financial:sources.financial,audit:sources.audit,settings:current.org.settings});
        return{bytes:Buffer.from(exported.workbook_base64,'base64'),filename:exported.filename,mimeType:exported.mime_type,recordCount:exported.record_count};
      }
      const names=['accounts','journal_entries','bank_reconciliations','cash_reconciliations'],limits=[5000,50000,5000,5000];
      const data=await Promise.all(names.map((name,index)=>tx.list(`organizations/${job.org_id}/${name}`,{limit:limits[index]+1})));
      data.forEach((rows,index)=>{ensure(rows.length<=limits[index],'مصادر التصدير تتجاوز حد المهمة.',413);ensure(rows.every(row=>row.org_id===job.org_id),'مصدر التصدير من مؤسسة أخرى.',409);});
      const exported=buildAccountingExport({orgId:job.org_id,role:current.role,createdAt:at,operationId:job.id,period,accounts:data[0] as Account[],entries:data[1] as JournalEntry[],reconciliations:[...data[2],...data[3]],settings:current.org.settings,maxEntries:50_000,maxBytes:25_000_000});
      return{bytes:Buffer.from(exported.workbook_base64,'base64'),filename:exported.filename,mimeType:exported.mime_type,recordCount:exported.record_count};
    });
  }
  async authorizePublication(tx:Transaction,job:Document,completedAt:string){
    const identity=await this.authorization.identity(identifier(job.requested_by)),current=await this.authorization.job(tx,job,identity);
    return current.policy?{expires_at:scheduledArtifactExpiry(current.policy,completedAt)}:{};
  }
}

export function firebaseLargeExportWorker(){const store:Store=new FirestoreStore(adminServices().db),operations=new Operations(store,undefined,resolveSubscription,verifyDeployedAccountingRules,platformControls.enabled);return new LargeExportWorker(store,new FirebaseLargeExportArtifacts(),new ServerLargeExportBuilder(operations));}

export async function authorizedLargeExportDownload(store:Store,worker:LargeExportWorker,orgId:string,collection:string,jobId:string,actor:Actor,options:ExportAuthorizationOptions={}){
  identifier(orgId);identifier(jobId);ensure(['company_export_jobs','accounting_export_jobs'].includes(collection),'مجموعة التصدير غير صالحة.');ensure(actor.emailVerified===true,'البريد غير مؤكد.',403);
  const authorization=new LiveExportAuthorization(store,options);
  return worker.download(orgId,collection,jobId,actor.uid,'Viewer',async(tx,job)=>{
    const requester=await authorization.identity(actor.uid);ensure(job,'ملف التصدير غير متاح.',404);
    const creator=job.requested_by===requester.uid?requester:await authorization.identity(identifier(job.requested_by));
    return authorization.download(tx,orgId,collection,jobId,job,creator,requester);
  });
}
