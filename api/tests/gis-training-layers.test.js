import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {readFileSync} from "node:fs";
import {GIS_TRAINING_LAYERS_JS,GIS_TRAINING_LAYERS_CSS} from "../src/gis-training-layers-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");

test("three training legend categories exist, with existing read-only directory links",()=>{
 assert.doesNotThrow(()=>new Script(GIS_TRAINING_LAYERS_JS));
 for(const key of ["uav","vp","station"])
  assert.ok(GIS_TRAINING_LAYERS_JS.includes("key:'"+key+"'"));
 for(const page of ["/api/uav-catalog","/api/vp-directory","/api/station-directory"])
  assert.ok(GIS_TRAINING_LAYERS_JS.includes(page));
 for(const name of ["Крило","Мультироторний","FPV","ВП","СП","Виявлення","Подавлення","Комбінована"])
  assert.ok(GIS_TRAINING_LAYERS_JS.includes(name),name);
});
test("training layers are non-georeferenced, synthetic and never query military records",()=>{
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/\b(?:getBounds|project|mapbox|maplibre|latitude|longitude|mgrs|azimuth|sector_range)\b/i);
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/\/api\/(?:raw-documents|gis\/stations|gis\/uav|gis\/vp|station-compare)/);
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/[\w.]+\s*\.\s*(?:DB|D1|R2|DOCUMENTS)\b/);
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("preview.hidden=true"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("state=Object.fromEntries"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("Не використовуються") ||
           GIS_TRAINING_LAYERS_JS.includes("не використовуються"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("НЕ позначки на карті"));
});
test("legend switches drive checkboxes, class filters and a schematic-only diagram",()=>{
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("data.trainingGroup"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("data.trainingFilter"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("stationDiagram()"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("createElementNS"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("Схема, не сектор дії станції"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("if(!active")===false);
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("preview.hidden=active.length===0||previewDismissed"));
 for(const classname of [".gisp-training-layers",".gisp-training-preview",".gisp-training-station-svg"])
  assert.ok(GIS_TRAINING_LAYERS_CSS.includes(classname));
});
test("all new training assets are Access+admin protected and loaded after public D1 layer",()=>{
 assert.ok(index.includes('"/api/gis-training-layers.js"'));
 assert.ok(index.includes('"/api/gis-training-layers.css"'));
 assert.ok(index.includes('if(user.role!=="admin"||user.active!==1)return error(403'));
 assert.ok(GIS_PREVIEW_HTML.includes('/api/gis-training-layers.js'));
 assert.ok(GIS_PREVIEW_HTML.includes('/api/gis-training-layers.css'));
 assert.ok(GIS_PREVIEW_HTML.indexOf('/api/gis-settlements.js')<GIS_PREVIEW_HTML.indexOf('/api/gis-training-layers.js'));
 assert.ok(index.includes('script-src \'self\''));
});
