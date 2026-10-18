// Historical metadata of document uploads and administrative review actions.
// No event-level operational records, geographic coordinates, UAV positions,
// station locations/sectors, document contents, names or user identities.
const HEADERS={"content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store","x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer","content-security-policy":"default-src 'none'"};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
function dateParts(value){
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const time=Date.parse(value+"T00:00:00Z");
 if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)return null;
 return time;
}
export function historicalRange(url){
 const p=new URL(url).searchParams;
 if([...p.keys()].some(x=>!["from","to"].includes(x)))throw Error("Непідтримуваний фільтр");
 const from=p.get("from"),to=p.get("to");
 const a=dateParts(from),b=dateParts(to);
 if(a===null||b===null||a>b||b-a>366*86400000)
  throw Error("Вкажи коректний період до 366 днів");
 const exclusiveTo=new Date(b+86400000).toISOString().slice(0,10);
 return {from,to,exclusiveTo};
}
const numbers=x=>Math.max(0,Math.floor(Number(x)||0));
export async function historicalAuditApi(req,env,user){
 if(req.method!=="GET")return reply({error:"Лише GET"},405);
 if(!user||user.role!=="admin"||user.active!==1)
  return reply({error:"Лише адміністратор"},403);
 let dates;try{dates=historicalRange(req.url)}
 catch(e){return reply({error:e.message},400)}
 if(!env?.DB)return reply({error:"D1 недоступна"},503);
 const {from,to,exclusiveTo}=dates;
 try{
  // Not a timeline of UAV incidents or military operations.
  // RAW record_count is summed per *saved version*, not unique real-world events.
  const statements=[
   "SELECT substr(created_at,1,10) AS day, COUNT(*) AS versions, "+
   "SUM(CASE WHEN json_extract(snapshot_json,'$.kind')='docx' THEN 1 ELSE 0 END) AS docx, "+
   "SUM(CASE WHEN json_extract(snapshot_json,'$.kind')='xlsx' THEN 1 ELSE 0 END) AS xlsx, "+
   "SUM(COALESCE(CAST(json_extract(snapshot_json,'$.record_count') AS INTEGER),0)) AS rows_saved, "+
   "SUM(MAX(0,COALESCE(CAST(json_extract(snapshot_json,'$.record_count') AS INTEGER),0)-"+
   "COALESCE(CAST(json_extract(snapshot_json,'$.valid_structure_count') AS INTEGER),0))) AS needs_review "+
   "FROM report_versions WHERE report_name GLOB 'ANALISE-RAW-V1:*' "+
   "AND created_at>=? AND created_at<? GROUP BY substr(created_at,1,10) ORDER BY day",
   "SELECT substr(at,1,10) AS day, "+
   "SUM(CASE WHEN action='created' THEN 1 ELSE 0 END) AS quality_created, "+
   "SUM(CASE WHEN action='updated' THEN 1 ELSE 0 END) AS quality_updated "+
   "FROM dq_audit WHERE at>=? AND at<? GROUP BY substr(at,1,10) ORDER BY day",
   "SELECT substr(at,1,10) AS day, COUNT(*) AS directory_changes "+
   "FROM directory_entry_audit WHERE at>=? AND at<? "+
   "GROUP BY substr(at,1,10) ORDER BY day",
   "SELECT substr(at,1,10) AS day, COUNT(*) AS record_changes "+
   "FROM record_audit WHERE at>=? AND at<? "+
   "GROUP BY substr(at,1,10) ORDER BY day"
  ];
  const result=await Promise.all(statements.map(sql=>env.DB.prepare(sql).bind(from,exclusiveTo).all()));
  const byDay=new Map();
  for(let i=0;i<result.length;i++){
   for(const row of result[i].results||[]){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.day||"")||row.day<from||row.day>to)continue;
    const current=byDay.get(row.day)||{
     day:row.day,versions:0,docx:0,xlsx:0,rows_saved:0,needs_review:0,
     quality_created:0,quality_updated:0,directory_changes:0,record_changes:0};
    const keys=i===0?["versions","docx","xlsx","rows_saved","needs_review"]:
     i===1?["quality_created","quality_updated"]:i===2?["directory_changes"]:["record_changes"];
    for(const key of keys)current[key]=numbers(row[key]);
    byDay.set(row.day,current);
   }
  }
  const days=[...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const totals={versions:0,docx:0,xlsx:0,rows_saved:0,needs_review:0,
   quality_created:0,quality_updated:0,directory_changes:0,record_changes:0};
  for(const day of days)for(const k of Object.keys(totals))totals[k]+=day[k];
  return reply({schema:"ANALISE_HISTORICAL_METADATA_V1",from,to,
   date_semantics:"document_saved_at_and_audit_action_at_NOT_original_event_date",
   read_only:true,geo_data:false,totals,days});
 }catch{
  return reply({error:"Історію метаданих наразі не вдалося прочитати"},503);
 }
}
