import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {readFileSync} from "node:fs";
import {historicalAuditApi,historicalRange} from "../src/gis-history-api.js";
import {GIS_HISTORY_HTML,GIS_HISTORY_CSS,GIS_HISTORY_JS} from "../src/gis-history-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
import worker from "../src/index.js";
const actor={id:"test",active:1,role:"admin"};
const url="https://example.invalid/api/gis-history/data?from=2026-09-01&to=2026-10-18";

test("historical date filters validate calendar days and at most 366 days",()=>{
 assert.deepEqual(historicalRange(url),{
  from:"2026-09-01",to:"2026-10-18",exclusiveTo:"2026-10-19"
 });
 for(const value of [
  "from=2026-02-29&to=2026-03-01",
  "from=2026-09-01&to=2026-08-31",
  "from=2024-01-01&to=2026-10-18",
  "from=2026-09-01&to=2026-10-18&table=operational_report_events",
  "from=2026-09-01&to=2026-13-12",
  "from=2026-09-01"
 ])assert.throws(()=>historicalRange("https://example.invalid/?"+value));
});
test("anonymous, non-admin and inactive users do not reach DB",async()=>{
 let called=false;
 const DB={prepare(){called=true;throw Error("must not query")}};
 for(const user of [null,{role:"duty",active:1},{role:"admin",active:0}]){
  const r=await historicalAuditApi(new Request(url),{DB},user);
  assert.equal(r.status,403);
 }
 assert.equal(called,false);
 const post=await historicalAuditApi(new Request(url,{method:"POST"}),{DB},actor);
 assert.equal(post.status,405);
 assert.equal(called,false);
});
test("history is compiled from immutable RAW metadata and administrative audit, not event locations",async()=>{
 const sql=[],bindings=[];
 const fixtures=[
  [
   {day:"2026-10-16",versions:2,docx:1,xlsx:1,rows_saved:104,needs_review:5},
   {day:"2026-10-17",versions:1,docx:1,xlsx:0,rows_saved:18,needs_review:1}
  ],
  [{day:"2026-10-17",quality_created:3,quality_updated:2}],
  [{day:"2026-10-16",directory_changes:1}],
  [{day:"2026-10-17",record_changes:4}]
 ];
 const DB={prepare(statement){
  const idx=sql.push(statement)-1;
  return {bind(...args){bindings.push(args);return {async all(){return {results:fixtures[idx]}}}}};
 }};
 const response=await historicalAuditApi(new Request(url),{DB},actor);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.schema,"ANALISE_HISTORICAL_METADATA_V1");
 assert.equal(data.read_only,true);
 assert.equal(data.geo_data,false);
 assert.equal(data.totals.versions,3);
 assert.equal(data.totals.rows_saved,122);
 assert.equal(data.totals.quality_created,3);
 assert.equal(data.totals.quality_updated,2);
 assert.equal(data.totals.directory_changes,1);
 assert.equal(data.totals.record_changes,4);
 assert.equal(data.days.length,2);
 assert.equal(data.days[0].day,"2026-10-16");
 for(const bind of bindings)assert.deepEqual(bind,["2026-09-01","2026-10-19"]);
 assert.equal(sql.length,4);
 for(const statement of sql){
  assert.match(statement,/SELECT/);
  assert.doesNotMatch(statement,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  assert.doesNotMatch(statement,/operational_report_events|latitude|longitude|\bmgrs\b|\buav\b|station_name|frequencies/i);
 }
 const serialized=JSON.stringify(data);
 assert.doesNotMatch(serialized,/source_name|raw_json|actor_id|directory_id|mgrs|lat|lon/i);
});
test("empty historical range returns zeros, never fabricated activity",async()=>{
 const DB={prepare(sql){return{bind(){return{async all(){return{results:[]}}}}}}};
 const r=await historicalAuditApi(new Request(url),{DB},actor);
 assert.equal(r.status,200);const x=await r.json();
 assert.equal(x.totals.versions,0);assert.deepEqual(x.days,[]);
});
test("database failure is non-disclosing and returns error rather than a false zero",async()=>{
 const DB={prepare(){throw Error("raw SECRET internal SQL location")}};
 const r=await historicalAuditApi(new Request(url),{DB},actor);
 assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/SECRET|SQL location/);
});
test("history UI is self-contained, compiles and correctly distinguishes upload time from event time",()=>{
 assert.doesNotThrow(()=>new Script(GIS_HISTORY_JS));
 for(const id of ["ha-from","ha-to","ha-load","ha-export","ha-cards","ha-chart","ha-table"])
  assert.ok(GIS_HISTORY_HTML.includes('id="'+id+'"'),id);
 assert.ok(GIS_HISTORY_HTML.includes("не дату події"));
 assert.ok(GIS_HISTORY_JS.includes("/api/gis-history/data?"));
 assert.ok(GIS_HISTORY_JS.includes("createObjectURL"));
 assert.ok(GIS_HISTORY_JS.includes("text/csv;charset=utf-8"));
 assert.ok(GIS_HISTORY_CSS.includes("@media(max-width:"));
 assert.ok(GIS_PREVIEW_HTML.includes('href="/api/gis-history"'));
 const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 for(const route of ["/api/gis-history","/api/gis-history/data","/api/gis-history.css","/api/gis-history.js"])
  assert.ok(index.includes(route));
 assert.match(index,/if\(user\.role!=="admin"\|\|user\.active!==1\)return error\(403/);
 assert.doesNotMatch(GIS_HISTORY_JS,/operational_report_events|\/api\/raw-documents\/|\/api\/gis\/stations|\/api\/gis\/uav/);
});
test("history routes remain behind existing Access gate",async()=>{
 const response=await worker.fetch(new Request("https://example.invalid/api/gis-history"),{});
 assert.equal(response.status,503);
 assert.ok(!(await response.text()).includes("Історія записів і дій"));
});
