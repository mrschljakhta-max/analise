// Administrative station directory: authenticated, admin-only and read-only.
// Never return coordinates, placement history or operational readiness.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store, private",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer"
}});
export async function stationDirectoryApi(req,env,user,segments){
  if(user?.role!=="admin")return json({error:"Лише адміністратор"},403);
  if(req.method!=="GET")return json({error:"Дозволено лише GET"},405);
  if(segments.length!==3||segments[2]!=="data")return json({error:"Невідомий маршрут"},404);
  if(!env.DB)return json({error:"D1 недоступна"},503);
  try{
    const rows=await env.DB.prepare(`
      SELECT s.station_code, s.call_sign, s.is_active, s.updated_at,
             st.name AS station_type, st.type_code,
             COALESCE(ou.short_name,ou.full_name,'') AS org_unit
      FROM stations s
      JOIN station_types st ON st.id=s.station_type_id
      LEFT JOIN org_units ou ON ou.id=s.org_unit_id
      ORDER BY s.station_code COLLATE NOCASE ASC
      LIMIT 5001
    `).all();
    const found=rows.results||[];
    return json({items:found.slice(0,5000),truncated:found.length>5000});
  }catch{
    return json({error:"Не вдалося прочитати довідник станцій D1"},503);
  }
}
