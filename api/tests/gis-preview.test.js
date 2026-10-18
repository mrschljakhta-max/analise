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

test("eastern Ukraine is the initial preview extent and reset target",()=>{
 assert.ok(GIS_PREVIEW_JS.includes("const BASE={lat:48.6,lon:37.6,zoom:7}"));
 assert.ok(GIS_PREVIEW_HTML.includes("РАЙОН: СХІД УКРАЇНИ · ТЕСТ"));
 assert.ok(GIS_PREVIEW_HTML.includes("Інтерактивна карта сходу України."));
 assert.ok(GIS_PREVIEW_HTML.includes("До центру карти"));
 assert.ok(GIS_PREVIEW_HTML.includes("ZOOM 7"));
 assert.ok(GIS_PREVIEW_JS.includes("Object.assign(state,BASE);state.selected=null;inspector(null);render()"));
 assert.ok(GIS_PREVIEW_JS.includes("Object.assign(state,BASE);render()"));
 const values=[["49.00","36.30"],["48.57","39.30"],["48.01","37.80"]];
 for(const [lat,lon] of values) assert.ok(GIS_PREVIEW_JS.includes("lat:"+lat+",lon:"+lon));
 assert.doesNotMatch(GIS_PREVIEW_JS,/Лісабон|38\.720|38\.743|38\.704|-9\.140|-9\.110|-9\.194/);
 assert.doesNotMatch(GIS_PREVIEW_HTML,/ЛІСАБОН|Лісабона|ZOOM 11|38\.7200/);
});

test("inverse Mercator longitude preserves real civil D1 viewport coordinates",()=>{
 const start=GIS_PREVIEW_JS.indexOf(" const radians=x=>");
 const end=GIS_PREVIEW_JS.indexOf(" const measure=()=>",start);
 assert.ok(start>=0&&end>start,"Real browser projection functions must be testable");
 // Evaluate the EXACT projection source shipped to the browser, not a copied formula.
 const source="const TILE_SIZE=256,MAX_LAT=85.05112878;\n"+
  GIS_PREVIEW_JS.slice(start,end)+"\n({llToWorld,worldToLL,world});";
 const {llToWorld,worldToLL,world}=new Script(source).runInNewContext({});
 const almost=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,
  "expected "+expected+" but got "+actual);
 for(const [lat,lon,zoom] of [
  [48.6,37.6,7],[49.99,36.23,10],[48.0,37.8,8],
  [0,0,3],[-25.6,-122.5,6],[10,179.8,9],[10,-179.8,9]
 ]){
  const point=llToWorld(lat,lon,zoom),recovered=worldToLL(point.x,point.y,zoom);
  almost(recovered.lat,lat);almost(recovered.lon,lon);
 }
 almost(worldToLL(0,world(7)/2,7).lon,-180);
 almost(worldToLL(world(7)/2,world(7)/2,7).lon,0);
 const center=llToWorld(48.6,37.6,7),width=1200,height=760;
 const nw=worldToLL(center.x-width/2,center.y-height/2,7);
 const se=worldToLL(center.x+width/2,center.y+height/2,7);
 assert.ok(nw.lon<37.6&&se.lon>37.6,"Bounds must surround eastern Ukraine");
 assert.ok(nw.lon>25&&se.lon<50,"Bounds must NOT shift across the Pacific");
 assert.ok(nw.lat>48.6&&se.lat<48.6);
 assert.ok(nw.lon<se.lon&&se.lat<nw.lat);
 const drag=worldToLL(center.x-140,center.y+100,7);
 assert.ok(Math.abs(drag.lon-37.6)<3,"Short drag must not jump 180 degrees");
});
