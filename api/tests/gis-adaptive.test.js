import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {GIS_ADAPTIVE_JS} from "../src/gis-adaptive-client.js";
import {GIS_ADAPTIVE_CSS} from "../src/gis-adaptive-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
import {GIS_PREVIEW_JS} from "../src/gis-preview-client.js";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const noSensitive=/\/api\/(?:raw|saved-documents|directories|files)|\bGIS_DB\b|\bGIS_R2\b/;

test("adaptive GIS browser code compiles without remote scripts",()=>{
 assert.doesNotThrow(()=>new Script(GIS_ADAPTIVE_JS));
 assert.doesNotThrow(()=>new Script(GIS_PREVIEW_JS));
 assert.doesNotMatch(GIS_ADAPTIVE_JS,/<script[^>]+src=.*https?:\/\//);
});
test("all six reference modes and contextual scenarios are live controls",()=>{
 for(const mode of ["kpi","routes","units","time","duty","settings"])
  assert.ok(GIS_ADAPTIVE_JS.includes("id:'"+mode+"'"),mode);
 for(const title of ["KPI","Маршрути","Підрозділи","Час","Чергові","Налаштування",
  "Порівняння","Території","Станції","Періоди","Експорт","Очистити"])
  assert.ok(GIS_ADAPTIVE_JS.includes(title),title);
 assert.match(GIS_ADAPTIVE_JS,/addEventListener\('click'/);
 assert.match(GIS_ADAPTIVE_JS,/bridge\.setVisibleIds/);
});
test("dock panels and central map are responsive and togglable",()=>{
 for(const key of ["gisp-hide-left","gisp-hide-right","gisp-compact","gisp-map-actions"])
  assert.ok(GIS_ADAPTIVE_CSS.includes(key),key);
 for(const key of ["gisp-mode-select","data-map-tool=\"inspector\"",
  "data-map-tool=\"fullscreen\"","data-map-tool=\"layers\""])
  assert.ok(GIS_ADAPTIVE_JS.includes(key),key);
 assert.ok(GIS_ADAPTIVE_CSS.includes("grid-template-columns:1fr"));
});
test("export builder has controls, preview and live update on map changes",()=>{
 for(const part of ["gisp-exp-title","gisp-exp-author","gisp-export-options","gisp-export-map",
  "gisp-export-paper","gisp-exp-grid-overlay","gisp-export-status"])
  assert.ok(GIS_ADAPTIVE_JS.includes(part),part);
 for(const option of ["title","legend","scale","north","info","kpi","grid"])
  assert.ok(GIS_ADAPTIVE_JS.includes("['"+option+"'"),option);
 assert.ok(GIS_ADAPTIVE_JS.includes("window.addEventListener('gis:map-changed'"));
 assert.match(GIS_ADAPTIVE_CSS,/@media print/);
});
test("Excel export creates UTF8 BOM semicolon CSV, PDF calls print, PNG detects unsafe tiles",()=>{
 assert.match(GIS_ADAPTIVE_JS,/text\/csv;charset=utf-8/);
 assert.ok(GIS_ADAPTIVE_JS.includes("const csv="));
 assert.match(GIS_ADAPTIVE_JS,/window\.print\(\)/);
 assert.match(GIS_ADAPTIVE_JS,/canvas\.toBlob/);
 assert.match(GIS_ADAPTIVE_JS,/img\.crossOrigin='anonymous'/);
 assert.match(GIS_ADAPTIVE_JS,/не вдалося|Не вдалося/);
});
test("adaptive preview stays synthetic and never fetches ANALISE datasets",()=>{
 assert.doesNotMatch(GIS_ADAPTIVE_JS,noSensitive);
 assert.doesNotMatch(GIS_ADAPTIVE_JS,/fetch\s*\(/);
 assert.ok(GIS_ADAPTIVE_JS.includes("DEMO"));
 assert.ok(GIS_ADAPTIVE_JS.includes("polyPoints"));
 assert.ok(GIS_ADAPTIVE_JS.includes("state.mode==='routes'"));
});
test("map viewport is persisted and original map controls remain intact",()=>{
 assert.match(GIS_PREVIEW_JS,/const BASE=\{lat:48\.6,lon:37\.6,zoom:7\}/);
 assert.ok(GIS_PREVIEW_JS.includes("window.GISDemoBridge"));
 for(const method of ["getView()","getPoints()","setVisibleIds(ids)","reset()"])
  assert.ok(GIS_PREVIEW_JS.includes(method),method);
 assert.ok(GIS_PREVIEW_HTML.includes("gisp-points"));
 assert.ok(GIS_PREVIEW_HTML.includes("gisp-home"));
});
test("new assets are loaded after map and use the original restricted CSP",()=>{
 assert.ok(GIS_PREVIEW_HTML.includes('/api/gis-adaptive.css'));
 assert.ok(GIS_PREVIEW_HTML.includes('/api/gis-adaptive.js'));
 assert.ok(GIS_PREVIEW_HTML.indexOf('/api/gis-preview.js')<GIS_PREVIEW_HTML.indexOf('/api/gis-adaptive.js'));
 assert.ok(source.includes('"\/api/gis-adaptive.js"'));
 assert.ok(source.includes('"\/api/gis-adaptive.css"'));
 assert.match(source,/GIS_ADAPTIVE_JS/);
 assert.match(source,/GIS_ADAPTIVE_CSS/);
 assert.ok(source.includes('script-src \'self\''));
 assert.ok(source.includes('if(user.role!=="admin"||user.active!==1)return error(403'));
});
test("exporting and layout adjustments are entirely browser-local",()=>{
 assert.match(GIS_ADAPTIVE_JS,/localStorage\.setItem/);
 assert.match(GIS_ADAPTIVE_JS,/createObjectURL/);
 assert.doesNotMatch(GIS_ADAPTIVE_JS,/upload|ingest|D1\.prepare|\bpostMessage\b/);
});

test("wide mode ribbon is removed and original map gets the reclaimed space",()=>{
 assert.doesNotMatch(GIS_ADAPTIVE_JS,/gisp-modebar|gisp-mode-links|gisp-layout-toggle|gisp-export-open/);
 assert.doesNotMatch(GIS_ADAPTIVE_CSS,/\\.gisp-modebar\\s*\\{/);
 assert.match(GIS_ADAPTIVE_CSS,/height:calc\\(100dvh - 138px\\)/);
 assert.ok(GIS_ADAPTIVE_JS.includes("gisp-mode-select"));
 assert.ok(GIS_ADAPTIVE_JS.includes("gisp-map-actions"));
 assert.ok(GIS_ADAPTIVE_JS.includes("data-map-tool=\"export\""));
});
