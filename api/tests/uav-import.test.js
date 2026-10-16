import test from 'node:test';
import assert from 'node:assert/strict';
import {uavImportApi} from '../src/uav-import-api.js';
import {UAV_IMPORT_HTML,UAV_IMPORT_CSS} from '../src/uav-import-assets.js';
import {UAV_IMPORT_JS} from '../src/uav-import-client.js';

const admin={id:'test-admin',role:'admin',active:1};
const url=type=>'https://example.test/api/uav-import/'+type;
const segments=type=>['api','uav-import',type];
const first={
  source_row:2,code:'UAV-0001',name:'Випробувальна модель',airframe:'wing',subtype:'',
  entry_kind:'model',country:'',manufacturer:'',purpose:'',note:'',is_active:1
};
const fpv={
  source_row:17,code:'UAV-0016',name:'FPV',airframe:'multirotor',subtype:'fpv',
  entry_kind:'generic',country:'',manufacturer:'',purpose:'',note:'',is_active:1
};
const post=(kind,body,origin='')=>new Request(url(kind),{
  method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},
  body:JSON.stringify(body)
});
function db({existing=[],trigger=true,batchFails=false}={}){
 const sql=[],bindings=[],batchCalls=[];
 const database={
   prepare(q){
     sql.push(q);
     return {
       bind(...args){
         bindings.push(args);
         return {first:async()=>{
           if(q.includes('sqlite_master'))return trigger?{name:'uav_model_audit_insert'}:null;
           throw Error('Unexpected .first: '+q);
         }};
       },
       all:async()=>{
         if(q.includes('SELECT code,normalized_name FROM uav_models')){
           return {results:existing};
         }
         throw Error('Unexpected .all: '+q);
       }
     };
   },
   async batch(statements){
     batchCalls.push(statements);
     if(batchFails)throw Error('SQLITE_CONSTRAINT');
     return statements.map(()=>({success:true,meta:{changes:1}}));
   }
 };
 return {env:{DB:database},sql,bindings,batchCalls};
}
test('only admin may preview or commit; cross-origin mutations are denied',async()=>{
 const m=db();
 assert.equal((await uavImportApi(post('prepare',{items:[first]}),m.env,{role:'viewer'},segments('prepare'))).status,403);
 assert.equal((await uavImportApi(post('prepare',{items:[first]},'https://invalid.test'),m.env,admin,segments('prepare'))).status,403);
 assert.equal(m.sql.length,0);
 assert.equal((await uavImportApi(new Request(url('prepare')),m.env,admin,segments('prepare'))).status,405);
 assert.equal((await uavImportApi(post('unknown',{items:[first]}),m.env,admin,segments('unknown'))).status,404);
});
test('prepare compares against D1 and performs no writes',async()=>{
 const m=db();
 const response=await uavImportApi(post('prepare',{items:[first,fpv]}),m.env,admin,segments('prepare'));
 assert.equal(response.status,200);
 const result=await response.json();
 assert.deepEqual(result.counts,{input:2,new:2,existing:0,frequencies:0});
 assert.equal(result.committed,false);
 assert.match(result.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(m.batchCalls.length,0);
 assert.equal(m.sql.length,2);
 assert.doesNotMatch(m.sql.join('\n'),/station_location_history|latitude|longitude|jamming|uav_frequency_profiles/);
});
test('same code/name already in D1 is skipped, not overwritten',async()=>{
 const m=db({existing:[{code:first.code,normalized_name:'випробувальна модель'}]});
 const response=await uavImportApi(post('prepare',{items:[first,fpv]}),m.env,admin,segments('prepare'));
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.counts.new,1);
 assert.equal(data.counts.existing,1);
 assert.deepEqual(data.skipped.map(s=>s.code),[first.code]);
});
test('conflicting code or name is blocked before batch',async()=>{
 const conflicts=[
   [{code:first.code,normalized_name:'інша назва'}],
   [{code:'UAV-9000',normalized_name:'випробувальна модель'}]
 ];
 for(const existing of conflicts){
   const m=db({existing});
   const result=await uavImportApi(post('prepare',{items:[first]}),m.env,admin,segments('prepare'));
   assert.equal(result.status,422);
   assert.ok((await result.json()).errors.length>0);
   assert.equal(m.batchCalls.length,0);
 }
});
test('duplicate names/codes and unexpected source fields are rejected',async()=>{
 for(const invalid of [
   [first,{...first,source_row:3,code:'UAV-0002'}],
   [first,{...first,source_row:3,name:'Інша назва'}],
   [{...first,frequency_mhz:123}],
   [{...first,airframe:'wing',subtype:'fpv'}],
   [{...fpv,subtype:'optical'}],
   [{...first,is_active:'true'}],
   [{...first,code:'543',name:''}]
 ]){
   const m=db();
   const r=await uavImportApi(post('prepare',{items:invalid}),m.env,admin,segments('prepare'));
   assert.equal(r.status,422);
   assert.equal(m.sql.length,0);
 }
});
test('commit requires valid fingerprint and explicit confirmation',async()=>{
 const m=db();
 const preview=await uavImportApi(post('prepare',{items:[first]}),m.env,admin,segments('prepare'));
 const {fingerprint}=await preview.json();
 for(const obj of [
   {items:[first],fingerprint},
   {items:[first],fingerprint:'0'.repeat(64),confirm:'IMPORT_UAV_NEW_ONLY'}
 ]){
   const r=await uavImportApi(post('commit',obj),m.env,admin,segments('commit'));
   assert.equal(r.status,409);
 }
 assert.equal(m.batchCalls.length,0);
 const result=await uavImportApi(post('commit',{
   items:[first],fingerprint,confirm:'IMPORT_UAV_NEW_ONLY'
 }),m.env,admin,segments('commit'));
 assert.equal(result.status,200);
 assert.equal((await result.json()).committed,true);
 assert.equal(m.batchCalls[0].length,1);
 assert.equal(m.bindings.at(-1)[1],first.code);
 assert.equal(m.bindings.at(-1)[4],'wing');
 assert.ok(m.sql.some(q=>q.startsWith('INSERT INTO uav_models')));
 assert.ok(m.sql.every(q=>!q.includes('uav_frequency_profiles')));
});
test('a modified D1 snapshot invalidates a prepared fingerprint',async()=>{
 const m=db();
 const preview=await uavImportApi(post('prepare',{items:[first]}),m.env,admin,segments('prepare'));
 const {fingerprint}=await preview.json();
 m.env.DB.prepare=('unused'); // the next calls use a separate mock for changed D1
 const changed=db({existing:[{code:'UAV-5555',normalized_name:'інші моделі'}]});
 const result=await uavImportApi(post('commit',{
   items:[first],fingerprint,confirm:'IMPORT_UAV_NEW_ONLY'
 }),changed.env,admin,segments('commit'));
 assert.equal(result.status,409);
 assert.equal(changed.batchCalls.length,0);
});
test('no new models means commit is a no-op; missing audit blocks writes',async()=>{
 const same=db({existing:[{code:first.code,normalized_name:'випробувальна модель'}]});
 const preview=await uavImportApi(post('prepare',{items:[first]}),same.env,admin,segments('prepare'));
 const {fingerprint}=await preview.json();
 const result=await uavImportApi(post('commit',{
   items:[first],fingerprint,confirm:'IMPORT_UAV_NEW_ONLY'
 }),same.env,admin,segments('commit'));
 assert.equal(result.status,200);
 assert.equal((await result.json()).committed,false);
 assert.equal(same.batchCalls.length,0);
 const notMigrated=db({trigger:false});
 const failed=await uavImportApi(post('prepare',{items:[first]}),notMigrated.env,admin,segments('prepare'));
 assert.equal(failed.status,503);
});
test('a failed batch does not claim successful import',async()=>{
 const m=db({batchFails:true});
 const preview=await uavImportApi(post('prepare',{items:[first]}),m.env,admin,segments('prepare'));
 const {fingerprint}=await preview.json();
 const res=await uavImportApi(post('commit',{
   items:[first],fingerprint,confirm:'IMPORT_UAV_NEW_ONLY'
 }),m.env,admin,segments('commit'));
 assert.equal(res.status,409);
 assert.equal((await res.json()).committed,false);
});
test('Excel parser is local; DICT_FPV statistics never become imported models',()=>{
 assert.match(UAV_IMPORT_HTML,/id="preview-rows"/);
 assert.match(UAV_IMPORT_HTML,/id="prepare"/);
 assert.match(UAV_IMPORT_HTML,/id="commit"/);
 assert.match(UAV_IMPORT_CSS,/\.row-review/);
 assert.match(UAV_IMPORT_JS,/DICT_UAV/);
 assert.match(UAV_IMPORT_JS,/DICT_FPV/);
 assert.match(UAV_IMPORT_JS,/code==='543'/);
 assert.match(UAV_IMPORT_JS,/norm\(type\)==='каб'/);
 assert.match(UAV_IMPORT_JS,/['"]кво['"]/);
 assert.match(UAV_IMPORT_JS,/id.*uav_code/);
 assert.match(UAV_IMPORT_JS,/new TextDecoder/);
 assert.match(UAV_IMPORT_JS,/getPayload/);
 assert.doesNotMatch(UAV_IMPORT_JS,/\.innerHTML\s*=/);
 assert.doesNotThrow(()=>new Function(UAV_IMPORT_JS));
});