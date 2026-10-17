import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext,Script} from "node:vm";
import {validateDemoReview,demoLocalStoreApi} from "../src/demo-local-store-api.js";
import {GENERIC_DEMO_D1_STORE_JS} from "../src/generic-demo-d1-store-assets.js";
import {GENERIC_LOCAL_REVIEW_JS} from "../src/generic-local-review-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import {GENERIC_PREVIEW_HTML} from "../src/generic-preview-assets.js";
import worker from "../src/index.js";

function fixture(){
 return {format:"docx",review:{
  schema_version:"ANALISE_LOCAL_REVIEW_V1",directory_id:"demo_quality_labels",
  persisted_in_d1:false,created_at:"2026-10-17T16:00:00.000Z",
  summary:{matched:1,pending:0,mapped:1,ignored:0,needs_mapping:0},
  decisions:[
   {id:"1",sheet:"Таблиця 1",table_index:null,source_row:3,field:"value_2",
    original_value:"Альфа-демо",detected_status:"matched",status:"matched",
    target_id:"demo_quality_alpha_v1",target_name:"Альфа-демо"},
   {id:"2",sheet:"Таблиця 1",table_index:null,source_row:4,field:"value_2",
    original_value:"Невідоме",detected_status:"missing",status:"mapped",
    target_id:"demo_quality_beta_v1",target_name:"Бета-демо"}
  ],
  history:[
   {id:1,entry_id:"2",action:"map",at:"2026-10-17T16:01:00.000Z",
    reason:"Підтверджено за тестовим довідником",
    previous:{status:"pending",target_id:null,target_name:null},
    next:{status:"mapped",target_id:"demo_quality_beta_v1",target_name:"Бета-демо"}}
  ]}
 };
}
function dbFake(){
 let rows=[];
 const queryLog=[];
 const labels={
  demo_quality_alpha_v1:"Альфа-демо",
  demo_quality_beta_v1:"Бета-демо"
 };
 const DB={prepare(sql){
  return {sql,args:[],bind(...args){this.args=args;return this},
   async first(){
    queryLog.push(this);
    if(sql.includes("directory_entries"))return labels[this.args[0]]?{name:labels[this.args[0]]}:null;
    if(sql.includes("FROM report_versions")){
     const found=rows.filter(x=>x.report_name===this.args[0])
       .sort((a,b)=>b.version-a.version)[0];
     return found||null;
    }
    throw Error("Unexpected first SQL");
   },
   async all(){
    queryLog.push(this);
    if(!sql.includes("FROM report_versions"))throw Error("Unexpected listing SQL");
    return {results:rows.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(x=>({
     id:x.id,report_name:x.report_name,version:x.version,created_at:x.created_at
    }))};
   },
   async run(){
    queryLog.push(this);
    if(!sql.includes("INSERT INTO report_versions"))throw Error("Unexpected mutation");
    const [id,report_name,version,snapshot_json,actor,created_at,sourceName,expected]=this.args;
    assert.equal(report_name,sourceName);
    const current=Math.max(0,...rows.filter(x=>x.report_name===report_name).map(x=>x.version));
    if(current!==expected)return {meta:{changes:0}};
    rows.push({id,report_name,version,snapshot_json,actor,created_at});
    return {meta:{changes:1}};
   }
  };
 }};
 return {DB,rows,queryLog};
}
const request=(method,body)=>new Request("https://unit.invalid/api/demo-local-store",{
 method,headers:body?{"content-type":"application/json"}:{},
 ...(body?{body:JSON.stringify(body)}:{})
});
const user={id:"demo-admin",role:"admin",active:1};

test("server retains immutable fictional values, decisions and review audit",()=>{
 const result=validateDemoReview(fixture());
 assert.equal(result.decisions.length,2);
 assert.equal(result.events.length,1);
 assert.equal(result.decisions[1].original_value,"Невідоме");
 assert.equal(result.events[0].reason,"Підтверджено за тестовим довідником");
 assert.deepEqual(result.selectedTargets,["demo_quality_alpha_v1","demo_quality_beta_v1"]);
});

test("reject arbitrary strings/metadata, forged manual mapping and broken history",()=>{
 const bad=fixture();
 bad.review.decisions[1].original_value="SECRET COORDINATE";
 assert.throws(()=>validateDemoReview(bad),/синтетичного/);
 const bad2=fixture();
 bad2.review.history[0].next.target_id="unknown-target";
 assert.throws(()=>validateDemoReview(bad2),/відповідник|Підроблений/i);
 const bad3=fixture();
 bad3.review.history[0].reason="Sensitive private or operational note";
 assert.throws(()=>validateDemoReview(bad3),/журналу/);
 const bad4=fixture();
 bad4.review.history[0].previous.status="mapped";
 assert.throws(()=>validateDemoReview(bad4),/порядок/);
 const bad5=fixture();
 bad5.review.decisions[1].source_row=3;
 assert.throws(()=>validateDemoReview(bad5),/Дубльований/);
 const bad6=fixture();
 bad6.review.decisions[1].target_id="demo_quality_alpha_v1";
 assert.throws(()=>validateDemoReview(bad6),/журналу/);
 const bad7=fixture();
 bad7.review.decisions[1].extra="arbitrary";
 assert.throws(()=>validateDemoReview(bad7),/Непідтримувані поля/);
});

