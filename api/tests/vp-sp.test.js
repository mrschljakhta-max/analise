import test from "node:test";
import assert from "node:assert/strict";
import {vpNormalizeName,vpKind,vpFields} from "../src/vp-sp-common.js";
import {vpSpDirectoryApi} from "../src/vp-sp-directory-api.js";
import {vpSpImportApi} from "../src/vp-sp-import-api.js";
import {VP_SP_HTML,VP_SP_CSS} from "../src/vp-sp-assets.js";
import {VP_SP_JS} from "../src/vp-sp-client.js";

const admin={role:"admin",active:1};
const segment=(type,method)=>["api",type,method];
const url=(type,method,q="")=>"https://example.test/api/"+type+"/"+method+q;
const request=(type,action,method,payload,origin="")=>new Request(url(type,action),{
 method,headers:{"Content-Type":"application/json",...(origin?{"Origin":origin}:{})},
 body:JSON.stringify(payload)
});
const example=[{source_row:2,kind:"vp",name:"ВП Гвоздь"},
               {source_row:3,kind:"vp",name:"Матє"}];
function fakeDB({existing=[],trigger=true,change=1,batchFail=false}={}){
 const queries=[],binds=[],batches=[];
 const db={
  prepare(sql){
   queries.push(sql);
   const bound={
    first:async()=>sql.includes("sqlite_master")?(trigger?{name:"audit"}:null):null,
    all:async()=>{
     if(sql.includes("SELECT kind,normalized_name FROM vp_sp_objects")){
      return {results:existing};
     }
     if(sql.includes("FROM vp_sp_audit"))return {results:[]};
     if(sql.includes("FROM vp_sp_objects ORDER BY"))return {results:[]};
     return {results:[]};
    },
    run:async()=>({meta:{changes:change}})
   };
   return {
    ...bound,bind(...a){binds.push(a);return bound}
   };
  },
  async batch(rows){
   batches.push(rows);
   if(batchFail)throw Error("UNIQUE constraint failed");
   return rows.map(()=>({success:true,meta:{changes:1}}));
  }
 };
 return {DB:db,queries,binds,batches};
}
test("name normalization strips only leading VP and unifies Матє/Мате",()=>{
 assert.equal(vpNormalizeName("ВП Гвоздь").name,"Гвоздь");
 assert.equal(vpNormalizeName("ВП. Гвоздь").name,"Гвоздь");
 assert.equal(vpNormalizeName("Матє").name,"Мате");
 assert.equal(vpNormalizeName("Мате").normalized_name,vpNormalizeName("Матє").normalized_name);
 assert.equal(vpNormalizeName("Підрозділ ВП 1").name,"Підрозділ ВП 1");
 assert.equal(vpKind("sp"),"sp");
});
test("generic site labels are never treated as named positions",()=>{
 for(const name of ["Об'єкт прикриття","Обєкт прикриття","інше","ВП"]){
  assert.throws(()=>vpNormalizeName(name));
 }
 assert.throws(()=>vpNormalizeName("Гвоздь\nтекст"));
});
test("import API requires admin and same origin",async()=>{
 const env=fakeDB();
 const data={items:example};
 const viewer=await vpSpImportApi(request("vp-import","prepare","POST",data),{DB:env.DB},
  {role:"viewer",active:1},segment("vp-import","prepare"));
 assert.equal(viewer.status,403);
 const cross=await vpSpImportApi(request("vp-import","prepare","POST",data,"https://evil.invalid"),
  {DB:env.DB},admin,segment("vp-import","prepare"));
 assert.equal(cross.status,403);
 assert.equal(env.queries.length,0);
});
test("prepare is read only, requires audit schema and normalizes names",async()=>{
 const env=fakeDB();
 const response=await vpSpImportApi(request("vp-import","prepare","POST",{items:example}),
  {DB:env.DB},admin,segment("vp-import","prepare"));
 assert.equal(response.status,200);
 const p=await response.json();
 assert.deepEqual(p.counts,{input:2,new:2,existing:0});
 assert.match(p.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(env.batches.length,0);
 assert.ok(env.queries.every(x=>x.trimStart().startsWith("SELECT")));
 assert.ok(env.queries.every(x=>!/\b(mgrs|latitude|longitude|coordinates|unit_id|org_unit_id)\b/i.test(x)));
 const missing=fakeDB({trigger:false});
 const failed=await vpSpImportApi(request("vp-import","prepare","POST",{items:example}),
  {DB:missing.DB},admin,segment("vp-import","prepare"));
 assert.equal(failed.status,503);
});
test("coordinate and affiliation keys are expressly rejected from imports",async()=>{
 for(const injected of [
  {...example[0],mgrs:"34UAA0000000000"},
  {...example[0],unit:"example unit"},
  {...example[0],subdivision:"unit"},
  {...example[0],lat:10,lon:20},
  {...example[0],coordinates:"location"},
  {...example[0],source_row:1}
 ]){
  const db=fakeDB();
  const r=await vpSpImportApi(request("vp-import","prepare","POST",{items:[injected]}),
    {DB:db.DB},admin,segment("vp-import","prepare"));
  assert.equal(r.status,422);
  assert.equal(db.queries.length,0);
 }
});
test("duplicate names, including spelling variant, block server import",async()=>{
 const db=fakeDB();
 const r=await vpSpImportApi(request("vp-import","prepare","POST",{items:[
  {source_row:2,kind:"vp",name:"Мате"},
  {source_row:3,kind:"vp",name:"Матє"}
 ]}),{DB:db.DB},admin,segment("vp-import","prepare"));
 assert.equal(r.status,422);
 assert.equal(db.queries.length,0);
});
test("existing names are skipped and not overwritten",async()=>{
 const db=fakeDB({existing:[{kind:"vp",normalized_name:"гвоздь"}]});
 const r=await vpSpImportApi(request("vp-import","prepare","POST",{items:example}),
  {DB:db.DB},admin,segment("vp-import","prepare"));
 const p=await r.json();
 assert.equal(p.counts.new,1);
 assert.equal(p.counts.existing,1);
 assert.equal(p.skipped[0].name,"Гвоздь");
});
test("commit requires matching fingerprint and explicit confirmation",async()=>{
 const env=fakeDB(),db={DB:env.DB},args=segment("vp-import","prepare");
 const prep=await vpSpImportApi(request("vp-import","prepare","POST",{items:example}),
  db,admin,args);
 const {fingerprint}=await prep.json();
 for(const payload of [
  {items:example,fingerprint},
  {items:example,fingerprint:"0".repeat(64),confirm:"IMPORT_VP_SP_NAMES_ONLY"}
 ]){
  const res=await vpSpImportApi(request("vp-import","commit","POST",payload),
   db,admin,segment("vp-import","commit"));
  assert.equal(res.status,409);
 }
 assert.equal(env.batches.length,0);
 const res=await vpSpImportApi(request("vp-import","commit","POST",
  {items:example,fingerprint,confirm:"IMPORT_VP_SP_NAMES_ONLY"}),
  db,admin,segment("vp-import","commit"));
 assert.equal(res.status,200);
 assert.equal((await res.json()).committed,true);
 assert.equal(env.batches.length,1);
 assert.equal(env.batches[0].length,2);
 assert.ok(env.queries.every(sql=>!/\b(mgrs|latitude|longitude|coordinates|unit_id)\b/i.test(sql)));
});
test("D1 changes invalidate the prepared fingerprint",async()=>{
 const a=fakeDB();
 const prep=await vpSpImportApi(request("vp-import","prepare","POST",{items:example}),
  {DB:a.DB},admin,segment("vp-import","prepare"));
 const {fingerprint}=await prep.json();
 const b=fakeDB({existing:[{kind:"vp",normalized_name:"інша назва"}]});
 const res=await vpSpImportApi(request("vp-import","commit","POST",
  {items:example,fingerprint,confirm:"IMPORT_VP_SP_NAMES_ONLY"}),
  {DB:b.DB},admin,segment("vp-import","commit"));
 assert.equal(res.status,409);
 assert.equal(b.batches.length,0);
});
test("failed transaction never claims success",async()=>{
 const env=fakeDB({batchFail:true}), db={DB:env.DB};
 const prep=await vpSpImportApi(request("vp-import","prepare","POST",{items:example}),
  db,admin,segment("vp-import","prepare"));
 const {fingerprint}=await prep.json();
 const res=await vpSpImportApi(request("vp-import","commit","POST",
  {items:example,fingerprint,confirm:"IMPORT_VP_SP_NAMES_ONLY"}),
  db,admin,segment("vp-import","commit"));
 assert.equal(res.status,409);
 assert.equal((await res.json()).committed,false);
});
test("directory API rejects unauthorized edits and unexpected fields",async()=>{
 const db=fakeDB();
 const data={kind:"vp",name:"Мате",is_active:1};
 const viewer=await vpSpDirectoryApi(request("vp-directory","create","POST",data),
  {DB:db.DB},{role:"viewer",active:1},segment("vp-directory","create"));
 assert.equal(viewer.status,403);
 const disallowed=await vpSpDirectoryApi(request("vp-directory","create","POST",{...data,mgrs:"synthetic"}),
  {DB:db.DB},admin,segment("vp-directory","create"));
 assert.equal(disallowed.status,400);
 assert.equal(db.queries.length,0);
});
test("directory creates and updates with audit readiness and version protection",async()=>{
 const db=fakeDB();
 const created=await vpSpDirectoryApi(request("vp-directory","create","POST",
  {kind:"sp",name:"Пост 1",is_active:1}),{DB:db.DB},admin,segment("vp-directory","create"));
 assert.equal(created.status,201);
 const payload=await created.json();
 assert.match(payload.code,/^SP-[A-F0-9]{12}$/);
 assert.ok(db.queries.some(q=>q.startsWith("INSERT INTO vp_sp_objects")));
 const conflict=fakeDB({change:0});
 const r=await vpSpDirectoryApi(request("vp-directory","update","PATCH",
  {code:payload.code,name:"Пост 2",is_active:1,version:1}),
  {DB:conflict.DB},admin,segment("vp-directory","update"));
 assert.equal(r.status,409);
});
test("directory lists records and reads audit history",async()=>{
 const db=fakeDB();
 const data=await vpSpDirectoryApi(new Request(url("vp-directory","data")),
  {DB:db.DB},admin,segment("vp-directory","data"));
 assert.equal(data.status,200);
 assert.deepEqual((await data.json()).items,[]);
 const history=await vpSpDirectoryApi(new Request(url("vp-directory","history","?code=VP-ABCDEF123456")),
  {DB:db.DB},admin,segment("vp-directory","history"));
 assert.equal(history.status,200);
});
test("UI contains preview, read-only summary and history without upload of sensitive values",()=>{
 for(const id of ["file","check-file","preview","preview-rows","compare","commit",
   "editor","editor-form","tab-history","catalog-rows","local-completeness"]){
  assert.ok(VP_SP_HTML.includes('id="'+id+'"'));
 }
 assert.match(VP_SP_HTML,/ДОВІДНИК_ВП/);
 assert.match(VP_SP_HTML,/ДОВІДНИК_СП/);
 assert.match(VP_SP_CSS,/\.import-metrics/);
 assert.match(VP_SP_JS,/hasUnit/);
 assert.match(VP_SP_JS,/hasMgrs/);
 assert.match(VP_SP_JS,/source_row:x.source_row,name:x.name,kind:x.kind/);
 assert.doesNotMatch(VP_SP_JS,/\.innerHTML\s*=/);
 assert.doesNotThrow(()=>new Function(VP_SP_JS));
});
