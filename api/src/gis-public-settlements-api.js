// Strictly bounded, admin-only READ access to the PUBLIC settlements gazetteer.
// No UAV data, unit positions, protection objects, stations or coverage sectors.
const headers={
 "content-type":"application/json; charset=utf-8","cache-control":"no-store, private",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer"
};
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers});
export function parseSettlementsBounds(url){
 const query=new URL(url).searchParams;
 const fields=["south","west","north","east"];
 const values={};
 for(const field of fields){
  const raw=query.get(field);
  if(raw==null||raw.trim()===""||!/^[-+]?\d+(?:\.\d+)?$/.test(raw.trim()))
   throw new Error("Потрібні коректні межі карти");
  values[field]=Number(raw);
  if(!Number.isFinite(values[field]))throw new Error("Некоректні географічні координати");
 }
 const {south,west,north,east}=values;
 if(south< -85||north>85||west< -180||east>180||south>=north||west>=east)
  throw new Error("Неприпустимі межі карти");
 if(north-south>14||east-west>24)
  throw new Error("Збільш масштаб для відображення населених пунктів");
 return values;
}
export function parseSettlementsPage(url){
 const q=new URL(url).searchParams;
 if([...q.keys()].some(key=>!["south","west","north","east","offset"].includes(key)))
  throw Error("Невідомий параметр запиту");
 const raw=q.get("offset");
 if(raw===null)return 0;
 if(q.getAll("offset").length!==1||!/^(0|[1-9][0-9]*)$/.test(raw))
  throw Error("Некоректна сторінка довідника");
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<0||n>1800||n%200!==0)
  throw Error("Некоректна сторінка довідника");
 return n;
}
export async function gisPublicSettlementsApi(req,env,user){
 if(req.method!=="GET")return json({error:"Лише GET"},405);
 if(user?.role!=="admin"||user.active!==1)return json({error:"Лише адміністратор"},403);
 let bounds,offset;
 try{bounds=parseSettlementsBounds(req.url);offset=parseSettlementsPage(req.url)}
 catch(e){return json({error:e.message},400)}
 if(!env?.DB)return json({error:"D1 не підключена"},503);
 // Whitelist only public gazetteer fields; never serialize the original
 // data_json (which may include other metadata in later schema versions).
 const sql=`SELECT id,
   TRIM(CAST(json_extract(data_json,'$.name') AS TEXT)) AS name,
   TRIM(CAST(COALESCE(json_extract(data_json,'$.type'),'') AS TEXT)) AS type,
   TRIM(CAST(COALESCE(json_extract(data_json,'$.community'),'') AS TEXT)) AS community,
   TRIM(CAST(COALESCE(json_extract(data_json,'$.district'),'') AS TEXT)) AS district,
   TRIM(CAST(COALESCE(json_extract(data_json,'$.region'),'') AS TEXT)) AS region,
   CAST(json_extract(data_json,'$.lat') AS REAL) AS lat,
   CAST(json_extract(data_json,'$.lon') AS REAL) AS lon
 FROM directory_entries
 WHERE directory_id='settlements' AND archived_at IS NULL
   AND json_extract(data_json,'$.name') IS NOT NULL
   AND TRIM(CAST(json_extract(data_json,'$.name') AS TEXT)) <> ''
   AND json_extract(data_json,'$.lat') IS NOT NULL
   AND json_extract(data_json,'$.lon') IS NOT NULL
   AND TRIM(CAST(json_extract(data_json,'$.lat') AS TEXT)) <> ''
   AND TRIM(CAST(json_extract(data_json,'$.lon') AS TEXT)) <> ''
   AND CAST(json_extract(data_json,'$.lat') AS REAL) BETWEEN ? AND ?
   AND CAST(json_extract(data_json,'$.lon') AS REAL) BETWEEN ? AND ?
 ORDER BY name COLLATE NOCASE, id LIMIT 201 OFFSET ?`;
 try{
  const rows=await env.DB.prepare(sql)
   .bind(bounds.south,bounds.north,bounds.west,bounds.east,offset).all();
  const valid=[];
  for(const r of rows.results||[]){
   const lat=Number(r.lat),lon=Number(r.lon),name=String(r.name||"").trim();
   if(!name||name.length>160||!Number.isFinite(lat)||!Number.isFinite(lon)||
    lat<bounds.south||lat>bounds.north||lon<bounds.west||lon>bounds.east)continue;
   valid.push({id:String(r.id||"").slice(0,64),name,type:String(r.type||"").slice(0,40),
    community:String(r.community||"").slice(0,120),district:String(r.district||"").slice(0,120),
    region:String(r.region||"").slice(0,120),lat,lon});
  }
  const more=(rows.results||[]).length>200;
  return json({directory:"settlements",source_status:"available",items:valid.slice(0,200),
   more,next_offset:more&&offset<1800?offset+200:null,
   truncated:more&&offset>=1800,offset,limit:200});
 }catch{
  // Do not expose query details or schema errors to the browser.
  return json({error:"Не вдалося прочитати публічний довідник населених пунктів"},503);
 }
}
