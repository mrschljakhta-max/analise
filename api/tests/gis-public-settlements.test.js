import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {parseSettlementsBounds,gisPublicSettlementsApi} from "../src/gis-public-settlements-api.js";
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
 assert.deepEqual(bindings,[47.5,50,35,40]);
 assert.ok(sql.includes("FROM directory_entries"));
 assert.ok(sql.includes("directory_id='settlements'"));
 assert.ok(sql.includes("LIMIT 201"));
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
