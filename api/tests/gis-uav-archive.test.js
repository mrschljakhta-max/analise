import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {readFileSync} from "node:fs";
import {uavArchiveCutoff,parseUavArchiveRange,ARCHIVE_SQL,archivedUavSummary} from "../src/gis-uav-archive-api.js";
import {GIS_UAV_ARCHIVE_HTML,GIS_UAV_ARCHIVE_CSS,GIS_UAV_ARCHIVE_JS} from "../src/gis-uav-archive-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
import {GIS_HISTORY_HTML} from "../src/gis-history-assets.js";
import worker from "../src/index.js";

const actor={role:"admin",active:1,id:"test-admin"};
const now=Date.UTC(2026,9,18);
const url="https://example.invalid/api/gis-uav-archive/data?year=2026";
const exampleRows=[
 {quarter:1,category:"fpv",n:35},
 {quarter:1,category:"wing",n:19},
 {quarter:1,category:"multirotor",n:23},
 {quarter:2,category:"fpv",n:24},
 {quarter:2,category:"wing",n:1}
];

test("historical archive cutoff removes recent 90 days and incomplete quarters",()=>{
 const gate=uavArchiveCutoff(now);
 assert.deepEqual(gate,{exclusiveBefore:"2026-07-01",lastYear:2026,lastQuarter:2,
  lagDays:90,minimumCell:20});
 const selection=parseUavArchiveRange(url,now);
 assert.deepEqual({
  year:selection.year,from:selection.from,exclusiveTo:selection.exclusiveTo,
  eligibleQuarters:selection.eligibleQuarters
 },{year:2026,from:"2026-01-01",exclusiveTo:"2026-07-01",eligibleQuarters:2});
 const previous=parseUavArchiveRange("https://example.invalid/?year=2025",now);
 assert.equal(previous.eligibleQuarters,4);
 assert.equal(previous.exclusiveTo,"2026-01-01");
});
test("archive time boundary in Q1 only permits the preceding calendar year",()=>{
 const nowQ1=Date.UTC(2026,2,1);
 const gate=uavArchiveCutoff(nowQ1);
 assert.equal(gate.lastYear,2025);
 assert.equal(gate.exclusiveBefore,"2025-10-01");
 const p=parseUavArchiveRange("https://example.invalid/?year=2025",nowQ1);
 assert.equal(p.exclusiveTo,"2025-10-01");
 assert.equal(p.eligibleQuarters,3);
});
test("archive API rejects granular timestamps, months and invalid query shape",async()=>{
 const bad=[
  "year=2026&month=1","year=2026&region=Kharkiv",
  "year=2026&year=2025","year=2026-01","year=2027",
  "year=2026&unit=example","year=2026&q=1","year=2026&lat=49",
  "year=2026&uav_type=fpv","year=","from=2025-01-01&to=2026-01-01"
 ];
 const env={DB:{prepare(){throw Error("query should not run")}}};
 for(const q of bad){
  const res=await archivedUavSummary(new Request("https://example.invalid/?"+q),env,actor,now);
  assert.equal(res.status,400,q);
 }
});
test("only active admin and read-only GET may reach D1",async()=>{
 let calls=0;
 const env={DB:{prepare(){calls++;throw Error("unexpected call")}}};
 for(const user of [null,{role:"duty",active:1},{role:"admin",active:0}]){
  const res=await archivedUavSummary(new Request(url),env,user,now);
  assert.equal(res.status,403);
 }
 const post=await archivedUavSummary(new Request(url,{method:"POST"}),env,actor,now);
 assert.equal(post.status,405);
 assert.equal(calls,0);
});
test("SQL selects only class/category and quarterly counts from committed PBD records",()=>{
 assert.match(ARCHIVE_SQL,/FROM operational_report_events AS e/);
 assert.match(ARCHIVE_SQL,/JOIN operational_report_sessions AS s/);
 assert.match(ARCHIVE_SQL,/e\.source_type='pbd_word'/);
 assert.match(ARCHIVE_SQL,/s\.status='committed'/);
 assert.match(ARCHIVE_SQL,/day>=\? AND day<\?/);
 assert.match(ARCHIVE_SQL,/GROUP BY quarter,category/);
 assert.doesNotMatch(ARCHIVE_SQL,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
 assert.doesNotMatch(ARCHIVE_SQL,/\b(?:mgrs|lat|lon|latitude|longitude|station_name|unit_name|raw_json|frequencies|settlement_name|detection_settlement|result_text)\b/i);
});
test("only threshold-cleared quarterly cells are exposed, small groups are not counted",async()=>{
 let sql="",params=[];
 const env={DB:{prepare(query){sql=query;return{bind(...args){params=args;return{async all(){
  return {results:exampleRows};
 }}}}}}};
 const res=await archivedUavSummary(new Request(url),env,actor,now);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.schema,"ANALISE_ARCHIVED_UAV_AGGREGATE_V1");
 assert.equal(data.read_only,true);
 assert.equal(data.state,"aggregates_available");
 assert.deepEqual(params,["2026-01-01","2026-07-01"]);
 assert.equal(sql,ARCHIVE_SQL);
 assert.equal(data.quarters.length,2);
 assert.deepEqual(data.quarters[0].categories.map(x=>x.count),[35,null,23,null]);
 assert.deepEqual(data.quarters[1].categories.map(x=>x.count),[24,null,null,null]);
 const serialized=JSON.stringify(data);
 assert.doesNotMatch(serialized,/latitude|longitude|\bmgrs\b|station_name|unit_name|frequency|source_label|actor_id/i);
 assert.equal(data.privacy.no_coordinates,true);
 assert.equal(data.privacy.no_regions,true);
 assert.equal(data.privacy.no_event_records,true);
});
test("small and empty groups yield no published aggregates, never fabricated values",async()=>{
 const env={DB:{prepare(){return {bind(){return{async all(){
  return {results:[{quarter:1,category:"fpv",n:19},{quarter:3,category:"fpv",n:100}]};
 }}}}}}};
 const res=await archivedUavSummary(new Request(url),env,actor,now);
 const data=await res.json();
 assert.equal(data.state,"no_public_aggregate");
 assert.equal(data.quarters.length,2);
 assert.ok(data.quarters.every(q=>q.categories.every(x=>x.count===null)));
});
test("D1 error returns 503 instead of hiding query failure as no activity",async()=>{
 const env={DB:{prepare(){throw Error("secret query or table details")}}};
 const res=await archivedUavSummary(new Request(url),env,actor,now);
 assert.equal(res.status,503);
 const body=await res.text();
 assert.doesNotMatch(body,/secret query|table details/);
 assert.match(body,/джерел|міграц/);
});
test("browser dashboard compiles, renders only aggregated data, and exports pre-filtered CSV",()=>{
 assert.doesNotThrow(()=>new Script(GIS_UAV_ARCHIVE_JS));
 for(const field of ["ua-year","ua-category","ua-load","ua-csv","ua-chart","ua-table","ua-status","ua-provenance"])
  assert.ok(GIS_UAV_ARCHIVE_HTML.includes('id="'+field+'"'),field);
 assert.ok(GIS_UAV_ARCHIVE_JS.includes("/api/gis-uav-archive/data?year="));
 assert.ok(GIS_UAV_ARCHIVE_JS.includes("new Blob"));
 assert.ok(GIS_UAV_ARCHIVE_JS.includes("text/csv;charset=utf-8"));
 assert.ok(GIS_UAV_ARCHIVE_JS.includes("latest.quarters.map"));
 assert.ok(!GIS_UAV_ARCHIVE_JS.includes("operational_report_events"));
 assert.doesNotMatch(GIS_UAV_ARCHIVE_JS,/\/api\/(?:raw-documents|operational-reports|uav-catalog\/card)/);
 assert.doesNotMatch(GIS_UAV_ARCHIVE_JS,/\b(?:lat|lon|mgrs|station|unit_name|time_from|time_to)\b/i);
 assert.ok(GIS_UAV_ARCHIVE_CSS.includes("@media(max-width:"));
 assert.ok(GIS_PREVIEW_HTML.includes('href="/api/gis-uav-archive"'));
 assert.ok(GIS_HISTORY_HTML.includes('href="/api/gis-uav-archive"'));
});
test("archive page uses established Access and admin restrictions",async()=>{
 const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
 for(const route of ["/api/gis-uav-archive","/api/gis-uav-archive/data",
  "/api/gis-uav-archive.css","/api/gis-uav-archive.js"])
  assert.ok(index.includes(route));
 assert.ok(index.includes('user.role!=="admin"||user.active!==1'));
 const res=await worker.fetch(new Request("https://example.invalid/api/gis-uav-archive"),{});
 assert.equal(res.status,503);
 assert.ok(!(await res.text()).includes("Історичні записи БпЛА"));
});
