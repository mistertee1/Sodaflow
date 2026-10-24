import { createHash, randomUUID } from 'node:crypto';
import type { Document, Store, Transaction } from './store';
import { ensure, identifier } from './validation';
import { sameLargeImportRecord } from './largeImportEvidence';

export interface LargeExportContent { bytes: Uint8Array; filename: string; mimeType: string; recordCount: number; }
export interface LargeExportContentBuilder {
  build(job: Document): Promise<LargeExportContent>;
  authorizePublication?(tx: Transaction, job: Document, completedAt: string): Promise<{ expires_at?: string }>;
  authorizeCleanup?(): Promise<void>;
}
export interface LargeExportArtifactStore {
  put(path: string, content: LargeExportContent): Promise<void>;
  delete(path: string): Promise<void>;
  signedUrl(path: string, expiresAt: Date): Promise<string>;
}

const collections = ['company_export_jobs','accounting_export_jobs'] as const;
const cleanFailure=(_error:unknown)=>({code:'export_generation_failed',message:'تعذر إنشاء ملف التصدير. أعد المحاولة أو تواصل مع الدعم.'});
const audit=(eventType:string,job:Document,at:string)=>({id:`audit-${job.id}-${eventType.toLowerCase()}-${job.attempt}`,org_id:job.org_id,event_type:eventType,actor_uid:'system:large-export-worker',created_at:at,export_metadata:{export_type:job.kind,format:job.format,status:job.status,attempt:job.attempt}});
const claimMs=15*60*1000;
const scopeKeys=['id','org_id','kind','format','attempt','max_attempts','requested_by','period','preset_id','schedule_id','policy_revision','scheduled_for','local_date','occurrence_id'];
const sameScope=(a:Document,b:Document)=>sameLargeImportRecord(Object.fromEntries(scopeKeys.map(key=>[key,a[key]])),Object.fromEntries(scopeKeys.map(key=>[key,b[key]])));
const freshClaim=(job:Document|undefined,claim:string,now:Date)=>job?.status==='running'&&job.worker_claim===claim&&Number.isFinite(Date.parse(job.started_at))&&Date.parse(job.started_at)<=now.getTime()&&Date.parse(job.started_at)>now.getTime()-claimMs;
export const exportUploadIntentId=(path:string)=>createHash('sha256').update(path).digest('hex');
function uploadEvidence(value:Document,id:string){
  identifier(value.org_id);identifier(value.job_id);identifier(value.filename);
  ensure(/^[a-f0-9]{64}$/.test(id)&&value.id===id&&collections.includes(value.collection)&&Number.isSafeInteger(value.attempt)&&value.attempt>=1
    &&typeof value.worker_claim==='string'&&['uploading','cleaning'].includes(value.state)
    &&Number.isSafeInteger(value.cleanup_attempts)&&value.cleanup_attempts>=0&&Number.isFinite(Date.parse(value.cleanup_after))
    &&value.artifact_path===`organizations/${value.org_id}/exports/${value.job_id}/attempt-${value.attempt}/${value.filename}`
    &&exportUploadIntentId(value.artifact_path)===id,'دليل تنظيف ملف التصدير غير مطابق.',409);
}

export class LargeExportWorker {
  constructor(private store:Store,private artifacts:LargeExportArtifactStore,private builder:LargeExportContentBuilder,private now:()=>Date=()=>new Date(),private claimId:()=>string=()=>randomUUID()){}

