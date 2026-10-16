import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/domain/store';
import {Organizations} from '../server/organizations';
import {Operations,type Actor} from '../src/domain/operations';
import {INITIAL_SETTINGS} from '../src/data/initialData';

test('Excel3.1 saves tenant export presets and records a bounded full-company export history',async()=>{
 const actor:Actor={uid:'owner',email:'owner@example.com',emailVerified:true},store=new MemoryStore(),org=await new Organizations(store).create(actor,'Portable',{...INITIAL_SETTINGS},'setup',true),root=`organizations/${org.id}`;
 await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionEnd:'2027-01-01'});});
 const ops=new Operations(store,()=>new Date('2026-10-16T16:20:00Z'));
 const preset=await ops.execute(org.id,actor,{action:'exportPreset.save',operationId:'preset-1',data:{name:'إقفال أكتوبر',kind:'accounting',period:{start:'2026-10-01',end:'2026-10-31'}}});
 assert.equal(preset.result.name,'إقفال أكتوبر');assert.equal(store.dump()[`${root}/export_presets/export-preset-preset-1`].org_id,org.id);
 const exported=await ops.execute(org.id,actor,{action:'companyExport.record',operationId:'company-1',data:{schema_version:3,byte_size:1200,filename:'company.json',collection_counts:{customers:2,journal_entries:4}}});
 assert.equal(exported.result.export_type,'company');const audit=store.dump()[`${root}/audit_logs/audit-company-1`];assert.equal(audit.event_type,'DATA_EXPORT_CREATED');assert.equal(audit.export_metadata.byte_size,1200);
 const snapshot=await ops.snapshot(org.id,actor);assert.equal(snapshot.collections.export_presets.length,1);
 await ops.execute(org.id,actor,{action:'exportPreset.delete',operationId:'preset-delete',data:{id:preset.result.id}});assert.equal(store.dump()[`${root}/export_presets/${preset.result.id}`],undefined);
});

test('Excel3.1 rejects invalid presets, oversized direct exports and unauthorized viewers',async()=>{
 const owner:Actor={uid:'owner',email:'owner@example.com',emailVerified:true},store=new MemoryStore(),org=await new Organizations(store).create(owner,'Portable',{...INITIAL_SETTINGS},'setup',true),root=`organizations/${org.id}`;
 await store.transaction(async tx=>{tx.set(root,{...await tx.get(root),accounting_version:2,planId:'Enterprise',subscriptionEnd:'2027-01-01'});tx.set(`${root}/members/viewer`,{uid:'viewer',role:'Viewer',status:'active',org_id:org.id});});
 const ops=new Operations(store),viewer={...owner,uid:'viewer'};
 await assert.rejects(ops.execute(org.id,owner,{action:'exportPreset.save',operationId:'bad-period',data:{name:'x',kind:'company',period:{start:'2026-01-01'}}}),/الفترة مسموحة/);
 await assert.rejects(ops.execute(org.id,owner,{action:'companyExport.record',operationId:'large',data:{schema_version:3,byte_size:900001,filename:'x.json',collection_counts:{}}}),/900KB/);
 await assert.rejects(ops.execute(org.id,viewer,{action:'companyExport.record',operationId:'denied',data:{schema_version:3,byte_size:10,filename:'x.json',collection_counts:{}}}),/صلاحية/);
});
