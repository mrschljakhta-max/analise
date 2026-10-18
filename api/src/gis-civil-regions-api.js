// Public civilian gazetteer overview for low-zoom GIS.
// Read-only counts by the existing region name; no military data and no
// coordinates, bounding boxes or specific settlement rows are returned.
const HEADERS={
 "content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
export const CIVIL_REGIONS_SQL=`SELECT
 COALESCE(NULLIF(TRIM(CAST(json_extract(data_json,'$.region') AS TEXT)),''),'Не вказано') AS region,
 COUNT(*) AS total,
 SUM(CASE WHEN json_extract(data_json,'$.lat') IS NOT NULL
  AND json_extract(data_json,'$.lon') IS NOT NULL
  AND TRIM(CAST(json_extract(data_json,'$.lat') AS TEXT))<>''
  AND TRIM(CAST(json_extract(data_json,'$.lon') AS TEXT))<>''
  AND CAST(json_extract(data_json,'$.lat') AS REAL) BETWEEN -85 AND 85
  AND CAST(json_extract(data_json,'$.lon') AS REAL) BETWEEN -180 AND 180
  THEN 1 ELSE 0 END) AS geocoded
 FROM directory_entries
 WHERE directory_id='settlements' AND archived_at IS NULL
 GROUP BY region ORDER BY total DESC, region COLLATE NOCASE LIMIT 101`;
export async function gisCivilRegionsApi(req,env,user){
 if(req.method!=="GET")return json({error:"Дозволено лише GET"},405);
 if(user?.role!=="admin"||user.active!==1)return json({error:"Лише адміністратор"},403);
 if(new URL(req.url).search)return json({error:"Невідомі параметри запиту"},400);
 if(!env?.DB)return json({error:"D1 недоступна",status:"database_unavailable"},503);
 try{
  const r=await env.DB.prepare(CIVIL_REGIONS_SQL).all();
  const rows=r.results||[];
  const items=rows.slice(0,100).map(row=>{
   const total=Number(row.total),geocoded=Number(row.geocoded);
   if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(geocoded)||
    geocoded<0||geocoded>total)throw Error("Недостовірний підсумок");
   return {region:String(row.region||"Не вказано").slice(0,120),
    total,geocoded};
  });
  return json({source:"directory_entries:settlements",status:"available",
   read_only:true,geographic:false,truncated:rows.length>100,items});
 }catch{
  return json({status:"query_failed",error:"Не вдалося прочитати цивільні підсумки D1"},503);
 }
}
