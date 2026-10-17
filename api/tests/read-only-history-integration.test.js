import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {purgatoryApi} from "../src/purgatory-api.js";
import {literalUnicodeGlob} from "../src/unicode-search.js";
import {PURGATORY_HTML} from "../src/purgatory-assets.js";
import {PURGATORY_JS} from "../src/purgatory-client.js";

const admin={id:"admin",role:"admin",active:1};
const url="https://analise.example/api/purgatory/";
function setup(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON;");
 sqlite.exec([
  "CREATE TABLE users(id TEXT PRIMARY KEY);",
  "CREATE TABLE directory_types(id TEXT PRIMARY KEY,title TEXT);",
  "CREATE TABLE directory_entries(id TEXT PRIMARY KEY,directory_id TEXT,data_json TEXT,archived_at TEXT);",
  "INSERT INTO users VALUES('admin');",
  "INSERT INTO directory_types VALUES('demo_quality_labels','Демо · Якість');",
  "INSERT INTO directory_types VALUES('other','Інший довідник');",
  "INSERT INTO directory_entries VALUES('demo-target','demo_quality_labels','{\"name\":\"Альфа-демо\"}',NULL);",
  "INSERT INTO directory_entries VALUES('other-target','other','{\"name\":\"Бета-демо\"}',NULL);"
 ].join("\n"));
 sqlite.exec(readFileSync(new URL("../migrations/0013_purgatory.sql",import.meta.url),"utf8"));
 const insert=sqlite.prepare(
  "INSERT INTO dq_occurrences "+
  "(id,directory_id,source_id,source_ref,context_key,raw_value,normalized_value,created_by,updated_by) "+
  "VALUES(?,?,?,?,?,?,?,?,?)");
 for(let i=0;i<135;i++){
  const demo=i<127,dir=demo?"demo_quality_labels":"other";
  const raw=demo?"Альфа-демо "+i:"Бета-демо "+i;
  insert.run("occ-"+i,dir,"synthetic-"+i,"fictional:"+i,"",raw,
   raw.toLocaleLowerCase("uk-UA"),"admin","admin");
 }
 const update=sqlite.prepare(
  "UPDATE dq_occurrences SET status='resolved',resolution_origin='manual',"+
  "target_id=?,updated_by='admin' WHERE id=?");
 for(let i=0;i<30;i++)update.run("demo-target","occ-"+i);
 sqlite.prepare(
  "INSERT INTO dq_rules(id,directory_id,context_key,normalized_value,"+
  "raw_example,target_id,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)"
 ).run("rule-1","demo_quality_labels","","альфа-демо","Альфа-демо",
  "demo-target","admin","admin");
 const db={prepare(sql){
  const stmt=sqlite.prepare(sql);
  const q=(args=[])=>({
   async first(){return stmt.get(...args)||null},
   async all(){return {results:stmt.all(...args)}},
   async run(){return {meta:stmt.run(...args)}}
  });
  return {bind(...args){return q(args)},...q()};
 }};
 return {sqlite,db};
}
function get(db,route,user=admin){
 return purgatoryApi(new Request(url+route),{DB:db},user,
  ["api","purgatory",route.split("?")[0]]);
}
test("Unicode search ignores Ukrainian casing and escapes GLOB metacharacters",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const stmt=db.prepare("SELECT ? GLOB ? AS matches");
  for(const value of ["Альфа","АЛЬФА","аЛьФа","альфа"])
   assert.equal(stmt.get(value,literalUnicodeGlob("АЛЬФА")).matches,1);
  for(const char of ["?","*","[","]","%","_"]){
   assert.equal(stmt.get("Альфа",literalUnicodeGlob(char)).matches,0);
   assert.equal(stmt.get("Альфа"+char,literalUnicodeGlob(char)).matches,1);
  }
 }finally{db.close()}
});
test("full history is paginated by immutable audit IDs without omitted events",async()=>{
 const {sqlite,db}=setup();
 try{
  const target=sqlite.prepare("SELECT COUNT(*) AS n FROM dq_audit").get().n;
  assert.ok(target>100);
  const seen=new Set(),ordered=[];
  let before=null,pages=0;
  do{
   const response=await get(db,"history"+(before===null?"":"?before="+before));
   assert.equal(response.status,200);
   const body=await response.json();
   assert.ok(body.items.length<=50);
   assert.equal(body.count,target);
   for(const item of body.items){
    assert.ok(!seen.has(item.id),"No duplicate event across pages");
    seen.add(item.id);ordered.push(item.id);
   }
   pages++;before=body.has_more?body.next_before:null;
   if(!body.has_more)break;
  }while(pages<10);
  assert.ok(pages>=3);
  assert.equal(seen.size,target);
  assert.ok(ordered.every((x,i)=>i===0||ordered[i-1]>x));
 }finally{sqlite.close()}
});
test("full-history filtering is server-side, Unicode-aware and directory-scoped",async()=>{
 const {sqlite,db}=setup();
 try{
  const other=await (await get(db,"history?directory_id=other")).json();
  assert.equal(other.count,8);
  for(const item of other.items)
   assert.equal(JSON.parse(item.after_json).directory,"other");
  const total=sqlite.prepare("SELECT COUNT(*) AS n FROM dq_audit").get().n;
  const demo=await (await get(db,"history?directory_id=demo_quality_labels")).json();
  assert.equal(demo.count,total-8);
  const mixed=await (await get(db,"history?q="+encodeURIComponent("аЛьФа"))).json();
  const caps=await (await get(db,"history?q="+encodeURIComponent("АЛЬФА"))).json();
  assert.ok(mixed.count>=127);
  assert.equal(mixed.count,caps.count);
  for(const term of ["%","[","?","*"]){
   const result=await (await get(db,"history?q="+encodeURIComponent(term))).json();
   assert.equal(result.count,0,"Metacharacters must be literal: "+term);
  }
  const under=await (await get(db,"history?q=_")).json();
  assert.ok(under.count>0&&under.count<total,"Underscore matches only literal text");
  const candidates=await (await get(db,"candidates?directory_id=demo_quality_labels&q="+
   encodeURIComponent("АЛЬФА"))).json();
  assert.deepEqual(candidates.items.map(x=>x.id),["demo-target"]);
 }finally{sqlite.close()}
});
test("history refuses invalid cursors, unknown directories and unprivileged access",async()=>{
 const {sqlite,db}=setup();
 try{
  for(const cursor of ["-1","0","1e5","abc","1%20OR%201=1","999999999999999999"]){
   assert.equal((await get(db,"history?before="+cursor)).status,400);
  }
  assert.equal((await get(db,"history?directory_id=missing")).status,404);
  assert.equal((await get(db,"history",{...admin,role:"duty"})).status,403);
  assert.equal((await get(db,"history",{...admin,active:0})).status,403);
 }finally{sqlite.close()}
});
test("history UI renders safe text and an actual fetch-more control",()=>{
 assert.doesNotThrow(()=>new Script(PURGATORY_JS));
 assert.match(PURGATORY_HTML,/id="pg-history-more"/);
 assert.match(PURGATORY_HTML,/id="pg-history-meta"/);
 assert.match(PURGATORY_JS,/loadHistory\(/);
 assert.match(PURGATORY_JS,/new URLSearchParams/);
 assert.match(PURGATORY_JS,/historyBefore/);
 assert.match(PURGATORY_JS,/historyHasMore/);
 assert.match(PURGATORY_JS,/textContent/);
 assert.doesNotMatch(PURGATORY_JS,/innerHTML/);
});
