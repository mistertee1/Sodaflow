import { createHash, randomUUID } from 'node:crypto';
import type { Document, Store, Transaction } from './store';
import { ensure, identifier } from './validation';
import { sameLargeImportRecord } from './largeImportEvidence';

export interface LargeExportContent { bytes: Uint8Array; filename: string; mimeType: string; recordCount: number; }
export interface LargeExportContentBuilder {
  build(job: Document): Promise<LargeExportContent>;
  authorizePublication?(tx: Transaction, job: Document, completedAt: string): Promise<{ expires_at?: string }>;
}
export interface LargeExportArtifactStore {
  put(path: string, content: LargeExportContent): Promise<void>;
  delete(path: string): Promise<void>;
  signedUrl(path: string, expiresAt: Date): Promise<string>;
}

const collections = ['company_export_jobs','accounting_export_jobs'] as const;
const cleanFailure=(_error:unknown)=>({code:'export_generation_failed',message:'تعذر إنشاء ملف التصدير. أعد المحاولة أو تواصل مع الدعم.'});
const audit=(eventType:string,job:Document,at:string)=>({id:`audit-${job.id}-${eventType.toLowerCase()}-${job.attempt}`,org_id:job.org_id,event_type:eventType,actor_uid:'system:large-export-worker',created_at:at,export_metadata:{export_type:job.kind,format:job.format,status:job.status,attempt:job.attempt}});

export class LargeExportWorker {
  constructor(private store:Store,private artifacts:LargeExportArtifactStore,private builder:LargeExportContentBuilder,private now:()=>Date=()=>new Date(),private claimId:()=>string=()=>randomUUID()){}

