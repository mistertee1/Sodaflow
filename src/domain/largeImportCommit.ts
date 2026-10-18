import type { Document, Transaction } from './store';
import { ensure, identifier } from './validation';
import { masterImportModule, type MasterImportModule } from './masterImport';

type DuplicatePolicy='skip'|'update';
const keys:Record<MasterImportModule,string[]>={customers:['customer_code','email'],suppliers:['supplier_code','email','tax_number'],products:['sku']};
const comparable=(value:unknown)=>String(value??'').trim().toLowerCase();
const existingValue=(module:MasterImportModule,row:Document,field:string)=>field==='customer_code'?row.customer_code??row.code??row.id:field==='supplier_code'?row.supplier_code??row.code??row.id:field==='sku'?row.sku??row.code??row.id:row[field];
const cleanData=(module:MasterImportModule,data:Document)=>{
  const allowed=module==='customers'?['customer_code','name','phone','email','address','currency','credit_limit','payment_terms']:module==='suppliers'?['supplier_code','name','phone','email','address','currency','payment_terms','tax_number']:['sku','product_name','category','unit','selling_price_sdg','selling_price_usd','track_inventory','tax_rate'];
  return Object.fromEntries(Object.entries(data).filter(([key])=>allowed.includes(key)));
};
const findDuplicate=(module:MasterImportModule,row:Document,existing:Document[])=>existing.find(record=>keys[module].some(field=>comparable(row[field])&&comparable(row[field])===comparable(existingValue(module,record,field))));

export async function commitLargeImport(tx:Transaction,root:string,job:Document,staging:Document,actorUid:string,operationId:string,at:string){
  ensure(job.status==='awaiting_commit'&&job.stage==='review_commit','مهمة الاستيراد ليست جاهزة للاعتماد.',409);
  ensure(staging&&staging.session_id===job.session_id&&staging.org_id===job.org_id,'بيانات staging لا تطابق المهمة.',409);
  ensure(Array.isArray(staging.rows)&&staging.rows.length===Number(job.validated_rows),'تغيرت صفوف staging بعد التحقق.',409);
  ensure(staging.rows.length<=400,'الاعتماد الذري يدعم حتى 400 صف؛ قسّم الملف إلى دفعات أصغر.',413);
  const module=masterImportModule(job.module),policy=job.duplicate_policy as DuplicatePolicy,existing=await tx.list(`${root}/${module}`),changes:Document[]=[],createdIds:string[]=[],skippedRows:number[]=[];
  for(const staged of staging.rows as Document[]){
    ensure(staged.status!=='blocking'&&!staged.issues?.some((issue:Document)=>issue.level==='blocking'),'تحتوي بيانات staging على خطأ حاجب.',409);
    const data=cleanData(module,staged.data||{}),duplicate=findDuplicate(module,data,existing);
    if(duplicate&&policy==='skip'){skippedRows.push(Number(staged.row_number));continue;}
    const id=duplicate?identifier(duplicate.id):`${module.slice(0,-1)}-imp-${identifier(job.id)}-${Number(staged.row_number)}`;
    const before=duplicate?structuredClone(duplicate):null,record={...(duplicate||{}),...data,id,org_id:job.org_id,import_batch_id:job.id,import_operation_id:operationId,updated_at:at,...duplicate?{}:{created_at:at}};
    tx.set(`${root}/${module}/${id}`,record);changes.push({id,before,after:record});if(!duplicate)createdIds.push(id);
    if(duplicate)Object.assign(existing[existing.findIndex(row=>row.id===duplicate.id)],record);else existing.push(record);
  }
  const backup={id:`backup-${job.id}`,org_id:job.org_id,job_id:job.id,module,operation_id:operationId,created_by:actorUid,created_at:at,status:'available',changes,created_ids:createdIds,skipped_rows:skippedRows};
  tx.set(`${root}/import_commit_backups/${backup.id}`,backup);
  return{...job,status:'completed',stage:'committed',committed_rows:changes.length,skipped_rows:skippedRows.length,commit_backup_id:backup.id,committed_by:actorUid,committed_at:at,updated_at:at};
}

export async function undoLargeImport(tx:Transaction,root:string,job:Document,backup:Document,actorUid:string,operationId:string,at:string){
  ensure(job.status==='completed'&&job.commit_backup_id===backup?.id&&backup.status==='available','لا توجد نسخة تراجع متاحة لهذه المهمة.',409);
  ensure(Array.isArray(backup.changes)&&backup.job_id===job.id&&backup.org_id===job.org_id,'دليل التراجع لا يطابق المهمة.',409);
  const module=masterImportModule(job.module);
  for(const change of backup.changes as Document[]){const current=await tx.get(`${root}/${module}/${identifier(change.id)}`);ensure(current&&current.import_batch_id===job.id&&current.import_operation_id===backup.operation_id,'تغير سجل بعد الاستيراد؛ أُلغي التراجع لحماية التعديلات اللاحقة.',409);}
  for(const change of backup.changes as Document[]){const path=`${root}/${module}/${identifier(change.id)}`;if(change.before)tx.set(path,change.before);else tx.delete(path);}
  tx.set(`${root}/import_commit_backups/${backup.id}`,{...backup,status:'consumed',undone_by:actorUid,undo_operation_id:operationId,undone_at:at});
  return{...job,status:'rolled_back',stage:'rolled_back',rolled_back_by:actorUid,rolled_back_at:at,updated_at:at};
}
