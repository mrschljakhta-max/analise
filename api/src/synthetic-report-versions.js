// Isolated synthetic-only report versions; no operational document ingestion.
import {verifiedSyntheticSnapshot} from "./synthetic-upload-history-api.js";

const headers={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
"x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'"};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso=/^\d{4}-\d{2}-\d{2}$/;
const safeDate=d=>typeof d==="string"&&iso.test(d)&&!Number.isNaN(Date.parse(d+"T00:00:00Z"))&&
 new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d;
function dateOf(doc){
 const value=doc.report_date;
 if(!safeDate(value)||value!=="2026-10-11")throw Error("Недозволена дата синтетичного документа");
 return value;
}
const hex=buffer=>[...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,"0")).join("");
const fingerprint=async doc=>hex(await crypto.subtle.digest("SHA-256",
 new TextEncoder().encode(JSON.stringify({
  kind:doc.type,report_date:dateOf(doc),
  values:doc.detail.map(x=>({row:x.row,label:x.label,...(doc.type==="docx"?{date_time:x.date_time}: {})}))
 }))));
export async function syntheticVersionsReady(DB){
 return Boolean(await DB.prepare(
  "SELECT name FROM sqlite_master WHERE type='trigger' AND name='demo_revision_publish' LIMIT 1"
 ).first());
}
export async function inspectSyntheticVersions(DB,docs){
 if(!await syntheticVersionsReady(DB))throw Error("Застосуй міграцію D1 0016");
 const result=[],seen=new Set();
 for(let index=0;index<docs.length;index++){
  const doc=docs[index];
  if(doc.type==="unsupported"){result.push({index,kind:"unsupported",change:"skipped"});continue}
  if(!["docx","xlsx"].includes(doc.type))throw Error("Непідтримуваний тестовий формат");
  const report_date=dateOf(doc),key=doc.type+":"+report_date;
  if(seen.has(key))throw Error("В одному пакеті два документи одного виду за ту саму звітну дату");
  seen.add(key);
  const active=await DB.prepare(
   "SELECT a.version_id,v.revision,v.content_sha256 "+
   "FROM demo_report_active a JOIN demo_report_versions v ON v.id=a.version_id "+
   "WHERE a.kind=? AND a.report_date=? LIMIT 1"
  ).bind(doc.type,report_date).first();
  const sha256=await fingerprint(doc);
  result.push({index,kind:doc.type,report_date,
    change:!active?"new":active.content_sha256===sha256?"same":"replacement",
    current_revision:active?.revision||0,
    expected_version_id:active?.version_id||"",
    sha256});
 }
 return result;
}
export function assertVersionApproval(plans,claimed){
 if(!Array.isArray(claimed)||claimed.length!==plans.filter(x=>x.kind!=="unsupported").length)
  throw Error("Потрібна попередня перевірка версій");
 const accepted=new Map();
 for(const item of claimed){
  if(!item||!["docx","xlsx"].includes(item.kind)||!safeDate(item.report_date)||
     typeof item.expected_version_id!=="string"||
     (item.expected_version_id!==""&&!uuid.test(item.expected_version_id)))
   throw Error("Некоректне підтвердження версії");
  const key=item.kind+":"+item.report_date;
  if(accepted.has(key))throw Error("Повторне підтвердження");
  accepted.set(key,item.expected_version_id);
 }
 for(const plan of plans.filter(x=>x.kind!=="unsupported")){
  if(!accepted.has(plan.kind+":"+plan.report_date)||
      accepted.get(plan.kind+":"+plan.report_date)!==plan.expected_version_id)
   throw Error("Версія змінилася. Повтори попередню перевірку");
 }
}
export function versionMutations(DB,{plans,sessionId,actorId,inputSha256}){
 const statements=[],linked=[];
 for(const p of plans){
  if(p.kind==="unsupported")continue;
  const versionId=p.change==="same"?p.expected_version_id:crypto.randomUUID();
  if(p.change!=="same"){
   statements.push(DB.prepare(
    "INSERT INTO demo_report_versions "+
    "(id,kind,report_date,revision,content_sha256,source_name,snapshot_json,session_id,previous_version_id,actor_id) "+
    "VALUES (?,?,?,?,?,?,?,?,?,?)"
   ).bind(versionId,p.kind,p.report_date,p.current_revision+1,p.sha256,
    p.name,p.snapshot_json,sessionId,p.expected_version_id||null,actorId));
  }
  // Trigger checks optimistic CAS and changes the active pointer atomically.
  statements.push(DB.prepare(
   "INSERT OR IGNORE INTO demo_report_version_events "+
   "(id,session_id,kind,report_date,event_type,version_id,expected_previous_id,actor_id) "+
   "VALUES (?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(),sessionId,p.kind,p.report_date,
   p.change==="same"?"reused":"published",versionId,p.expected_version_id||null,actorId));
  statements.push(DB.prepare(
   "UPDATE demo_import_documents SET version_id=? "+
   "WHERE session_id=? AND input_sha256=? AND member_index=? AND version_id IS NULL"
  ).bind(versionId,sessionId,inputSha256,p.index));
  linked.push({kind:p.kind,report_date:p.report_date,revision:p.change==="same"?p.current_revision:p.current_revision+1,
   change:p.change,version_id:versionId});
 }
 return {statements,linked};
}
export function withSnapshotPlans(plans,docs){
 return plans.map(p=>p.kind==="unsupported"?p:{
  ...p,name:String(docs[p.index].name).slice(0,160),
  snapshot_json:verifiedSyntheticSnapshot(docs[p.index])
 });
}
export async function syntheticVersionsApi(req,env,user,segments){
 if(!user||user.role!=="admin"||user.active!==1)return reply({error:"Лише адміністратор"},403);
 if(req.method!=="GET")return reply({error:"Дозволено лише GET"},405);
 if(!env.DB)return reply({error:"D1 недоступна"},503);
 try{
  if(!await syntheticVersionsReady(env.DB))return reply({error:"Застосуй міграцію D1 0016"},503);
  const id=segments[3];
  if(id){
   if(!uuid.test(id))return reply({error:"Некоректний ідентифікатор"},400);
   const version=await env.DB.prepare(
    "SELECT v.id,v.kind,v.report_date,v.revision,v.source_name,v.created_at,v.actor_id,"+
    "v.previous_version_id,v.snapshot_json,a.version_id AS active_id "+
    "FROM demo_report_versions v LEFT JOIN demo_report_active a "+
    "ON a.kind=v.kind AND a.report_date=v.report_date WHERE v.id=? LIMIT 1"
   ).bind(id).first();
   if(!version)return reply({error:"Версію не знайдено"},404);
   const detail=JSON.parse(version.snapshot_json);
   return reply({version:{id:version.id,kind:version.kind,report_date:version.report_date,
    revision:version.revision,source_name:version.source_name,created_at:version.created_at,
    actor_id:version.actor_id,previous_version_id:version.previous_version_id,
    active:version.active_id===version.id},document:detail});
  }
  const params=new URL(req.url).searchParams;
  const date=params.get("date")||"",kind=params.get("kind")||"";
  if(date&&!safeDate(date))return reply({error:"Некоректна звітна дата"},400);
  if(kind&&!["docx","xlsx"].includes(kind))return reply({error:"Некоректний формат"},400);
  const offset=Number(params.get("offset")||0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return reply({error:"Некоректна сторінка"},400);
  const rows=await env.DB.prepare(
   "SELECT v.id,v.kind,v.report_date,v.revision,v.source_name,v.created_at,v.actor_id,"+
   "v.previous_version_id,(a.version_id=v.id) AS active "+
   "FROM demo_report_versions v JOIN demo_report_active a "+
   "ON a.kind=v.kind AND a.report_date=v.report_date "+
   "WHERE (?='' OR v.report_date=?) AND (?='' OR v.kind=?) "+
   "ORDER BY v.report_date DESC,v.kind ASC,v.revision DESC LIMIT 31 OFFSET ?"
  ).bind(date,date,kind,kind,offset).all();
  const versions=rows.results||[];
  return reply({versions:versions.slice(0,30),has_more:versions.length>30,offset});
 }catch{
  return reply({error:"Не вдалося отримати реєстр версій"},503);
 }
}
