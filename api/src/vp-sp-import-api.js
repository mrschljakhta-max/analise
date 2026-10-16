import {vpNormalizeName,vpKind,vpFields} from "./vp-sp-common.js";
// Excel itself stays in the browser. Only safe object names (no unit or MGRS)
// are transferred to this admin-only, insert-only endpoint.
const HEADERS={
 "content-type":"application/json; charset=utf-8",
 "cache-control":"no-store, private",
 "x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const reply=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const fail=(msg,status=400)=>reply({error:msg,committed:false},status);
async function parse(req){
 if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json")){
  throw Error("Потрібен Content-Type: application/json");
 }
 if(Number(req.headers.get("content-length")||0)>65536)throw Error("Завеликий запит");
 const raw=await req.text();
 if(new TextEncoder().encode(raw).length>65536)throw Error("Завеликий запит");
 let p;
 try{p=JSON.parse(raw)}catch{throw Error("Некоректний JSON")}
 if(!p||typeof p!=="object"||Array.isArray(p)){
  throw Error("Очікується JSON-об'єкт");
 }
 if(Object.keys(p).some(k=>!["items","fingerprint","confirm"].includes(k))||
  !Array.isArray(p.items)||p.items.length>250){
  throw Error("Некоректний набір даних імпорту");
 }
 if(p.fingerprint!==undefined&&typeof p.fingerprint!=="string")throw Error("Некоректний код перевірки");
 if(p.confirm!==undefined&&typeof p.confirm!=="string")throw Error("Некоректне підтвердження");
 return p;
}
function validate(rows){
 const errors=[],known=new Set(),items=[];
 for(const [n,r] of rows.entries()){
  try{
   vpFields(r,["source_row","kind","name"]);
   if(!Number.isSafeInteger(r.source_row)||r.source_row<2||r.source_row>100001){
    throw Error("Некоректний номер рядка");
   }
   const normalized=vpNormalizeName(r.name),kind=vpKind(r.kind);
   const key=kind+"\u0000"+normalized.normalized_name;
   if(known.has(key))throw Error("Повтор назви в імпорті");
   known.add(key);
   items.push({source_row:r.source_row,kind,...normalized});
  }catch(e){
   errors.push({row:Number.isInteger(r?.source_row)?r.source_row:n+2,message:e.message});
  }
 }
 return {items,errors};
}
async function snapshot(DB){
 const r=await DB.prepare(
  "SELECT kind,normalized_name FROM vp_sp_objects ORDER BY kind,normalized_name LIMIT 2001"
 ).all();
 const rows=r.results||[];
 if(rows.length>2000)throw Error("Надто великий довідник для перевірки");
 return rows.map(x=>({kind:x.kind,normalized_name:x.normalized_name}));
}
async function digest(items,current){
 const str=JSON.stringify({items,current});
 const bytes=new TextEncoder().encode(str);
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
export async function vpSpImportApi(req,env,user,segments){
 if(user?.role!=="admin"||user.active===0)return fail("Тільки адміністратор",403);
 if(segments.length!==3||!["prepare","commit"].includes(segments[2]))return fail("Невідомий маршрут",404);
 if(req.method!=="POST")return fail("Непідтримуваний метод",405);
 const origin=req.headers.get("origin");
 if(origin&&origin!==new URL(req.url).origin)return fail("Недозволене джерело",403);
 if(!env.DB)return fail("База D1 недоступна",503);
 let incoming;
 try{incoming=await parse(req)}catch(e){return fail(e.message,400)}
 const candidate=validate(incoming.items);
 if(candidate.errors.length)return reply({ok:false,errors:candidate.errors,committed:false},422);
 try{
  const trigger=await env.DB.prepare(
   "SELECT name FROM sqlite_master WHERE type='trigger' AND name='vp_sp_objects_audit_insert' LIMIT 1"
  ).first();
  if(!trigger)return fail("Спочатку застосуй міграцію D1 0011",503);
  const current=await snapshot(env.DB);
  const existing=new Set(current.map(x=>x.kind+"\u0000"+x.normalized_name));
  const fresh=candidate.items.filter(x=>!existing.has(x.kind+"\u0000"+x.normalized_name));
  const skipped=candidate.items.filter(x=>existing.has(x.kind+"\u0000"+x.normalized_name))
   .map(x=>({row:x.source_row,name:x.name,kind:x.kind}));
  const fingerprint=await digest(candidate.items,current);
  const counts={input:candidate.items.length,new:fresh.length,existing:skipped.length};
  if(segments[2]==="prepare"){
   return reply({ok:true,counts,skipped,fingerprint,committed:false});
  }
  if(incoming.confirm!=="IMPORT_VP_SP_NAMES_ONLY"||incoming.fingerprint!==fingerprint){
   return fail("Склад імпорту або довідник D1 змінився. Повтори порівняння.",409);
  }
  if(!fresh.length)return reply({ok:true,counts,committed:false,
   message:"Нових назв немає. Повторний імпорт не потрібен."});
  const now=new Date().toISOString();
  const queries=fresh.map(x=>{
   const code=x.kind.toUpperCase()+"-"+crypto.randomUUID()
    .replace(/-/g,"").slice(0,12).toUpperCase();
   return env.DB.prepare(
    "INSERT INTO vp_sp_objects (id,code,kind,name,normalized_name,is_active,created_at,updated_at) "+
    "VALUES (?,?,?,?,?,?,?,?)"
   ).bind(crypto.randomUUID(),code,x.kind,x.name,x.normalized_name,1,now,now);
  });
  // D1 meta.changes includes audit-trigger writes and is not a per-row
  // insert count. Never return a false failure after a successful commit.
  let batchError=null;
  try{
   const result=await env.DB.batch(queries);
   if(!Array.isArray(result)||result.length!==queries.length||
    result.some(x=>x?.success===false)){
    batchError=Error("Unexpected D1 batch response");
   }
  }catch(e){
   batchError=e;
  }
  // Read back the names from D1 to disambiguate committed and rolled-back
  // batches even if the D1 response was unexpected.
  try{
   const after=await snapshot(env.DB);
   const persisted=new Set(after.map(x=>x.kind+String.fromCharCode(0)+x.normalized_name));
   const saved=fresh.filter(x=>persisted.has(x.kind+String.fromCharCode(0)+x.normalized_name));
   if(saved.length===fresh.length){
    return reply({ok:true,counts,committed:true,verified:true});
   }
   if(batchError){
    console.error("VP/SP name batch not verified",{
     statementCount:queries.length,errorType:batchError?.name||"D1Error",
     persistedCount:saved.length
    });
   }
   return fail(saved.length>0?
     "Частина назв присутня в D1. Онови довідник і повтори порівняння перед наступною спробою.":
     "D1 не підтвердила нові назви. Онови довідник і повтори порівняння.",409);
  }catch(e){
   console.error("VP/SP names post-commit verification failed",{
    statementCount:queries.length,errorType:e?.name||"D1Error"
   });
   return fail("Не вдалося перевірити результат у D1. Онови довідник і повтори порівняння.",503);
  }
 }catch(e){
  if(/no such table: vp_sp_/i.test(String(e?.message||"")))return fail("Спочатку застосуй міграцію D1 0011",503);
  return fail("Не вдалося перевірити довідник у D1",503);
 }
}
