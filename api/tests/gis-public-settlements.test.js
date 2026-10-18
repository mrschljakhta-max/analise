import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {parseSettlementsBounds,parseSettlementsPage,gisPublicSettlementsApi} from "../src/gis-public-settlements-api.js";
import {GIS_PUBLIC_SETTLEMENTS_JS,GIS_PUBLIC_SETTLEMENTS_CSS} from "../src/gis-public-settlements-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
import {GIS_PREVIEW_JS} from "../src/gis-preview-client.js";
import {readFileSync} from "node:fs";
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const url="https://example.invalid/api/gis/settlements?south=47.5&west=35&north=50&east=40";
const admin={role:"admin",active:1};
const data={id:"public-place-1",name:"Приклад",type:"місто",lat:48.6,lon:37.7};

test("strict bounds validation allows eastern Ukraine but rejects global scans",()=>{
 const bounds=parseSettlementsBounds(url);
 assert.deepEqual(bounds,{south:47.5,west:35,north:50,east:40});
 for(const bad of [
  "south=abc&west=35&north=50&east=40",
  "south=47.5&west=35&north=50",
  "south=47.5&west=35&north=47&east=40",
  "south=-85&west=-170&north=85&east=170",
  "south=47.5&west=45&north=50&east=40",
  "south=47.5&west=35&north=50&east=Infinity"
 ])assert.throws(()=>parseSettlementsBounds("https://x.invalid/?"+bad));
});
test("only active admin can read public settlement records",async()=>{
 let requests=0;
 const env={DB:{prepare:()=>{requests++;throw Error("Unreachable")}}};
 const rejected=await gisPublicSettlementsApi(new Request(url),env,{role:"duty",active:1});
 assert.equal(rejected.status,403);
 const inactive=await gisPublicSettlementsApi(new Request(url),env,{role:"admin",active:0});
 assert.equal(inactive.status,403);
 const wrongMethod=await gisPublicSettlementsApi(new Request(url,{method:"POST"}),env,admin);
 assert.equal(wrongMethod.status,405);
 assert.equal(requests,0);
});
test("database adapter reads only directory_entries settlements fields, no mutation",async()=>{
 let sql="",bindings=[],calls=0;
 const env={DB:{prepare:(query)=>{sql=query;return{bind:(...args)=>{bindings=args;return{all:async()=>{calls++;return{results:[data,
  {id:"bad",name:"",type:"",lat:48.7,lon:37.8},
  {id:"outside",name:"Некоректно",type:"",lat:54.1,lon:37.8}
 ]}}}}}}}};
 const response=await gisPublicSettlementsApi(new Request(url),env,admin);
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.directory,"settlements");assert.equal(payload.items.length,1);
 assert.equal(payload.items[0].name,"Приклад");
 assert.equal(payload.items[0].lat,48.6);
 assert.equal(calls,1);
 assert.deepEqual(bindings,[47.5,50,35,40,0]);
 assert.ok(sql.includes("FROM directory_entries"));
 assert.ok(sql.includes("directory_id='settlements'"));
 assert.ok(sql.includes("LIMIT 201 OFFSET ?"));
 assert.ok(!/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i.test(sql));
 assert.ok(!/\b(?:uav|station|vp_sp|raw_documents|frequencies)\b/i.test(sql));
});
test("read fails closed on Cloudflare D1 outage without exposing SQL",async()=>{
 const env={DB:{prepare:()=>({bind:()=>({all:async()=>{throw Error("Sensitive SQL detail")}})})}};
 const result=await gisPublicSettlementsApi(new Request(url),env,admin);
 assert.equal(result.status,503);
 const body=await result.text();
 assert.ok(!body.includes("Sensitive SQL detail"));
});
test("browser overlay is opt-in and only makes bounded read-only API calls",()=>{
 assert.doesNotThrow(()=>new Script(GIS_PUBLIC_SETTLEMENTS_JS));
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/\/api\/gis\/settlements\?/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/method|fetch\('/);
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("check.type='checkbox'"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("450"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_CSS.includes(".gisp-public-markers"));
 assert.doesNotMatch(GIS_PUBLIC_SETTLEMENTS_JS,/\b(?:mgrs|station_ids|suppression_sector|vp_sp|uav_events)\b/i);
 assert.ok(GIS_PREVIEW_JS.includes("getBounds()"));
 assert.ok(GIS_PREVIEW_HTML.includes('/api/gis-settlements.css'));
 assert.ok(GIS_PREVIEW_HTML.includes('/api/gis-settlements.js'));
 assert.ok(GIS_PREVIEW_HTML.indexOf('/api/gis-adaptive.js')<GIS_PREVIEW_HTML.indexOf('/api/gis-settlements.js'));
 assert.ok(index.includes('if(url.pathname==="/api/gis/settlements")'));
});

test("server pagination is bounded and validates its offset",()=>{
 assert.equal(parseSettlementsPage(url),0);
 assert.equal(parseSettlementsPage(url+"&offset=200"),200);
 assert.equal(parseSettlementsPage(url+"&offset=1800"),1800);
 for(const suffix of ["&offset=-200","&offset=201","&offset=2000","&offset=abc",
  "&offset=0&offset=200","&offset=0&unit=example","&offset=0&uav=sample"])
  assert.throws(()=>parseSettlementsPage(url+suffix),suffix);
});
test("D1 page responses retain safe civil attributes without raw data",async()=>{
 let args=[];
 const rows=Array.from({length:201},(_,i)=>({
  id:"civil-"+i,name:"Населений пункт "+i,type:"село",
  community:"Громада",district:"Район",region:"Область",lat:48.5,lon:36.5
 }));
 const env={DB:{prepare(sql){return {bind(...values){args=values;return{
  all:async()=>({results:rows})
 }}}}}};
 const response=await gisPublicSettlementsApi(new Request(url+"&offset=200"),env,admin);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.source_status,"available");
 assert.equal(body.items.length,200);
 assert.equal(body.items[0].community,"Громада");
 assert.equal(body.items[0].region,"Область");
 assert.equal(body.more,true);
 assert.equal(body.next_offset,400);
 assert.equal(body.truncated,false);
 assert.deepEqual(args,[47.5,50,35,40,200]);
 const encoded=JSON.stringify(body);
 assert.doesNotMatch(encoded,/raw_json|station_name|mgrs|frequency|azimuth|source_file/);
});
test("bounded pagination warns at page ten rather than pretending full coverage",async()=>{
 const env={DB:{prepare(){return{bind(){return{all:async()=>({
  results:Array.from({length:201},(_,i)=>({id:String(i),name:"село",lat:48.5,lon:36}))
 })}}}}}};
 const response=await gisPublicSettlementsApi(new Request(url+"&offset=1800"),env,admin);
 const body=await response.json();
 assert.equal(body.next_offset,null);
 assert.equal(body.truncated,true);
 assert.equal(body.more,true);
});
test("real civilian D1 layer is auto-enabled and interactive, never supplied by synthetic pins",()=>{
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("check.checked=true"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("demo.checked=false"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("void load()"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("params.set('offset'"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("page<10"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("controls.prepend(wrapper)"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("bridge.centerOn"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("gisp-public-search"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("gisp-public-type"));
 assert.ok(GIS_PUBLIC_SETTLEMENTS_JS.includes("is-cluster"));
 assert.ok(!GIS_PUBLIC_SETTLEMENTS_JS.includes("getPoints()"));
 assert.match(GIS_PUBLIC_SETTLEMENTS_CSS,/gisp-public-controls/);
});

test("empty viewport distinguishes genuinely empty directory from missing coordinates",async()=>{
 const statements=[];
 const env={DB:{prepare(sql){
  statements.push(sql);
  if(sql.includes("COUNT(*) AS active"))return {first:async()=>({active:120,geocoded:0})};
  return {bind(...args){return {all:async()=>({results:[]})}}};
 }}};
 const res=await gisPublicSettlementsApi(new Request(url),env,admin);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.items.length,0);
 assert.deepEqual(data.source_health,{status:"available",active:120,geocoded:0});
 assert.equal(statements.length,2);
 assert.ok(statements.every(sql=>!/(?:\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b)/i.test(sql)));
 assert.ok(statements.every(sql=>!/(?:operational_report_events|station_name|mgrs)/i.test(sql)));
});
test("empty viewport with geocoded records stays an empty viewport, not a blank database",async()=>{
 const env={DB:{prepare(sql){
  if(sql.includes("COUNT(*) AS active"))return {first:async()=>({active:215,geocoded:211})};
  return {bind(){return {all:async()=>({results:[]})}}};
 }}};
 const data=await (await gisPublicSettlementsApi(new Request(url),env,admin)).json();
 assert.equal(data.items.length,0);
 assert.deepEqual(data.source_health,{status:"available",active:215,geocoded:211});
});
test("failure of optional count diagnostics never fabricates zero archive records",async()=>{
 const env={DB:{prepare(sql){
  if(sql.includes("COUNT(*) AS active"))return {first:async()=>{throw Error("private D1 error")}};
  return {bind(){return {all:async()=>({results:[]})}}};
 }}};
 const data=await (await gisPublicSettlementsApi(new Request(url),env,admin)).json();
 assert.equal(data.items.length,0);
 assert.deepEqual(data.source_health,{status:"unavailable"});
 assert.doesNotMatch(JSON.stringify(data),/private D1 error/);
});
test("map movement renders once per animation frame and reads D1 only on actual viewport changes",()=>{
 assert.match(GIS_PREVIEW_JS,/panFrame=requestAnimationFrame/);
 assert.match(GIS_PREVIEW_JS,/panDx\+=e.clientX-pointer.x/);
 assert.match(GIS_PREVIEW_JS,/wheelAccum\+=e.deltaY/);
 assert.match(GIS_PREVIEW_JS,/lastWheelZoom<150/);
 assert.match(GIS_PREVIEW_JS,/map.clientWidth!==lastMapWidth/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/key===scheduledKey\|\|key===completedKey/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/completedKey=key/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/source_health/);
 assert.doesNotMatch(GIS_PUBLIC_SETTLEMENTS_JS,/\/api\/(?:operational-reports|raw-documents|gis\/stations)/);
});
