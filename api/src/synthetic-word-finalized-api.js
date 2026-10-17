// Strictly fictional Word records physically stored in Cloudflare D1.
// No real source document or sensitive operational field is accepted here.
const HEADER={
 "content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store",
 "x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADER});
const fail=(status,error)=>send({error},status);
const ALLOWED=new Set(["Альфа-демо","Альфа деммo","Бета-демо","Бетта-демо"]);
const CANONICAL=new Set(["Альфа-демо","Бета-демо"]);
export function summarizePersistedSyntheticWord(doc,rawRows){
 if(!doc||!Array.isArray(rawRows)||rawRows.length>100)return null;
 let saved=0,pending=0;
 const seen=new Set(),items=[];
 for(const row of rawRows){
  if(!Number.isInteger(row.source_row)||row.source_row<1||row.source_row>100||
   seen.has(row.source_row)||!ALLOWED.has(row.source_label)||
   !(row.canonical_label===null||CANONICAL.has(row.canonical_label))||
   !["none","original","manual","rule"].includes(row.resolution_origin))return null;
  const known=CANONICAL.has(row.source_label),ready=row.canonical_label!==null;
  if(known&&(row.canonical_label!==row.source_label||row.resolution_origin!=="original"))return null;
  if(!known&&ready&&!["manual","rule"].includes(row.resolution_origin))return null;
  if(ready&&row.resolution_origin==="none"||!ready&&row.resolution_origin!=="none")return null;
  seen.add(row.source_row);
  if(ready)saved++;else pending++;
  items.push({row:row.source_row,status:ready?"saved":"pending",
   ...(ready?{label:row.canonical_label,origin:row.resolution_origin}:{})});
 }
 return {id:doc.id,name:doc.document_name,created_at:doc.created_at,
  report_date:doc.report_date,revision:doc.revision,
  persisted:true,saved,pending,total:items.length,items};
}
export async function syntheticWordFinalizedApi(req,env,user){
 if(!user||user.role!=="admin"||user.active!==1)return fail(403,"Лише адміністратор");
 if(req.method!=="GET")return fail(405,"Лише GET");
 if(!env.DB)return fail(503,"D1 недоступна");
 try{
  const ready=await env.DB.prepare("SELECT name FROM sqlite_master "+
   "WHERE type='table' AND name='demo_word_rows' LIMIT 1").first();
  if(!ready)return fail(503,"Спочатку застосуй міграцію D1 0019");
  const params=new URL(req.url).searchParams;
  const limitText=params.get("limit")||"10",offsetText=params.get("offset")||"0";
  if(!/^\d{1,2}$/.test(limitText)||!/^\d{1,5}$/.test(offsetText))return fail(400,"Неправильна сторінка");
  const limit=Number(limitText),offset=Number(offsetText);
  if(limit<1||limit>25||offset>20000)return fail(400,"Неправильна сторінка");
  // Only current active immutable report versions. Historical versions still
  // retain rows in D1 but do not inflate the live confirmation totals.
  const result=await env.DB.prepare(
   "SELECT v.id,v.source_name AS document_name,v.created_at,v.report_date,v.revision "+
   "FROM demo_report_active a JOIN demo_report_versions v ON a.version_id=v.id "+
   "WHERE a.kind='docx' ORDER BY v.report_date DESC,v.created_at DESC,v.id DESC "+
   "LIMIT ? OFFSET ?"
  ).bind(limit+1,offset).all();
  const page=result.results||[],documents=[];
  for(const doc of page.slice(0,limit)){
   const r=await env.DB.prepare(
    "SELECT source_row,source_label,canonical_label,resolution_origin "+
    "FROM demo_word_rows WHERE version_id=? ORDER BY source_row LIMIT 101"
   ).bind(doc.id).all();
   const summary=summarizePersistedSyntheticWord(doc,r.results||[]);
   if(!summary)return fail(503,"Некоректні збережені тестові записи Word");
   documents.push(summary);
  }
  return send({mode:"synthetic_only",storage:"cloudflare_d1",
   documents,saved:documents.reduce((n,x)=>n+x.saved,0),
   pending:documents.reduce((n,x)=>n+x.pending,0),
   has_more:page.length>limit,next_offset:offset+limit,offset});
 }catch{
  return fail(503,"Не вдалося прочитати збережені тестові записи Word");
 }
}
