// Word-only read model for explicitly synthetic ANALISE fixtures.
// Does not accept uploaded bytes and never returns non-demo field values.
// Approved results are projected from persistent D1 snapshots and subsequent
// purgatory resolutions, making re-upload unnecessary for the demo.
const HEADER={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'none'"
};
const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADER});
const fail=(status,error)=>send({error},status);
const DEMO_DIRECTORY="demo_quality_labels";
const SOURCE_ID="synthetic-docx-2026-10-11";
const RAW_LABELS=new Set(["Альфа-демо","Альфа деммo","Бета-демо","Бетта-демо"]);
const TARGETS=new Map([
  ["demo_quality_alpha_v1","Альфа-демо"],
  ["demo_quality_beta_v1","Бета-демо"]
]);
const KNOWN=new Set(TARGETS.values());

function safeSnapshot(raw){
  let value;
  try{value=JSON.parse(raw)}catch{return null}
  if(!value||value.type!=="docx"||!Number.isInteger(value.records)||
    !Array.isArray(value.detail)||value.detail.length!==value.records||
    value.records<1||value.records>100)return null;
  const unique=new Set();
  const detail=[];
  for(const item of value.detail){
    if(!item||!Number.isInteger(item.row)||item.row<1||item.row>100||
      !RAW_LABELS.has(item.label)||!["known","resolved","review"].includes(item.status)||
      unique.has(item.row))return null;
    // A valid original label is always canonical regardless of snapshot status.
    if(KNOWN.has(item.label)&&item.status!=="known")return null;
    if(!KNOWN.has(item.label)&&item.status==="known")return null;
    unique.add(item.row);
    detail.push({row:item.row,source_label:item.label});
  }
  return detail;
}

export function summarizeSyntheticWordDocument(doc,occurrences){
  const detail=safeSnapshot(doc.snapshot_json);
  if(!detail)return null;
  let saved=0,pending=0;
  const items=detail.map(item=>{
    const known=KNOWN.has(item.source_label);
    const occurrence=occurrences.get(SOURCE_ID+":row-"+String(item.row).padStart(3,"0")+":label");
    // Only known, fixed fictional dictionary IDs are allowed as corrected targets.
    const label=known?item.source_label:
      occurrence?.status==="resolved"&&
      occurrence?.target_directory===DEMO_DIRECTORY&&
      TARGETS.get(occurrence?.target_id)===occurrence?.target_label
        ?occurrence.target_label:null;
    if(label)saved++;else pending++;
    return {row:item.row,status:label?"saved":"pending",
      ...(label?{label,origin:known?"original":occurrence?.resolution_origin==="manual"?"manual":"rule"}:{})};
  });
  return {id:doc.id,name:doc.document_name,created_at:doc.created_at,
    saved,pending,total:items.length,items};
}

export async function syntheticWordFinalizedApi(req,env,user){
  if(!user||user.role!=="admin"||user.active!==1)return fail(403,"Лише адміністратор");
  if(req.method!=="GET")return fail(405,"Лише GET");
  if(!env.DB)return fail(503,"D1 недоступна");
  try{
    const ready=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' "+
      "AND name='demo_import_documents' LIMIT 1").first();
    if(!ready)return fail(503,"Спочатку застосуй міграцію D1 0015");
    const params=new URL(req.url).searchParams;
    const limitText=params.get("limit")||"10",offsetText=params.get("offset")||"0";
    if(!/^\d{1,2}$/.test(limitText)||!/^\d{1,5}$/.test(offsetText))
      return fail(400,"Неправильна сторінка");
    const limit=Number(limitText),offset=Number(offsetText);
    if(limit<1||limit>25||offset>20000)return fail(400,"Неправильна сторінка");
    const rows=await env.DB.prepare(
      "SELECT id,document_name,created_at,snapshot_json FROM demo_import_documents "+
      "WHERE kind='docx' AND status='accepted' ORDER BY created_at DESC,id DESC "+
      "LIMIT ? OFFSET ?"
    ).bind(limit+1,offset).all();
    const occurrenceRows=await env.DB.prepare(
      "SELECT o.source_ref,o.status,o.target_id,o.resolution_origin,"+
      "e.directory_id AS target_directory,json_extract(e.data_json,'$.name') AS target_label "+
      "FROM dq_occurrences o LEFT JOIN directory_entries e ON e.id=o.target_id "+
      "WHERE o.directory_id=? AND o.source_id=? AND o.active=1 LIMIT 200"
    ).bind(DEMO_DIRECTORY,SOURCE_ID).all();
    const occurrences=new Map((occurrenceRows.results||[]).map(x=>[x.source_ref,x]));
    const raw=rows.results||[],docs=[];
    for(const doc of raw.slice(0,limit)){
      const result=summarizeSyntheticWordDocument(doc,occurrences);
      if(result)docs.push(result);
    }
    return send({mode:"synthetic_only",documents:docs,
      saved:docs.reduce((n,x)=>n+x.saved,0),
      pending:docs.reduce((n,x)=>n+x.pending,0),
      has_more:raw.length>limit,next_offset:offset+limit,offset});
  }catch{
    return fail(503,"Не вдалося прочитати тестові результати Word");
  }
}
