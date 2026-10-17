import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {Script} from "node:vm";
import {databaseViewerApi,databaseViewerDatasets} from "../src/database-viewer-api.js";
import {DATABASE_VIEWER_HTML,DATABASE_VIEWER_CSS} from "../src/database-viewer-assets.js";
import {DATABASE_VIEWER_JS} from "../src/database-viewer-client.js";
import {GLOBAL_NAV_JS} from "../src/global-navigation-assets.js";

const base="https://analise.example/api/database-viewer/";
const admin={id:"admin-001",role:"admin",active:1};
function setup(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec([
  "CREATE TABLE directory_types(id TEXT PRIMARY KEY,title TEXT,version INT,created_at TEXT,updated_at TEXT);",
  "CREATE TABLE directory_entries(id TEXT PRIMARY KEY,directory_id TEXT,data_json TEXT,version INT,archived_at TEXT,created_at TEXT,updated_at TEXT);",
  "CREATE TABLE dq_occurrences(id TEXT PRIMARY KEY,directory_id TEXT,source_id TEXT,source_ref TEXT,raw_value TEXT,normalized_value TEXT,status TEXT,resolution_origin TEXT,active INT,created_at TEXT,updated_at TEXT);",
  "CREATE TABLE dq_rules(id TEXT PRIMARY KEY,directory_id TEXT,raw_example TEXT,normalized_value TEXT,target_id TEXT,active INT,version INT,created_at TEXT,updated_at TEXT);",
  "CREATE TABLE demo_import_sessions(id TEXT PRIMARY KEY,actor_id TEXT,created_at TEXT,updated_at TEXT,input_count INT,document_count INT,row_count INT,pending_count INT,auto_resolved_count INT,skipped_count INT);",
  "CREATE TABLE demo_import_documents(id TEXT PRIMARY KEY,session_id TEXT,document_name TEXT,kind TEXT,status TEXT,row_count INT,pending_count INT,auto_resolved_count INT,created_at TEXT,snapshot_json TEXT,member_index INT);",
  "CREATE TABLE demo_report_versions(id TEXT PRIMARY KEY,kind TEXT,report_date TEXT,revision INT,source_name TEXT,created_at TEXT,previous_version_id TEXT,snapshot_json TEXT);",
  "CREATE TABLE demo_report_active(kind TEXT,report_date TEXT,version_id TEXT);"
 ].join("\n"));
 const insert=(sql,...args)=>sqlite.prepare(sql).run(...args);
 insert("INSERT INTO directory_types VALUES(?,?,?,?,?)","demo_quality_labels","ДЕМО · Тестові назви",1,"2026-10-15","2026-10-16");
 insert("INSERT INTO directory_types VALUES(?,?,?,?,?)","settlements","Населені пункти",1,"2026-10-15","2026-10-16");
 insert("INSERT INTO directory_entries VALUES(?,?,?,?,?,?,?)","demo-1","demo_quality_labels",JSON.stringify({name:"Альфа-демо"}),1,null,"2026-10-15","2026-10-16");
 insert("INSERT INTO directory_entries VALUES(?,?,?,?,?,?,?)","secret-1","settlements",JSON.stringify({name:"SECRET_OPERATION_COORDINATE"}),1,null,"2026-10-15","2026-10-16");
 insert("INSERT INTO dq_occurrences VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  "occ-1","demo_quality_labels","synthetic-docx-2026-10-11",
  "synthetic-docx-2026-10-11:row-001:label","Альфа деммo","альфа деммo","resolved","rule",1,"2026-10-15","2026-10-16");
 insert("INSERT INTO dq_occurrences VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  "occ-sensitive","demo_quality_labels","sensitive-source","SECRET_OPERATION_SOURCE_REF",
  "Альфа деммo","альфа деммo","pending","none",1,"2026-10-15","2026-10-16");
 insert("INSERT INTO dq_rules VALUES(?,?,?,?,?,?,?,?,?)","rule-1","demo_quality_labels","Альфа деммo","альфа деммo","demo-1",1,1,"2026-10-15","2026-10-16");
 insert("INSERT INTO demo_import_sessions VALUES(?,?,?,?,?,?,?,?,?,?)",
  "session-1","admin-001","2026-10-16 17:00:00","2026-10-16 17:00:00",1,2,97,0,48,0);
 const snapshot=JSON.stringify({detail:[
  {row:1,label:"Альфа-демо",status:"known"},
  {row:2,label:"Бетта-демо",status:"resolved"},
  {row:3,label:"SECRET_OPERATION_SNAPSHOT",status:"review"}]});
 insert("INSERT INTO demo_import_documents VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  "doc-1","session-1","ANALISE_ДЕМО_таблиця_76.docx","docx","accepted",76,0,38,"2026-10-16 17:00:00",snapshot,0);
 insert("INSERT INTO demo_report_versions VALUES(?,?,?,?,?,?,?,?)",
  "ver-1","docx","2026-10-11",1,"ANALISE_ДЕМО_таблиця_76.docx","2026-10-16 17:00:00",null,snapshot);
 insert("INSERT INTO demo_report_active VALUES(?,?,?)","docx","2026-10-11","ver-1");
 const db={prepare(sql){
  const st=sqlite.prepare(sql);
  const x=(args=[])=>({async first(){return st.get(...args)||null},async all(){return {results:st.all(...args)}}});
  return {bind(...args){return x(args)},...x()};
 }};
 return {db,sqlite,insert};
}
const call=(db,path,user=admin,method="GET")=>databaseViewerApi(
 new Request(base+path,{method}),{DB:db},user,
 ["api","database-viewer",path.split("?")[0]]);

test("only approved datasets are cataloged; real records are never in the listing",async()=>{
 const {db,sqlite}=setup();
 try{
  const r=await call(db,"catalog");assert.equal(r.status,200);
  const data=await r.json(),sets=Object.fromEntries(data.datasets.map(x=>[x.id,x]));
  assert.equal(data.mode,"read_only");
  assert.equal(data.datasets.length,9);
  assert.equal(databaseViewerDatasets().length,9);
  assert.equal(sets.directories.count,2);
  assert.equal(sets.demo_labels.count,1);
  assert.equal(sets.demo_occurrences.count,1);
  assert.equal(sets.demo_documents.count,1);
  assert.doesNotMatch(JSON.stringify(data),/SECRET_OPERATION/);
 }finally{sqlite.close()}
});
test("detail and list restrict to synthetic records and sanitize snapshots",async()=>{
 const {db,sqlite}=setup();
 try{
  const docs=await (await call(db,"data?dataset=demo_documents")).json();
  assert.equal(docs.rows.length,1);assert.equal(docs.count,1);
  assert.doesNotMatch(JSON.stringify(docs),/snapshot_json|SECRET_OPERATION/);
  const detail=await (await call(db,"data?dataset=demo_documents&id=doc-1")).json();
  assert.equal(detail.details.length,2);
  assert.deepEqual(detail.details.map(x=>x.label),["Альфа-демо","Бетта-демо"]);
  assert.doesNotMatch(JSON.stringify(detail),/SECRET_OPERATION/);
  const version=await (await call(db,"data?dataset=demo_versions&id=ver-1")).json();
  assert.equal(version.record.active,1);assert.equal(version.details.length,2);
  assert.equal((await call(db,"data?dataset=demo_labels&id=secret-1")).status,404);
  const occ=await (await call(db,"data?dataset=demo_occurrences")).json();
  assert.equal(occ.count,1);
  assert.doesNotMatch(JSON.stringify(occ),/SECRET_OPERATION|occ-sensitive/);
 }finally{sqlite.close()}
});
test("Ukrainian searching, status filters, wildcard escapes and sorting",async()=>{
 const {db,sqlite}=setup();
 try{
  for(const term of ["Альфа","альфа","АЛЬФА","аЛьФа"]){
   const res=await (await call(db,"data?dataset=demo_labels&q="+encodeURIComponent(term))).json();
   assert.equal(res.count,1);
  }
  assert.equal((await (await call(db,"data?dataset=demo_labels&q=%25")).json()).count,0);
  assert.equal((await (await call(db,"data?dataset=demo_labels&q=*")).json()).count,0);
  assert.equal((await (await call(db,"data?dataset=demo_labels&q=%3F")).json()).count,0);
  assert.equal((await (await call(db,"data?dataset=demo_labels&q=%5B")).json()).count,0);
  assert.equal((await (await call(db,"data?dataset=demo_rules&q=%D0%90%D0%9B%D0%AC%D0%A4%D0%90")).json()).count,1);
  assert.equal((await (await call(db,"data?dataset=demo_occurrences&filter=resolved")).json()).count,1);
  assert.equal((await (await call(db,"data?dataset=demo_occurrences&filter=pending")).json()).count,0);
  assert.equal((await (await call(db,"data?dataset=demo_rules&filter=active")).json()).count,1);
  assert.equal((await (await call(db,"data?dataset=demo_documents&filter=docx&sort=name")).json()).count,1);
  assert.equal((await (await call(db,"data?dataset=demo_documents&filter=xlsx")).json()).count,0);
 }finally{sqlite.close()}
});
test("server-side pagination returns 25 rows and continuation",async()=>{
 const {db,sqlite,insert}=setup();
 try{
  for(let i=2;i<=32;i++)insert("INSERT INTO demo_import_sessions VALUES(?,?,?,?,?,?,?,?,?,?)",
   "session-"+i,"admin-001","2026-10-16 17:00:00","2026-10-16 17:00:00",1,1,i,0,0,0);
  const first=await (await call(db,"data?dataset=demo_sessions")).json();
  const last=await (await call(db,"data?dataset=demo_sessions&offset=25")).json();
  assert.equal(first.count,32);assert.equal(first.rows.length,25);
  assert.equal(first.has_more,true);assert.equal(first.page_size,25);
  assert.equal(last.rows.length,7);assert.equal(last.has_more,false);
  assert.notEqual(first.rows[0].id,last.rows[0].id);
 }finally{sqlite.close()}
});
test("strictly read-only: no admin bypass, SQL queries or arbitrary table access",async()=>{
 const {db,sqlite}=setup();
 try{
  assert.equal((await call(db,"catalog",{...admin,role:"duty"})).status,403);
  assert.equal((await call(db,"catalog",{...admin,active:0})).status,403);
  for(const name of ["records","users","sqlite_master"]){
   assert.equal((await call(db,"data?dataset="+name)).status,400);
  }
  assert.equal((await call(db,"data?dataset=demo_rules&filter=DROP%20TABLE")).status,400);
  assert.equal((await call(db,"data?dataset=demo_labels&sort=sql")).status,400);
  assert.equal((await call(db,"data?dataset=demo_labels&offset=-1")).status,400);
  assert.equal((await call(db,"data?dataset=demo_labels&offset=1e4")).status,400);
  assert.equal((await call(db,"data?dataset=demo_labels&id=%27%20OR%201%3D1--")).status,400);
  assert.equal((await call(db,"data?dataset=demo_labels&id=missing")).status,404);
  assert.equal((await call(db,"catalog",admin,"POST")).status,405);
  assert.equal((await call(db,"data?dataset=demo_labels",admin,"DELETE")).status,405);
 }finally{sqlite.close()}
});
test("missing D1 migrations result in unavailable datasets instead of query failure",async()=>{
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("CREATE TABLE directory_types(id TEXT,title TEXT,version INT,created_at TEXT,updated_at TEXT)");
 const db={prepare(sql){const s=sqlite.prepare(sql);const wrap=(p=[])=>({
  async all(){return {results:s.all(...p)}},async first(){return s.get(...p)||null}
 });return {bind(...args){return wrap(args)},...wrap()}}};
 try{
  const r=await (await call(db,"catalog")).json();
  assert.equal(r.datasets.find(x=>x.id==="directories").available,true);
  assert.equal(r.datasets.find(x=>x.id==="demo_documents").available,false);
  assert.equal((await call(db,"data?dataset=demo_documents")).status,503);
 }finally{sqlite.close()}
});
test("protected read-only browser client uses textContent and GET, not mutation",()=>{
 assert.doesNotThrow(()=>new Script(DATABASE_VIEWER_JS));
 assert.doesNotThrow(()=>new Script(GLOBAL_NAV_JS));
 for(const id of ["db-datasets","db-search","db-filter","db-sort","db-prev",
  "db-next","db-table-wrap","db-detail","db-detail-fields","db-export","db-refresh"]){
  assert.match(DATABASE_VIEWER_HTML,new RegExp("id=\""+id+"\""));
 }
 assert.match(DATABASE_VIEWER_HTML,/\/api\/global-nav\.js/);
 assert.match(GLOBAL_NAV_JS,/\/api\/database-viewer/);
 assert.match(DATABASE_VIEWER_CSS,/db-workspace/);
 assert.match(DATABASE_VIEWER_JS,/method:"GET"/);
 assert.doesNotMatch(DATABASE_VIEWER_JS,/method\s*:\s*["'](?:POST|PATCH|DELETE)|XMLHttpRequest|sendBeacon|WebSocket/);
 assert.match(DATABASE_VIEWER_JS,/textContent/);
 assert.doesNotMatch(DATABASE_VIEWER_JS,/\.innerHTML/);
});