  async runNext():Promise<Document|null>{
    const queued=await this.store.transaction(tx=>tx.list('large_export_queue',{limit:25,orderBy:'created_at'}));
    for(const item of [...queued].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))){
      const result=await this.run(identifier(item.org_id),identifier(item.collection),identifier(item.job_id));if(result)return result;
    }
    return null;
  }

  async run(orgId:string,collection:string,jobId:string):Promise<Document|null>{
    ensure(collections.includes(collection as typeof collections[number]),'مجموعة مهمة التصدير غير صالحة.');
    const path=`organizations/${identifier(orgId)}/${collection}/${identifier(jobId)}`,claim=identifier(this.claimId()),started=this.now().toISOString();
    const job=await this.store.transaction(async tx=>{
      const current=await tx.get(path),queuePath=`large_export_queue/${orgId}.${jobId}`;if(!current){tx.delete(queuePath);return null;}
      const stale=current.status==='running'&&Date.parse(String(current.started_at||''))<=this.now().getTime()-claimMs;
      if(current.status!=='queued'&&!stale){if(current.status!=='running')tx.delete(queuePath);return null;}
      ensure(Number.isSafeInteger(current.attempt)&&current.attempt>=1&&Number.isSafeInteger(current.max_attempts)&&current.max_attempts>=1&&current.max_attempts<=3,'عداد محاولات ملف التصدير غير صالح.',409);
      const attempt=current.attempt+(stale?1:0);if(stale&&attempt>current.max_attempts){const failedAt=this.now().toISOString(),result={...current,status:'failed',worker_claim:null,failure:{code:'worker_timeout',message:'توقفت معالجة ملف التصدير بعد استنفاد المحاولات.'},artifact:null,expires_at:null,failed_at:failedAt,updated_at:failedAt};tx.set(path,result);tx.delete(queuePath);const event=audit('DATA_EXPORT_FAILED',result,failedAt);tx.set(`organizations/${orgId}/audit_logs/${event.id}`,event);return null;}
      const running:Document={...current,status:'running',progress:10,attempt,worker_claim:claim,started_at:started,updated_at:started,...stale?{recovered_at:started}: {}};tx.set(path,running);return running;
    });
    if(!job)return null;
    let artifactPath='',uploadId='',builtHash='',putSucceeded=false;
    try{
      ensure(job.id===jobId&&job.org_id===orgId&&collection===(job.kind==='company'?'company_export_jobs':'accounting_export_jobs'),'هوية أو مجموعة مهمة التصدير غير مطابقة.',409);
      const content=await this.builder.build(job);ensure(content.bytes.byteLength>0&&content.bytes.byteLength<=25_000_000,'حجم ملف التصدير يتجاوز 25MB.',413);
      const filename=identifier(content.filename.replace(/[^A-Za-z0-9._-]/g,'-')),mimeType=String(content.mimeType);ensure(mimeType.length>0&&mimeType.length<=120,'نوع ملف التصدير غير صالح.');const sha256=createHash('sha256').update(content.bytes).digest('hex');builtHash=sha256;
      artifactPath=`organizations/${orgId}/exports/${job.id}/attempt-${job.attempt}/${filename}`;uploadId=exportUploadIntentId(artifactPath);
      const prepared=await this.store.transaction(async tx=>{
        const current=await tx.get(path);if(!freshClaim(current,claim,this.now()))return false;
        ensure(sameScope(current!,job),'نطاق مهمة التصدير تغير قبل الرفع.',409);
        await this.builder.authorizePublication?.(tx,current!,this.now().toISOString());
        ensure(!await tx.get(`large_export_uploads/${uploadId}`),'مسار الرفع مرتبط بمحاولة قائمة.',409);
        const at=this.now();if(!freshClaim(current,claim,at))return false;
        tx.set(`large_export_uploads/${uploadId}`,{id:uploadId,org_id:orgId,job_id:jobId,collection,attempt:job.attempt,worker_claim:claim,filename,artifact_path:artifactPath,state:'uploading',created_at:at.toISOString(),cleanup_after:new Date(at.getTime()+claimMs).toISOString(),cleanup_attempts:0});return true;
      });
      if(!prepared)return null;
      await this.artifacts.put(artifactPath,{...content,filename,mimeType});
      putSucceeded=true;
      const finished=this.now(),completed=await this.store.transaction(async tx=>{
        const current=await tx.get(path);if(!freshClaim(current,claim,this.now()))return null;
        ensure(sameScope(current!,job),'هوية أو نطاق مهمة التصدير تغير أثناء البناء.',409);
        const upload=await tx.get(`large_export_uploads/${uploadId}`);ensure(upload,'دليل رفع الملف مفقود.',409);uploadEvidence(upload,uploadId);
        ensure(upload.state==='uploading'&&upload.worker_claim===claim,'الملف قيد التنظيف ولا يمكن إعلانه.',409);
        const publication=await this.builder.authorizePublication?.(tx,current!,finished.toISOString());
        const expires=new Date(publication?.expires_at||finished.getTime()+24*60*60*1000);
        ensure(Number.isFinite(expires.getTime())&&expires>finished&&expires.getTime()<=finished.getTime()+86400000,'انتهاء ملف التصدير غير صالح.',409);
        if(!freshClaim(current,claim,this.now()))return null;
        const result={...current,status:'completed',progress:100,worker_claim:null,artifact:{path:artifactPath,filename,mime_type:mimeType,byte_size:content.bytes.byteLength,sha256,record_count:content.recordCount},expires_at:expires.toISOString(),completed_at:finished.toISOString(),updated_at:finished.toISOString()};
        tx.set(path,result);tx.delete(`large_export_uploads/${uploadId}`);tx.delete(`large_export_queue/${orgId}.${job.id}`);tx.set(`large_export_expiry/${orgId}.${job.id}`,{id:`${orgId}.${job.id}`,org_id:orgId,job_id:job.id,collection,expires_at:expires.toISOString()});const event=audit('DATA_EXPORT_COMPLETED',result,finished.toISOString());tx.set(`organizations/${orgId}/audit_logs/${event.id}`,event);return result;
      });
      if(!completed){await this.cleanupUpload(uploadId,claim,putSucceeded);return null;}return completed;
    }catch(error){if(uploadId)await this.cleanupUpload(uploadId,claim,putSucceeded).catch(()=>undefined);const failedAt=this.now().toISOString();return this.store.transaction(async tx=>{
      const current=await tx.get(path);
      // A committed publication may have lost only its acknowledgement. Never
      // delete that object or turn the confirmed result into a failed attempt.
      if(current?.status==='completed'&&current.artifact?.path===artifactPath&&current.artifact?.sha256===builtHash)return current;
      if(!freshClaim(current,claim,this.now())||current!.attempt!==job.attempt)return null;
      const result={...current,status:'failed',progress:Number(current!.progress||10),worker_claim:null,failure:cleanFailure(error),artifact:null,expires_at:null,failed_at:failedAt,updated_at:failedAt};tx.set(path,result);tx.delete(`large_export_queue/${orgId}.${job.id}`);const event=audit('DATA_EXPORT_FAILED',result,failedAt);tx.set(`organizations/${orgId}/audit_logs/${event.id}`,event);return result;
    });}
  }

  async cleanupUpload(id:string,forceClaim?:string,putAcknowledged=false):Promise<Document|null>{
    ensure(/^[a-f0-9]{64}$/.test(id),'معرّف دليل الرفع غير صالح.');
    await this.builder.authorizeCleanup?.();
    const intentPath=`large_export_uploads/${id}`,cleanupClaim=identifier(this.claimId());
    const prepared=await this.store.transaction<Document|null>(async tx=>{
      const value=await tx.get(intentPath);if(!value)return null;uploadEvidence(value,id);
      const job=await tx.get(`organizations/${value.org_id}/${value.collection}/${value.job_id}`);
      if(job?.status==='completed'&&job.artifact?.path===value.artifact_path){tx.delete(intentPath);return{preserved:true,org_id:value.org_id,job_id:value.job_id};}
      const forced=forceClaim===value.worker_claim;
      if(!forced&&Date.parse(value.cleanup_after)>this.now().getTime())return null;
      if(value.state==='uploading'&&job&&job.attempt===value.attempt&&freshClaim(job,job.worker_claim,this.now())&&!forced)return null;
      const marked={...value,state:'cleaning',put_acknowledged:value.put_acknowledged===true||putAcknowledged&&forced,cleanup_claim:cleanupClaim,cleanup_attempts:Math.min(value.cleanup_attempts+1,999999),cleanup_started_at:this.now().toISOString()};
      tx.set(intentPath,marked);return marked;
    });
    if(!prepared)return null;
    if(prepared.preserved)return{status:'preserved',org_id:prepared.org_id,job_id:prepared.job_id};
    try{await this.artifacts.delete(prepared.artifact_path);}
    catch{
      await this.store.transaction(async tx=>{const value=await tx.get(intentPath);if(value?.cleanup_claim!==cleanupClaim)return;tx.set(intentPath,{...value,cleanup_after:new Date(this.now().getTime()+Math.min(3600,60*Math.max(1,prepared.cleanup_attempts))*1000).toISOString(),last_failure:{code:'export_cleanup_unavailable',message:'تعذر تنظيف ملف خاص؛ ستعاد المحاولة من السحابة.'}});});
      return{status:'pending',org_id:prepared.org_id,job_id:prepared.job_id};
    }
    await this.store.transaction(async tx=>{
      const value=await tx.get(intentPath);if(value?.cleanup_claim!==cleanupClaim)return;
      if(value.put_acknowledged===true)tx.delete(intentPath);
      else tx.set(intentPath,{...value,cleanup_confirmed_at:this.now().toISOString(),cleanup_after:new Date(this.now().getTime()+claimMs).toISOString(),last_failure:null});
    });
    // Without a positive PUT acknowledgement, retain a private cleanup marker.
    // A remote PUT can finish after its caller died or reported a network error.
    return{status:putAcknowledged?'deleted':'swept',org_id:prepared.org_id,job_id:prepared.job_id};
  }

  async cleanupNext():Promise<Document|null>{
    await this.builder.authorizeCleanup?.();
    const pending=await this.store.transaction(tx=>tx.list('large_export_uploads',{limit:25,orderBy:'cleanup_after'}));
    for(const value of pending){if(Date.parse(value.cleanup_after)>this.now().getTime())continue;const result=await this.cleanupUpload(value.id);if(result)return result;}
    return null;
  }

  async expire(orgId:string,collection:string,jobId:string):Promise<Document|null>{
    ensure(collections.includes(collection as typeof collections[number]),'مجموعة مهمة التصدير غير صالحة.');await this.builder.authorizeCleanup?.();const path=`organizations/${identifier(orgId)}/${collection}/${identifier(jobId)}`;
    const job=await this.store.transaction(async tx=>{const value=await tx.get(path);if(!value||value.status!=='completed'||!value.expires_at){tx.delete(`large_export_expiry/${orgId}.${jobId}`);return undefined;}return value;});if(!job||new Date(job.expires_at)>this.now())return null;
    ensure(job.id===jobId&&job.org_id===orgId&&Number.isFinite(Date.parse(job.expires_at))&&job.artifact&&Number.isSafeInteger(job.attempt)&&job.attempt>=1
      &&typeof job.artifact.filename==='string'&&/^[A-Za-z0-9._-]+$/.test(job.artifact.filename)
      &&job.artifact.path===`organizations/${orgId}/exports/${jobId}/attempt-${job.attempt}/${job.artifact.filename}`,'دليل انتهاء ملف التصدير أو مساره غير مطابق.',409);
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
