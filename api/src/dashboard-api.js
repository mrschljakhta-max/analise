// ANALISE home dashboard: aggregate administrative counts only.
// No object coordinates, unit relationships, station assignments, or row-level data.
const HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store, private",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'none'"
};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:HEADERS});
const count=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error("Invalid D1 count");return n;};
export async function dashboardApi(req,env,user,segments){
  if(segments.length!==3||segments[2]!=="data")return json({error:"Невідомий маршрут"},404);
  if(req.method!=="GET")return json({error:"Дозволено лише GET"},405);
  if(!env.DB||!user||user.active!==1)return json({error:"Немає доступу до даних"},403);
  // Roles without directory administration permissions do not get directory
  // inventory totals; the public menu only exposes their existing routes.
  if(user.role!=="admin"){
    return json({role:"user",counts:null,generated_at:new Date().toISOString()});
  }
  try{
    const row=await env.DB.prepare(
      "SELECT "+
      "(SELECT COUNT(*) FROM directory_entries WHERE directory_id='settlements' AND archived_at IS NULL) AS settlements,"+
      "(SELECT COUNT(*) FROM org_units) AS org_units,"+
      "(SELECT COUNT(*) FROM stations) AS stations,"+
      "(SELECT COUNT(*) FROM station_types) AS station_models,"+
      "(SELECT COUNT(*) FROM uav_models) AS uav_models,"+
      "(SELECT COUNT(*) FROM vp_sp_objects WHERE kind='vp') AS vp,"+
      "(SELECT COUNT(*) FROM vp_sp_objects WHERE kind='sp') AS sp,"+
      "(SELECT COUNT(*) FROM contacts) AS contacts"
    ).first();
    if(!row)return json({error:"Не вдалося отримати підсумок"},503);
    return json({
      role:"admin",
      counts:{
        settlements:count(row.settlements),
        org_units:count(row.org_units),
        stations:count(row.stations),
        station_models:count(row.station_models),
        uav_models:count(row.uav_models),
        vp:count(row.vp),
        sp:count(row.sp),
        contacts:count(row.contacts)
      },
      generated_at:new Date().toISOString()
    });
  }catch(e){
    // Do not surface SQL or private data if the migrations are incomplete.
    return json({error:"Не вдалося отримати підсумкові дані D1. Перевір міграції."},503);
  }
}
