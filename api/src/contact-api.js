import {CONTACT_FIELDS,contactKeys,contactRecord} from "./contact-common.js";

// Private admin-only API. Never send telephone numbers or account IDs to public routes.
const JSON_HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'none'"
};
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const fail=(message,status=400)=>respond({error:message},status);
const MSG_MIGRATION="Спочатку застосуй міграцію D1 0012";
const editable=[
 "name","normalized_name","aliases","group_label","group_key","phone",
 "whatsapp","signal","delta_account","email","direction","unit_name",
 "duty_role","note","verification_status","source_label","is_active"
];
const codeOK=v=>typeof v==="string"&&/^CT-[A-F0-9]{12}$/.test(v);
const readBody=async(req,max=131072)=>{
 if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json")){
  throw Error("Потрібен Content-Type application/json");
 }
 if(Number(req.headers.get("content-length")||0)>max)throw Error("Завеликий запит");
 const raw=await req.text();
 if(new TextEncoder().encode(raw).length>max)throw Error("Завеликий запит");
 let payload;
 try{payload=JSON.parse(raw)}catch{throw Error("Некоректний JSON")}
 if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Error("Очікується об'єкт");
 return payload;
};
async function ready(DB){
 const audit=await DB.prepare(
  "SELECT name FROM sqlite_master WHERE type='trigger' AND name='contact_audit_insert' LIMIT 1"
 ).first();
 return Boolean(audit);
}
async function snapshot(DB){
 const result=await DB.prepare(
  "SELECT code,group_key,normalized_name,phone,email,delta_account,version "+
  "FROM contacts ORDER BY group_key,normalized_name LIMIT 2001"
 ).all();
 const rows=result.results||[];
 if(rows.length>2000)throw Error("Завеликий довідник для одного імпорту");
 return rows;
}
const keyOf=r=>r.group_key+String.fromCharCode(0)+r.normalized_name;
async function fingerprint(items,current){
 const bytes=new TextEncoder().encode(JSON.stringify({
  items,current:current.map(r=>[r.code,r.group_key,r.normalized_name,r.version])
 }));
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 return [...hash].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function create(DB,row,actor,timestamp){
 const id=crypto.randomUUID(),code="CT-"+crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();
 const fields=["id","code",...editable,"verified_at","version","created_by","updated_by","created_at","updated_at"];
 const values=[id,code,...editable.map(k=>row[k]),
  row.verification_status==="verified"?timestamp:null,
  1,actor,actor,timestamp,timestamp];
 const placeholders=fields.map(()=>"?").join(",");
 await DB.prepare(
  "INSERT INTO contacts ("+fields.join(",")+") VALUES ("+placeholders+")"
 ).bind(...values).run();
 return code;
}
async function list(DB){
 const result=await DB.prepare(
  "SELECT code,"+editable.join(",")+",verified_at,version,created_at,updated_at "+
  "FROM contacts ORDER BY group_key,name COLLATE NOCASE LIMIT 2001"
 ).all();
 const rows=result.results||[];
 return {items:rows.slice(0,2000),truncated:rows.length>2000};
}
async function bulk(req,env,user,operation){
 let body;
 try{
  body=await readBody(req);
  contactKeys(body,["items","fingerprint","confirm"]);
  if(!Array.isArray(body.items)||body.items.length>150||
    (typeof body.fingerprint!=="string"||body.fingerprint.length>128)||
    typeof body.confirm!=="string"){
   throw Error("Некоректний файл для імпорту");
  }
 }catch(e){return fail(e.message,400)}
 const incoming=[],seen=new Set(),errors=[];
 for(const [index,item] of body.items.entries()){
  try{
   contactKeys(item,["source_row",...CONTACT_FIELDS]);
   if(!Number.isSafeInteger(item.source_row)||item.source_row<2||item.source_row>100001){
    throw Error("Некоректний номер рядка");
   }
   const row=contactRecord(Object.fromEntries(CONTACT_FIELDS.map(k=>[k,item[k]])));
   const key=keyOf(row);
   if(seen.has(key))throw Error("Повтор назви в цій групі");
   seen.add(key);incoming.push({...row,source_row:item.source_row});
  }catch(e){errors.push({row:Number.isInteger(item?.source_row)?item.source_row:index+2,
    message:e.message})}
 }
 if(errors.length)return respond({ok:false,errors,committed:false},422);
 if(!incoming.length)return fail("Не знайдено контактів для імпорту",400);
 try{
  if(!await ready(env.DB))return fail(MSG_MIGRATION,503);
  const current=await snapshot(env.DB),existing=new Map(current.map(r=>[keyOf(r),r]));
  const novel=incoming.filter(r=>!existing.has(keyOf(r)));
  const duplicates=incoming.filter(r=>existing.has(keyOf(r)));
  const changed=duplicates.filter(r=>{
   const old=existing.get(keyOf(r));
   return old.phone!==r.phone||old.email!==r.email||old.delta_account!==r.delta_account;
  });
  const counts={input:incoming.length,new:novel.length,existing:duplicates.length,
   review:changed.length};
  const digest=await fingerprint(incoming,current);
  if(operation==="prepare"){
   return respond({ok:true,counts,
    existing:duplicates.map(x=>({row:x.source_row,name:x.name,group_label:x.group_label})),
    review:changed.map(x=>({row:x.source_row,name:x.name,group_label:x.group_label,
     fields:[
      ...(existing.get(keyOf(x)).phone!==x.phone?["phone"]:[]),
      ...(existing.get(keyOf(x)).email!==x.email?["email"]:[]),
      ...(existing.get(keyOf(x)).delta_account!==x.delta_account?["delta_account"]:[])
     ]})),
    fingerprint:digest,committed:false});
  }
  if(body.confirm!=="IMPORT_CONTACTS_NEW_ONLY"||body.fingerprint!==digest){
   return fail("Excel або довідник D1 змінився. Повтори порівняння.",409);
  }
  if(!novel.length)return respond({ok:true,counts,committed:false,
   message:"Усі контакти вже існують. Повторний імпорт не потрібен."});
  const timestamp=new Date().toISOString(),queries=[];
  for(const item of novel){
   const id=crypto.randomUUID(),
     code="CT-"+crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();
   const fields=["id","code",...editable,"verified_at","version","created_by","updated_by","created_at","updated_at"];
   const bind=[id,code,...editable.map(k=>item[k]),
    item.verification_status==="verified"?timestamp:null,
    1,user.id,user.id,timestamp,timestamp];
   queries.push(env.DB.prepare(
    "INSERT INTO contacts ("+fields.join(",")+") VALUES ("+fields.map(()=>"?").join(",")+")"
   ).bind(...bind));
  }
  let batchError=null;
  try{
   const result=await env.DB.batch(queries);
   if(!Array.isArray(result)||result.length!==queries.length||
    result.some(r=>r?.success===false))batchError=Error("Incomplete D1 result");
  }catch(e){batchError=e}
  // A trigger causes D1 meta.changes>1. Confirm persistence from D1, not meta.changes.
  try{
   const after=await snapshot(env.DB),keys=new Set(after.map(keyOf));
   const present=novel.filter(x=>keys.has(keyOf(x)));
   if(present.length===novel.length){
    return respond({ok:true,counts,committed:true,verified:true});
   }
   if(batchError)console.error("Contact import batch verification",{
    count:novel.length,errorType:batchError?.name||"D1Error"
   });
   return fail("Результат імпорту не підтверджено. Онови довідник і перевір записи перед повтором.",409);
  }catch{
   return fail("Не вдалося перевірити результат запису D1. Онови довідник перед повтором.",503);
  }
 }catch(e){
  if(/no such table|no such column/i.test(String(e?.message||"")))return fail(MSG_MIGRATION,503);
  return fail("Не вдалося перевірити контакти в D1",503);
 }
}
export async function contactApi(req,env,user,seg){
 if(user?.role!=="admin"||user?.active!==1)return fail("Довідник контактів доступний лише адміністратору",403);
 if(!env.DB)return fail("D1 недоступна",503);
 const method=req.method,operation=seg[2],sub=seg[3];
 const standard=seg.length===3&&["data","history","create","update"].includes(operation);
 const importer=seg.length===4&&operation==="import"&&["prepare","commit"].includes(sub);
 if(!standard&&!importer)return fail("Невідомий маршрут",404);
 if(!((method==="GET"&&["data","history"].includes(operation)&&standard)||
   (standard&&method==="POST"&&operation==="create")||
   (standard&&method==="PATCH"&&operation==="update")||
   (importer&&method==="POST")))return fail("Непідтримуваний метод",405);
 if(method!=="GET"){
  const origin=req.headers.get("origin");
  if(origin&&origin!==new URL(req.url).origin)return fail("Недозволене джерело",403);
 }
 if(importer)return bulk(req,env,user,sub);
 if(method==="GET"){
  try{
   if(operation==="data")return respond(await list(env.DB));
   const code=new URL(req.url).searchParams.get("code");
   if(!codeOK(code))return fail("Некоректний код контакту",400);
   const rows=await env.DB.prepare(
    "SELECT action,actor_id,before_json,after_json,changed_at FROM contact_audit "+
    "WHERE contact_code=? ORDER BY id DESC LIMIT 101"
   ).bind(code).all();
   return respond({items:(rows.results||[]).slice(0,100),truncated:(rows.results||[]).length>100});
  }catch(e){
   if(/no such table|no such column/i.test(String(e?.message||"")))return fail(MSG_MIGRATION,503);
   return fail("Не вдалося відкрити контакти",503);
  }
 }
 let row;
 try{
  const body=await readBody(req,8192);
  row=contactRecord(body,method==="PATCH");
 }catch(e){return fail(e.message,400)}
 try{
  if(!await ready(env.DB))return fail(MSG_MIGRATION,503);
  const at=new Date().toISOString();
  if(operation==="create"){
   const code=await create(env.DB,row,user.id,at);
   return respond({saved:true,code,version:1},201);
  }
  const fields=editable.filter(k=>k!=="normalized_name"&&k!=="group_key");
  // Normalized keys are generated server-side and are not user input.
  const setters=[
   ...fields.map(k=>k+"=?"),
   "normalized_name=?","group_key=?",
   "verified_at=CASE WHEN ?='verified' THEN COALESCE(verified_at,?) ELSE NULL END",
   "version=version+1","updated_by=?","updated_at=?"
  ];
  const args=[...fields.map(k=>row[k]),row.normalized_name,row.group_key,
   row.verification_status,at,user.id,at,row.code,row.version];
  const result=await env.DB.prepare(
   "UPDATE contacts SET "+setters.join(",")+" WHERE code=? AND version=?"
  ).bind(...args).run();
  if(!result.meta?.changes)return fail("Картку вже змінено. Онови довідник.",409);
  return respond({saved:true,code:row.code,version:row.version+1});
 }catch(e){
  if(/UNIQUE constraint failed/i.test(String(e?.message||""))){
   return fail("Контакт із такою назвою в цій групі вже існує",409);
  }
  if(/no such table|no such column/i.test(String(e?.message||"")))return fail(MSG_MIGRATION,503);
  return fail("Не вдалося зберегти контакт",503);
 }
}
