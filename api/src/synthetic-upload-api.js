// Synthetic-only OOXML/ZIP ingestion for testing ANALISE. Never ingests operational records.
// Accepted test fixtures have an embedded analise-fixture.json AND strict allowlisted names.
// Original bytes are inspected in memory and discarded; only fictional spelling errors enter D1.
import {unzipSync} from "fflate";
import {purgatoryApi} from "./purgatory-api.js";
import {saveSyntheticHistory,syntheticHistoryReady} from "./synthetic-upload-history-api.js";
import {syntheticWordRowsReady} from "./synthetic-word-records.js";
import {inspectSyntheticVersions,assertVersionApproval,withSnapshotPlans} from "./synthetic-report-versions.js";

const encoder=new TextDecoder();
const TEST_ID="demo_quality_labels";
const ALLOWED=new Set(["Альфа-демо","Альфа деммo","Бета-демо","Бетта-демо"]);
const CORRECT=new Set(["Альфа-демо","Бета-демо"]);
const MAX_FILE=5*1024*1024,MAX_ENTRY=2*1024*1024,MAX_EXPANDED=5*1024*1024;
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'"};
const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const invalid=(reason,status=400)=>send({error:reason},status);
const byteToText=v=>encoder.decode(v);
function getZip(bytes){
 let expanded=0,entries=0;
 const out=unzipSync(bytes,{filter:file=>{
  entries++;
  if(entries>300||file.originalSize>MAX_ENTRY)return false;
  expanded+=file.originalSize;
  return expanded<=MAX_EXPANDED;
 }});
 if(entries>300||expanded>MAX_EXPANDED)throw Error("Архів перевищує безпечний розмір");
 return out;
}
const readPart=(parts,name)=>parts[name]?byteToText(parts[name]):"";
function decodeXml(text){
 return text.replace(/&#x([a-f0-9]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
 .replace(/&#([0-9]+);/g,(_,dec)=>String.fromCodePoint(parseInt(dec,10)))
 .replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<")
 .replace(/&gt;/g,">").replace(/&amp;/g,"&");
}
function parseDocx(parts){
 const xml=readPart(parts,"word/document.xml");
 if(!xml||xml.length>MAX_ENTRY)throw Error("Неправильний синтетичний DOCX");
 const rows=xml.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)||[];
 const detail=[];
 for(const row of rows){
  const cells=row.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)||[];
  const values=cells.map(c=>decodeXml((Array.from(c.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
    .map(m=>m[1]).join(""))).trim());
  if(values.length!==4||! /^\d{2}:\d{2}\s\d{2}\.\d{2}\.\d{4}$/.test(values[0]))continue;
  if(!ALLOWED.has(values[2]))throw Error("Документ містить значення поза синтетичним набором");
  detail.push({row:detail.length+1,label:values[2],date_time:values[0],status:CORRECT.has(values[2])?"known":"review"});
 }
 if(detail.length!==76||rows.length!==79)throw Error("Структура Word не відповідає синтетичному зразку");
 return detail;
}
function parseXlsx(parts){
 const xml=readPart(parts,"xl/worksheets/sheet1.xml");
 if(!xml||xml.length>MAX_ENTRY)throw Error("Неправильний синтетичний XLSX");
 const rows=xml.match(/<(?:[a-z]+:)?row(?:\s[^>]*)?>[\s\S]*?<\/(?:[a-z]+:)?row>/g)||[];
 const detail=[];
 for(const row of rows){
  // Only cells A and N are inspected. Never extract or return unrelated fields.
  const index=row.match(/<(?:[a-z]+:)?c\s[^>]*r="A(\d+)"[^>]*>[\s\S]*?<(?:[a-z]+:)?v>(\d+)<\/(?:[a-z]+:)?v>/);
  if(!index||Number(index[1])<=1||Number(index[2])!==Number(index[1])-1)continue;
  const nameCell=row.match(/<(?:[a-z]+:)?c\s[^>]*r="N\d+"[^>]*>[\s\S]*?<\/(?:[a-z]+:)?c>/);
  if(!nameCell)throw Error("У тестовій книзі відсутнє поле перевірки");
  const textMatch=nameCell[0].match(/<(?:[a-z]+:)?v>([\s\S]*?)<\/(?:[a-z]+:)?v>/);
  const name=decodeXml(textMatch?.[1]||"").trim();
  if(!ALLOWED.has(name))throw Error("Книга містить значення поза синтетичним набором");
  detail.push({row:Number(index[1]),label:name,status:CORRECT.has(name)?"known":"review"});
 }
 if(detail.length!==21)throw Error("Структура Excel не відповідає синтетичному зразку");
 return detail;
}
export function parseSyntheticBundle(bytes,name="synthetic.zip"){
 if(bytes.length>MAX_FILE)throw Error("Файл перевищує ліміт 5 МБ");
 if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)throw Error("Очікується DOCX, XLSX або ZIP");
 const ext=name.toLowerCase().split(".").pop();
 const parts=getZip(bytes);
 if(ext==="zip"){
  const result=[];
  for(const [path,value] of Object.entries(parts)){
   if(!/\.(docx|xlsx)$/i.test(path)||path.startsWith("__MACOSX/"))continue;
   if(result.length>=12)throw Error("В архіві забагато документів");
   try{result.push(...parseSyntheticBundle(value,path));}
   catch(e){result.push({name:path,type:"unsupported",error:String(e.message),records:0,detail:[]});}
  }
  if(!result.length)throw Error("В архіві не знайдено тестових DOCX/XLSX");
  return result;
 }
 if(!["docx","xlsx"].includes(ext))throw Error("Непідтримуваний формат");
 const rawManifest=readPart(parts,"analise-fixture.json");
 if(!rawManifest)throw Error("Файл не має позначки синтетичного тесту. Оперативні документи не приймаються");
 let manifest;try{manifest=JSON.parse(rawManifest)}catch{throw Error("Некоректна позначка тестового файла")}
 if(manifest?.marker!=="ANALISE_SYNTHETIC_ONLY_V1"||
   manifest.kind!==ext||manifest.synthetic!==true||manifest.date!=="2026-10-11")
  throw Error("Це не підтверджений синтетичний шаблон");
 const detail=ext==="docx"?parseDocx(parts):parseXlsx(parts);
 if(detail.length!==manifest.expected_rows)throw Error("Кількість записів не збігається з тестовою позначкою");
 return [{name:name.split("/").pop(),type:ext,records:detail.length,
  questions:detail.filter(x=>x.status==="review").length,
  detail,source_id:"synthetic-"+ext+"-2026-10-11",period:"10–11.10.2026",report_date:manifest.date}];
}
async function seedDemo(DB,user){
 const present=await DB.prepare("SELECT id FROM directory_types WHERE id=? LIMIT 1").bind(TEST_ID).first();
 if(!present)throw Error("Спочатку застосуй міграцію D1 0014");
 const now=new Date().toISOString();
 await DB.batch([
  ["demo_quality_alpha_v1","Альфа-демо"],
  ["demo_quality_beta_v1","Бета-демо"]
 ].map(([id,name])=>DB.prepare(
  "INSERT OR IGNORE INTO directory_entries(id,directory_id,data_json,version,created_by,updated_by,created_at,updated_at) "+
  "VALUES (?, ?, ?, 1, ?, ?, ?, ?)"
 ).bind(id,TEST_ID,JSON.stringify({name}),user.id,user.id,now,now)));
}
async function persistDemo(req,env,user,docs){
 const items=[];
 for(const doc of docs){
  if(doc.type==="unsupported")continue;
  for(const line of doc.detail){
   if(line.status!=="review")continue;
   items.push({directory_id:TEST_ID,context_key:"",
    raw_value:line.label,source_id:doc.source_id,
    source_ref:doc.source_id+":row-"+String(line.row).padStart(3,"0")+":label"});
  }
 }
 if(!items.length)return {persisted:0};
 await seedDemo(env.DB,user);
 let saved=0;
 for(let start=0;start<items.length;start+=70){
  const payload={items:items.slice(start,start+70)};
  const internal=new Request(new URL("/api/purgatory/ingest",req.url),{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify(payload)
  });
  const result=await purgatoryApi(internal,env,user,["api","purgatory","ingest"]);
  const body=await result.json();
  if(!result.ok)throw Error(body.error||"Не вдалося зберегти тестові питання");
  saved+=body.accepted;
 }
 // Show CURRENT queue state, not the count of typographical variants in the file.
 // Approved rules may have resolved an issue at insertion time.
 for(const doc of docs){
  if(doc.type==="unsupported")continue;
  const rows=await env.DB.prepare(
   "SELECT source_ref,status FROM dq_occurrences WHERE source_id=? AND active=1 LIMIT 150"
  ).bind(doc.source_id).all();
  const byRef=new Map((rows.results||[]).map(r=>[r.source_ref,r.status]));
  for(const line of doc.detail){
   if(line.status==="known")continue;
   const ref=doc.source_id+":row-"+String(line.row).padStart(3,"0")+":label";
   if(byRef.get(ref)==="resolved")line.status="resolved";
  }
  doc.questions=doc.detail.filter(line=>line.status==="review").length;
 }
 return {persisted:saved};
}
export async function syntheticUploadApi(req,env,user){
 if(!user||user.role!=="admin"||user.active!==1)return invalid("Лише адміністратор",403);
 if(req.method!=="POST")return invalid("Дозволено лише POST",405);
 const mode=new URL(req.url).pathname.endsWith("/inspect")?"inspect":"commit";
 const origin=req.headers.get("origin");
 if(origin&&origin!==new URL(req.url).origin)return invalid("Недозволене джерело",403);
 if(!env.DB)return invalid("D1 недоступна",503);
 if(!["application/octet-stream","application/zip"].includes((req.headers.get("content-type")||"").split(";")[0]))
  return invalid("Очікується бінарний файл");
 if(Number(req.headers.get("content-length")||0)>MAX_FILE)return invalid("Файл перевищує 5 МБ",413);
 const params=new URL(req.url).searchParams;
 const name=params.get("name")||"";
 const suppliedSession=params.get("session");
 if(suppliedSession && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedSession))
  return invalid("Некоректний ідентифікатор сеансу");
 const sessionId=suppliedSession||crypto.randomUUID();
 if(!/^[\p{L}\p{N} _.()\-]{1,160}\.(docx|xlsx|zip)$/iu.test(name))return invalid("Некоректне ім'я файла");
 try{
  if(!await syntheticHistoryReady(env.DB))return invalid("Застосуй міграцію D1 0015",503);
  const buffer=await req.arrayBuffer();if(buffer.byteLength>MAX_FILE)return invalid("Файл перевищує 5 МБ",413);
  const docs=parseSyntheticBundle(new Uint8Array(buffer),name);
  const plans=await inspectSyntheticVersions(env.DB,docs);
  if(mode==="inspect")return send({mode:"synthetic_only",documents:plans.map(p=>({
   kind:p.kind,report_date:p.report_date||null,change:p.change,
   current_revision:p.current_revision||0,expected_version_id:p.expected_version_id||""
  }))});
  if(docs.some(d=>d.type==="docx") && !await syntheticWordRowsReady(env.DB))
   return invalid("Застосуй міграцію D1 0019 для запису тестових рядків Word",503);
  let approved;
  try{
   approved=JSON.parse(req.headers.get("x-analise-version-approval")||"null");
   assertVersionApproval(plans,approved);
  }catch{return invalid("Потрібна попередня перевірка версій або дані застаріли",409)}
  // Only synthetic test labels and safe snapshots can be persisted.
  const versionPlans=withSnapshotPlans(plans,docs);
  // Only the fixed synthetic test labels enter D1. No document originals are uploaded to R2.
  const {persisted}=await persistDemo(req,env,user,docs);
  const history=await saveSyntheticHistory(env.DB,{sessionId,actorId:user.id,uploadName:name,sourceBytes:buffer,documents:docs,versionPlans});
  return send({mode:"synthetic_only",session_id:history.session_id,versions:history.versions,documents:docs,accepted:docs.filter(d=>d.type!=="unsupported").length,
   errors:docs.filter(d=>d.type==="unsupported").length,
   records:docs.reduce((sum,d)=>sum+d.records,0),
   questions:docs.reduce((sum,d)=>sum+(d.questions||0),0),persisted});
 }catch(e){
  const msg=String(e?.message||"Помилка");
  if(/Stale demo report version|UNIQUE constraint failed: demo_report_versions\.kind/.test(msg))
   return invalid("Звіт оновив інший оператор. Повтори перевірку перед заміною.",409);
  if(msg.includes("Застосуй міграцію D1 0016")||msg.includes("Застосуй міграцію D1 0019"))return invalid(msg,503);
  // No personal, operational or file contents are logged or returned.
  if(/синтетичн|Непідтримув|Структура|Архів|Файл|Документ|Книга|тестов|позначк|Очікується|Неправильний|Кількість|ліміт|забагато|збігається|одного виду|звітну дату/.test(msg))
   return invalid(msg);
  return invalid("Не вдалося обробити тестовий документ",503);
 }
}
