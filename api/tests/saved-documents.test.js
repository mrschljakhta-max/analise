import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {rawReviewApi,previewReviewBatch} from "../src/raw-review-api.js";
import {SAVED_DOCUMENTS_HTML,SAVED_DOCUMENTS_CSS} from "../src/saved-documents-assets.js";
import {SAVED_DOCUMENTS_JS} from "../src/saved-documents-client.js";
import {GLOBAL_NAV_JS} from "../src/global-navigation-assets.js";
import {rawDocumentsApi} from "../src/raw-documents-api.js";
import worker from "../src/index.js";

const uid="12345678-1234-4000-8000-123456789012";
const actor={id:"demo-admin",role:"admin",active:1};
function fixture(count=65){
 const records=Array.from({length:count},(_,i)=>({
  source_row:i+3,
  values:{value_2:i===0?"":i===2?"перевірити":i===3?"Некоректна назва":"Демо назва "+i,
   date:"2026-10-18"},
  raw_cells:["a","b","c","d"],valid:i!==2
 }));
 return {schema_version:"ANALISE_RAW_D1_V1",source_name:"demo.docx",
  kind:"docx",review_status:"pending",checked_against_directories:false,raw_immutable:true,
  record_count:count,valid_structure_count:count-1,
  tables:[{sheet:"Таблиця 1",format:"docx",recognized:true,header_row:1,
   profile:"four_column_with_groups",columns:["value_2","date"],records,issues:[],
   structure:{groups:0,headings:1,empty:0}}]
 };
}
function fakeDb(){
 const raw=fixture(),occ=new Map();let insertCalls=0;
 const db={prepare(sql){
  return{sql,args:[],bind(...args){this.args=args;return this},
   async first(){
    if(sql.includes("FROM report_versions WHERE id="))
     return {id:uid,version:1,snapshot_json:JSON.stringify(raw)};
    if(sql.includes("sqlite_master"))return {name:"dq_rule_updated"};
    if(sql.includes("FROM directory_types WHERE id="))return {id:this.args[0]};
    if(sql.includes("FROM dq_rules"))return null;
    throw Error("Unexpected SQL: "+sql);
   },
   async all(){
    if(sql.includes("FROM directory_types ORDER BY title"))return {results:[{id:"demo_quality_labels",title:"Демо-довідник"}]};
    if(sql.includes("FROM dq_occurrences"))return {results:[{status:"pending",count:occ.size}]};
    throw Error("Unexpected SQL: "+sql);
   }
  };
 },
 async batch(statements){
  insertCalls++;
  for(const x of statements){
   assert.match(x.sql,/INSERT INTO dq_occurrences/);
   const a=x.args;
   const key=a[1]+"|"+a[3]+"|"+a[4];
   occ.set(key,{raw_value:a[5],source_ref:a[3],context_key:a[4],
    source_id:a[2],status:a[8]});
  }
  return statements.map(()=>({meta:{changes:1}}));
 }};
 return {db,occ,raw,get insertCalls(){return insertCalls}};
}
const env=x=>({DB:x.db,RAW_SAVE_ENABLED:"true"});
const post=(data)=>new Request("https://unit.example/api/raw-review/"+uid+"/queue",{
 method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)
});
const args=(offset=0)=>({directory_id:"demo_quality_labels",table_index:0,column:"value_2",offset});
test("RAW batch preview is column- and sheet-scoped and skips only blanks",()=>{
 const data=fixture();
 const first=previewReviewBatch(data,0,"value_2",0);
 assert.equal(first.processed,60);
 assert.equal(first.accepted,59);
 assert.equal(first.empty,1);
 assert.equal(first.next_offset,60);
 const second=previewReviewBatch(data,0,"value_2",60);
 assert.equal(second.accepted,5);
 assert.equal(second.next_offset,null);
 assert.throws(()=>previewReviewBatch(data,0,"unknown",0),/Колонку/);
 assert.throws(()=>previewReviewBatch(data,3,"value_2",0),/Колонку/);
});
test("Server queues D1 source values in Purgatory in bounded batches with stable references",async()=>{
 const x=fakeDb();
 const one=await rawReviewApi(post(args()),env(x),actor,["api","raw-review",uid,"queue"]);
 assert.equal(one.status,201);
 const p=await one.json();
 assert.equal(p.queued,59);assert.equal(p.next_offset,60);
 const two=await rawReviewApi(post(args(60)),env(x),actor,["api","raw-review",uid,"queue"]);
 assert.equal((await two.json()).queued,5);
 assert.equal(x.occ.size,64);
 assert.equal(x.occ.get("demo_quality_labels|raw:"+uid+":0:3:value_2|value_2"),undefined);
 assert.equal(x.occ.get("demo_quality_labels|raw:"+uid+":0:5:value_2|value_2").raw_value,"перевірити");
 const prev=JSON.stringify(x.raw);
 await rawReviewApi(post(args()),env(x),actor,["api","raw-review",uid,"queue"]);
 assert.equal(x.occ.size,64);
 assert.equal(JSON.stringify(x.raw),prev);
});
test("Quality statistics and directory catalog are read without altering RAW",async()=>{
 const x=fakeDb();
 const dir=await rawReviewApi(new Request("https://unit.example/api/raw-review/directories"),
  env(x),actor,["api","raw-review","directories"]);
 assert.equal((await dir.json()).items[0].title,"Демо-довідник");
 const before=await rawReviewApi(new Request("https://unit.example/api/raw-review/"+uid+"/quality"),
  env(x),actor,["api","raw-review",uid,"quality"]);
 assert.equal((await before.json()).counts.pending,0);
 await rawReviewApi(post(args()),env(x),actor,["api","raw-review",uid,"queue"]);
 const after=await rawReviewApi(new Request("https://unit.example/api/raw-review/"+uid+"/quality"),
  env(x),actor,["api","raw-review",uid,"quality"]);
 assert.equal((await after.json()).counts.pending,59);
});
test("Field selection, directory selection and source id must be validated",async()=>{
 const x=fakeDb();
 const badRequests=[
  {...args(),column:"not_a_field"},
  {...args(),directory_id:"../../target"},
  {...args(),table_index:60},
  {...args(),offset:-1},
  {...args(),extra:"unapproved"}
 ];
 for(const payload of badRequests){
  const r=await rawReviewApi(post(payload),env(x),actor,["api","raw-review",uid,"queue"]);
  assert.equal(r.status,400);
 }
 assert.equal(x.insertCalls,0);
 const invalid=await rawReviewApi(post(args()),env(x),actor,
  ["api","raw-review","not-a-uuid","queue"]);
 assert.equal(invalid.status,404);
});
test("Nonadmins cannot retrieve stored documents or enqueue values",async()=>{
 const x=fakeDb();
 for(const user of [null,{id:"operator",active:1,role:"duty"},{id:"old",active:0,role:"admin"}]){
  const r=await rawReviewApi(post(args()),env(x),user,["api","raw-review",uid,"queue"]);
  assert.equal(r.status,403);
 }
 assert.equal(x.insertCalls,0);
});
test("Saved Documents UI and admin menu are protected and rendered as scripts",async()=>{
 assert.doesNotThrow(()=>new Script(SAVED_DOCUMENTS_JS));
 assert.match(SAVED_DOCUMENTS_HTML,/id="sd-list"/);
 assert.match(SAVED_DOCUMENTS_HTML,/id="sd-queue"/);
 assert.match(SAVED_DOCUMENTS_CSS,/prefers-reduced-motion/);
 assert.match(GLOBAL_NAV_JS,/Збережені документи/);
 assert.ok(SAVED_DOCUMENTS_JS.includes('/api/raw-review/'));
 const unauthorized=await worker.fetch(new Request("https://unit.example/api/saved-documents"),{});
 assert.equal(unauthorized.status,503);
});

