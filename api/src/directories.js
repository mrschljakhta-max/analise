// Generic reference-directory CRUD. No operational data processing.
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const fail=(code,message)=>respond({error:message},code);
const timestamp=()=>new Date().toISOString();
async function bodyJson(req){
  if(!(req.headers.get("content-type")||"").startsWith("application/json"))throw Error("Очікується JSON");
  const s=await req.text();if(new TextEncoder().encode(s).length>65536)throw Error("Завеликий запит");
  return JSON.parse(s);
}
function validate(schema, data){
 if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Некоректний запис");
 const keys=new Set(schema.fields.map(f=>f.key));
 if(Object.keys(data).some(k=>!keys.has(k)))throw Error("Невідомі поля");
 for(const f of schema.fields){
   const v=data[f.key];
   if(f.required&&(v===undefined||v===null||String(v).trim()===""))throw Error("Обов'язкове поле: "+f.key);
   if(v!==undefined&&v!==null&&!(typeof v==="string"||typeof v==="number"))throw Error("Неприпустимий тип: "+f.key);
   if(typeof v==="string"&&v.length>500)throw Error("Завелике значення: "+f.key);
 }
 return JSON.stringify(data);
}
export async function directoryApi(req,env,user,seg){
 try{
  const method=req.method, dir=seg[2];
  if(seg.length===2&&method==="GET"){
   const x=await env.DB.prepare("SELECT id,title,schema_json,version FROM directory_types ORDER BY title").all();
   return respond({items:x.results.map(r=>({...r,schema:JSON.parse(r.schema_json),schema_json:undefined}))});
  }
  if(!dir||!/^[a-z][a-z0-9_-]{1,59}$/.test(dir))return fail(404,"Невідомий довідник");
  const def=await env.DB.prepare("SELECT * FROM directory_types WHERE id=?").bind(dir).first();
  if(!def)return fail(404,"Невідомий довідник");
  const schema=JSON.parse(def.schema_json);
  if(seg.length===3&&method==="GET")return respond({id:def.id,title:def.title,schema});
  if(seg[3]!=="entries")return fail(404,"Невідомий маршрут");
  if(seg.length===4&&method==="GET"){
   const limit=100,offset=Math.min(100000,Math.max(0,Number.parseInt(new URL(req.url).searchParams.get("offset")||"0",10)||0));
   const x=await env.DB.prepare("SELECT id,data_json,version,created_at,updated_at FROM directory_entries WHERE directory_id=? AND archived_at IS NULL ORDER BY id LIMIT ? OFFSET ?").bind(dir,limit,offset).all();
   return respond({items:x.results.map(r=>({id:r.id,data:JSON.parse(r.data_json),version:r.version,created_at:r.created_at,updated_at:r.updated_at})),limit,offset});
  }
  if(seg.length===4&&method==="POST"){
   if(user.role!=="admin")return fail(403,"Лише адміністратор");
   const payload=await bodyJson(req), data=validate(schema,payload.data),id=crypto.randomUUID(),at=timestamp();
   await env.DB.batch([
    env.DB.prepare("INSERT INTO directory_entries(id,directory_id,data_json,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id,dir,data,user.id,user.id,at,at),
    env.DB.prepare("INSERT INTO directory_entry_audit(entry_id,directory_id,action,actor_id,new_json,at) VALUES (?,?,?,?,?,?)").bind(id,dir,"create",user.id,data,at)
   ]);
   return respond({id,version:1},201);
  }
  if(seg.length===5&&["PATCH","DELETE"].includes(method)){
   if(user.role!=="admin")return fail(403,"Лише адміністратор");
   const id=seg[4],payload=await bodyJson(req);
   if(!Number.isInteger(payload.version)||payload.version<1)return fail(400,"Потрібна версія");
   const old=await env.DB.prepare("SELECT data_json,version FROM directory_entries WHERE id=? AND directory_id=? AND archived_at IS NULL").bind(id,dir).first();
   if(!old)return fail(404,"Запис не знайдено");
   if(old.version!==payload.version)return fail(409,"Конфлікт версій");
   const at=timestamp(),data=method==="PATCH"?validate(schema,payload.data):old.data_json;
   const q=method==="PATCH"?
    env.DB.prepare("UPDATE directory_entries SET data_json=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND directory_id=? AND version=? AND archived_at IS NULL").bind(data,user.id,at,id,dir,payload.version):
    env.DB.prepare("UPDATE directory_entries SET archived_at=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND directory_id=? AND version=? AND archived_at IS NULL").bind(at,user.id,at,id,dir,payload.version);
   const result=await q.run();if(!result.meta.changes)return fail(409,"Конфлікт версій");
   await env.DB.prepare("INSERT INTO directory_entry_audit(entry_id,directory_id,action,actor_id,old_json,new_json,at) VALUES (?,?,?,?,?,?,?)").bind(id,dir,method==="PATCH"?"update":"archive",user.id,old.data_json,method==="PATCH"?data:null,at).run();
   return respond({id,version:payload.version+1});
  }
  return fail(405,"Непідтримувана дія");
 }catch(e){
  if(e instanceof SyntaxError||/^(Очікується|Завеликий|Некоректний|Невідомі|Обов'язкове|Неприпустимий)/.test(e.message))return fail(400,e.message);
  return fail(500,"Помилка сервера");
 }
}
