import test from "node:test";
import assert from "node:assert/strict";
import {syntheticWordFinalizedApi,summarizeSyntheticWordDocument} from "../src/synthetic-word-finalized-api.js";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {SYNTHETIC_UPLOAD_HTML} from "../src/synthetic-upload-assets.js";
import {SYNTHETIC_UPLOAD_JS} from "../src/synthetic-upload-client.js";

const source="synthetic-docx-2026-10-11:row-";
const doc={
 id:"demo-doc-1",document_name:"ANALISE_ДЕМО_Word.docx",created_at:"2026-10-17T01:00:00Z",
 snapshot_json:JSON.stringify({type:"docx",records:4,detail:[
  {row:1,label:"Альфа-демо",status:"known"},
  {row:2,label:"Альфа деммo",status:"review"},
  {row:3,label:"Бета-демо",status:"known"},
  {row:4,label:"Бетта-демо",status:"review"}
 ]})
};
const target=(row,id,label,origin="manual")=>[source+String(row).padStart(3,"0")+":label",{
 status:"resolved",target_id:id,target_label:label,target_directory:"demo_quality_labels",
 resolution_origin:origin
}];
function mockDb({documents=[doc],resolved=[]}={}){
 const statements=[];
 const DB={prepare(sql){
  const statement={sql,args:[],
   bind(...args){this.args=args;return this},
   async first(){return {name:"demo_import_documents"}},
   async all(){
    if(sql.includes("FROM demo_import_documents"))return {results:documents};
    if(sql.includes("FROM dq_occurrences"))return {results:resolved.map(([source_ref,x])=>({source_ref,...x}))};
    return {results:[]};
   }};
  statements.push(statement);return statement;
 }};
 return {DB,statements};
}
const request=url=>new Request(url||"https://analise.test/api/synthetic-upload/finalized");
const admin={id:"admin-1",role:"admin",active:1};

test("known labels are finalized, unfamiliar demo labels remain pending",()=>{
 const result=summarizeSyntheticWordDocument(doc,new Map());
 assert.equal(result.total,4);assert.equal(result.saved,2);assert.equal(result.pending,2);
 assert.deepEqual(result.items.map(x=>x.status),["saved","pending","saved","pending"]);
 assert.deepEqual(result.items.filter(x=>x.status==="saved").map(x=>x.label),["Альфа-демо","Бета-демо"]);
 assert.equal(result.items[1].label,undefined);
});
test("later manual approval makes pending rows queryable without reupload",()=>{
 const reviewed=new Map([target(2,"demo_quality_alpha_v1","Альфа-демо"),
  target(4,"demo_quality_beta_v1","Бета-демо","rule")]);
 const result=summarizeSyntheticWordDocument(doc,reviewed);
 assert.equal(result.saved,4);assert.equal(result.pending,0);
 assert.equal(result.items[1].label,"Альфа-демо");
 assert.equal(result.items[1].origin,"manual");
 assert.equal(result.items[3].origin,"rule");
});
test("wrong directory or tampered target label never becomes finalized",()=>{
 const review=new Map([target(2,"demo_quality_alpha_v1","Інше")]);
 assert.equal(summarizeSyntheticWordDocument(doc,review).pending,2);
 review.set(source+"002:label",{status:"resolved",target_id:"demo_quality_alpha_v1",
  target_label:"Альфа-демо",target_directory:"other"});
 assert.equal(summarizeSyntheticWordDocument(doc,review).pending,2);
});
test("invalid snapshots fail closed and never return unapproved text",()=>{
 const poisoned={...doc,snapshot_json:JSON.stringify({type:"docx",records:1,
   detail:[{row:1,label:"Не дозволені дані",status:"known"}]})};
 assert.equal(summarizeSyntheticWordDocument(poisoned,new Map()),null);
 const duplicate={...doc,snapshot_json:JSON.stringify({type:"docx",records:2,
   detail:[{row:1,label:"Альфа-демо",status:"known"},
    {row:1,label:"Альфа-демо",status:"known"}]})};
 assert.equal(summarizeSyntheticWordDocument(duplicate,new Map()),null);
});
test("GET endpoint is admin-only and uses persisted D1 evidence",async()=>{
 const {DB,statements}=mockDb();
 const out=await syntheticWordFinalizedApi(request(),{DB},admin);
 assert.equal(out.status,200);
 const result=await out.json();
 assert.equal(result.mode,"synthetic_only");assert.equal(result.saved,2);
 assert.equal(result.pending,2);assert.equal(result.documents.length,1);
 assert.ok(statements.some(x=>x.sql.includes("demo_import_documents")));
 assert.ok(statements.some(x=>x.sql.includes("dq_occurrences")&&
  x.args.includes("demo_quality_labels")));
 for(const who of [null,{role:"duty",active:1},{role:"admin",active:0}]){
  const rejected=await syntheticWordFinalizedApi(request(),{DB},who);
  assert.equal(rejected.status,403);
 }
 assert.equal((await syntheticWordFinalizedApi(new Request(request().url,{method:"POST"}),{DB},admin)).status,405);
 assert.equal((await syntheticWordFinalizedApi(request("https://analise.test/api/synthetic-upload/finalized?offset=-1"),{DB},admin)).status,400);
});
test("integration route exists; read model contains no operational mappings",()=>{
 const router=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 const module=readFileSync(new URL("../src/synthetic-word-finalized-api.js",import.meta.url),"utf8");
 assert.match(router,/synthetic-upload\/finalized/);
 assert.match(module,/synthetic_only/);
 assert.doesNotMatch(module,/MGRS|azimuth|координат|цілі|подавлен|бойов/iu);
});

test("demo interface exposes refreshable finalized Word results and compiles",()=>{
 assert.match(SYNTHETIC_UPLOAD_HTML,/id=\\"ud-finalized-refresh\\"/);
 assert.match(SYNTHETIC_UPLOAD_HTML,/id=\\"ud-finalized-list\\"/);
 assert.match(SYNTHETIC_UPLOAD_JS,/synthetic-upload\\/finalized/);
 assert.doesNotThrow(()=>new Script(SYNTHETIC_UPLOAD_JS));
});
