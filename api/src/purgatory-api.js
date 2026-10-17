import {literalUnicodeGlob} from "./unicode-search.js";
// Generic, non-operational directory-value review and memory for ANALISE.
// Existing directories are read-only here. Source strings are immutable in the audit.
export const normalizeReviewValue = value => String(value ?? "").normalize("NFC")
 .replace(/[’‘ʼ\u02bc]/gu,"'").replace(/[‐‑‒–—−]/gu,"-")
 .replace(/\s+/gu," ").trim().toLocaleLowerCase("uk-UA");
const HEADERS={
 "content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store",
 "x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const fail=(status,message)=>response({error:message},status);
const id=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
function text(value,max,required=false){
 if(typeof value!=="string")throw Error("Очікується текстове поле");
 const v=value.trim();
 if((required&&!v)||v.length>max||/[\u0000-\u001f\u007f]/u.test(v))throw Error("Некоректне текстове значення");
 return v;
}
function only(value,keys){
 if(!value||typeof value!=="object"||Array.isArray(value)||
 Object.keys(value).some(k=>!keys.includes(k)))throw Error("Невідомі поля запиту");
}
async function parse(req){
 if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
  throw Error("Потрібен application/json");
 if(Number(req.headers.get("content-length")||0)>65536)throw Error("Завеликий запит");
 const raw=await req.text();
 if(new TextEncoder().encode(raw).length>65536)throw Error("Завеликий запит");
 const body=JSON.parse(raw);only(body,Object.keys(body));return body;
}
function group(input){
 return {directory_id:text(input.directory_id,60,true),
  context_key:text(input.context_key??"",100),
  raw_value:text(input.raw_value,200,true)};
}
async function validDirectory(db,code){
 return Boolean(await db.prepare("SELECT id FROM directory_types WHERE id=? LIMIT 1").bind(code).first());
}
async function validTarget(db,directory,target){
 return Boolean(await db.prepare(
  "SELECT id FROM directory_entries WHERE directory_id=? AND id=? AND archived_at IS NULL LIMIT 1"
 ).bind(directory,target).first());
}
async function migrationReady(db){
 return Boolean(await db.prepare(
  "SELECT name FROM sqlite_master WHERE type='trigger' AND name='dq_rule_updated' LIMIT 1"
 ).first());
}
async function snapshot(db){
 const [rows,rules,audit,counts,dirs]=await Promise.all([
  db.prepare("SELECT o.directory_id,t.title AS directory_title,o.context_key,o.raw_value,o.normalized_value,COUNT(*) AS occurrences,MIN(o.id) AS first_id FROM dq_occurrences o JOIN directory_types t ON t.id=o.directory_id WHERE o.active=1 AND o.status='pending' GROUP BY o.directory_id,o.context_key,o.normalized_value ORDER BY occurrences DESC,o.directory_id,o.normalized_value LIMIT 150").all(),
  db.prepare("SELECT r.id,r.directory_id,t.title AS directory_title,r.context_key,r.raw_example,r.normalized_value,r.target_id,json_extract(e.data_json,'$.name') AS target_name,r.active,r.version,r.updated_at FROM dq_rules r JOIN directory_types t ON t.id=r.directory_id LEFT JOIN directory_entries e ON e.id=r.target_id ORDER BY r.updated_at DESC LIMIT 150").all(),
  db.prepare("SELECT a.id,a.entity_type,a.entity_id,a.action,a.actor_id,a.at,a.before_json,a.after_json,"+
   "json_extract(ea.data_json,'$.name') AS after_target_name,"+
   "json_extract(eb.data_json,'$.name') AS before_target_name,"+
   "r.raw_example AS rule_example "+
   "FROM dq_audit a "+
   "LEFT JOIN directory_entries ea ON ea.id=json_extract(a.after_json,'$.target') "+
   "LEFT JOIN directory_entries eb ON eb.id=json_extract(a.before_json,'$.target') "+
   "LEFT JOIN dq_rules r ON a.entity_type='rule' AND a.entity_id=r.id "+
   "ORDER BY a.id DESC LIMIT 100").all(),
  db.prepare("SELECT (SELECT COUNT(*) FROM dq_occurrences WHERE active=1 AND status='pending') AS pending_occurrences,(SELECT COUNT(*) FROM dq_occurrences WHERE active=1 AND status='resolved') AS resolved_occurrences,(SELECT COUNT(*) FROM dq_rules WHERE active=1) AS active_rules").first(),
  db.prepare("SELECT id,title FROM directory_types ORDER BY title LIMIT 100").all()
 ]);
 return response({groups:rows.results||[],rules:rules.results||[],
  audit:audit.results||[],counts, dictionaries:dirs.results||[]});
}
// Full read-only audit history, paginated by immutable monotonically increasing ID.
// Filtering and searching happen server-side, so older matching events aren't omitted.
const AUDIT_DIRECTORY="COALESCE(json_extract(a.after_json,'$.directory'),json_extract(a.before_json,'$.directory'))";
const AUDIT_FROM=" FROM dq_audit a "+
 "LEFT JOIN directory_entries ea ON ea.id=json_extract(a.after_json,'$.target') "+
 "LEFT JOIN directory_entries eb ON eb.id=json_extract(a.before_json,'$.target') "+
 "LEFT JOIN dq_rules r ON a.entity_type='rule' AND a.entity_id=r.id "+
 "LEFT JOIN directory_types t ON t.id="+AUDIT_DIRECTORY;
const AUDIT_SELECT="SELECT a.id,a.entity_type,a.entity_id,a.action,a.actor_id,a.at,a.before_json,a.after_json,"+
 "json_extract(ea.data_json,'$.name') AS after_target_name,"+
 "json_extract(eb.data_json,'$.name') AS before_target_name,"+
 "r.raw_example AS rule_example";
async function auditHistory(db,req){
 const params=new URL(req.url).searchParams;
 const directory=text(params.get("directory_id")||"",60);
 const needle=text(params.get("q")||"",80);
 const cursorRaw=params.get("before");
 if(cursorRaw!==null&&!/^[1-9]\d{0,14}$/.test(cursorRaw))
  return fail(400,"Некоректний курсор історії");
 const cursor=cursorRaw===null?null:Number(cursorRaw);
 if(cursor!==null&&!Number.isSafeInteger(cursor))return fail(400,"Некоректний курсор історії");
 if(directory&&!await validDirectory(db,directory))
  return fail(404,"Довідник не знайдено");
 const filters=[],args=[];
 if(directory){
  filters.push(AUDIT_DIRECTORY+"=?");
  args.push(directory);
 }
 if(needle){
  const expressions=["a.after_json","a.before_json","a.actor_id","a.at",
    "r.raw_example","t.title","json_extract(ea.data_json,'$.name')",
    "json_extract(eb.data_json,'$.name')"];
  filters.push("("+expressions.map(expr=>expr+" GLOB ?").join(" OR ")+")");
  args.push(...expressions.map(()=>literalUnicodeGlob(needle)));
 }
 const where=filters.length?" WHERE "+filters.join(" AND "):"";
 const pageFilters=cursor===null?filters:[...filters,"a.id < ?"];
 const pageWhere=pageFilters.length?" WHERE "+pageFilters.join(" AND "):"";
 // The cursor MUST be in WHERE, not the last LEFT JOIN's ON clause.
 const result=await db.prepare(AUDIT_SELECT+AUDIT_FROM+pageWhere+
  " ORDER BY a.id DESC LIMIT 51"
 ).bind(...args,...(cursor===null?[]:[cursor])).all();
 const all=result.results||[],items=all.slice(0,50);
 const count=await db.prepare("SELECT COUNT(*) AS n"+AUDIT_FROM+where)
  .bind(...args).first();
 return response({items,count:count?.n??0,has_more:all.length>50,
  next_before:items.length?items[items.length-1].id:null,page_size:50});
}

async function candidates(db,req){
 const search=new URL(req.url).searchParams;
 const dir=text(search.get("directory_id")||"",60,true);
 const q=text(search.get("q")||"",80);
 if(!await validDirectory(db,dir))return fail(404,"Довідник не знайдено");
 // Return only directory labels/opaque IDs, never metadata.
 const pattern=literalUnicodeGlob(q);
 const data=await db.prepare(
  "SELECT id,json_extract(data_json,'$.name') AS name FROM directory_entries "+
  "WHERE directory_id=? AND archived_at IS NULL AND json_type(data_json,'$.name')='text' "+
  "AND json_extract(data_json,'$.name') GLOB ? "+
  "ORDER BY json_extract(data_json,'$.name') LIMIT 40"
 ).bind(dir,pattern).all();
 return response({items:data.results||[]});
}
async function ingest(db,body,user){
 only(body,["items"]);
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>80)
  throw Error("Потрібно від 1 до 80 записів");
 const statements=[],cache=new Map(),actor=user.id,at=now();
 for(const item of body.items){
  only(item,["directory_id","context_key","raw_value","source_id","source_ref"]);
  const g=group(item),source_id=text(item.source_id,120,true),
   source_ref=text(item.source_ref,160,true),
   normalized=normalizeReviewValue(g.raw_value);
  if(!cache.has(g.directory_id))cache.set(g.directory_id,await validDirectory(db,g.directory_id));
  if(!cache.get(g.directory_id))throw Error("Довідник відсутній");
  const rule=await db.prepare(
   "SELECT r.target_id FROM dq_rules r JOIN directory_entries e ON e.id=r.target_id "+
   "AND e.directory_id=r.directory_id AND e.archived_at IS NULL "+
   "WHERE r.directory_id=? AND r.context_key=? AND r.normalized_value=? AND r.active=1 LIMIT 1"
  ).bind(g.directory_id,g.context_key,normalized).first();
  const target=rule?.target_id||null,origin=target?"rule":"none",
    status=target?"resolved":"pending";
  statements.push(db.prepare(
   "INSERT INTO dq_occurrences(id,directory_id,source_id,source_ref,context_key,raw_value,normalized_value,target_id,status,resolution_origin,active,version,created_by,updated_by,created_at,updated_at) "+
   "VALUES (?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,?) "+
   "ON CONFLICT(directory_id,context_key,source_ref) DO UPDATE SET "+
   "source_id=excluded.source_id,raw_value=excluded.raw_value,normalized_value=excluded.normalized_value,"+
   "target_id=CASE WHEN dq_occurrences.raw_value=excluded.raw_value AND dq_occurrences.resolution_origin='manual' THEN dq_occurrences.target_id ELSE excluded.target_id END,"+
   "status=CASE WHEN dq_occurrences.raw_value=excluded.raw_value AND dq_occurrences.resolution_origin='manual' THEN dq_occurrences.status ELSE excluded.status END,"+
   "resolution_origin=CASE WHEN dq_occurrences.raw_value=excluded.raw_value AND dq_occurrences.resolution_origin='manual' THEN 'manual' ELSE excluded.resolution_origin END,"+
   "active=1,version=dq_occurrences.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at"
  ).bind(id(),g.directory_id,source_id,source_ref,g.context_key,g.raw_value,normalized,
   target,status,origin,actor,actor,at,at));
 }
 await db.batch(statements);
 return response({accepted:body.items.length,message:"Записи збережено. Невідомі значення очікують перевірки."},201);
}
async function resolve(db,body,user){
 only(body,["directory_id","context_key","raw_value","target_id","mode","occurrence_id"]);
 const g=group(body),norm=normalizeReviewValue(g.raw_value),
  target=text(body.target_id,100,true),mode=body.mode,actor=user.id,at=now();
 if(!await validTarget(db,g.directory_id,target))return fail(400,"Обери чинний запис відповідного довідника");
 if(mode==="single"){
  const occId=text(body.occurrence_id,100,true);
  const result=await db.prepare(
   "UPDATE dq_occurrences SET target_id=?,status='resolved',resolution_origin='manual',"+
   "version=version+1,updated_by=?,updated_at=? WHERE id=? AND directory_id=? AND context_key=? AND normalized_value=? AND active=1 AND status='pending'"
  ).bind(target,actor,at,occId,g.directory_id,g.context_key,norm).run();
  if(!result.meta?.changes)return fail(409,"Запис уже змінено. Онови сторінку.");
  return response({resolved:1,scope:"single"});
 }
 if(mode!=="rule")return fail(400,"Оберіть тип рішення");
 const existing=await db.prepare(
  "SELECT id FROM dq_rules WHERE directory_id=? AND context_key=? AND normalized_value=?"
 ).bind(g.directory_id,g.context_key,norm).first();
 const statement=db.prepare(
  "INSERT INTO dq_rules(id,directory_id,context_key,normalized_value,raw_example,target_id,active,version,created_by,updated_by,created_at,updated_at) "+
  "VALUES (?,?,?,?,?,?,1,1,?,?,?,?) "+
  "ON CONFLICT(directory_id,context_key,normalized_value) DO UPDATE SET "+
  "target_id=excluded.target_id,raw_example=excluded.raw_example,active=1,version=dq_rules.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at"
 ).bind(existing?.id||id(),g.directory_id,g.context_key,norm,g.raw_value,target,actor,actor,at,at);
 const bulk=db.prepare(
  "UPDATE dq_occurrences SET target_id=?,status='resolved',resolution_origin='rule',version=version+1,updated_by=?,updated_at=? "+
  "WHERE directory_id=? AND context_key=? AND normalized_value=? AND active=1 "+
  "AND (status='pending' OR (status='resolved' AND resolution_origin='rule')) "+
  "AND (target_id IS NOT ? OR status!='resolved' OR resolution_origin!='rule')"
 ).bind(target,actor,at,g.directory_id,g.context_key,norm,target);
 const results=await db.batch([statement,bulk]);
 return response({scope:"rule",resolved:results[1]?.meta?.changes??null,
  message:"Правило збережено; відповідні активні входження оновлено."});
}
async function revoke(db,body,user){
 only(body,["rule_id"]);
 const ruleId=text(body.rule_id,100,true),actor=user.id,at=now();
 const rule=await db.prepare("SELECT directory_id,context_key,normalized_value,target_id FROM dq_rules WHERE id=? AND active=1")
  .bind(ruleId).first();
 if(!rule)return fail(404,"Активне правило не знайдено");
 const statements=[
  db.prepare("UPDATE dq_rules SET active=0,version=version+1,updated_by=?,updated_at=? WHERE id=? AND active=1").bind(actor,at,ruleId),
  db.prepare("UPDATE dq_occurrences SET target_id=NULL,status='pending',resolution_origin='none',version=version+1,updated_by=?,updated_at=? "+
   "WHERE directory_id=? AND context_key=? AND normalized_value=? AND active=1 AND resolution_origin='rule'")
   .bind(actor,at,rule.directory_id,rule.context_key,rule.normalized_value)
 ];
 const result=await db.batch(statements);
 return response({revoked:true,reopened:result[1]?.meta?.changes??null});
}
async function ignore(db,body,user){
 only(body,["occurrence_id"]);
 const occId=text(body.occurrence_id,100,true);
 const r=await db.prepare("UPDATE dq_occurrences SET status='ignored',resolution_origin='none',target_id=NULL,version=version+1,updated_by=?,updated_at=? WHERE id=? AND active=1 AND status='pending'")
  .bind(user.id,now(),occId).run();
 return r.meta?.changes?response({ignored:true}):fail(409,"Запис не знайдено або вже опрацьовано");
}
async function retire(db,body,user){
 only(body,["source_id"]);
 const source=text(body.source_id,120,true);
 const result=await db.prepare(
  "UPDATE dq_occurrences SET active=0,version=version+1,updated_by=?,updated_at=? WHERE source_id=? AND active=1"
 ).bind(user.id,now(),source).run();
 return response({retired:result.meta?.changes??0});
}
export async function purgatoryApi(req,env,user,segments){
 if(!user||user.role!=="admin"||user.active!==1)return fail(403,"Лише адміністратор");
 const origin=req.headers.get("origin");
 if(!["GET","HEAD"].includes(req.method)&&origin&&origin!==new URL(req.url).origin)
  return fail(403,"Запит з іншого сайту заборонено");
 if(!env.DB)return fail(503,"D1 недоступна");
 try{
  if(!await migrationReady(env.DB))return fail(503,"Застосуй міграцію D1 0013");
  const route=segments[2]||"";
  if(req.method==="GET"&&route==="data")return await snapshot(env.DB);
 if(req.method==="GET"&&route==="history")return await auditHistory(env.DB,req);
  if(req.method==="GET"&&route==="candidates")return await candidates(env.DB,req);
  if(req.method!=="POST")return fail(405,"Метод не підтримується");
  const body=await parse(req);
  if(route==="ingest")return await ingest(env.DB,body,user);
  if(route==="resolve")return await resolve(env.DB,body,user);
  if(route==="revoke")return await revoke(env.DB,body,user);
  if(route==="ignore")return await ignore(env.DB,body,user);
  if(route==="retire")return await retire(env.DB,body,user);
  return fail(404,"Невідомий маршрут");
 }catch(error){
  if(error instanceof SyntaxError||/Некорект|Невідомі|Потрібн|Очікується|Завеликий|Довідник відсутній/.test(String(error.message)))
   return fail(400,"Некоректний запит: "+error.message);
  return fail(503,"Операцію не завершено. Перевір конфігурацію та стан D1.");
 }
}
