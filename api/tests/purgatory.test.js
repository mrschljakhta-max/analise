import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {purgatoryApi,normalizeReviewValue} from "../src/purgatory-api.js";
import {PURGATORY_HTML,PURGATORY_CSS} from "../src/purgatory-assets.js";
import {PURGATORY_JS} from "../src/purgatory-client.js";
import {GLOBAL_NAV_JS} from "../src/global-navigation-assets.js";
import {DASHBOARD_HTML} from "../src/dashboard-assets.js";

const admin={id:"test-admin",role:"admin",active:1};
const viewer={id:"test-viewer",role:"duty",active:1};
const req=(route,method="GET",body,origin)=>{
 const u="https://analise.example/api/purgatory/"+route;
 return new Request(u,{method,headers:{
  ...(method==="POST"?{"content-type":"application/json"}:{}),
  ...(origin?{origin}:{})
 },...(body!==undefined?{body:JSON.stringify(body)}:{})});
};
function fakeDB({migration=true,rule=null,target=true,existingRule=null}={}){
 const queries=[],batches=[];
 const DB={
  prepare(sql){
   const stmt={sql,args:[],bind(...args){this.args=args;return this},
    async first(){
     queries.push(this);
     if(sql.includes("sqlite_master"))return migration?{name:"dq_rule_updated"}:null;
     if(sql.includes("SELECT id FROM directory_types"))return {id:"general"};
     if(sql.includes("SELECT id FROM directory_entries"))return target?{id:"entry-01"}:null;
     if(sql.includes("SELECT r.target_id"))return rule;
     if(sql.includes("SELECT id FROM dq_rules"))return existingRule;
     if(sql.includes("SELECT directory_id,context_key,normalized_value,target_id FROM dq_rules"))
      return {directory_id:"general",context_key:"",normalized_value:"невірно",target_id:"entry-01"};
     return {};
    },
    async all(){queries.push(this);return {results:[]}},
    async run(){queries.push(this);return {meta:{changes:1}}},
   };
   return stmt;
  },
  async batch(statements){batches.push(statements);for(const s of statements)queries.push(s);
   return statements.map(()=>({meta:{changes:2}}));
  }
 };
 return {DB,queries,batches};
}
test("normalization is deterministic but preserves raw elsewhere",()=>{
 assert.equal(normalizeReviewValue("  ТЕСТ—  01  "),"тест- 01");
 assert.equal(normalizeReviewValue("О’ПИС"),"о'пис");
});
test("admin-only access precedes D1 access",async()=>{
 const db=fakeDB();
 for(const user of [viewer,{...admin,active:0},null]){
  const r=await purgatoryApi(req("data"),{DB:db.DB},user,["api","purgatory","data"]);
  assert.equal(r.status,403);
 }
 assert.equal(db.queries.length,0);
});
test("migrations are mandatory before use",async()=>{
 const db=fakeDB({migration:false});
 const r=await purgatoryApi(req("data"),{DB:db.DB},admin,["api","purgatory","data"]);
 assert.equal(r.status,503);
 assert.match((await r.json()).error,/0013/);
});
test("no cross-origin mutations",async()=>{
 const db=fakeDB();
 const r=await purgatoryApi(req("ingest","POST",{items:[]}, "https://evil.example"),
  {DB:db.DB},admin,["api","purgatory","ingest"]);
 assert.equal(r.status,403);
 assert.equal(db.queries.length,0);
});
test("generic ingest normalizes, creates a pending item, and batches atomically",async()=>{
 const db=fakeDB();
 const r=await purgatoryApi(req("ingest","POST",{items:[{
  directory_id:"general",source_id:"fictional-1",source_ref:"fictional-1:row2:name",
  raw_value:"  Пробний—термін  "
 }]}),{DB:db.DB},admin,["api","purgatory","ingest"]);
 assert.equal(r.status,201);
 assert.equal(db.batches.length,1);
 const stmt=db.batches[0][0];
 assert.match(stmt.sql,/INSERT INTO dq_occurrences/);
 assert.match(stmt.sql,/ON CONFLICT/);
 assert.ok(stmt.args.includes("пробний-термін"));
 assert.ok(stmt.args.includes("Пробний—термін"));
 assert.ok(stmt.args.includes("pending"));
});
test("confirmed rule applies to all active matching generic occurrences",async()=>{
 const db=fakeDB();
 const result=await purgatoryApi(req("resolve","POST",{
  directory_id:"general",raw_value:"Невірно",context_key:"",
  target_id:"entry-01",mode:"rule"
 }),{DB:db.DB},admin,["api","purgatory","resolve"]);
 assert.equal(result.status,200);
 assert.equal((await result.json()).scope,"rule");
 assert.equal(db.batches.length,1);
 const bulk=db.batches[0][1];
 assert.match(bulk.sql,/resolution_origin='rule'/);
 assert.match(bulk.sql,/active=1/);
 assert.match(bulk.sql,/status='pending'/);
 assert.ok(bulk.args.includes("невірно"));
});
test("single fix does not create a persistent rule",async()=>{
 const db=fakeDB();
 const result=await purgatoryApi(req("resolve","POST",{
  directory_id:"general",raw_value:"Невірно",context_key:"",
  target_id:"entry-01",mode:"single",occurrence_id:"fictitious"
 }),{DB:db.DB},admin,["api","purgatory","resolve"]);
 assert.equal(result.status,200);
 assert.equal(db.batches.length,0);
 assert.ok(db.queries.some(s=>s.sql.includes("resolution_origin='manual'")));
});
test("target must be a current entry in the selected directory",async()=>{
 const db=fakeDB({target:false});
 const r=await purgatoryApi(req("resolve","POST",{
  directory_id:"general",raw_value:"Невірно",context_key:"",
  target_id:"entry-01",mode:"rule"
 }),{DB:db.DB},admin,["api","purgatory","resolve"]);
 assert.equal(r.status,400);
 assert.equal(db.batches.length,0);
});
test("revoke reopens only rule-derived active occurrences",async()=>{
 const db=fakeDB();
 const r=await purgatoryApi(req("revoke","POST",{rule_id:"synthetic-rule"}),
  {DB:db.DB},admin,["api","purgatory","revoke"]);
 assert.equal(r.status,200);
 assert.equal(db.batches.length,1);
 assert.match(db.batches[0][1].sql,/resolution_origin='rule'/);
 assert.match(db.batches[0][1].sql,/active=1/);
});
test("non-operational schema includes immutable audit snapshots and uniqueness",()=>{
 const sql=readFileSync(new URL("../migrations/0013_purgatory.sql",import.meta.url),"utf8");
 assert.match(sql,/UNIQUE\(directory_id,context_key,normalized_value\)/);
 assert.match(sql,/UNIQUE\(directory_id,context_key,source_ref\)/);
 assert.match(sql,/CREATE TRIGGER IF NOT EXISTS dq_occurrence_updated/);
 assert.match(sql,/CREATE TRIGGER IF NOT EXISTS dq_rule_updated/);
 assert.match(sql,/before_json TEXT/);
 assert.doesNotMatch(sql,/DROP TABLE/);
});
test("private page, dynamic DOM, and admin nav are connected",()=>{
 assert.match(PURGATORY_HTML,/\/api\/purgatory.js/);
 assert.match(PURGATORY_CSS,/prefers-reduced-motion/);
 assert.match(PURGATORY_JS,/textContent/);
 assert.match(GLOBAL_NAV_JS,/href:'\/api\/purgatory'/);
 assert.match(DASHBOARD_HTML,/href=\\?"\/api\/purgatory/);
});
