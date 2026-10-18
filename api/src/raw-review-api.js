// Deferred, administrator-initiated data quality review of persisted RAW snapshots.
// Source cells are read from D1. This does not rewrite RAW, classify content,
// infer field semantics, or automatically commit dictionary matches.
import {purgatoryApi} from "./purgatory-api.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD=/^(?:[a-z][a-z0-9_]{0,39}|[A-Z]{1,3})$/;
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
const fail=(error,status=400)=>reply({error},status);
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);

function parseRequest(input){
 if(!isObject(input)||Object.keys(input).some(k=>!["directory_id","table_index","column","offset"].includes(k)))
  throw Error("Неочікувані параметри перевірки");
 if(typeof input.directory_id!=="string"||!/^[\w:-]{1,60}$/.test(input.directory_id)||
   !Number.isSafeInteger(input.table_index)||input.table_index<0||input.table_index>19||
   typeof input.column!=="string"||!FIELD.test(input.column)||
   !Number.isSafeInteger(input.offset)||input.offset<0||input.offset>1200)
  throw Error("Некоректне налаштування перевірки");
 return input;
}
async function readRaw(db,id){
 const item=await db.prepare(
  "SELECT id,version,snapshot_json FROM report_versions WHERE id=? "+
  "AND report_name GLOB 'ANALISE-RAW-V1:*' LIMIT 1"
 ).bind(id).first();
 if(!item)return null;
 const raw=JSON.parse(item.snapshot_json);
 if(raw?.schema_version!=="ANALISE_RAW_D1_V1"||!Array.isArray(raw.tables))throw Error("Недійсна RAW-версія");
 return {id:item.id,version:item.version,data:raw};
}
function extractBatch(data,table_index,column,offset,max=60){
 const table=data.tables?.[table_index];
 if(!table||!Array.isArray(table.columns)||!table.columns.includes(column)||
  !Array.isArray(table.records))
  throw Error("Колонку не знайдено у збереженій RAW-версії");
 const end=Math.min(table.records.length,offset+max);
 const items=[];let empty=0,tooLong=0;
 for(let i=offset;i<end;i++){
  const r=table.records[i],value=r?.values?.[column];
  const original=typeof value==="string"?value:"";
  const clean=original.trim();
  if(!clean){empty++;continue}
  if(clean.length>200||/[\u0000-\u001f\u007f]/u.test(clean)){tooLong++;continue}
  if(!Number.isSafeInteger(r.source_row)||r.source_row<1||r.source_row>15000)
   throw Error("Пошкоджено номер рядка RAW");
  items.push({source_row:r.source_row,raw_value:clean});
 }
 return {table_index,column,offset,processed:end-offset,next_offset:end<table.records.length?end:null,
  total:table.records.length,accepted:items.length,empty,too_long:tooLong,items};
}
export function previewReviewBatch(data,index,column,offset=0){
 return extractBatch(data,index,column,offset);
}
export async function rawReviewApi(req,env,user,seg){
 if(!user||user.role!=="admin"||user.active!==1)return fail("Лише адміністратор",403);
 if(!env.DB)return fail("D1 недоступна",503);
 if(seg.length===3&&seg[2]==="directories"&&req.method==="GET"){
  try{
   const rows=await env.DB.prepare(
    "SELECT id,title FROM directory_types ORDER BY title LIMIT 150"
   ).all();
   return reply({items:rows.results||[]});
  }catch{return fail("Довідники D1 недоступні",503)}
 }
 const id=seg[2];
 if(seg.length!==4||!UUID.test(id||""))return fail("Маршрут не знайдено",404);
 if(seg[3]==="quality"&&req.method==="GET"){
  try{
   const source=await readRaw(env.DB,id);
   if(!source)return fail("Збережену RAW-версію не знайдено",404);
   const rows=await env.DB.prepare(
    "SELECT status, COUNT(*) AS count FROM dq_occurrences "+
    "WHERE source_id=? AND active=1 GROUP BY status"
   ).bind("raw:"+id).all();
   const counts={pending:0,resolved:0,ignored:0};
   for(const r of rows.results||[])if(Object.hasOwn(counts,r.status))counts[r.status]=r.count;
   return reply({source_id:"raw:"+id,source_version:source.version,counts,
    note:"Показники стосуються лише значень, переданих до Чистилища. RAW не змінюється."});
  }catch{return fail("Статус перевірки недоступний",503)}
 }
 if(seg[3]!=="queue"||req.method!=="POST")return fail("Метод не підтримується",405);
 if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
  return fail("Потрібен application/json",415);
 if(Number(req.headers.get("content-length")||0)>4096)return fail("Завеликий запит",413);
 let params;
 try{
  const body=await req.text();
  if(new TextEncoder().encode(body).length>4096)return fail("Завеликий запит",413);
  params=parseRequest(JSON.parse(body));
 }catch(e){return fail(String(e.message||"Некоректний запит"),400)}
 let source,batch;
 try{
  source=await readRaw(env.DB,id);
  if(!source)return fail("Збережену RAW-версію не знайдено",404);
  batch=extractBatch(source.data,params.table_index,params.column,params.offset);
 }catch(e){return fail(String(e.message||"Неможливо прочитати RAW"),400)}
 // Nonempty values are never silently marked as queued when they are skipped.
 // Existing Purgatory ingest validates directory IDs and maintains a separate audit.
 if(!batch.items.length)return reply({...batch,queued:0,review_status:"pending",source_id:"raw:"+id});
 const items=batch.items.map(entry=>({
  directory_id:params.directory_id,context_key:params.column,
  raw_value:entry.raw_value,
  source_id:"raw:"+id,
  source_ref:"raw:"+id+":"+params.table_index+":"+entry.source_row+":"+params.column
 }));
 const proxied=new Request(new URL("/api/purgatory/ingest",req.url),{
  method:"POST",headers:{"content-type":"application/json",
   ...(req.headers.get("origin")?{"origin":req.headers.get("origin")}: {})},
  body:JSON.stringify({items})
 });
 const stored=await purgatoryApi(proxied,env,user,["api","purgatory","ingest"]);
 if(!stored.ok){
  let detail="Чергу перевірки не вдалося оновити";
  try{detail=(await stored.json()).error||detail}catch{}
  return fail(detail,stored.status);
 }
 return reply({...batch,queued:items.length,items:undefined,review_status:"pending",
  source_id:"raw:"+id},201);
}
