import test from 'node:test';import assert from 'node:assert/strict';
import {nativeCurrencyExposure} from '../src/domain/fxExposure';
import {journal,journalLine} from '../src/domain/financial';
const entries=[journal('local','tenant','owner','2026-10-01','invoice','a','local',[journalLine('1200','AR',2000,0,1,0),journalLine('4100','sales',0,2000,0,1)]),journal('foreign','tenant','owner','2026-10-02','invoice','b','foreign',[journalLine('1200','AR',3000,0,1.5,0),journalLine('4100','sales',0,3000,0,1.5)])];
const proof=[{journal_id:'local',line_index:0,source_id:'a',native_currency:'SDG' as const},{journal_id:'foreign',line_index:0,source_id:'b',native_currency:'USD' as const}];
test('mixed AR retains local reporting USD while exposing only original foreign USD',()=>{const before=structuredClone(entries);const result=nativeCurrencyExposure('tenant','2026-10-31','1200',entries,proof);assert.deepEqual(result.local,{sdg:2000,usd:1});assert.deepEqual(result.foreign,{sdg:3000,usd:1.5});assert.deepEqual(entries,before)});
test('missing, duplicate and wrong control-line proofs fail closed',()=>{for(const p of [proof.slice(0,1),[...proof,proof[0]],[{...proof[0],line_index:1},proof[1]]])assert.throws(()=>nativeCurrencyExposure('tenant','2026-10-31','1200',entries,p))});
test('historical cutoff excludes later source without reading current balances',()=>{const r=nativeCurrencyExposure('tenant','2026-10-01','1200',entries,proof);assert.deepEqual(r.foreign,{sdg:0,usd:0});assert.deepEqual(r.local,{sdg:2000,usd:1})});
