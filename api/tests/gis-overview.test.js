import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {readFileSync} from "node:fs";
import {CIVIL_REGIONS_SQL,gisCivilRegionsApi} from "../src/gis-civil-regions-api.js";
import {GIS_OVERVIEW_JS,GIS_OVERVIEW_CSS} from "../src/gis-overview-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
const sourceIndex=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const url="https://example.invalid/api/gis/settlement-regions";
const admin={role:"admin",active:1};

test("civil regional overview is read-only and admin protected",async()=>{
 let hits=0;
 const env={DB:{prepare(){hits++;throw Error("read only")}}};
 for(const user of [{role:"duty",active:1},{role:"admin",active:0}]){
  assert.equal((await gisCivilRegionsApi(new Request(url),env,user)).status,403);
 }
 assert.equal((await gisCivilRegionsApi(new Request(url,{method:"POST"}),env,admin)).status,405);
 assert.equal((await gisCivilRegionsApi(new Request(url+"?region=test"),env,admin)).status,400);
 assert.equal((await gisCivilRegionsApi(new Request(url),{},admin)).status,503);
 assert.equal(hits,0);
});
test("civil regions aggregate existing public gazetteer without leaking coordinates",async()=>{
 let sql="";
 const env={DB:{prepare(text){sql=text;return {all:async()=>({results:[
  {region:"Харківська область",total:200,geocoded:198},
  {region:"Донецька область",total:180,geocoded:176}
 ]})}}}};
 const res=await gisCivilRegionsApi(new Request(url),env,admin);
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.read_only,true);assert.equal(body.geographic,false);
 assert.equal(body.source,"directory_entries:settlements");
 assert.deepEqual(body.items,[{region:"Харківська область",total:200,geocoded:198},
  {region:"Донецька область",total:180,geocoded:176}]);
 assert.match(sql,/FROM directory_entries/);
 assert.match(sql,/directory_id='settlements'/);
 assert.match(sql,/GROUP BY region/);
 assert.match(sql,/LIMIT 101/);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA)\b/i);
 assert.doesNotMatch(sql,/operational_report|stations|vp_sp|unit_code|mgrs/i);
 assert.doesNotMatch(JSON.stringify(body),/latitude|longitude|mgrs|unit_name|position/i);
});
test("bad/corrupt counters fail rather than fabricating numbers; 100 groups bounded",async()=>{
 const db=rows=>({DB:{prepare(){return {all:async()=>({results:rows})}}}});
 const invalid=await gisCivilRegionsApi(new Request(url),db([
  {region:"Публічна область",total:2,geocoded:4}]),admin);
 assert.equal(invalid.status,503);
 const bad=await invalid.json();assert.equal(bad.status,"query_failed");
 const rows=Array.from({length:101},(_,i)=>({region:"Область "+i,total:5,geocoded:5}));
 const res=await gisCivilRegionsApi(new Request(url),db(rows),admin);
 const data=await res.json();
 assert.equal(data.items.length,100);assert.equal(data.truncated,true);
});
test("GIS client uses existing privacy gated archive and shows null suppressed cells, not zero",()=>{
 assert.doesNotThrow(()=>new Script(GIS_OVERVIEW_JS));
 assert.match(GIS_OVERVIEW_JS,/fetch\('\/api\/gis\/settlement-regions'/);
 assert.match(GIS_OVERVIEW_JS,/fetch\('\/api\/gis-uav-archive\/data\?year='/);
 assert.match(GIS_OVERVIEW_JS,/Number\.isSafeInteger\(cat\.count\)&&cat\.count>=20\?cat\.count:null/);
 assert.match(GIS_OVERVIEW_JS,/item\.count===null\?'—'/);
 assert.match(GIS_OVERVIEW_JS,/RAW за роком завантаження/);
 assert.match(GIS_OVERVIEW_JS,/bridge\.centerOn\(view\.lat,view\.lon,7\)/);
 assert.match(GIS_OVERVIEW_JS,/cache:'no-store'/);
 assert.match(GIS_OVERVIEW_JS,/credentials:'same-origin'/);
 assert.doesNotMatch(GIS_OVERVIEW_JS,/operational_report_events|station_code|call_sign|mgrs|uav_type|station_name|object_name/);
 for(const name of ["/api/gis-overview.js","/api/gis-overview.css"]){
  assert.ok(GIS_PREVIEW_HTML.includes(name));
  assert.ok(sourceIndex.includes('"'+name+'"'));
 }
 assert.match(GIS_OVERVIEW_CSS,/\.gisp-overview-map-badge/);
});
test("client renders D1 civilian regional overview, zooms to real civil pins and displays safe history",async()=>{
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.parent=null;this.handlers={};
   this.style={};this.hidden=false;this.disabled=false;this.value='';
   this.textContent='';this.className='';this.attrs={};}
  append(...values){for(const x of values){this.children.push(x);
   if(x&&typeof x==="object")x.parent=this;}}
  replaceChildren(...values){this.children=[];this.append(...values)}
  after(item){if(!this.parent)throw Error("No parent");
   const siblings=this.parent.children,i=siblings.indexOf(this);
   siblings.splice(i+1,0,item);item.parent=this.parent;}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,fn){this.handlers[k]=fn;}
 }
 function find(root,pred){const results=[];const visit=n=>{
  if(!n||typeof n!=="object")return;
  if(pred(n))results.push(n);
  for(const child of n.children||[])visit(child);
 };visit(root);return results;}
 const doc={nodes:new Map(),createElement:tag=>new Node(tag),
  getElementById(id){return this.nodes.get(id)||null}};
 const parent=new Node("main"),layer=new Node("aside"),map=new Node("div");
 const reference=new Node("section");reference.id="gisp-reference-data";
 parent.append(layer,reference,map);
 doc.nodes.set("gisp-layer-controls",layer);
 doc.nodes.set("gisp-map",map);
 doc.nodes.set("gisp-reference-data",reference);
 let zoom=6,centerCount=0,calls=[];
 const bridge={getView(){return{lat:48.6,lon:37.6,zoom}},
  centerOn(lat,lon,next){assert.equal(next,7);zoom=next;centerCount++}};
 const window={GISDemoBridge:bridge,addEventListener(){}};
 const fetch=async(path,options)=>{
  calls.push(path);
  assert.equal(options.credentials,"same-origin");
  if(path==="/api/gis/settlement-regions")return{ok:true,json:async()=>({
   source:"directory_entries:settlements",status:"available",geographic:false,
   items:[{region:"Харківська область",total:5,geocoded:4}],truncated:false})};
  return {ok:true,json:async()=>({
   schema:"ANALISE_ARCHIVED_UAV_AGGREGATE_V1",
   source_status:"structured_available",state:"aggregates_available",
   quarters:[{label:"2026 · Q1",categories:[
    {category:"fpv",label:"FPV",count:25},
    {category:"wing",label:"Крило",count:null}]}]})};
 };
 new Script(GIS_OVERVIEW_JS).runInNewContext({document:doc,window,fetch,AbortController,Date});
 await new Promise(setImmediate);
 assert.deepEqual(calls,["/api/gis/settlement-regions"]);
 const badge=find(map,x=>x.className==="gisp-overview-map-badge")[0];
 assert.equal(badge.hidden,false);
 const zoomButton=find(layer,x=>x.className==="gisp-overview-zoom")[0];
 zoomButton.handlers.click();
 assert.equal(centerCount,1);
 const reload=find(parent,x=>x.textContent==="Читати архів")[0];
 assert.ok(reload);
 const selector=find(parent,x=>x.className==="gisp-overview-year")[0];selector.value="2026";
 reload.handlers.click();await new Promise(setImmediate);
 assert.ok(calls.includes("/api/gis-uav-archive/data?year=2026"));
 assert.ok(find(parent,x=>x.textContent==="25").length>0);
 assert.ok(find(parent,x=>x.textContent==="—").length>0);
 assert.equal(map.children.length,1,"only non-positional low-zoom badge, no military pins");
});