test("RAW registry paginates all revisions without duplicating or truncating after 30",async()=>{
 const rows=Array.from({length:34},(_,i)=>({
  id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
  report_name:"ANALISE-RAW-V1:demo"+i,version:i+1,created_at:"2026-10-18T07:00:00Z",
  snapshot_json:JSON.stringify({...fixture(1),source_name:"Document "+i+".docx",record_count:1})
 }));
 const env={RAW_SAVE_ENABLED:"true",DB:{prepare(sql){
  assert.match(sql,/LIMIT 31 OFFSET \?/);
  return {bind(offset){return {async all(){return {results:rows.slice(offset,offset+31)}}}}};
 }}};
 const one=await rawDocumentsApi(new Request("https://unit.example/api/raw-documents?offset=0"),
  env,actor,["api","raw-documents"]);
 const a=await one.json();assert.equal(a.items.length,30);assert.equal(a.has_more,true);
 const two=await rawDocumentsApi(new Request("https://unit.example/api/raw-documents?offset=30"),
  env,actor,["api","raw-documents"]);
 const b=await two.json();assert.equal(b.items.length,4);assert.equal(b.has_more,false);
 assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,34);
 const wrong=await rawDocumentsApi(new Request("https://unit.example/api/raw-documents?offset=-30"),
  env,actor,["api","raw-documents"]);
 assert.equal(wrong.status,400);
});
