import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {readFileSync} from "node:fs";
import {GIS_TRAINING_LAYERS_JS,GIS_TRAINING_LAYERS_CSS} from "../src/gis-training-layers-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");

test("existing GIS asset URLs remain behind Cloudflare Access and active admin guard",()=>{
 assert.match(index,/if\(user\.role!=="admin"\|\|user\.active!==1\)return error\(403/);
 for(const path of ["/api/gis-training-layers.js","/api/gis-training-layers.css"]){
  assert.ok(index.includes('"'+path+'"'));
  assert.ok(GIS_PREVIEW_HTML.includes(path));
 }
 assert.ok(index.includes("gisReferenceSummaryApi(req,env,user)"));
 assert.ok(GIS_PREVIEW_HTML.indexOf("/api/gis-settlements.js")<
  GIS_PREVIEW_HTML.indexOf("/api/gis-training-layers.js"));
});
test("current D1 catalog browser does not render simulated geographic markers",()=>{
 assert.doesNotThrow(()=>new Script(GIS_TRAINING_LAYERS_JS));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("uav_models"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("vp_sp_objects"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("station_types"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("fetch('/api/gis/reference-summary'"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("render(spec.key)"));
 for(const str of ["gisp-training-map-overlay","gisp-training-map-marker",
  "allExamples","stationDiagram","marker.style.left","marker.style.top"]){
  assert.ok(!GIS_TRAINING_LAYERS_JS.includes(str),str);
 }
 for(const name of [".gisp-reference-group",".gisp-reference-status",
  ".gisp-reference-filter",".gisp-reference-item"]){
  assert.ok(GIS_TRAINING_LAYERS_CSS.includes(name));
 }
});
