// Read-only, heavily aggregated historical UAV class statistics.
// No coordinates, event records, named platforms, recent quarters or units leave D1.
const HEADERS={
 "content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const MIN_CELL=20,LAG_DAYS=90,DAY_MS=86400000;
const KEYS=["fpv","wing","multirotor","other"];
const LABELS={fpv:"FPV",wing:"Крило",multirotor:"Мультироторні",other:"Без визначеного класу"};
export function uavArchiveCutoff(now=Date.now()){
 const lagged=new Date(now-LAG_DAYS*DAY_MS);
 const firstMonthOfQuarter=Math.floor(lagged.getUTCMonth()/3)*3;
 const cutoff=new Date(Date.UTC(lagged.getUTCFullYear(),firstMonthOfQuarter,1));
 const year=cutoff.getUTCFullYear(),index=firstMonthOfQuarter/3;
 return {exclusiveBefore:cutoff.toISOString().slice(0,10),
  lastYear:index===0?year-1:year,lastQuarter:index===0?4:index,
  lagDays:LAG_DAYS,minimumCell:MIN_CELL};
}
export function parseUavArchiveRange(uri,now=Date.now()){
 const q=new URL(uri).searchParams;
 if([...q.keys()].some(key=>key!=="year")||q.getAll("year").length!==1)
  throw Error("Обери лише календарний рік");
 const text=q.get("year");
 if(!/^[0-9]{4}$/.test(text||""))throw Error("Некоректний рік");
 const year=Number(text),gate=uavArchiveCutoff(now);
 if(year<2018||year>gate.lastYear)throw Error("Для цього року немає завершеного архівного періоду");
 return {year,from:year+"-01-01",exclusiveTo:year===gate.lastYear?
  gate.exclusiveBefore:(year+1)+"-01-01",
  eligibleQuarters:year===gate.lastYear?gate.lastQuarter:4,gate};
}
const EVENT_DATE=["CASE",
 "WHEN e.event_datetime GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'",
 "THEN substr(e.event_datetime,1,10)",
 "WHEN e.event_datetime GLOB '[0-9][0-9].[0-9][0-9].[0-9][0-9][0-9][0-9]*'",
 "THEN substr(e.event_datetime,7,4)||'-'||substr(e.event_datetime,4,2)||'-'||substr(e.event_datetime,1,2)",
 "ELSE NULL END"].join(" ");
const UAV_CLASS=["CASE",
 "WHEN instr(lower(coalesce(e.uav_type,'')),'fpv')>0",
 " OR instr(coalesce(e.uav_type,''),'ФПВ')>0",
 " OR instr(coalesce(e.uav_type,''),'фпв')>0 THEN 'fpv'",
 "WHEN instr(lower(coalesce(e.uav_type,'')),'wing')>0",
 " OR instr(coalesce(e.uav_type,''),'Крило')>0",
 " OR instr(coalesce(e.uav_type,''),'крило')>0",
 " OR instr(coalesce(e.uav_type,''),'Літак')>0",
 " OR instr(coalesce(e.uav_type,''),'літак')>0 THEN 'wing'",
 "WHEN instr(lower(coalesce(e.uav_type,'')),'multirotor')>0",
 " OR instr(coalesce(e.uav_type,''),'Мультиротор')>0",
 " OR instr(coalesce(e.uav_type,''),'мультиротор')>0",
 " OR instr(coalesce(e.uav_type,''),'Квадро')>0",
 " OR instr(coalesce(e.uav_type,''),'квадро')>0 THEN 'multirotor'",
 "ELSE 'other' END"].join(" ");
export const ARCHIVE_SQL="WITH filtered AS ("+
 "SELECT "+EVENT_DATE+" AS day, "+UAV_CLASS+" AS category "+
 "FROM operational_report_events AS e "+
 "JOIN operational_report_sessions AS s ON s.id=e.session_id "+
 "WHERE e.source_type='pbd_word' AND s.status='committed'"+
 "), eligible AS ("+
 "SELECT CAST(substr(day,6,2) AS INTEGER) AS month_num,category "+
 "FROM filtered WHERE day>=? AND day<? AND day IS NOT NULL AND julianday(day) IS NOT NULL"+
 "), quartered AS ("+
 "SELECT CAST((month_num-1)/3 AS INTEGER)+1 AS quarter,category "+
 "FROM eligible WHERE month_num BETWEEN 1 AND 12"+
 ") SELECT quarter,category,COUNT(*) AS n "+
 "FROM quartered GROUP BY quarter,category ORDER BY quarter,category";
// Separate the working RAW archive from a possibly absent structured-event schema.
export const ARCHIVE_SOURCE_SQL="SELECT name FROM sqlite_master WHERE type='table' "+
 "AND name IN ('operational_report_events','operational_report_sessions','report_versions','d1_migrations')";
export const ARCHIVE_RAW_SQL="SELECT COUNT(*) AS versions, "+
 "COALESCE(SUM(CAST(json_extract(snapshot_json,'$.record_count') AS INTEGER)),0) AS rows_saved "+
 "FROM report_versions WHERE report_name GLOB 'ANALISE-RAW-V1:*' "+
 "AND substr(created_at,1,4)=?";
// Table-valued SQLite PRAGMA is queried via SELECT, with a bound table name.
// Only approved column names are inspected; no data rows or raw documents are read.
export const ARCHIVE_COLUMNS_SQL="SELECT name FROM pragma_table_info(?)";
export const ARCHIVE_MIGRATION_SQL="SELECT COUNT(*) AS applied FROM d1_migrations WHERE name=?";
const REQUIRED_COLUMNS={
 operational_report_events:["session_id","source_type","event_datetime","uav_type"],
 operational_report_sessions:["id","status"],
 report_versions:["report_name","snapshot_json","created_at"]
};
async function missingColumns(db,table){
 const result=await db.prepare(ARCHIVE_COLUMNS_SQL).bind(table).all();
 const names=new Set((result.results||[]).map(row=>row.name));
 return REQUIRED_COLUMNS[table].filter(name=>!names.has(name));
}
async function archiveSources(db,year){
 const snapshot=await db.prepare(ARCHIVE_SOURCE_SQL).all();
 const existing=new Set((snapshot.results||[]).map(row=>row.name));
 const structuredPresent=existing.has("operational_report_events")&&
  existing.has("operational_report_sessions");
 const missing=[];
 let columnCheckFailed=false;
 for(const table of ["operational_report_events","operational_report_sessions"]){
  if(!existing.has(table))continue;
  try{for(const column of await missingColumns(db,table))missing.push(table+"."+column)}
  catch{columnCheckFailed=true}
 }
 let raw={status:existing.has("report_versions")?"unreadable":"missing",upload_year:year};
 if(existing.has("report_versions")){
  try{
   const rawMissing=await missingColumns(db,"report_versions");
   if(rawMissing.length)raw={status:"schema_incompatible",upload_year:year};
   else{
    const row=await db.prepare(ARCHIVE_RAW_SQL).bind(String(year)).first();
    raw={status:"available",upload_year:year,
     versions:Math.max(0,Number(row?.versions)||0),
     rows_saved:Math.max(0,Number(row?.rows_saved)||0)};
   }
  }catch{raw={status:"unreadable",upload_year:year}}
 }
 let ledger="absent";
 if(existing.has("d1_migrations")){
  try{
   const row=await db.prepare(ARCHIVE_MIGRATION_SQL).bind("0018_operational_reports.sql").first();
   ledger=Number(row?.applied)>0?"registered":"not_registered";
  }catch{ledger="unreadable"}
 }
 const structuredState=!structuredPresent?"missing":columnCheckFailed?"unverified":
  missing.length?"incompatible":"present";
 const ledgerDiscrepancy=ledger==="registered"&&structuredState!=="present" ||
  ledger==="not_registered"&&structuredState==="present";
 return {structured_tables:structuredState,raw,
  schema_diagnostics:{missing_columns:missing,ledger_0018:ledger,
   ledger_discrepancy:ledgerDiscrepancy}};
}
function blankQuarters(period){
 return Array.from({length:period.eligibleQuarters},(_,index)=>({
  quarter:index+1,label:period.year+" · Q"+(index+1),
  categories:KEYS.map(key=>({category:key,label:LABELS[key],count:null}))
 }));
}
function diagnosticsResponse(period,sources,sourceStatus,status=200){
 return send({schema:"ANALISE_ARCHIVED_UAV_AGGREGATE_V1",
  source:"operational_report_events (pbd_word, committed sessions)",
  period:{year:period.year,eligible_quarters:period.eligibleQuarters},
  eligibility:{full_quarters_only:true,minimum_lag_days:LAG_DAYS,
   exclusive_before:period.gate.exclusiveBefore,minimum_visible_category_count:MIN_CELL},
  privacy:{no_coordinates:true,no_regions:true,no_units:true,no_station_data:true,
   no_event_records:true,no_precise_times:true},
  read_only:true,source_status:sourceStatus,raw_archive:sources.raw,
  schema_diagnostics:sources.schema_diagnostics,
  state:"source_unavailable",quarters:blankQuarters(period),
  error:status===503?sourceStatus==="schema_incompatible"?
   "Схема структурованих таблиць не відповідає API":
   sourceStatus==="schema_check_failed"?"Не вдалося перевірити колонки D1":
   "Не вдалося виконати структурований запит D1":undefined
 },status);
}
export async function archivedUavSummary(req,env,user,now=Date.now()){
 if(req.method!=="GET")return send({error:"Дозволено лише GET"},405);
 if(!user||user.role!=="admin"||user.active!==1)
  return send({error:"Доступ лише адміністратору"},403);
 let period;
 try{period=parseUavArchiveRange(req.url,now)}
 catch(e){return send({error:e.message,cutoff:uavArchiveCutoff(now)},400)}
 if(!env?.DB)return send({error:"Cloudflare D1 не підключено",source_status:"unavailable"},503);
 let sources;
 try{sources=await archiveSources(env.DB,period.year)}
 catch{return send({error:"Не вдалося перевірити структуру D1",source_status:"database_unavailable"},503)}
 if(sources.structured_tables==="missing")
  return diagnosticsResponse(period,sources,"schema_missing");
 if(sources.structured_tables==="incompatible")
  return diagnosticsResponse(period,sources,"schema_incompatible",503);
 if(sources.structured_tables==="unverified")
  return diagnosticsResponse(period,sources,"schema_check_failed",503);
 let result;
 try{result=await env.DB.prepare(ARCHIVE_SQL).bind(period.from,period.exclusiveTo).all()}
 catch{
  // Report the stage, never claim a missing migration without validating it.
  return diagnosticsResponse(period,sources,"structured_query_failed",503);
 }
 const byQuarter=new Map();
 for(const row of result.results||[]){
  const q=Number(row.quarter),key=String(row.category||""),n=Number(row.n);
  if(!Number.isSafeInteger(q)||q<1||q>period.eligibleQuarters||
   !KEYS.includes(key)||!Number.isSafeInteger(n)||n<0)continue;
  const columns=byQuarter.get(q)||new Map();
  columns.set(key,n);byQuarter.set(q,columns);
 }
 const quarters=[];
 for(let q=1;q<=period.eligibleQuarters;q++){
  const columns=byQuarter.get(q)||new Map();
  quarters.push({quarter:q,label:period.year+" · Q"+q,
   categories:KEYS.map(key=>({category:key,label:LABELS[key],
    count:typeof columns.get(key)==="number"&&columns.get(key)>=MIN_CELL?columns.get(key):null}))});
 }
 return send({schema:"ANALISE_ARCHIVED_UAV_AGGREGATE_V1",
  source:"operational_report_events (pbd_word, committed sessions)",
  period:{year:period.year,eligible_quarters:period.eligibleQuarters},
  eligibility:{full_quarters_only:true,minimum_lag_days:LAG_DAYS,
   exclusive_before:period.gate.exclusiveBefore,
   minimum_visible_category_count:MIN_CELL},
  privacy:{no_coordinates:true,no_regions:true,no_units:true,no_station_data:true,
   no_event_records:true,no_precise_times:true},
  read_only:true,source_status:"structured_available",raw_archive:sources.raw,
  schema_diagnostics:sources.schema_diagnostics,
  state:quarters.some(q=>q.categories.some(c=>c.count!==null))?
   "aggregates_available":"no_public_aggregate",quarters});
}
