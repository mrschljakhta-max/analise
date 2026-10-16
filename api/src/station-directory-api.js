// Administrative station directory: authenticated, admin-only and read-only.
// Excludes coordinates, placement history and operational state from every response.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store, private",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer"
}});

export async function stationDirectoryApi(req,env,user,segments){
  if(user?.role!=="admin")return json({error:"Лише адміністратор"},403);
  if(req.method!=="GET")return json({error:"Дозволено лише GET"},405);
  if(segments.length!==3||!["data","card"].includes(segments[2]))return json({error:"Невідомий маршрут"},404);
  if(!env.DB)return json({error:"D1 недоступна"},503);
  try{
    if(segments[2]==="data"){
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
    }

    const code=new URL(req.url).searchParams.get("code")?.trim()||"";
    if(!code||code.length>100||!/^[A-Za-z0-9_-]+$/.test(code)){
      return json({error:"Некоректний код станції"},400);
    }
    const station=await env.DB.prepare(`
      SELECT s.station_code, s.call_sign, s.is_active,
             s.updated_at AS station_updated_at,
             st.id AS station_type_id, st.name AS station_type,
             st.type_code, st.import_code AS type_import_code,
             st.category, st.can_detect, st.can_jam,
             st.is_active AS type_is_active, st.updated_at AS type_updated_at,
             COALESCE(ou.short_name,ou.full_name,'') AS org_unit,
             COALESCE(ou.unit_code,'') AS org_unit_code
      FROM stations s
      JOIN station_types st ON st.id=s.station_type_id
      LEFT JOIN org_units ou ON ou.id=s.org_unit_id
      WHERE s.station_code=? LIMIT 1
    `).bind(code).first();
    if(!station)return json({error:"Станцію не знайдено"},404);

    // Only catalog presence and declared capability; never expose band parameters,
    // geographic details, per-station antenna states or operational activity.
    const characteristics=await env.DB.prepare(`
      SELECT antenna_kind, is_active
      FROM station_type_antennas
      WHERE station_type_id=?
      ORDER BY CASE antenna_kind
        WHEN 'detection' THEN 1
        WHEN 'directional_jam' THEN 2
        WHEN 'omni_jam' THEN 3 ELSE 4 END
    `).bind(station.station_type_id).all();
    const {station_type_id,...publicStation}=station;
    return json({station:publicStation,characteristics:characteristics.results||[],
      history_available:false});
  }catch{
    return json({error:"Не вдалося прочитати картку станції D1"},503);
  }
}
