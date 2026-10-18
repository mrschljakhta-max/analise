import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {GIS_PREVIEW_HTML,GIS_PREVIEW_CSS} from "../src/gis-preview-assets.js";
import {GIS_PREVIEW_JS} from "../src/gis-preview-client.js";
import {GLOBAL_NAV_JS} from "../src/global-navigation-assets.js";
import worker from "../src/index.js";
import {readFileSync} from "node:fs";
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");

test("the admin map preview is a working, syntax-valid browser client",()=>{
 assert.doesNotThrow(()=>new Script(GIS_PREVIEW_JS));
 for(const action of ["gisp-map","gisp-plus","gisp-minus","gisp-home",
  "gisp-points","gisp-basemap","gisp-markers","gisp-inspector"])
  assert.ok(GIS_PREVIEW_HTML.includes('id="'+action+'"'),"Missing map element: "+action);
 assert.match(GIS_PREVIEW_JS,/addEventListener\('pointermove'/);
 assert.match(GIS_PREVIEW_JS,/addEventListener\('wheel'/);
 assert.match(GIS_PREVIEW_JS,/addEventListener\('keydown'/);
 assert.match(GIS_PREVIEW_JS,/gisp-marker/);
 assert.match(GIS_PREVIEW_CSS,/\.gisp-map/);
});
test("real OSM raster tiles are loaded with proper attribution and restricted CSP",()=>{
 assert.ok(GIS_PREVIEW_JS.includes("https://tile.openstreetmap.org/"));
 assert.ok(GIS_PREVIEW_HTML.includes("OpenStreetMap contributors"));
 assert.ok(index.includes("img-src 'self' data: https://tile.openstreetmap.org"));
 assert.ok(index.includes("script-src 'self'"));
 assert.ok(index.includes("referrerPolicy:\"strict-origin-when-cross-origin\""));
 assert.doesNotMatch(GIS_PREVIEW_HTML,/<script[^>]+https?:\/\//);
 assert.doesNotMatch(GIS_PREVIEW_JS,/fetch\(['"]\/api\/|\bGIS_DB\b|\bGIS_R2\b/);
});
test("preview has no current military or database-derived places and clearly identifies synthetic data",()=>{
 assert.ok(GIS_PREVIEW_HTML.includes("DEMO"));
 assert.ok(GIS_PREVIEW_JS.includes("Синтетичний"));
 assert.doesNotMatch(GIS_PREVIEW_JS,/\b(?:mgrs|station|uav|frequency|unit_position)\b/i);
 assert.doesNotMatch(GIS_PREVIEW_HTML,/raw-documents|\bsecret\b/i);
});
test("the protected map route remains behind Cloudflare Access and admin role",async()=>{
 assert.ok(index.includes('"/api/gis-preview"'));
 assert.match(index,/GIS_PREVIEW_HTML/);
 assert.match(index,/if\(user\.role!=="admin"\|\|user\.active!==1\)return error\(403/);
 const r=await worker.fetch(new Request("https://example.invalid/api/gis-preview"),{});
 assert.equal(r.status,503);
 const html=await r.text();
 assert.ok(!html.includes("tile.openstreetmap.org"),"Unconfigured Access must not return a map");
});
test("ANALISE navigation adds a map link for admins without altering existing links",()=>{
 assert.ok(GLOBAL_NAV_JS.includes("title:'Карта',href:'/api/gis-preview'"));
 assert.ok(GLOBAL_NAV_JS.includes("adminLinks.append(mapLink)"));
 assert.ok(GLOBAL_NAV_JS.includes("href:'/api/dashboard'"));
 assert.ok(GLOBAL_NAV_JS.includes("href:'/api/saved-documents'"));
});
