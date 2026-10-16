// Private, synthetic-only ingestion history. Real report bytes are never stored.
// The snapshot is intentionally limited to fictional demo names and row statuses.
const headers={
 "content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'"
};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const fail=(status,error)=>respond({error},status);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateRe=/^\d{4}-\d{2}-\d{2}$/;
const nameLimit=160;
function validId(value){return typeof value==="string"&&uuid.test(value)}
export async function syntheticHistoryReady(DB){
 return Boolean(await DB.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='demo_import_documents' LIMIT 1"
 ).first());
}
function snapshot(doc){
 if(doc.type==="unsupported"){
  return JSON.stringify({name:String(doc.name||"").slice(0,nameLimit),type:"unsupported",
   records:0,questions:0,detail:[]});
 }
 // Fail closed if a future parser introduces any non-demo labels.
 const allowed=new Set(["Альфа-демо","Альфа деммo","Бета-демо","Бетта-демо"]);
 const detail=doc.detail.map(x=>{
  if(!allowed.has(x.label)||!Number.isSafeInteger(x.row)||x.row<1||x.row>100
  ||!["known","resolved","review"].includes(x.status))throw Error("Invalid synthetic snapshot");
  return {row:x.row,label:x.label,status:x.status};
 });
 const packed=JSON.stringify({name:doc.name,type:doc.type,records:doc.records,questions:doc.questions,detail});
 if(packed.length>23000)throw Error("Synthetic snapshot too large");
 return packed;
}
const digestHex=buffer=>crypto.subtle.digest("SHA-256",buffer).then(d=>[...new Uint8Array(d)]
 .map(b=>b.toString(16).padStart(2,"0")).join(""));
export async function saveSyntheticHistory(DB,{sessionId,actorId,uploadName,sourceBytes,documents}){
 if(!validId(sessionId))throw Error("Invalid import session");
 if(typeof uploadName!=="string"||uploadName.length>nameLimit)throw Error("Invalid input name");
 if(!Array.isArray(documents)||documents.length===0||documents.length>12)throw Error("Invalid document count");
 const hash=await digestHex(sourceBytes);
 const queries=[
  DB.prepare("INSERT OR IGNORE INTO demo_import_sessions(id,actor_id) VALUES (?,?)").bind(sessionId,actorId)
 ];
 const owner=await DB.prepare("SELECT actor_id FROM demo_import_sessions WHERE id=?").bind(sessionId).first();
 if(owner&&owner.actor_id!==actorId)throw Error("Import session not owned by actor");
 for(let index=0;index<documents.length;index++){
  const doc=documents[index],status=doc.type==="unsupported"?"skipped":"accepted";
  const rows=status==="accepted"?doc.records:0;
  const pending=status==="accepted"?doc.detail.filter(x=>x.status==="review").length:0;
  const resolved=status==="accepted"?doc.detail.filter(x=>x.status==="resolved").length:0;
  const body=snapshot(doc);
  queries.push(DB.prepare(
   "INSERT OR IGNORE INTO demo_import_documents "+
   "(id,session_id,input_sha256,member_index,input_name,document_name,kind,status,row_count,pending_count,auto_resolved_count,snapshot_json) "+
   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(),sessionId,hash,index,uploadName,String(doc.name).slice(0,nameLimit),
    status==="accepted"?doc.type:"unsupported",status,rows,pending,resolved,body));
 }
 queries.push(DB.prepare(
  "UPDATE demo_import_sessions SET updated_at=CURRENT_TIMESTAMP,"+
  "input_count=(SELECT COUNT(DISTINCT input_sha256) FROM demo_import_documents WHERE session_id=?),"+
  "document_count=(SELECT COUNT(*) FROM demo_import_documents WHERE session_id=? AND status='accepted'),"+
  "row_count=(SELECT COALESCE(SUM(row_count),0) FROM demo_import_documents WHERE session_id=?),"+
  "pending_count=(SELECT COALESCE(SUM(pending_count),0) FROM demo_import_documents WHERE session_id=?),"+
  "auto_resolved_count=(SELECT COALESCE(SUM(auto_resolved_count),0) FROM demo_import_documents WHERE session_id=?),"+
  "skipped_count=(SELECT COUNT(*) FROM demo_import_documents WHERE session_id=? AND status='skipped')"+
  " WHERE id=? AND actor_id=?"
 ).bind(sessionId,sessionId,sessionId,sessionId,sessionId,sessionId,sessionId,actorId));
 await DB.batch(queries);
 return {session_id:sessionId};
}
export async function syntheticHistoryApi(req,env,user,segments){
 if(!user||user.role!=="admin"||user.active!==1)return fail(403,"Лише адміністратор");
 if(req.method!=="GET")return fail(405,"Тільки GET");
 if(!env.DB)return fail(503,"D1 недоступна");
 try{
  if(!await syntheticHistoryReady(env.DB))return fail(503,"Застосуй міграцію D1 0015");
  const id=segments[3];
  if(id){
   if(!validId(id))return fail(400,"Некоректний ідентифікатор");
   const session=await env.DB.prepare(
    "SELECT id,actor_id,created_at,updated_at,input_count,document_count,row_count,pending_count,"+
    "auto_resolved_count,skipped_count FROM demo_import_sessions WHERE id=? LIMIT 1"
   ).bind(id).first();
   if(!session)return fail(404,"Сеанс не знайдено");
   const docs=await env.DB.prepare(
    "SELECT document_name,input_name,kind,status,row_count,pending_count,auto_resolved_count,snapshot_json,created_at "+
    "FROM demo_import_documents WHERE session_id=? ORDER BY created_at,member_index,id LIMIT 120"
   ).bind(id).all();
   return respond({session,documents:(docs.results||[]).map(d=>{
    let snap={};try{snap=JSON.parse(d.snapshot_json)}catch{}
    return {name:d.document_name,input_name:d.input_name,type:d.kind,status:d.status,
      records:d.row_count,questions:d.pending_count,resolved:d.auto_resolved_count,
      detail:Array.isArray(snap.detail)?snap.detail:[]};
   })});
  }
  const params=new URL(req.url).searchParams;
  const date=params.get("date")||"";
  if(date&&(!dateRe.test(date)||Number.isNaN(Date.parse(date+"T00:00:00Z"))))
   return fail(400,"Некоректна дата");
  const offset=Number(params.get("offset")||0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return fail(400,"Некоректна сторінка");
  const statement=date?
   env.DB.prepare("SELECT id,actor_id,created_at,updated_at,input_count,document_count,row_count,pending_count,auto_resolved_count,skipped_count "+
    "FROM demo_import_sessions WHERE substr(created_at,1,10)=? ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?").bind(date,offset):
   env.DB.prepare("SELECT id,actor_id,created_at,updated_at,input_count,document_count,row_count,pending_count,auto_resolved_count,skipped_count "+
    "FROM demo_import_sessions ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?").bind(offset);
  const rows=(await statement.all()).results||[];
  return respond({sessions:rows.slice(0,30),has_more:rows.length>30,offset,next_offset:offset+30});
 }catch{
  return fail(503,"Історію зараз не вдалося прочитати");
 }
}
