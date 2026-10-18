import test from 'node:test';
import assert from 'node:assert/strict';
import {namesFor,createClient,execute,checkInventory,safeSummary} from '../scripts/cloudflare-provision.mjs';
const paths={d1:'/d1/database',r2:'/r2/buckets',kv:'/storage/kv/namespaces',queue:'/queues'};
function mocked(){
 const collection={d1:[],r2:[],kv:[],queue:[]},calls=[];
 const fields={d1:['name','uuid'],r2:['name','name'],kv:['title','id'],queue:['queue_name','queue_id']};
 const fetchImpl=async(url,{method,body})=>{
  const p=new URL(url).pathname,k=Object.keys(paths).find(x=>p.endsWith(paths[x]));
  if(!k)throw Error('Wrong path');
  calls.push({kind:k,method});
  if(method==='POST'){
   const record=JSON.parse(body),[n,id]=fields[k];
   collection[k].push({...record,...(k==='r2'?{}:{[id]:k+'-'+record[n]})});
  }
  const result=k==='r2'?{buckets:collection[k]}:collection[k];
  return {ok:true,status:200,json:async()=>({success:true,result,result_info:{total_pages:1}})};
 };
 return {client:createClient({accountId:'a'.repeat(32),token:'synthetic-cloudflare-token-for-unit-tests',fetchImpl}),calls,collection};
}
test('never permits production provisioning',()=>{
 for(const env of ['production','prod','',null,'../prod'])assert.throws(()=>namesFor(env));
 assert.equal(namesFor('dev').d1,'analise-gis-dev-db');
});
test('plan offline, confirmation preflight blocks all HTTP calls',async()=>{
 const m=mocked();
 const p=await execute(null,'dev','plan');assert.equal(p.status,'offline_plan');
 await assert.rejects(execute(m.client,'dev','create','CREATE_GIS_STAGING'),/confirmation/);
 assert.equal(m.calls.length,0);
});
test('creates independent D1/R2/KV/Queue, then verifies existing inventory',async()=>{
 const m=mocked();
 const dev=await execute(m.client,'dev','create','CREATE_GIS_DEV');
 const staging=await execute(m.client,'staging','create','CREATE_GIS_STAGING');
 assert.equal(dev.status,'created_and_verified');assert.equal(staging.status,'created_and_verified');
 assert.equal(m.calls.filter(c=>c.method==='POST').length,8);
 const verified=await execute(m.client,'staging','verify');assert.equal(verified.status,'verified');
 for(const kind of Object.keys(paths))assert.notEqual(dev.found[kind].id,staging.found[kind].id);
 assert.equal(safeSummary(dev).found,undefined);
 assert.equal(safeSummary(dev).productionModified,false);
});
test('already-existing namespace blocks creation even if only one exists',async()=>{
 const m=mocked();m.collection.kv.push({title:namesFor('dev').kv,id:'existing-kv'});
 await assert.rejects(execute(m.client,'dev','create','CREATE_GIS_DEV'),/Existing kv/);
 assert.equal(m.calls.filter(c=>c.method==='POST').length,0);
});
test('does not delete anything if cloud provisioning only partially succeeds',async()=>{
 const m=mocked();const orig=m.client.call;
 m.client.call=(method,endpoint,payload)=>{
  if(method==='POST'&&endpoint===paths.r2)throw Error('403 denied');
  return orig(method,endpoint,payload);
 };
 await assert.rejects(execute(m.client,'dev','create','CREATE_GIS_DEV'),/Partial provisioning/);
 assert.equal(m.collection.d1.length,1);
 assert.equal(m.calls.some(c=>c.method==='DELETE'),false);
});
test('cross environment identity reuse is rejected',()=>{
 const inv={d1:[{name:namesFor('dev').d1,id:'duplicate'},{name:namesFor('staging').d1,id:'duplicate'}],r2:[],kv:[],queue:[]};
 assert.throws(()=>checkInventory(inv,'dev'),/share d1/);
});
test('API client only permits allowlisted endpoints and GET/POST',async()=>{
 const m=mocked();
 await assert.rejects(m.client.call('DELETE',paths.d1,{}),/not allowlisted/);
 await assert.rejects(m.client.call('POST','/workers/scripts',{name:'bad'}),/not allowlisted/);
});
