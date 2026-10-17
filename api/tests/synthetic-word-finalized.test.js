import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {syntheticWordFinalizedApi,summarizePersistedSyntheticWord} from "../src/synthetic-word-finalized-api.js";
import {syntheticWordRowsReady,syntheticWordRowStatements} from "../src/synthetic-word-records.js";
import {saveSyntheticHistory} from "../src/synthetic-upload-history-api.js";
import {inspectSyntheticVersions,withSnapshotPlans} from "../src/synthetic-report-versions.js";
import {purgatoryApi} from "../src/purgatory-api.js";
import {SYNTHETIC_UPLOAD_HTML} from "../src/synthetic-upload-assets.js";
import {SYNTHETIC_UPLOAD_JS} from "../src/synthetic-upload-client.js";

const admin={id:"test-admin",role:"admin",active:1};
const SOURCE="synthetic-docx-2026-10-11";
const ref=row=>SOURCE+":row-"+String(row).padStart(3,"0")+":label";
const DDL=["0001_initial.sql","0002_directories.sql","0013_purgatory.sql",
 "0014_synthetic_import_demo.sql","0015_synthetic_upload_history.sql",
 "0016_synthetic_report_versions.sql","0019_synthetic_word_records.sql"];
const now="2026-10-17T05:00:00Z";

function database({defer19=false}={}){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const migration of DDL.filter(x=>!defer19||!x.startsWith("0019")))
  sqlite.exec(readFileSync(new URL("../migrations/"+migration,import.meta.url),"utf8"));
 sqlite.prepare("INSERT INTO users(id,email,role,active,created_at,updated_at) "+
  "VALUES (?,?,?,?,?,?)").run(admin.id,"admin@example.test","admin",1,now,now);
 const make=(sql,args=[])=>{
  const stmt=sqlite.prepare(sql);
  return {
   bind(...values){return make(sql,values)},
   async first(){return stmt.get(...args)||null},
   async all(){return {results:stmt.all(...args)}},
   async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}}
  };
 };
 const DB={
  prepare(sql){return make(sql)},
  async batch(statements){
   sqlite.exec("BEGIN");
   try{
    const out=[];
    for(const stmt of statements)out.push(await stmt.run());
    sqlite.exec("COMMIT");
    return out;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  }
 };
 return {DB,sqlite,close:()=>sqlite.close()};
}
const fixture=()=>({
 name:"ANALISE_ДЕМО_Word.docx",type:"docx",records:4,questions:2,
 report_date:"2026-10-11",
 detail:[
  {row:1,label:"Альфа-демо",date_time:"12:00 11.10.2026",status:"known"},
  {row:2,label:"Альфа деммo",date_time:"12:00 11.10.2026",status:"review"},
  {row:3,label:"Бета-демо",date_time:"12:00 11.10.2026",status:"known"},
  {row:4,label:"Бетта-демо",date_time:"12:00 11.10.2026",status:"review"}
 ]});
async function importFixture(DB,doc=fixture()){
 const docs=[doc],plans=await inspectSyntheticVersions(DB,docs);
 return saveSyntheticHistory(DB,{
  sessionId:crypto.randomUUID(),actorId:admin.id,
  uploadName:"ANALISE_ДЕМО_Word.docx",
  sourceBytes:new Uint8Array([25,12,44]),documents:docs,
  versionPlans:withSnapshotPlans(plans,docs)
 });
}
function seedTargets(sqlite){
 const entry=sqlite.prepare("INSERT INTO directory_entries "+
 "(id,directory_id,data_json,version,created_by,updated_by,created_at,updated_at) "+
 "VALUES(?,?,?,1,?,?,?,?)");
 for(const [id,label] of [["demo_quality_alpha_v1","Альфа-демо"],
 ["demo_quality_beta_v1","Бета-демо"]])
  entry.run(id,"demo_quality_labels",JSON.stringify({name:label}),admin.id,admin.id,now,now);
}
function occurrence(sqlite,row,label){
 const id="occ-"+row;
 sqlite.prepare("INSERT INTO dq_occurrences "+
 "(id,directory_id,source_id,source_ref,context_key,raw_value,normalized_value,"+
 "status,resolution_origin,active,version,created_by,updated_by,created_at,updated_at) "+
 "VALUES (?,?,?,?,?,?,?,?,?,1,1,?,?,?,?)").run(
  id,"demo_quality_labels",SOURCE,ref(row),"",label,label.toLocaleLowerCase("uk-UA"),
  "pending","none",admin.id,admin.id,now,now);
 return id;
}
const GET=()=>new Request("https://analise.test/api/synthetic-upload/finalized");
async function finalized(DB){
 const response=await syntheticWordFinalizedApi(GET(),{DB},admin);
 assert.equal(response.status,200);
 return response.json();
}

