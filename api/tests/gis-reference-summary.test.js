import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {gisReferenceSummaryApi} from "../src/gis-reference-summary-api.js";
import {GIS_TRAINING_LAYERS_JS,GIS_TRAINING_LAYERS_CSS} from "../src/gis-training-layers-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const url="https://example.invalid/api/gis/reference-summary";
const admin={role:"admin",active:1};
const groups=[
 {airframe:"wing",subtype:"",is_active:1,count:2},
 {airframe:"multirotor",subtype:"fpv",is_active:1,count:1},
 {airframe:"multirotor",subtype:"quadcopter",is_active:0,count:1}
];
const models=[
 {name:"Model Alpha",airframe:"wing",subtype:""},
 {name:"Model Beta",airframe:"multirotor",subtype:"fpv"}
];
const positions=[
 {kind:"vp",is_active:1,count:3},{kind:"sp",is_active:1,count:2},
 {kind:"sp",is_active:0,count:1}
];
const stationTypes=[
 {kind:"General type A",total:7,active:5},
 {kind:"General type B",total:2,active:2}
];
function makeDB({fail=null}={}){
 const queries=[];
 return {queries,prepare(sql){
  queries.push(sql);
  if(fail&&sql.includes(fail))throw Error(fail==="vp_sp_objects"?
   "D1_ERROR: no such table: vp_sp_objects":"read error from private database");
  return {all:async()=>{
   if(sql.includes("FROM uav_models")&&sql.includes("GROUP BY"))return {results:groups};
   if(sql.includes("FROM uav_models"))return {results:models};
   if(sql.includes("FROM vp_sp_objects"))return {results:positions};
   if(sql.includes("FROM stations s"))return {results:stationTypes};
   throw Error("unknown SQL");
  }};
 }};
}
test("admin access is required; only GET without query parameters is accepted",async()=>{
 const db=makeDB(),env={DB:db};
 assert.equal((await gisReferenceSummaryApi(new Request(url,{method:"POST"}),env,admin)).status,405);
 assert.equal((await gisReferenceSummaryApi(new Request(url),env,{role:"duty",active:1})).status,403);
 assert.equal((await gisReferenceSummaryApi(new Request(url),env,{role:"admin",active:0})).status,403);
 assert.equal((await gisReferenceSummaryApi(new Request(url+"?geo=true"),env,admin)).status,400);
 assert.equal((await gisReferenceSummaryApi(new Request(url),{},admin)).status,503);
 assert.equal(db.queries.length,0);
});
test("returns real independent directory aggregates and UAV catalog names, never geography",async()=>{
 const db=makeDB();
 const response=await gisReferenceSummaryApi(new Request(url),{DB:db},admin);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.overall_status,"available");
 assert.equal(body.read_only,true);
 assert.equal(body.geographic,false);
 assert.deepEqual(body.sources.uav.items,[
  {name:"Model Alpha",category:"Крило"},
  {name:"Model Beta",category:"FPV"}
 ]);
 assert.equal(body.sources.uav.total,4);
 assert.equal(body.sources.uav.active,3);
 assert.deepEqual(body.sources.uav.categories,[
  {name:"Крило",total:2,active:2},
  {name:"Мультироторний",total:1,active:0},
  {name:"FPV",total:1,active:1}
 ]);
 assert.deepEqual(body.sources.vp.categories,[
  {name:"ВП",total:3,active:3},{name:"СП",total:3,active:2}
 ]);
 assert.equal(body.sources.station.total,9);
 assert.equal(body.sources.station.active,7);
 const str=JSON.stringify(body);
 assert.doesNotMatch(str,/call_sign|station_code|unit_code|org_unit|frequenc|mgrs|latitude|longitude|coords|event_datetime|raw_json|operational_report/i);
 assert.equal(db.queries.length,4);
 for(const sql of db.queries){
  assert.match(sql,/^SELECT /);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA)\b/i);
  assert.doesNotMatch(sql,/\b(?:call_sign|station_code|org_unit|unit_name|event_datetime|mgrs|lat|lon|longitude|latitude|frequencies|raw_json|object_name)\b/i);
 }
});
test("one broken directory never spoils the other two; schema missing is distinguishable",async()=>{
 const db=makeDB({fail:"vp_sp_objects"});
 const resp=await gisReferenceSummaryApi(new Request(url),{DB:db},admin);
 assert.equal(resp.status,200);
 const data=await resp.json();
 assert.equal(data.overall_status,"partial");
 assert.deepEqual(data.sources.vp,{status:"schema_missing"});
 assert.equal(data.sources.uav.status,"available");
 assert.equal(data.sources.station.status,"available");
 assert.doesNotMatch(JSON.stringify(data),/D1_ERROR|read error|no such table/i);
});
test("no source is reported available when every D1 read fails",async()=>{
 let count=0;
 const DB={prepare(){count++;throw Error("private D1 failure")}};
 const data=await (await gisReferenceSummaryApi(new Request(url),{DB},admin)).json();
 assert.equal(count,3);
 assert.equal(data.overall_status,"unavailable");
 assert.deepEqual(data.sources,{
  uav:{status:"query_failed"},vp:{status:"query_failed"},station:{status:"query_failed"}
 });
 assert.doesNotMatch(JSON.stringify(data),/private D1 failure/);
});
test("client uses protected same-origin reference summary, not hardcoded demo markers",()=>{
 assert.doesNotThrow(()=>new Script(GIS_TRAINING_LAYERS_JS));
 assert.match(GIS_TRAINING_LAYERS_JS,/fetch\('\/api\/gis\/reference-summary'/);
 assert.match(GIS_TRAINING_LAYERS_JS,/credentials:'same-origin'/);
 assert.match(GIS_TRAINING_LAYERS_JS,/cache:'no-store'/);
 assert.match(GIS_TRAINING_LAYERS_JS,/payload\.sources/);
 assert.match(GIS_TRAINING_LAYERS_JS,/ДОВІДНИКИ D1/);
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/gisp-training-map-marker|example\.x|example\.y|map\.append|project\(|getBounds\(|(?:lat|lon|mgrs):/);
 assert.match(GIS_TRAINING_LAYERS_CSS,/\.gisp-reference/);
 assert.match(index,/gisReferenceSummaryApi\(req,env,user\)/);
 assert.match(index,/gis-reference-summary-api\.js/);
 assert.match(GIS_PREVIEW_HTML,/\/api\/gis-training-layers\.js/);
});
test("DOM behavior: real D1 categories and model names replace fake icons; retry reads again",async()=>{
 class Node {
  constructor(tag){this.tag=tag;this.children=[];this.parent=null;this.handlers={};
   this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;}
  append(...values){for(const x of values){
   this.children.push(x);if(x&&typeof x==="object")x.parent=this;
  }}
  after(n){if(!this.parent)throw Error("orphan");const c=this.parent.children;
   const i=c.indexOf(this);c.splice(i+1,0,n);n.parent=this.parent;}
  replaceChildren(...nodes){this.children=[];this.append(...nodes)}
  setAttribute(name,value){this[name]=value}
  addEventListener(name,callback){this.handlers[name]=callback}
 }
 function find(node,fn){const out=[];const walk=x=>{
  if(!x||typeof x!=="object")return;
  if(fn(x))out.push(x);
  for(const c of x.children||[])walk(c);
 };walk(node);return out;}
 const document={
  nodes:new Map(),createElement:tag=>new Node(tag),
  createTextNode:text=>({tag:"text",textContent:String(text)}),
  getElementById(id){return this.nodes.get(id)}
 };
 const outer=new Node("main"),controls=new Node("div"),inspector=new Node("aside"),map=new Node("div");
 outer.append(controls,map);document.nodes.set("gisp-layer-controls",controls);
 document.nodes.set("gisp-inspector",inspector);
 let fetches=0;
 const fetch=async(address,options)=>{
  fetches++;
  assert.equal(address,"/api/gis/reference-summary");
  assert.equal(options.credentials,"same-origin");
  return {ok:true,json:async()=>({
   read_only:true,geographic:false,overall_status:"available",
   sources:{
    uav:{status:"available",source:"uav_models",total:4,active:3,
     categories:[{name:"Крило",total:2,active:2},{name:"FPV",total:2,active:1}],
     items:[{name:"Model Alpha",category:"Крило"}],truncated:false},
    vp:{status:"available",source:"vp_sp_objects",total:3,active:2,
     categories:[{name:"ВП",total:2,active:2},{name:"СП",total:1,active:0}]},
    station:{status:"available",source:"stations + station_types",total:2,active:2,
     categories:[{name:"General type A",total:2,active:2}]}
   }
  })};
 };
 new Script(GIS_TRAINING_LAYERS_JS).runInNewContext({document,fetch,AbortController});
 await new Promise(setImmediate);
 assert.equal(fetches,1);
 assert.equal(map.children.length,0,"no fake markers or overlays can be attached to map");
 const groups=find(outer,n=>n.dataset?.referenceGroup);
 assert.equal(groups.length,3);
 const buttons=find(outer,n=>n.tag==="button");
 assert.ok(buttons.some(x=>x.textContent.includes("Model Alpha")));
 assert.ok(buttons.some(x=>x.textContent.includes("ВП")));
 assert.ok(buttons.some(x=>x.textContent.includes("General type A")));
 assert.ok(!buttons.some(x=>x.textContent.includes("DEMO")));
 const model=buttons.find(x=>x.textContent.includes("Model Alpha"));
 model.handlers.click();
 assert.ok(find(inspector,n=>n.textContent.includes("Model Alpha")).length>0);
 const reload=buttons.find(x=>x.textContent.includes("Читати D1"));
 reload.handlers.click();
 await new Promise(setImmediate);
 assert.equal(fetches,2);
});
