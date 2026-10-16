import test from "node:test";
import assert from "node:assert/strict";
import {dashboardApi} from "../src/dashboard-api.js";
import {DASHBOARD_HTML,DASHBOARD_CSS,DASHBOARD_JS} from "../src/dashboard-assets.js";
import {GLOBAL_NAV_JS,GLOBAL_NAV_CSS} from "../src/global-navigation-assets.js";
import {DIRECTORY_CATALOG_HTML} from "../src/directory-catalog-assets.js";
import {STATION_DIRECTORY_HTML} from "../src/station-directory-assets.js";
import {STATION_MODELS_HTML} from "../src/station-models-assets.js";
import {UAV_CATALOG_HTML} from "../src/uav-catalog-assets.js";
import {VP_SP_HTML} from "../src/vp-sp-assets.js";
import {ORG_DIRECTORY_HTML} from "../src/org-directory-assets.js";
import {DIRECTORY_VIEW_HTML} from "../src/directory-view-assets.js";
import {DIRECTORY_IMPORT_HTML} from "../src/directory-import-assets.js";
import {ORG_IMPORT_HTML} from "../src/org-import-assets.js";
import {STATION_IMPORT_HTML} from "../src/station-import-assets.js";
import {UAV_IMPORT_HTML} from "../src/uav-import-assets.js";
import {APP_HTML} from "../src/app-assets.js";

const admin={role:"admin",active:1};
const duty={role:"duty",active:1};
const url="https://example.test/api/dashboard/data";
const seg=["api","dashboard","data"];
const counts={
  settlements:3975,org_units:34,stations:24,station_models:6,
  uav_models:18,vp:34,sp:0
};
function db(row=counts){
  let calls=0;
  const env={DB:{prepare(sql){
   calls++;
   assert.match(sql,/SELECT COUNT\(\*\) FROM directory_entries/);
   assert.match(sql,/SELECT COUNT\(\*\) FROM vp_sp_objects WHERE kind='vp'/);
   assert.match(sql,/SELECT COUNT\(\*\) FROM vp_sp_objects WHERE kind='sp'/);
   assert.doesNotMatch(sql,/SELECT\s+name|SELECT\s+mgrs|SELECT\s+org_unit_id/i);
   return {first:async()=>row};
  }}};
  return {env,get calls(){return calls}};
}
test("dashboard: admin gets live aggregate values without row-level records",async()=>{
 const fixture=db();
 const res=await dashboardApi(new Request(url),fixture.env,admin,seg);
 assert.equal(res.status,200);
 const result=await res.json();
 assert.equal(result.role,"admin");
 assert.deepEqual(result.counts,counts);
 assert.match(result.generated_at,/^\d{4}-\d{2}-\d{2}T/);
 assert.equal(fixture.calls,1);
 assert.match(res.headers.get("cache-control"),/no-store/);
 assert.equal("items" in result,false);
});
test("dashboard: duty role cannot read administrative summary or query D1",async()=>{
 const fixture=db();
 const res=await dashboardApi(new Request(url),fixture.env,duty,seg);
 assert.equal(res.status,200);
 const result=await res.json();
 assert.equal(result.role,"user");
 assert.equal(result.counts,null);
 assert.equal(fixture.calls,0);
});
test("dashboard: inactive account cannot read data",async()=>{
 const fixture=db();
 const res=await dashboardApi(new Request(url),fixture.env,{role:"admin",active:0},seg);
 assert.equal(res.status,403);
 assert.equal(fixture.calls,0);
});
test("dashboard: rejects wrong method and unexpected route",async()=>{
 const fixture=db();
 assert.equal((await dashboardApi(new Request(url,{method:"POST"}),fixture.env,admin,seg)).status,405);
 assert.equal((await dashboardApi(new Request(url),fixture.env,admin,["api","dashboard","query"])).status,404);
 assert.equal(fixture.calls,0);
});
test("dashboard: no silent fake zero when migrations are missing",async()=>{
 const env={DB:{prepare(){return {first:async()=>{throw Error("no such table: stations")}}}}};
 const res=await dashboardApi(new Request(url),env,admin,seg);
 assert.equal(res.status,503);
 assert.equal("counts" in await res.json(),false);
});
test("dashboard: invalid D1 values cannot be reported as zero",async()=>{
 const fixture=db({...counts,stations:null});
 const res=await dashboardApi(new Request(url),fixture.env,admin,seg);
 assert.equal(res.status,503);
});
test("dashboard: HTML routes to every existing administrative module",()=>{
 for(const href of ["/api/directory-catalog","/api/directory-view","/api/org-directory",
   "/api/station-directory","/api/station-models","/api/uav-catalog","/api/vp-directory",
   "/api/directory-import","/api/org-import","/api/station-import","/api/uav-import",
   "/api/app"]){
  assert.ok(DASHBOARD_HTML.includes('href="'+href+'"'),"Missing dashboard link "+href);
 }
 assert.match(DASHBOARD_HTML,/id="db-search"/);
 assert.match(DASHBOARD_HTML,/id="db-refresh"/);
 assert.match(DASHBOARD_HTML,/id="db-modules"/);
 assert.match(DASHBOARD_HTML,/id="db-connection"/);
 for(const key of Object.keys(counts)){
  assert.match(DASHBOARD_HTML,new RegExp('data-count="'+key+'"'));
 }
});
test("dashboard: browser scripts validate summaries and reveal admin-only cards",()=>{
 assert.doesNotThrow(()=>new Function(DASHBOARD_JS));
 assert.match(DASHBOARD_JS,/data\.role==='admin'/);
 assert.match(DASHBOARD_JS,/Number\.isSafeInteger/);
 assert.match(DASHBOARD_JS,/db-admin-ready/);
 assert.match(DASHBOARD_JS,/location|filter\(/);
 assert.doesNotMatch(DASHBOARD_JS,/\.innerHTML\s*=/);
 assert.match(DASHBOARD_CSS,/\[data-admin-only\]\{display:none!important\}/);
 assert.match(DASHBOARD_CSS,/@media\(max-width:670px\)/);
 assert.match(DASHBOARD_CSS,/@media\(prefers-reduced-motion:reduce\)/);
});
test("dashboard: shared top navigation is protected and uses only defined local routes",()=>{
 assert.doesNotThrow(()=>new Function(GLOBAL_NAV_JS));
 assert.match(GLOBAL_NAV_JS,/fetch\('\/api\/me'/);
 assert.match(GLOBAL_NAV_JS,/data\.role==='admin'/);
 assert.match(GLOBAL_NAV_CSS,/\.an-topnav/);
 assert.doesNotMatch(GLOBAL_NAV_JS,/\.innerHTML\s*=/);
 for(const page of [DIRECTORY_CATALOG_HTML,STATION_DIRECTORY_HTML,STATION_MODELS_HTML,
  UAV_CATALOG_HTML,VP_SP_HTML,ORG_DIRECTORY_HTML,DIRECTORY_VIEW_HTML,DIRECTORY_IMPORT_HTML,
  ORG_IMPORT_HTML,STATION_IMPORT_HTML,UAV_IMPORT_HTML]){
  assert.match(page,/href="\/api\/global-nav\.css"/);
  assert.match(page,/src="\/api\/global-nav\.js"/);
 }
 assert.match(APP_HTML,/href="\/api\/dashboard"/);
});
