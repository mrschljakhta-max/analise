import {isVisibleReference} from "./gis-reference-visibility.js";
// Read-only, admin-only reference data for the GIS side panel.
// This endpoint never selects positions, UAV events, station call signs,
// unit affiliations, frequencies, MGRS, routes or other operational fields.
const HEADERS={
 "content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store",
 "x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const MAX_UAV_NAMES=100;
const finiteCount=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const safeName=value=>typeof value==="string"?value.trim().slice(0,160):"";
const uavClass=(frame,subtype)=>frame==="wing"?"Крило":
  subtype==="fpv"?"FPV":frame==="multirotor"?"Мультироторний":"Інше";
const vpClass=kind=>kind==="vp"?"ВП":kind==="sp"?"СП":"Інше";
function failure(error){
 // Do not leak schema, queries or row values via the endpoint.
 return {status:/no such table/i.test(String(error?.message||error))?"schema_missing":"query_failed"};
}
function ensureCount(value){
 const n=finiteCount(value);
 if(n===null)throw Error("Некоректний агрегований результат D1");
 return n;
}
function summarized(groups,allowedOrder){
 const map=new Map();
 for(const x of groups){
  const name=x.name;
  if(!map.has(name))map.set(name,{name,total:0,active:0});
  const agg=map.get(name);
  agg.total+=ensureCount(x.total);
  agg.active+=ensureCount(x.active);
  if(agg.active>agg.total)throw Error("Несумісний підсумок D1");
 }
 return [...map.values()].sort((a,b)=>{
  const aa=allowedOrder.indexOf(a.name),bb=allowedOrder.indexOf(b.name);
  return (aa<0?999:aa)-(bb<0?999:bb)||a.name.localeCompare(b.name,"uk");
 });
}
async function models(DB){
 const rows=await DB.prepare(
  "SELECT airframe,subtype,is_active,COUNT(*) AS count "+
  "FROM uav_models GROUP BY airframe,subtype,is_active LIMIT 401"
 ).all();
 if((rows.results||[]).length>=401)throw Error("Некоректна кількість категорій");
 const grouped=summarized((rows.results||[]).map(r=>({
  name:uavClass(r.airframe,r.subtype),total:r.count,
  active:Number(r.is_active)===1?r.count:0
 })),["Крило","Мультироторний","FPV","Інше"]);
 const items=await DB.prepare(
  "SELECT name,airframe,subtype FROM uav_models "+
  "WHERE is_active=1 ORDER BY name COLLATE NOCASE LIMIT 101"
 ).all();
 const list=(items.results||[]).slice(0,MAX_UAV_NAMES)
  .map(r=>({name:safeName(r.name),category:uavClass(r.airframe,r.subtype)}))
  .filter(r=>r.name);
 return {status:"available",source:"uav_models",
  total:grouped.reduce((a,x)=>a+x.total,0),
  active:grouped.reduce((a,x)=>a+x.active,0),
  categories:grouped,items:list,
  truncated:(items.results||[]).length>MAX_UAV_NAMES};
}
async function positions(DB){
 // Deliberately do not read individual VP/SP names, codes or locations.
 const rows=await DB.prepare(
  "SELECT kind,is_active,COUNT(*) AS count FROM vp_sp_objects "+
  "GROUP BY kind,is_active"
 ).all();
 const categories=summarized((rows.results||[]).map(r=>({
  name:vpClass(r.kind),total:r.count,
  active:Number(r.is_active)===1?r.count:0
 })),["ВП","СП","Інше"]);
 return {status:"available",source:"vp_sp_objects",
  total:categories.reduce((a,x)=>a+x.total,0),
  active:categories.reduce((a,x)=>a+x.active,0),categories};
}
async function stations(DB){
 // Only the generic equipment class and aggregate counts; never an
 // individual asset, station call sign, organisation, or technical parameter.
 const rows=await DB.prepare(
  "SELECT st.name AS kind,COUNT(*) AS total,"+
  "SUM(CASE WHEN s.is_active=1 THEN 1 ELSE 0 END) AS active "+
  "FROM stations s JOIN station_types st ON st.id=s.station_type_id "+
  "GROUP BY st.name ORDER BY st.name COLLATE NOCASE LIMIT 501"
 ).all();
 if((rows.results||[]).length>500)throw Error("Завеликий перелік типів");
 const categories=summarized((rows.results||[]).map(r=>({
  name:safeName(r.kind)||"Не вказано",total:r.total,active:r.active
 })),[]);
 return {status:"available",source:"stations + station_types",
  total:categories.reduce((a,x)=>a+x.total,0),
  active:categories.reduce((a,x)=>a+x.active,0),categories};
}
export async function gisReferenceSummaryApi(req,env,user){
 if(req.method!=="GET")return respond({error:"Дозволено лише GET"},405);
 if(user?.role!=="admin"||user.active!==1)return respond({error:"Лише адміністратор"},403);
 if(new URL(req.url).search)return respond({error:"Непідтримувані параметри"},400);
 if(!env?.DB)return respond({error:"D1 недоступна",overall_status:"database_unavailable"},503);
 const sources={};
 const readers=[["uav",models],["vp",positions],["station",stations]];
 let enabled=0,available=0;
 for(const [key,fn] of readers){
  if(!isVisibleReference(key)){sources[key]={status:"disabled"};continue}
  enabled++;
  try{sources[key]=await fn(env.DB)}catch(e){sources[key]=failure(e)}
  if(sources[key].status==="available")available++;
 }
 return respond({read_only:true,geographic:false,
  overall_status:enabled===0?"disabled":available===enabled?"available":
   available===0?"unavailable":"partial",
  sources});
}