test("save returns D1-confirmed revision, exact retry reuses it, new decision appends",async()=>{
 const fake=dbFake();
 const env={DB:fake.DB};
 let r=await demoLocalStoreApi(request("POST",fixture()),env,user,["api","demo-local-store"]);
 assert.equal(r.status,201);
 const first=await r.json();
 assert.equal(first.version,1);assert.equal(first.storage,"cloudflare_d1");
 assert.equal(fake.rows.length,1);
 assert.equal(JSON.parse(fake.rows[0].snapshot_json).decisions[1].original_value,"Невідоме");
 r=await demoLocalStoreApi(request("POST",fixture()),env,user,["api","demo-local-store"]);
 assert.equal(r.status,200);
 assert.equal((await r.json()).reused,true);
 assert.equal(fake.rows.length,1);
 const second=fixture();
 second.review.history.push({
  id:2,entry_id:"2",action:"ignore",at:"2026-10-17T16:02:00.000Z",
  reason:"Виключено з тесту",
  previous:{status:"mapped",target_id:"demo_quality_beta_v1",target_name:"Бета-демо"},
  next:{status:"ignored",target_id:null,target_name:null}
 });
 second.review.decisions[1].status="ignored";
 second.review.decisions[1].target_id=null;
 second.review.decisions[1].target_name=null;
 second.review.summary={matched:1,pending:0,mapped:0,ignored:1,needs_mapping:0};
 r=await demoLocalStoreApi(request("POST",second),env,user,["api","demo-local-store"]);
 assert.equal(r.status,201);
 assert.equal((await r.json()).version,2);
 assert.equal(fake.rows.length,2);
 assert.equal(fake.rows[0].snapshot_json.includes('"ignored"'),false);
 assert.equal(fake.rows[1].snapshot_json.includes('"ignored"'),true);
 assert.equal(fake.queryLog.filter(x=>/INSERT INTO/.test(x.sql)).length,2);
});

test("stored revisions can be listed and latest snapshot read",async()=>{
 const fake=dbFake(),env={DB:fake.DB};
 let r=await demoLocalStoreApi(request("POST",fixture()),env,user,["api","demo-local-store"]);
 const {key}=await r.json();
 r=await demoLocalStoreApi(request("GET"),env,user,["api","demo-local-store"]);
 assert.equal(r.status,200);
 assert.equal((await r.json()).items.length,1);
 r=await demoLocalStoreApi(new Request("https://unit.invalid/api/demo-local-store/"+key+"/latest"),
  env,user,["api","demo-local-store",key,"latest"]);
 assert.equal(r.status,200);
 const saved=await r.json();
 assert.equal(saved.data.directory_id,"demo_quality_labels");
 assert.equal(saved.data.history.length,1);
});

test("admin-only and read-only methods cannot write",async()=>{
 const fake=dbFake(),env={DB:fake.DB};
 for(const u of [{id:"user",role:"duty",active:1},null,{id:"x",role:"admin",active:0}]){
  const r=await demoLocalStoreApi(request("POST",fixture()),env,u,["api","demo-local-store"]);
  assert.equal(r.status,403);
 }
 const invalid=await demoLocalStoreApi(request("PUT",fixture()),env,user,["api","demo-local-store"]);
 assert.equal(invalid.status,405);
 const missing=await demoLocalStoreApi(request("POST",fixture()),{},user,["api","demo-local-store"]);
 assert.equal(missing.status,503);
 assert.equal(fake.rows.length,0);
});

test("private UI requires human click to POST; never sends original DOCX/XLSX",async()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_DEMO_D1_STORE_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_DEMO_D1_STORE_JS,/Зберегти тестові результати в D1/);
 assert.match(GENERIC_PREVIEW_HTML,/\\/api\\/generic-demo-d1-store\\.js/);
 assert.match(GENERIC_PREVIEW_JS,/demoD1Store\\.mount/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\\bfetch\\s*\\(/);
 assert.doesNotMatch(GENERIC_DEMO_D1_STORE_JS,/formData\\(|\\.arrayBuffer\\(|readAsArrayBuffer|FileReader/);
 assert.match(readFileSync(new URL("../src/index.js",import.meta.url),"utf8"),/demoLocalStoreApi/);
 const r=await worker.fetch(new Request("https://unit.invalid/api/demo-local-store"),{});
 assert.equal(r.status,503);
});
