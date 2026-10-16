import {vpNormalizeName,vpKind,vpActive,vpFields,vpVersion,vpCode} from "./vp-sp-common.js";

const HEADERS={
 "content-type":"application/json; charset=utf-8",
 "cache-control":"no-store, private",
 "x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const respond=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:HEADERS});
const fail=(message,status=400)=>respond({error:message},status);
async function body(req){
 if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json")){
  throw Error("Очікується Content-Type: application/json");
 }
 if(Number(req.headers.get("content-length")||0)>8192)throw Error("Завеликий запит");
 const raw=await req.text();
 if(new TextEncoder().encode(raw).length>8192)throw Error("Завеликий запит");
 let parsed;
 try{parsed=JSON.parse(raw)}catch{throw Error("Некоректний JSON")}
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("Очікується JSON-об'єкт");
 return parsed;
}
const hasAudit=async DB=>Boolean(await DB.prepare(
 "SELECT name FROM sqlite_master WHERE type='trigger' AND name='vp_sp_objects_audit_insert' LIMIT 1"
).first());
function validate(req,method){
 if(method==="POST"){
  vpFields(req,["kind","name","is_active"]);
  return {...vpNormalizeName(req.name),kind:vpKind(req.kind),is_active:vpActive(req.is_active)};
 }
 vpFields(req,["code","name","is_active","version"]);
 return {...vpNormalizeName(req.name),code:vpCode(req.code),
  is_active:vpActive(req.is_active),version:vpVersion(req.version)};
}
export async function vpSpDirectoryApi(req,env,user,seg){
 if(user?.role!=="admin"||user.active===0)return fail("Тільки адміністратор",403);
 if(seg.length!==3||!["data","history","create","update"].includes(seg[2])){
  return fail("Невідомий маршрут",404);
 }
 const section=seg[2],method=req.method;
 if(!((method==="GET"&&["data","history"].includes(section))||
      (method==="POST"&&section==="create")||
      (method==="PATCH"&&section==="update"))){
  return fail("Непідтримуваний метод",405);
 }
 if(!env.DB)return fail("База D1 недоступна",503);
 if(method!=="GET"){
  const origin=req.headers.get("origin");
  if(origin&&origin!==new URL(req.url).origin)return fail("Недозволене джерело",403);
  let p;
  try{p=validate(await body(req),method)}catch(e){return fail(e.message,400)}
  try{
   if(!await hasAudit(env.DB))return fail("Спочатку застосуй міграцію D1 0011",503);
   const now=new Date().toISOString();
   if(method==="POST"){
    const id=crypto.randomUUID(),code=p.kind.toUpperCase()+"-"+crypto.randomUUID()
      .replace(/-/g,"").slice(0,12).toUpperCase();
    await env.DB.prepare(
     "INSERT INTO vp_sp_objects (id,code,kind,name,normalized_name,is_active,created_at,updated_at) "+
     "VALUES (?,?,?,?,?,?,?,?)"
    ).bind(id,code,p.kind,p.name,p.normalized_name,p.is_active,now,now).run();
    return respond({saved:true,code,version:1},201);
   }
   const r=await env.DB.prepare(
    "UPDATE vp_sp_objects SET name=?,normalized_name=?,is_active=?,"+
    "version=version+1,updated_at=? WHERE code=? AND version=?"
   ).bind(p.name,p.normalized_name,p.is_active,now,p.code,p.version).run();
   if(!r.meta?.changes)return fail("Запис змінився в іншій вкладці. Онови довідник.",409);
   return respond({saved:true,code:p.code,version:p.version+1});
  }catch(e){
   if(/UNIQUE constraint failed/i.test(String(e?.message||""))){
    return fail("Запис із такою назвою вже є в довіднику",409);
   }
   return fail("Не вдалося зберегти запис у D1",503);
  }
 }
 try{
  if(section==="data"){
   const db=await env.DB.prepare(
    "SELECT code,kind,name,is_active,version,created_at,updated_at "+
    "FROM vp_sp_objects ORDER BY kind,name COLLATE NOCASE LIMIT 2001"
   ).all();
   const rows=db.results||[];
   return respond({items:rows.slice(0,2000),truncated:rows.length>2000});
  }
  const code=new URL(req.url).searchParams.get("code");
  try{vpCode(code)}catch(e){return fail(e.message,400)}
  const rows=await env.DB.prepare(
   "SELECT action,old_json,new_json,changed_at FROM vp_sp_audit "+
   "WHERE object_code=? ORDER BY id DESC LIMIT 101"
  ).bind(code).all();
  return respond({items:(rows.results||[]).slice(0,100),truncated:(rows.results||[]).length>100});
 }catch(e){
  if(/no such table: vp_sp_/i.test(String(e?.message||"")))return fail("Спочатку застосуй міграцію D1 0011",503);
  return fail("Не вдалося завантажити довідник ВП/СП із D1",503);
 }
}