  async runNext():Promise<Document|null>{
    const queued=await this.store.transaction(tx=>tx.list('large_export_queue',{limit:25,orderBy:'created_at'}));
    const item=[...queued].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))[0];
    return item?this.run(identifier(item.org_id),identifier(item.collection),identifier(item.job_id)):null;
  }

  async run(orgId:string,collection:string,jobId:string):Promise<Document|null>{
    ensure(collections.includes(collection as typeof collections[number]),'مجموعة مهمة التصدير غير صالحة.');
    const path=`organizations/${identifier(orgId)}/${collection}/${identifier(jobId)}`,claim=this.claimId(),started=this.now().toISOString();
    const job=await this.store.transaction(async tx=>{
      const current=await tx.get(path),queuePath=`large_export_queue/${orgId}.${jobId}`;if(!current){tx.delete(queuePath);return null;}
      const stale=current.status==='running'&&Date.parse(String(current.started_at||''))<=this.now().getTime()-15*60*1000;
      if(current.status!=='queued'&&!stale){if(current.status!=='running')tx.delete(queuePath);return null;}
      const attempt=Number(current.attempt||1)+(stale?1:0);if(stale&&attempt>Number(current.max_attempts||3)){const failedAt=this.now().toISOString(),result={...current,status:'failed',worker_claim:null,failure:{code:'worker_timeout',message:'توقفت معالجة ملف التصدير بعد استنفاد المحاولات.'},artifact:null,expires_at:null,failed_at:failedAt,updated_at:failedAt};tx.set(path,result);tx.delete(queuePath);const event=audit('DATA_EXPORT_FAILED',result,failedAt);tx.set(`organizations/${orgId}/audit_logs/${event.id}`,event);return null;}
      const running:Document={...current,status:'running',progress:10,attempt,worker_claim:claim,started_at:started,updated_at:started,...stale?{recovered_at:started}: {}};tx.set(path,running);return running;
    });
    if(!job)return null;
    let artifactPath='';
    try{
      ensure(job.id===jobId&&job.org_id===orgId&&collection===(job.kind==='company'?'company_export_jobs':'accounting_export_jobs'),'هوية أو مجموعة مهمة التصدير غير مطابقة.',409);
      const content=await this.builder.build(job);ensure(content.bytes.byteLength>0&&content.bytes.byteLength<=25_000_000,'حجم ملف التصدير يتجاوز 25MB.',413);
      const filename=identifier(content.filename.replace(/[^A-Za-z0-9._-]/g,'-')),mimeType=String(content.mimeType);ensure(mimeType.length>0&&mimeType.length<=120,'نوع ملف التصدير غير صالح.');const sha256=createHash('sha256').update(content.bytes).digest('hex');
      artifactPath=`organizations/${orgId}/exports/${job.id}/attempt-${job.attempt}/${filename}`;await this.artifacts.put(artifactPath,{...content,filename,mimeType});
      const finished=this.now(),completed=await this.store.transaction(async tx=>{
        const current=await tx.get(path);if(!current||current.status!=='running'||current.worker_claim!==claim)return null;
        const keys=['id','org_id','kind','format','attempt','requested_by','period','preset_id','schedule_id','policy_revision','scheduled_for'];
        ensure(sameLargeImportRecord(Object.fromEntries(keys.map(key=>[key,current[key]])),Object.fromEntries(keys.map(key=>[key,job[key]]))),'هوية أو نطاق مهمة التصدير تغير أثناء البناء.',409);
        const publication=await this.builder.authorizePublication?.(tx,current,finished.toISOString());
        const expires=new Date(publication?.expires_at||finished.getTime()+24*60*60*1000);
        ensure(Number.isFinite(expires.getTime())&&expires>finished&&expires.getTime()<=finished.getTime()+86400000,'انتهاء ملف التصدير غير صالح.',409);
        const result={...current,status:'completed',progress:100,worker_claim:null,artifact:{path:artifactPath,filename,mime_type:mimeType,byte_size:content.bytes.byteLength,sha256,record_count:content.recordCount},expires_at:expires.toISOString(),completed_at:finished.toISOString(),updated_at:finished.toISOString()};
        tx.set(path,result);tx.delete(`large_export_queue/${orgId}.${job.id}`);tx.set(`large_export_expiry/${orgId}.${job.id}`,{id:`${orgId}.${job.id}`,org_id:orgId,job_id:job.id,collection,expires_at:expires.toISOString()});const event=audit('DATA_EXPORT_COMPLETED',result,finished.toISOString());tx.set(`organizations/${orgId}/audit_logs/${event.id}`,event);return result;
      });
      if(!completed){await this.artifacts.delete(artifactPath);return null;}return completed;
    }catch(error){if(artifactPath)await this.artifacts.delete(artifactPath).catch(()=>undefined);const failedAt=this.now().toISOString();return this.store.transaction(async tx=>{
      const current=await tx.get(path);if(!current||current.status!=='running'||current.worker_claim!==claim)return null;
      const result={...current,status:'failed',progress:Number(current.progress||10),worker_claim:null,failure:cleanFailure(error),artifact:null,expires_at:null,failed_at:failedAt,updated_at:failedAt};tx.set(path,result);tx.delete(`large_export_queue/${orgId}.${job.id}`);const event=audit('DATA_EXPORT_FAILED',result,failedAt);tx.set(`organizations/${orgId}/audit_logs/${event.id}`,event);return result;
    });}
  }

  async expire(orgId:string,collection:string,jobId:string):Promise<Document|null>{
    ensure(collections.includes(collection as typeof collections[number]),'مجموعة مهمة التصدير غير صالحة.');const path=`organizations/${identifier(orgId)}/${collection}/${identifier(jobId)}`;
    const job=await this.store.transaction(async tx=>{const value=await tx.get(path);if(!value||value.status!=='completed'||!value.expires_at){tx.delete(`large_export_expiry/${orgId}.${jobId}`);return undefined;}return value;});if(!job||new Date(job.expires_at)>this.now())return null;
    if(job.artifact?.path)await this.artifacts.delete(String(job.artifact.path));const at=this.now().toISOString();return this.store.transaction(async tx=>{const current=await tx.get(path);if(!current||current.status!=='completed'||current.expires_at!==job.expires_at)return null;const result={...current,status:'expired',artifact:null,expired_at:at,updated_at:at};tx.set(path,result);tx.delete(`large_export_expiry/${orgId}.${jobId}`);const event=audit('DATA_EXPORT_EXPIRED',result,at);tx.set(`organizations/${orgId}/audit_logs/${event.id}`,event);return result;});
  }

  async expireNext():Promise<Document|null>{const due=await this.store.transaction(tx=>tx.list('large_export_expiry',{limit:25,orderBy:'expires_at'})),item=due.find(x=>new Date(x.expires_at)<=this.now());return item?this.expire(identifier(item.org_id),identifier(item.collection),identifier(item.job_id)):null;}

  async download(orgId:string,collection:string,jobId:string,actorUid:string,role:string,authorize?:(tx:Transaction,job:Document|undefined)=>Promise<{role:string;expires_at:string}>):Promise<{url:string;expires_at:string}>{
    ensure(collections.includes(collection as typeof collections[number]),'مجموعة مهمة التصدير غير صالحة.');
    return this.store.transaction(async tx=>{
      const job=await tx.get(`organizations/${identifier(orgId)}/${collection}/${identifier(jobId)}`),grant=authorize?await authorize(tx,job):undefined,effectiveRole=grant?.role||role;
      ensure(collection!=='company_export_jobs'||effectiveRole==='Owner','تنزيل حزمة الشركة متاح للمالك فقط.',403);ensure(['Owner','Admin','Accountant'].includes(effectiveRole),'تنزيل التصدير غير مسموح.',403);
      ensure(job&&job.org_id===orgId&&job.status==='completed'&&job.artifact?.path,'ملف التصدير غير متاح.',404);ensure(new Date(job.expires_at)>this.now(),'انتهت صلاحية ملف التصدير.',410);ensure(effectiveRole==='Owner'||job.requested_by===actorUid,'تنزيل المهمة متاح لمنشئها أو المالك.',403);
      const expires=new Date(Math.min(new Date(job.expires_at).getTime(),this.now().getTime()+5*60*1000,grant?Date.parse(grant.expires_at):Infinity));
      ensure(expires>this.now(),'انتهت صلاحية تنزيل التصدير.',410);
      return{url:await this.artifacts.signedUrl(String(job.artifact.path),expires),expires_at:expires.toISOString()};
    });
  }
}
