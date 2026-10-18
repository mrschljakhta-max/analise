// Coarse, read-only spatial aggregate of CIVILIAN settlement directory entries.
// Coordinates returned are mathematical centers of 1°/2° cells, never military
// positions or exact coordinates of any individual settlement.
const HEADERS={
 "content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store",
 "x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
export const CIVIL_GRID_SQL=`WITH civil AS (
 SELECT CAST(json_extract(data_json,'$.lat') AS REAL) AS lat,
        CAST(json_extract(data_json,'$.lon') AS REAL) AS lon
 FROM directory_entries
 WHERE directory_id='settlements' AND archived_at IS NULL
  AND json_extract(data_json,'$.lat') IS NOT NULL
  AND json_extract(data_json,'$.lon') IS NOT NULL
  AND TRIM(CAST(json_extract(data_json,'$.lat') AS TEXT))<>''
  AND TRIM(CAST(json_extract(data_json,'$.lon') AS TEXT))<>''
), buckets AS (
 SELECT CAST((lat+90)/? AS INTEGER) AS y,
        CAST((lon+180)/? AS INTEGER) AS x
 FROM civil
 WHERE lat BETWEEN -85 AND 85 AND lon BETWEEN -180 AND 180
)
SELECT y,x,COUNT(*) AS n FROM buckets
GROUP BY y,x ORDER BY n DESC,y,x LIMIT 501`;
export function parseCivilGridCell(url){
 const query=new URL(url).searchParams;
 if(query.size===0)return 1;
 if([...query.keys()].length!==1||query.getAll("cell").length!==1||
    !["1","2"].includes(query.get("cell")))throw Error("Неприпустима сітка");
 return Number(query.get("cell"));
}
export async function gisCivilGridApi(request,env,user){
 if(request.method!=="GET")return respond({error:"Дозволено лише GET"},405);
 if(user?.role!=="admin"||user.active!==1)
  return respond({error:"Лише адміністратор"},403);
 let cell;
 try{cell=parseCivilGridCell(request.url)}
 catch{return respond({error:"Некоректні параметри сітки"},400)}
 if(!env?.DB)return respond({status:"database_unavailable",error:"D1 не підключена"},503);
 try{
  const result=await env.DB.prepare(CIVIL_GRID_SQL).bind(cell,cell).all();
  const source=result.results||[];
  const truncated=source.length>500;
  const items=[];
  for(const row of source.slice(0,500)){
   const x=Number(row.x),y=Number(row.y),count=Number(row.n);
   if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||
      !Number.isSafeInteger(count)||count<1||
      x<0||x>Math.ceil(360/cell)||y<0||y>Math.ceil(180/cell))
    throw Error("Некоректні агрегати");
   const lat=(y+0.5)*cell-90,lon=(x+0.5)*cell-180;
   if(lat<-85||lat>85||lon<-180||lon>180)continue;
   items.push({id:x+"-"+y,lat,lon,count});
  }
  return respond({
   status:"available",source:"directory_entries:settlements",
   kind:"civilian_grid",read_only:true,cell_degrees:cell,
   centers_are_cell_centers:true,truncated,items
  });
 }catch{
  return respond({status:"query_failed",error:"Не вдалося прочитати цивільні кластери D1"},503);
 }
}
