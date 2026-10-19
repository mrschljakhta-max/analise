import test from "node:test";
import assert from "node:assert/strict";
import {Script,runInNewContext} from "node:vm";
import {readFileSync} from "node:fs";
import {
 GIS_REFERENCE_VISIBILITY,GIS_REFERENCE_VISIBILITY_JS,isVisibleReference
} from "../src/gis-reference-visibility.js";
import {GIS_TRAINING_LAYERS_JS} from "../src/gis-training-layers-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
import {gisReferenceSummaryApi} from "../src/gis-reference-summary-api.js";

const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
test("one safe server-controlled visibility file covers UAV, VP/SP and station summaries",()=>{
 assert.deepEqual(Object.keys(GIS_REFERENCE_VISIBILITY).sort(),["station","uav","vp"]);
 for(const key of ["uav","vp","station"]){
  assert.equal(GIS_REFERENCE_VISIBILITY[key].enabled,true);
  assert.equal(GIS_REFERENCE_VISIBILITY[key].mode,"reference_only");
  assert.equal(isVisibleReference(key),true);
 }
 assert.equal(isVisibleReference("other"),false);
 assert.equal(isVisibleReference("vp",{vp:{enabled:false,mode:"reference_only"}}),false);
 assert.equal(isVisibleReference("vp",{vp:{enabled:true,mode:"geographic"}}),false);
 assert.equal(isVisibleReference("vp",{vp:{enabled:true}}),false);
});
test("client receives same manifest before catalog script and neither path allows coordinates",()=>{
 const context={window:{}};
 runInNewContext(GIS_REFERENCE_VISIBILITY_JS,context);
 assert.deepEqual(JSON.parse(JSON.stringify(context.window.ANALISE_GIS_REFERENCE_VISIBILITY)),
  GIS_REFERENCE_VISIBILITY);
 assert.doesNotThrow(()=>new Script(GIS_TRAINING_LAYERS_JS));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("window.ANALISE_GIS_REFERENCE_VISIBILITY"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("mode==='reference_only'"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes(".filter(item=>visible(item.key))"));
 assert.match(GIS_TRAINING_LAYERS_JS,/payload\.geographic!==false/);
 assert.match(GIS_TRAINING_LAYERS_JS,/success\+' із '\+definitions\.length/);
 const a="/api/gis-reference-visibility.js";
 assert.ok(index.includes('"'+a+'"'));
 assert.ok(GIS_PREVIEW_HTML.includes(a));
 assert.ok(GIS_PREVIEW_HTML.indexOf(a)<GIS_PREVIEW_HTML.indexOf("/api/gis-training-layers.js"));
 assert.match(index,/GIS_REFERENCE_VISIBILITY_JS/);
 assert.match(index,/if\(url.pathname===\"\/api\/gis-reference-visibility\.js\"\)/);
 assert.match(index,/if\(user\.role!==\"admin\"\|\|user\.active!==1\)return error\(403/);
});
test("hidden reference panels do not make any requests or render fabricated markers",()=>{
 const controls={after(element){this.output=element}};
 const document={getElementById:key=>key==="gisp-layer-controls"?controls:null,
  createElement:tag=>{
   return {tag,children:[],className:"",textContent:"",disabled:false,
    setAttribute(){},append(...nodes){this.children.push(...nodes)}};
  }};
 const window={ANALISE_GIS_REFERENCE_VISIBILITY:{
  uav:{enabled:false,mode:"reference_only"},
  vp:{enabled:false,mode:"reference_only"},
  station:{enabled:false,mode:"reference_only"}
 }};
 runInNewContext(GIS_TRAINING_LAYERS_JS,{document,window,
  fetch:()=>{throw Error("disabled layers must not contact D1")}});
 assert.equal(controls.output.id,"gisp-reference-data");
 assert.equal(controls.output.children.at(-1).textContent,
  "Довідникові шари вимкнено в gis-reference-visibility.js");
 assert.ok(!GIS_TRAINING_LAYERS_JS.includes("bridge.project"));
 assert.ok(!GIS_TRAINING_LAYERS_JS.includes("station_location_history"));
});
test("server remains non-geographic and preserves existing admin-only D1 counts",async()=>{
 const queries=[];
 const db={prepare(sql){
  queries.push(sql);return {all:async()=>({results:
   sql.includes("FROM uav_models")?[]:
   sql.includes("FROM vp_sp_objects")?[]:
   sql.includes("FROM stations s")?[]:[]})};
 }};
 const result=await gisReferenceSummaryApi(
  new Request("https://test.invalid/api/gis/reference-summary"),{DB:db},
  {role:"admin",active:1}
 );
 const payload=await result.json();
 assert.equal(result.status,200);
 assert.equal(payload.geographic,false);
 assert.equal(payload.read_only,true);
 assert.equal(payload.overall_status,"available");
 assert.deepEqual(Object.keys(payload.sources).sort(),["station","uav","vp"]);
 assert.equal(queries.length,4);
 for(const sql of queries){
  assert.match(sql,/^SELECT /);
  assert.doesNotMatch(sql,/\b(?:mgrs|latitude|longitude|lat|lon|call_sign|deployment_status|station_location_history)\b/i);
 }
});
