import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {Script} from "node:vm";
import {saveSyntheticHistory,syntheticHistoryApi} from "../src/synthetic-upload-history-api.js";
import {PURGATORY_HTML} from "../src/purgatory-assets.js";
import {PURGATORY_JS} from "../src/purgatory-client.js";
import {SYNTHETIC_UPLOAD_HTML} from "../src/synthetic-upload-assets.js";
import {SYNTHETIC_UPLOAD_JS} from "../src/synthetic-upload-client.js";

const actor={id:"demo-admin",role:"admin",active:1};
const clientUrl="https://analise.example/api/synthetic-upload/history";
function testDB(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('demo-admin');");
 sqlite.exec(readFileSync(new URL("../migrations/0015_synthetic_upload_history.sql",import.meta.url),"utf8"));
 const d1={
  prepare(query){
   const statement=sqlite.prepare(query);
   const wrap=(parameters=[])=>({
    sql:query,
    async first(){return statement.get(...parameters)||null},
    async all(){return {results:statement.all(...parameters)}},
    async run(){const result=statement.run(...parameters);return {meta:{changes:result.changes}}}
   });
   return {bind(...parameters){return wrap(parameters)},...wrap()};
  },
  async batch(queries){
   sqlite.exec("BEGIN");
   try{
    const result=[];for(const x of queries)result.push(await x.run());
    sqlite.exec("COMMIT");return result;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  }
 };
 return {sqlite,d1};
}
const demoDocs=()=>[
 {name:"ANALISE_ДЕМО_таблиця_76.docx",type:"docx",records:3,questions:1,
  detail:[{row:1,label:"Альфа-демо",status:"known"},
   {row:2,label:"Альфа деммo",status:"review"},
   {row:3,label:"Бетта-демо",status:"resolved"}]},
 {name:"ANALISE_ДЕМО_журнал_21.xlsx",type:"xlsx",records:2,questions:0,
  detail:[{row:2,label:"Бета-демо",status:"known"},{row:3,label:"Бетта-демо",status:"resolved"}]}
];
test("migration creates bounded, synthetic-only session history",()=>{
 const sql=readFileSync(new URL("../migrations/0015_synthetic_upload_history.sql",import.meta.url),"utf8");
 assert.match(sql,/CREATE TABLE IF NOT EXISTS demo_import_sessions/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS demo_import_documents/);
 assert.match(sql,/UNIQUE\(session_id,input_sha256,member_index\)/);
 assert.match(sql,/json_valid\(snapshot_json\)/);
 assert.doesNotMatch(sql,/DROP TABLE/);
 const {sqlite}=testDB();
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_sessions").get().n,0);
 sqlite.close();
});
test("same session + bytes are idempotent, distinct upload creates separate session",async()=>{
 const {sqlite,d1}=testDB();
 try{
  const bytes=new TextEncoder().encode("SYNTHETIC_ONLY");
  const first="550e8400-e29b-41d4-a716-446655440000";
  const second="550e8400-e29b-41d4-a716-446655440001";
  const opts={actorId:actor.id,uploadName:"ANALISE_ДЕМО_пакет.zip",sourceBytes:bytes,documents:demoDocs()};
  await saveSyntheticHistory(d1,{sessionId:first,...opts});
  await saveSyntheticHistory(d1,{sessionId:first,...opts});
  assert.equal(sqlite.prepare("SELECT document_count AS n FROM demo_import_sessions WHERE id=?").get(first).n,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_documents").get().n,2);
  await saveSyntheticHistory(d1,{sessionId:second,...opts});
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_documents").get().n,4);
  const get=async(path)=>syntheticHistoryApi(new Request(clientUrl+path),{DB:d1},actor,["api","synthetic-upload","history",...path.slice(1).split('/').filter(Boolean)]);
  const list=await get("?offset=0");
  assert.equal(list.status,200);
  const listBody=await list.json();
  assert.equal(listBody.sessions.length,2);
  assert.equal(listBody.sessions[0].row_count,5);
  assert.equal(listBody.sessions[0].pending_count,1);
  assert.equal(listBody.sessions[0].auto_resolved_count,2);
  const details=await get("/"+first);
  assert.equal(details.status,200);
  const body=await details.json();
  assert.equal(body.documents.length,2);
  assert.equal(body.documents[0].detail[0].label,"Альфа-демо");
  assert.equal(body.documents[0].detail[1].status,"review");
  assert.equal(body.documents[0].detail[2].status,"resolved");
  assert.ok(!JSON.stringify(body).includes("document.xml"));
 }finally{sqlite.close()}
});
test("multiple distinct files can share one drag-drop session",async()=>{
 const {sqlite,d1}=testDB();
 try{
  const sessionId="550e8400-e29b-41d4-a716-446655440003";
  const docs=demoDocs();
  await saveSyntheticHistory(d1,{sessionId,actorId:actor.id,uploadName:"ANALISE_ДЕМО_таблиця.docx",sourceBytes:new Uint8Array([1]),documents:[docs[0]]});
  await saveSyntheticHistory(d1,{sessionId,actorId:actor.id,uploadName:"ANALISE_ДЕМО_журнал.xlsx",sourceBytes:new Uint8Array([2]),documents:[docs[1]]});
  const session=sqlite.prepare("SELECT input_count,document_count,row_count FROM demo_import_sessions WHERE id=?").get(sessionId);
  assert.deepEqual(session,{input_count:2,document_count:2,row_count:5});
 }finally{sqlite.close()}
});
test("history is strictly admin-only and validates IDs and date filters",async()=>{
 const {sqlite,d1}=testDB();
 try{
  const endpoint=(s,user)=>syntheticHistoryApi(new Request(clientUrl+s),{DB:d1},user,["api","synthetic-upload","history"]);
  assert.equal((await endpoint("",{...actor,role:"duty"})).status,403);
  assert.equal((await endpoint("?date=2026-19-55",actor)).status,400);
  assert.equal((await endpoint("?offset=-1",actor)).status,400);
  assert.equal((await syntheticHistoryApi(new Request(clientUrl+"/bogus"),{DB:d1},actor,["api","synthetic-upload","history","bogus"])).status,400);
  assert.equal((await syntheticHistoryApi(new Request(clientUrl+"/550e8400-e29b-41d4-a716-446655440004"),{DB:d1},actor,["api","synthetic-upload","history","550e8400-e29b-41d4-a716-446655440004"])).status,404);
 }finally{sqlite.close()}
});
test("snapshot prevents arbitrary document contents from reaching history",async()=>{
 const {sqlite,d1}=testDB();
 try{
  const docs=demoDocs();docs[0].detail[0].label="UNLISTED SENSITIVE DATA";
  await assert.rejects(()=>saveSyntheticHistory(d1,{
   sessionId:"550e8400-e29b-41d4-a716-446655440005",actorId:actor.id,
   uploadName:"ANALISE_ДЕМО_test.zip",sourceBytes:new Uint8Array([3]),documents:docs
  }),/Invalid synthetic snapshot/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_sessions").get().n,0);
 }finally{sqlite.close()}
});
test("embedded UI scripts compile and offer readable audit and history views",()=>{
 assert.doesNotThrow(()=>new Script(PURGATORY_JS));
 assert.doesNotThrow(()=>new Script(SYNTHETIC_UPLOAD_JS));
 assert.match(PURGATORY_JS,/Підтверджено відповідник/);
 assert.match(PURGATORY_JS,/pg-audit-trace/);
 assert.match(PURGATORY_HTML,/без технічного JSON/);
 assert.match(SYNTHETIC_UPLOAD_JS,/historyRequest/);
 assert.match(SYNTHETIC_UPLOAD_HTML,/ud-history-date/);
 assert.match(SYNTHETIC_UPLOAD_HTML,/ud-history-list/);
});
