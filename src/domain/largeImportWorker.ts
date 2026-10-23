import { randomUUID } from 'node:crypto';
import type { Document, Store } from './store';
import { ensure, identifier } from './validation';
import type { MasterImportModule } from './masterImport';
import { largeImportStagingSha256 } from './largeImportEvidence';

export interface LargeImportRowValidator { validate(row:Document,module:MasterImportModule,policy:'skip'|'update'):Promise<void>|void; }

const cleanFailure=(_error:unknown)=>({code:'import_validation_failed',message:'تعذر التحقق من ملف الاستيراد. صحح الملف أو أعد المحاولة.'});
const audit=(eventType:string,job:Document,at:string)=>({id:`audit-${job.id}-${eventType.toLowerCase()}-${job.attempt}`,org_id:job.org_id,event_type:eventType,actor_uid:'system:large-import-worker',created_at:at,import_metadata:{module:job.module,status:job.status,attempt:job.attempt,processed_rows:job.processed_rows,total_rows:job.total_rows}});

export class LargeImportWorker {
  constructor(private store:Store,private validator:LargeImportRowValidator,private now:()=>Date=()=>new Date(),private claimId:()=>string=()=>randomUUID(),private chunkSize=250){ensure(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=500,'حجم دفعة الاستيراد غير صالح.');}

  async runNext():Promise<Document|null>{
    const queued=await this.store.transaction(tx=>tx.list('large_import_queue',{limit:25,orderBy:'created_at'}));
    const item=[...queued].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))[0];
    return item?this.run(identifier(item.org_id),identifier(item.job_id)):null;
  }

  async run(orgId:string,jobId:string):Promise<Document|null>{
    const root=`organizations/${identifier(orgId)}`,path=`${root}/large_import_jobs/${identifier(jobId)}`,queuePath=`large_import_queue/${orgId}.${jobId}`,claim=this.claimId(),started=this.now().toISOString();
    const claimed=await this.store.transaction(async tx=>{
      const current=await tx.get(path);if(!current){tx.delete(queuePath);return null;}
      const stale=current.status==='running'&&Date.parse(String(current.started_at||''))<=this.now().getTime()-15*60*1000;
      if(current.status!=='queued'&&!stale){if(current.status!=='running')tx.delete(queuePath);return null;}
      const attempt=Number(current.attempt||1)+(stale?1:0);
      if(stale&&attempt>Number(current.max_attempts||3)){const at=this.now().toISOString(),result={...current,status:'failed',worker_claim:null,failure:{code:'worker_timeout',message:'توقفت معالجة ملف الاستيراد بعد استنفاد المحاولات.'},failed_at:at,updated_at:at};tx.set(path,result);tx.delete(queuePath);const event=audit('DATA_IMPORT_FAILED',result,at);tx.set(`${root}/audit_logs/${event.id}`,event);return null;}
      const session=await tx.get(`${root}/import_sessions/${identifier(current.session_id)}`),staging=await tx.get(`${root}/import_staging/${identifier(current.session_id)}`);
      ensure(session&&staging&&session.org_id===orgId&&staging.org_id===orgId&&staging.session_id===current.session_id,'اختفت جلسة الاستيراد أو بياناتها المؤقتة.',409);
      ensure(session.status==='previewed'&&session.file_hash===current.file_hash&&Number(session.schema_version)===Number(current.schema_version),'تغيرت أدلة المعاينة بعد جدولة المهمة.',409);
      ensure(Array.isArray(staging.rows)&&staging.rows.length===Number(current.total_rows),'تغير عدد صفوف staging بعد المراجعة.',409);
      const running={...current,status:'running',stage:'validation',progress:0,processed_rows:0,failed_rows:0,attempt,worker_claim:claim,started_at:started,updated_at:started,...stale?{recovered_at:started}:{}};tx.set(path,running);return{job:running,rows:staging.rows as Document[]};
    }).catch(error=>this.fail(path,queuePath,root,claim,error));
    if(!claimed||!('job' in claimed))return claimed as Document|null;
    const {job,rows}=claimed;
    try{
      for(let offset=0;offset<rows.length;offset+=this.chunkSize){const chunk=rows.slice(offset,offset+this.chunkSize);for(const row of chunk)await this.validator.validate(row,job.module,job.duplicate_policy);const processed=Math.min(rows.length,offset+chunk.length),progress=Math.min(99,Math.floor(processed*99/rows.length));const alive=await this.store.transaction(async tx=>{const current=await tx.get(path);if(!current||current.status!=='running'||current.worker_claim!==claim)return false;tx.set(path,{...current,processed_rows:processed,progress,stage:'validation',updated_at:this.now().toISOString()});return true;});if(!alive)return null;}
      const validatedStagingSha256=await largeImportStagingSha256(rows);
      return this.store.transaction(async tx=>{const current=await tx.get(path);if(!current||current.status!=='running'||current.worker_claim!==claim)return null;const at=this.now().toISOString(),result={...current,status:'awaiting_commit',stage:'review_commit',progress:100,processed_rows:rows.length,validated_rows:rows.length,validated_staging_sha256:validatedStagingSha256,worker_claim:null,validated_at:at,updated_at:at};tx.set(path,result);tx.delete(queuePath);const event=audit('DATA_IMPORT_VALIDATED',result,at);tx.set(`${root}/audit_logs/${event.id}`,event);return result;});
    }catch(error){return this.fail(path,queuePath,root,claim,error);}
  }

  private async fail(path:string,queuePath:string,root:string,claim:string,error:unknown):Promise<Document|null>{const at=this.now().toISOString();return this.store.transaction(async tx=>{const current=await tx.get(path);if(!current||current.status!=='running'||current.worker_claim!==claim)return null;const result={...current,status:'failed',worker_claim:null,failure:cleanFailure(error),failed_at:at,updated_at:at};tx.set(path,result);tx.delete(queuePath);const event=audit('DATA_IMPORT_FAILED',result,at);tx.set(`${root}/audit_logs/${event.id}`,event);return result;});}
}
