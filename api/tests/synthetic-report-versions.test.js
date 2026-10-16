import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {Script} from "node:vm";
import {saveSyntheticHistory} from "../src/synthetic-upload-history-api.js";
import {inspectSyntheticVersions,assertVersionApproval,withSnapshotPlans,
 syntheticVersionsApi,syntheticVersionsReady} from "../src/synthetic-report-versions.js";
import {SYNTHETIC_UPLOAD_HTML} from "../src/synthetic-upload-assets.js";
import {SYNTHETIC_UPLOAD_JS} from "../src/synthetic-upload-client.js";

const actor={id:"demo-admin",role:"admin",active:1};
const session=i=>"550e8400-e29b-41d4-a716-4466554400"+String(i).padStart(2,"0");
function makeDB(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('demo-admin');");
 sqlite.exec(readFileSync(new URL("../migrations/0015_synthetic_upload_history.sql",import.meta.url),"utf8"));
 sqlite.exec(readFileSync(new URL("../migrations/0016_synthetic_report_versions.sql",import.meta.url),"utf8"));
 const d1={
  prepare(sql){
   const stmt=sqlite.prepare(sql);
   const bind=(p=[])=>({sql,
    async first(){return stmt.get(...p)||null},
    async all(){return {results:stmt.all(...p)}},
    async run(){return {meta:stmt.run(...p)}}
   });
   return {bind(...p){return bind(p)},...bind()};
  },
  async batch(queries){
   sqlite.exec("BEGIN");
   try{const out=[];for(const stmt of queries)out.push(await stmt.run());sqlite.exec("COMMIT");return out}
   catch(e){sqlite.exec("ROLLBACK");throw e}
  }
 };
 return {sqlite,d1};
}
const doc=(kind="docx",variant=0)=>{
 const labels=variant===0?["Альфа-демо","Альфа деммo"]:["Альфа-демо","Бетта-демо"];
 return {name:"ANALISE_ДЕМО_"+kind+"."+kind,type:kind,report_date:"2026-10-11",
  records:2,questions:1,detail:labels.map((label,i)=>({
   row:i+1,label,status:i===0?"known":"review",
   ...(kind==="docx"?{date_time:"12:00 11.10.2026"}:{})
  }))};
};
const publish=async(db,docs,num,bytes)=>{
 const plans=withSnapshotPlans(await inspectSyntheticVersions(db,docs),docs);
 const approval=plans.filter(x=>x.kind!=="unsupported").map(x=>({
  kind:x.kind,report_date:x.report_date,expected_version_id:x.expected_version_id
 }));
 assertVersionApproval(plans,approval);
 const result=await saveSyntheticHistory(db,{sessionId:session(num),actorId:actor.id,
  uploadName:"ANALISE_ДЕМО_"+num+".zip",sourceBytes:new Uint8Array([num,...bytes]),documents:docs,
  versionPlans:plans});
 return {plans,result};
};
test("0016 is additive and establishes atomic compare-and-swap and immutable results",()=>{
 const sql=readFileSync(new URL("../migrations/0016_synthetic_report_versions.sql",import.meta.url),"utf8");
 assert.match(sql,/CREATE TABLE IF NOT EXISTS demo_report_versions/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS demo_report_active/);
 assert.match(sql,/demo_revision_check/);
 assert.match(sql,/RAISE\(ABORT,'Stale demo report version'\)/);
 assert.match(sql,/ALTER TABLE demo_import_documents ADD COLUMN version_id/);
 assert.doesNotMatch(sql,/DROP TABLE/);
 const {sqlite}=makeDB();
 assert.ok(sqlite.prepare("SELECT name FROM pragma_table_info('demo_import_documents') WHERE name='version_id'").get());
 sqlite.close();
});
test("first upload v1; identical later upload reuses v1; changed upload publishes v2 preserving v1",async()=>{
 const {sqlite,d1}=makeDB();
 try{
  assert.ok(await syntheticVersionsReady(d1));
  let res=await publish(d1,[doc()],1,[1]);
  assert.equal(res.plans[0].change,"new");assert.equal(res.result.versions[0].revision,1);
  const active=()=>sqlite.prepare("SELECT version_id FROM demo_report_active WHERE kind='docx' AND report_date='2026-10-11'").get().version_id;
  const firstId=active();
  res=await publish(d1,[doc()],2,[2]);
  assert.equal(res.plans[0].change,"same");assert.equal(res.result.versions[0].revision,1);
  assert.equal(active(),firstId);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_report_versions").get().n,1);
  res=await publish(d1,[doc("docx",1)],3,[3]);
  assert.equal(res.plans[0].change,"replacement");
  assert.equal(res.result.versions[0].revision,2);
  const secondId=active();assert.notEqual(secondId,firstId);
  const historical=sqlite.prepare("SELECT revision,previous_version_id,snapshot_json FROM demo_report_versions WHERE id=?").get(secondId);
  assert.equal(historical.previous_version_id,firstId);
  const older=sqlite.prepare("SELECT snapshot_json FROM demo_report_versions WHERE id=?").get(firstId);
  assert.match(older.snapshot_json,/Альфа деммo/);
  assert.match(historical.snapshot_json,/Бетта-демо/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_report_versions").get().n,2);
  const list=await syntheticVersionsApi(new Request("https://analise.test/api/synthetic-upload/versions"),{DB:d1},actor,["api","synthetic-upload","versions"]);
  assert.equal(list.status,200);
  const data=await list.json();assert.equal(data.versions.length,2);
  assert.equal(data.versions[0].active,1);assert.equal(data.versions[0].revision,2);
  assert.equal(data.versions[1].active,0);
  const old=await syntheticVersionsApi(new Request("https://analise.test/api/synthetic-upload/versions/"+firstId),{DB:d1},actor,["api","synthetic-upload","versions",firstId]);
  const detail=await old.json();assert.equal(detail.version.active,false);
  assert.equal(detail.document.detail[1].label,"Альфа деммo");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_documents WHERE version_id IS NOT NULL").get().n,3);
 }finally{sqlite.close()}
});
test("Word and Excel same report date have independent active revisions",async()=>{
 const {sqlite,d1}=makeDB();
 try{
  const initial=await publish(d1,[doc("docx"),doc("xlsx")],4,[4]);
  assert.equal(initial.result.versions.length,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_report_active").get().n,2);
  await publish(d1,[doc("xlsx",1)],5,[5]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_report_versions WHERE kind='docx'").get().n,1);
  assert.equal(sqlite.prepare("SELECT MAX(revision) AS n FROM demo_report_versions WHERE kind='xlsx'").get().n,2);
 }finally{sqlite.close()}
});
test("two changed revisions based on one preview cannot silently overwrite each other",async()=>{
 const {sqlite,d1}=makeDB();
 try{
  await publish(d1,[doc()],6,[6]);
  const before=withSnapshotPlans(await inspectSyntheticVersions(d1,[doc("docx",1)]),[doc("docx",1)]);
  await publish(d1,[doc("docx",1)],7,[7]);
  await assert.rejects(()=>saveSyntheticHistory(d1,{
   sessionId:session(8),actorId:actor.id,uploadName:"ANALISE_ДЕМО_8.zip",
   sourceBytes:new Uint8Array([8]),documents:[doc("docx",1)],versionPlans:before
  }),/Stale demo report version/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_report_versions").get().n,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_sessions WHERE id=?").get(session(8)).n,0);
 }finally{sqlite.close()}
});
test("version preview approval required and old history preserved",async()=>{
 const {sqlite,d1}=makeDB();
 try{
  const draft=await inspectSyntheticVersions(d1,[doc()]);
  assert.throws(()=>assertVersionApproval(draft,[]),/попередня перевірка/);
  assert.throws(()=>assertVersionApproval(draft,[{kind:"docx",report_date:"2026-10-11",expected_version_id:session(4)}]),/Версія змінилася/);
  await saveSyntheticHistory(d1,{sessionId:session(9),actorId:actor.id,
   uploadName:"ANALISE_ДЕМО_old.zip",sourceBytes:new Uint8Array([9]),documents:[doc()]});
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM demo_import_documents WHERE version_id IS NULL").get().n,1);
  const r=await syntheticVersionsApi(new Request("https://analise.test/api/synthetic-upload/versions"),{DB:d1},{...actor,role:"viewer"},["api","synthetic-upload","versions"]);
  assert.equal(r.status,403);
 }finally{sqlite.close()}
});
test("client retains one dropzone and adds inspect, confirmation, active and archived views",()=>{
 assert.doesNotThrow(()=>new Script(SYNTHETIC_UPLOAD_JS));
 assert.equal((SYNTHETIC_UPLOAD_HTML.match(/id="ud-dropzone"/g)||[]).length,1);
 assert.match(SYNTHETIC_UPLOAD_JS,/synthetic-upload\//);
 assert.match(SYNTHETIC_UPLOAD_JS,/inspect/);
 assert.match(SYNTHETIC_UPLOAD_JS,/x-analise-version-approval/);
 assert.match(SYNTHETIC_UPLOAD_JS,/window.confirm/);
 assert.match(SYNTHETIC_UPLOAD_HTML,/id="ud-version-list"/);
 assert.match(SYNTHETIC_UPLOAD_HTML,/Звітна дата/);
});
