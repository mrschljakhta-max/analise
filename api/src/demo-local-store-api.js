// ANALISE strictly synthetic local-review persistence.
// Reuses generic report_versions from migration 0001; never handles uploaded source files,
// operational data or arbitrary document cells. No new migrations.
import {normalizeReviewValue} from "./purgatory-api.js";

const PREFIX="ANALISE-DEMO-LOCAL-V1:";
const DIRECTORY="demo_quality_labels";
const KNOWN=new Map([["альфа-демо","demo_quality_alpha_v1"],["бета-демо","demo_quality_beta_v1"]]);
const LABELS=new Set(["альфа-демо","бета-демо","альфа деммo","бетта-демо","невідоме",""]);
const TARGET_NAMES=new Map([["demo_quality_alpha_v1","Альфа-демо"],["demo_quality_beta_v1","Бета-демо"]]);
const REASONS=new Set(["Підтверджено за тестовим довідником","Виключено з тесту",
 "Уточнено після перегляду","Скасувати останнє підтвердження"]);
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const fail=(message,status=400)=>reply({error:message},status);
const invalid=msg=>{throw Error(msg)};
const only=(obj,allowed)=>{
 if(!obj||typeof obj!=="object"||Array.isArray(obj)||Object.keys(obj).some(k=>!allowed.includes(k)))
  invalid("Непідтримувані поля збереження");
};
const txt=(v,n)=>typeof v==="string"&&v.length<=n?v:null;
const iso=(v)=>typeof v==="string"&&v.length<=35&&Number.isFinite(Date.parse(v))&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v);
function compareState(a,b){
 return a.status===b?.status&&a.target_id===(b.target_id??null);
}
export function validateDemoReview(input){
 only(input,["format","review"]);
 if(!["docx","xlsx"].includes(input.format))invalid("Потрібен формат DOCX або XLSX");
 const r=input.review;only(r,["schema_version","directory_id","persisted_in_d1",
  "created_at","summary","decisions","history"]);
 if(r.schema_version!=="ANALISE_LOCAL_REVIEW_V1"||r.directory_id!==DIRECTORY||
  r.persisted_in_d1!==false||!Array.isArray(r.decisions)||!Array.isArray(r.history)||
  r.decisions.length<1||r.decisions.length>100||r.history.length>75)
  invalid("Дозволені лише локальні синтетичні результати до 100 рядків");
 const entries=[], keys=new Set();
 for(let i=0;i<r.decisions.length;i++){
  const e=r.decisions[i];
  only(e,["id","sheet","table_index","source_row","field","original_value",
   "detected_status","status","target_id","target_name"]);
  if(e.id!==String(i+1)||typeof e.original_value!=="string"||
    e.original_value.length>64||typeof e.sheet!=="string"||
    !/^(?:Таблиця|Аркуш) [1-9]\d?$/.test(e.sheet)||
    !(e.source_row===null||(Number.isSafeInteger(e.source_row)&&e.source_row>=1&&e.source_row<=100))||
    !(e.field===null||e.field==="value_2"||/^[A-Z]{1,2}$/.test(e.field||""))||
    !["matched","missing","ambiguous","empty","ambiguous_mapping"].includes(e.detected_status)||
    !["matched","pending","mapped","ignored","needs_mapping"].includes(e.status)||
    !LABELS.has(normalizeReviewValue(e.original_value)))
    invalid("Рядок не належить до дозволеного синтетичного набору");
  const key=[e.sheet,e.source_row,e.field].join(":");
  if(keys.has(key))invalid("Дубльований рядок або поле"); keys.add(key);
  const normalized=normalizeReviewValue(e.original_value);
  if(e.detected_status==="matched"&&!KNOWN.has(normalized))
   invalid("Неправильний початковий збіг");
  if(e.detected_status==="empty"&&normalized!=="")
   invalid("Неправильне порожнє значення");
  if(e.detected_status==="ambiguous_mapping"&&(e.source_row!==null||e.field!==null))
   invalid("Неоднозначне поле не може мати номер рядка");
  if(e.detected_status==="matched"&&e.target_id!==KNOWN.get(normalized))
   invalid("Збіг з довідником не підтверджено");
  const initial=e.detected_status==="matched"
   ?{status:"matched",target_id:KNOWN.get(normalized)}:
   e.detected_status==="ambiguous_mapping"
   ?{status:"needs_mapping",target_id:null}:{status:"pending",target_id:null};
  entries.push({id:e.id,sheet:e.sheet,source_row:e.source_row,field:e.field,
   original_value:e.original_value,detected_status:e.detected_status,
   final_status:e.status,final_target_id:e.target_id??null,final_target_name:e.target_name??null,initial});
 }
 const state=new Map(entries.map(e=>[e.id,{...e.initial}]));
 const events=[];
 for(let i=0;i<r.history.length;i++){
  const ev=r.history[i];
  only(ev,["id","action","entry_id","at","reason","previous","next","reverts"]);
  if(ev.id!==i+1||!["map","ignore","undo"].includes(ev.action)||
    typeof ev.entry_id!=="string"||!state.has(ev.entry_id)||
    !REASONS.has(ev.reason)||!iso(ev.at))
   invalid("Некоректна подія журналу");
  only(ev.previous,["status","target_id","target_name"]);
  only(ev.next,["status","target_id","target_name"]);
  const cur=state.get(ev.entry_id);
  if(!compareState(cur,ev.previous))invalid("Порушено порядок рішень");
  const record=entries[Number(ev.entry_id)-1];
  if(!["missing","ambiguous","empty"].includes(record.detected_status))
   invalid("Зміна підтвердженого або нерозпізнаного поля заборонена");
  let next;
  if(ev.action==="map"){
   if(record.detected_status==="empty"||!TARGET_NAMES.has(ev.next.target_id))
    invalid("Недозволений відповідник");
   next={status:"mapped",target_id:ev.next.target_id};
  }else if(ev.action==="ignore"){
   next={status:"ignored",target_id:null};
  }else{
   const last=events.at(-1);
   if(!last||last.action==="undo"||ev.reverts!==last.id||
     ev.entry_id!==last.entry_id||!compareState(last.previous,ev.next))
    invalid("Некоректне скасування рішення");
   next={...last.previous};
  }
  if(!compareState(next,ev.next))invalid("Підроблений стан після рішення");
  state.set(ev.entry_id,next);
  events.push({id:ev.id,entry_id:ev.entry_id,action:ev.action,
   at:ev.at,reason:ev.reason,
   ...(ev.action==="undo"?{reverts:ev.reverts}:{}),
   previous:{...cur},next:{...next}});
 }
 const decisions=entries.map(e=>{
  const now=state.get(e.id);
  if(now.status!==e.final_status||now.target_id!==e.final_target_id)
   invalid("Рішення не відповідає журналу подій");
  if((now.status==="mapped"||now.status==="matched")&&
    e.final_target_id!==now.target_id)invalid("Невірний відповідник");
  if(e.final_target_id!==null&&!TARGET_NAMES.has(e.final_target_id))
   invalid("Недозволений запис довідника");
  const name=e.final_target_id?TARGET_NAMES.get(e.final_target_id):null;
  if(e.final_target_name!==name)invalid("Неузгоджена назва довідника");
  return {id:e.id,sheet:e.sheet,source_row:e.source_row,field:e.field,
   original_value:e.original_value,detected_status:e.detected_status,
   status:now.status,target_id:now.target_id,canonical_name:name};
 });
 if(r.summary){
  only(r.summary,["matched","pending","mapped","ignored","needs_mapping"]);
  for(const status of ["matched","pending","mapped","ignored","needs_mapping"]){
   if(r.summary[status]!==decisions.filter(e=>e.status===status).length)
    invalid("Некоректний підсумок перевірки");
  }
 }
 const selectedTargets=[...new Set(decisions.map(d=>d.target_id).filter(Boolean))];
 const fingerprintRows=entries.map(({sheet,source_row,field,original_value,detected_status})=>
  [sheet,source_row,field,original_value,detected_status]);
 return {format:input.format,directory_id:DIRECTORY,decisions,events,
  selectedTargets,fingerprintRows};
}
async function sha256(value){
 const bytes=new TextEncoder().encode(value),digest=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function checkTargets(db,targets){
 for(const id of targets){
  const row=await db.prepare(
   "SELECT json_extract(data_json,'$.name') AS name FROM directory_entries "+
   "WHERE id=? AND directory_id=? AND archived_at IS NULL LIMIT 1"
  ).bind(id,DIRECTORY).first();
  if(!row||row.name!==TARGET_NAMES.get(id))invalid("Відповідник довідника змінився — онови перевірку");
 }
}
function baseQuery(name){
 return "SELECT id,version,snapshot_json,created_at FROM report_versions "+
   "WHERE report_name=? ORDER BY version DESC LIMIT 1";
}
export async function demoLocalStoreApi(req,env,user,seg){
 if(!user||user.active!==1||user.role!=="admin")return fail("Лише адміністратор",403);
 if(!env.DB)return fail("D1 недоступна",503);
 if(seg.length===2&&req.method==="GET"){
  try{
   const rows=await env.DB.prepare(
    "SELECT id,report_name,version,created_at FROM report_versions "+
    "WHERE report_name GLOB 'ANALISE-DEMO-LOCAL-V1:*' "+
    "ORDER BY created_at DESC,id DESC LIMIT 25"
   ).all();
   return reply({storage:"cloudflare_d1",synthetic_only:true,items:rows.results||[]});
  }catch{return fail("Історію не вдалося прочитати",503)}
 }
 if(seg.length===4&&seg[3]==="latest"&&req.method==="GET"){
  const hash=seg[2];
  if(!/^[a-f0-9]{64}$/.test(hash))return fail("Некоректний ключ",400);
  try{
   const item=await env.DB.prepare(baseQuery()).bind(PREFIX+hash).first();
   if(!item)return fail("Документ не знайдено",404);
   return reply({id:item.id,version:item.version,created_at:item.created_at,
    data:JSON.parse(item.snapshot_json)});
  }catch{return fail("Дані не вдалося прочитати",503)}
 }
 if(seg.length!==2||req.method!=="POST")return fail("Непідтримувана дія",405);
 let payload;
 try{
  const size=Number(req.headers.get("content-length")||0);
  if(size>65536)return fail("Завеликий запит",413);
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
   return fail("Потрібен JSON",415);
  const raw=await req.text();
  if(new TextEncoder().encode(raw).length>65536)return fail("Завеликий запит",413);
  payload=validateDemoReview(JSON.parse(raw));
 }catch{return fail("Файл або історія рішень не відповідають дозволеному демо-формату",400)}
 try{
  await checkTargets(env.DB,payload.selectedTargets);
  const fingerprint=await sha256(JSON.stringify([payload.format,payload.fingerprintRows]));
  const name=PREFIX+fingerprint;
  const snapshot={schema_version:"ANALISE_DEMO_D1_V1",synthetic_only:true,
   format:payload.format,directory_id:DIRECTORY,
   decisions:payload.decisions,history:payload.events};
  const raw=JSON.stringify(snapshot);
  if(new TextEncoder().encode(raw).length>24000)
   return fail("Завеликий журнал для демонстраційного збереження",413);
  const existing=await env.DB.prepare(baseQuery()).bind(name).first();
  if(existing?.snapshot_json===raw)
   return reply({id:existing.id,version:existing.version,reused:true,
    key:fingerprint,storage:"cloudflare_d1",synthetic_only:true});
  const version=existing?.version?existing.version+1:1,expected=version-1;
  const uid=crypto.randomUUID(),at=new Date().toISOString();
  const inserted=await env.DB.prepare(
   "INSERT INTO report_versions(id,report_name,version,status,snapshot_json,created_by,created_at) "+
   "SELECT ?,?,?,'confirmed',?,?,? WHERE "+
   "(SELECT COALESCE(MAX(version),0) FROM report_versions WHERE report_name=?)=?"
  ).bind(uid,name,version,raw,user.id,at,name,expected).run();
  if(inserted.meta?.changes!==1)return fail("Запис змінився, повтори перевірку",409);
  return reply({id:uid,version,reused:false,key:fingerprint,
   storage:"cloudflare_d1",synthetic_only:true},201);
 }catch(e){
  if(/UNIQUE constraint|SQLITE_CONSTRAINT/.test(String(e?.message||"")))
   return fail("Одночасна зміна версії; повтори збереження",409);
  if(/Відповідник довідника змінився/.test(String(e?.message||"")))
   return fail("Відповідник довідника змінився — онови перевірку",409);
  return fail("Помилка збереження тестового результату в D1",503);
 }
}