test("D1 0019 creates a constrained append-only Word row store with audit",()=>{
 const {DB,sqlite,close}=database();
 try{
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_word_rows").get().n,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_word_row_audit").get().n,0);
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='demo_word_dq_updated'").get());
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='demo_word_row_initial_resolution'").get());
  assert.ok(DB);
 }finally{close()}
});
test("an imported Word document writes physical rows immediately in D1",async()=>{
 const {DB,sqlite,close}=database();
 try{
  assert.equal(await syntheticWordRowsReady(DB),true);
  await importFixture(DB);
  const rows=sqlite.prepare("SELECT source_row,source_label,canonical_label,resolution_origin "+
   "FROM demo_word_rows ORDER BY source_row").all();
  assert.equal(rows.length,4);
  assert.deepEqual(rows.map(r=>r.canonical_label),["Альфа-демо",null,"Бета-демо",null]);
  const read=await finalized(DB);
  assert.equal(read.storage,"cloudflare_d1");
  assert.equal(read.saved,2);assert.equal(read.pending,2);
  assert.equal(read.documents[0].persisted,true);
  assert.equal(read.documents[0].total,4);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM demo_word_row_audit").get().n,4);
 }finally{close()}
});
test("manual Purgatory resolution updates D1 row without a second upload",async()=>{
 const {DB,sqlite,close}=database();
 try{
  seedTargets(sqlite);
  await importFixture(DB);
  const id=occurrence(sqlite,2,"Альфа деммo");
  const result=await purgatoryApi(new Request(
   "https://analise.test/api/purgatory/resolve",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({directory_id:"demo_quality_labels",
      context_key:"",raw_value:"Альфа деммo",target_id:"demo_quality_alpha_v1",
      mode:"single",occurrence_id:id})
   }),{DB},admin,["api","purgatory","resolve"]);
  assert.equal(result.status,200);
  const after=sqlite.prepare("SELECT canonical_label,resolution_origin FROM demo_word_rows WHERE source_row=2").get();
  assert.equal(after.canonical_label,"Альфа-демо");
  assert.equal(after.resolution_origin,"manual");
  const read=await finalized(DB);
  assert.equal(read.saved,3);assert.equal(read.pending,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_documents").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_word_row_audit WHERE action='resolution_changed'").get().n,1);
 }finally{close()}
});
test("retracted Purgatory resolution returns stored row to pending",async()=>{
 const {DB,sqlite,close}=database();
 try{
  seedTargets(sqlite);
  await importFixture(DB);
  occurrence(sqlite,4,"Бетта-демо");
  sqlite.prepare("UPDATE dq_occurrences SET target_id=?,status='resolved',resolution_origin='rule' "+
   "WHERE source_ref=?").run("demo_quality_beta_v1",ref(4));
  assert.equal((await finalized(DB)).saved,3);
  sqlite.prepare("UPDATE dq_occurrences SET target_id=NULL,status='pending',resolution_origin='none' "+
   "WHERE source_ref=?").run(ref(4));
  assert.equal((await finalized(DB)).saved,2);
  const row=sqlite.prepare("SELECT canonical_label,resolution_origin FROM demo_word_rows WHERE source_row=4").get();
  assert.equal(row.canonical_label,null);assert.equal(row.resolution_origin,"none");
 }finally{close()}
});
test("a previously approved correction is applied atomically during later import",async()=>{
 const {DB,sqlite,close}=database();
 try{
  seedTargets(sqlite);
  occurrence(sqlite,2,"Альфа деммo");
  sqlite.prepare("UPDATE dq_occurrences SET target_id=?,status='resolved',resolution_origin='manual' "+
   "WHERE source_ref=?").run("demo_quality_alpha_v1",ref(2));
  await importFixture(DB);
  const row=sqlite.prepare("SELECT canonical_label,resolution_origin FROM demo_word_rows WHERE source_row=2").get();
  assert.equal(row.canonical_label,"Альфа-демо");
  assert.equal(row.resolution_origin,"manual");
 }finally{close()}
});
test("identical re-import does not duplicate physically stored rows",async()=>{
 const {DB,sqlite,close}=database();
 try{
  await importFixture(DB);
  await importFixture(DB);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_word_rows").get().n,4);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_report_versions").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_sessions").get().n,2);
  assert.equal((await finalized(DB)).documents.length,1);
 }finally{close()}
});
test("a newer revision keeps old rows in history, only new active rows count",async()=>{
 const {DB,sqlite,close}=database();
 try{
  await importFixture(DB);
  const next=fixture();
  next.detail[3].label="Альфа деммo";
  await importFixture(DB,next);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_word_rows").get().n,8);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_report_versions").get().n,2);
  assert.equal((await finalized(DB)).documents[0].revision,2);
  assert.equal((await finalized(DB)).documents[0].total,4);
 }finally{close()}
});
test("migration 0019 backfills prior synthetic Word versions with no reupload",async()=>{
 const {DB,sqlite,close}=database({defer19:true});
 try{
  assert.equal(await syntheticWordRowsReady(DB),false);
  const doc=fixture();
  const plans=await inspectSyntheticVersions(DB,[doc]);
  await saveSyntheticHistory(DB,{sessionId:crypto.randomUUID(),actorId:admin.id,
   uploadName:"ANALISE_ДЕМО_Word.docx",sourceBytes:new Uint8Array([9,8,7]),
   documents:[doc],versionPlans:withSnapshotPlans(plans,[doc])});
  sqlite.exec(readFileSync(new URL("../migrations/0019_synthetic_word_records.sql",import.meta.url),"utf8"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_word_rows").get().n,4);
  assert.equal((await finalized(DB)).saved,2);
 }finally{close()}
});
test("not permitted to persist arbitrary free-text labels or misassociate targets",async()=>{
 const {DB,sqlite,close}=database();
 try{
  const invalid=fixture();invalid.detail[1].label="Не дозволено";
  assert.throws(()=>syntheticWordRowStatements(DB,{
   sessionId:crypto.randomUUID(),inputHash:"f".repeat(64),documents:[invalid]
  }),/Invalid synthetic Word record/);
  seedTargets(sqlite);
  await importFixture(DB);
  occurrence(sqlite,2,"Альфа деммo");
  sqlite.prepare("UPDATE dq_occurrences SET target_id=?,status='resolved',resolution_origin='manual' "+
   "WHERE source_ref=?").run("demo_quality_beta_v1",ref(2));
  assert.equal(sqlite.prepare("SELECT canonical_label FROM demo_word_rows WHERE source_row=2").get().canonical_label,"Бета-демо");
  // Even when a different, currently active demo label is selected, no arbitrary text enters.
  assert.throws(()=>sqlite.prepare("UPDATE demo_word_rows SET canonical_label='Чутливий запис' WHERE source_row=2").run(),/CHECK/);
 }finally{close()}
});
test("read API fails closed for unauthenticated users, missing migration, malformed pages",async()=>{
 const {DB,close}=database({defer19:true});
 try{
  assert.equal((await syntheticWordFinalizedApi(GET(),{DB},admin)).status,503);
  assert.equal((await syntheticWordFinalizedApi(GET(),{DB},null)).status,403);
  assert.equal((await syntheticWordFinalizedApi(new Request(GET().url,{method:"POST"}),{DB},admin)).status,405);
 }finally{close()}
 const {DB:withRows,close:done}=database();
 try{
  assert.equal((await syntheticWordFinalizedApi(
   new Request(GET().url+"?offset=-1"),{DB:withRows},admin)).status,400);
 }finally{done()}
});
test("read model validates the allowed persisted row schema",()=>{
 const doc={id:"v1",document_name:"Demo",created_at:now,report_date:"2026-10-11",revision:1};
 const sample=[
  {source_row:1,source_label:"Альфа-демо",canonical_label:"Альфа-демо",resolution_origin:"original"},
  {source_row:2,source_label:"Альфа деммo",canonical_label:null,resolution_origin:"none"}
 ];
 assert.equal(summarizePersistedSyntheticWord(doc,sample).saved,1);
 assert.equal(summarizePersistedSyntheticWord(doc,[...sample,sample[0]]),null);
 assert.equal(summarizePersistedSyntheticWord(doc,[{...sample[1],source_label:"Unknown"}]),null);
});
test("UI shows physical D1 storage summary; JS remains valid",()=>{
 assert.match(SYNTHETIC_UPLOAD_HTML,/id="ud-finalized-refresh"/);
 assert.match(SYNTHETIC_UPLOAD_HTML,/id="ud-finalized-list"/);
 assert.ok(SYNTHETIC_UPLOAD_JS.includes("synthetic-upload/finalized"));
 assert.doesNotThrow(()=>new Script(SYNTHETIC_UPLOAD_JS));
});
