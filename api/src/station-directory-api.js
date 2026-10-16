// Administrative equipment registry endpoints, behind Cloudflare Access and admin role.
// No geolocation, technical parameters or operational/deployment fields are returned or editable.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store, private",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer"
}});

const isValidCode=value=>typeof value==="string"&&
  value.length>0&&value.length<=100&&/^[A-Za-z0-9_-]+$/.test(value);

async function parseEdit(req){
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json")){
    return {error:"Потрібен Content-Type: application/json"};
  }
  if(Number(req.headers.get("content-length")||0)>4096)return {error:"Завеликий запит"};
  let data;
  try{
    const input=await req.text();
    if(new TextEncoder().encode(input).length>4096)return {error:"Завеликий запит"};
    data=JSON.parse(input);
  }catch{return {error:"Невірний JSON"}}
  if(!data||Array.isArray(data)||typeof data!=="object")
    return {error:"Очікується JSON-об'єкт"};
  const fields=["code","expected_updated_at","call_sign","org_unit_id","is_active"];
  if(Object.keys(data).some(k=>!fields.includes(k))||fields.some(k=>!(k in data)))
    return {error:"Дозволено змінювати тільки назву, підрозділ і стан обліку"};
  const name=typeof data.call_sign==="string"?data.call_sign.trim():"";
  if(!isValidCode(data.code))return {error:"Некоректний код станції"};
  if(!name||name.length>160||/[\u0000-\u001f\u007f]/.test(name))
    return {error:"Назва повинна містити від 1 до 160 символів без керувальних знаків"};
  if(typeof data.expected_updated_at!=="string"||!data.expected_updated_at||
    data.expected_updated_at.length>80)
    return {error:"Потрібна дата версії запису"};
  if(data.org_unit_id!==null&&
    (typeof data.org_unit_id!=="string"||!data.org_unit_id||
     data.org_unit_id.length>128))
    return {error:"Некоректний ID підрозділу"};
  if(data.is_active!==0&&data.is_active!==1)
    return {error:"Обліковий стан повинен бути 0 або 1"};
  return {value:{code:data.code,expected_updated_at:data.expected_updated_at,
    call_sign:name,org_unit_id:data.org_unit_id,is_active:data.is_active}};
}

export async function stationDirectoryApi(req,env,user,segments){
  if(user?.role!=="admin"||user.active===0)return json({error:"Лише адміністратор"},403);
  if(segments.length!==3||!["data","card","units","history"].includes(segments[2]))
    return json({error:"Невідомий маршрут"},404);
  const section=segments[2];
  if(!((req.method==="GET")||(req.method==="PATCH"&&section==="card")))
    return json({error:"Непідтримувана дія"},405);
  if(!env.DB)return json({error:"D1 недоступна"},503);
  if(req.method==="PATCH"){
    // Even when Access session cookies are present, reject cross-origin writes.
    const origin=req.headers.get("origin");
    if(origin&&origin!==new URL(req.url).origin)return json({error:"Недозволене джерело запиту"},403);
    const parsed=await parseEdit(req);
    if(parsed.error)return json({error:parsed.error},400);
    const input=parsed.value;
    try{
      // Every successful administrative edit must be auditable.
      // Until migration 0008 is applied, fail closed rather than silently lose history.
      const auditTrigger=await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name='station_accounting_audit_after_update' LIMIT 1"
      ).first();
      if(!auditTrigger)return json({
        error:"Спочатку застосуй міграцію журналу обліку станцій у D1. До цього редагування заблоковано."
      },503);
      if(input.org_unit_id!==null){
        const unit=await env.DB.prepare(
          "SELECT id FROM org_units WHERE id=? AND is_active=1 LIMIT 1"
        ).bind(input.org_unit_id).first();
        if(!unit)return json({error:"Підрозділ відсутній або неактивний"},400);
      }
      // Read time only for making the next edit timestamp strictly greater.
      // Compare-and-swap in UPDATE is authoritative for concurrent edits.
      const nowIso=new Date().toISOString();
      const oldIso=input.expected_updated_at.includes("T")
        ?input.expected_updated_at
        :input.expected_updated_at.replace(" ","T")+"Z";
      const oldMillis=Date.parse(oldIso);
      const newTimestamp=Number.isFinite(oldMillis)&&oldMillis>=Date.now()
        ?new Date(oldMillis+1).toISOString():nowIso;
      const result=await env.DB.prepare(
        "UPDATE stations SET call_sign=?,org_unit_id=?,is_active=?,updated_at=? "+
        "WHERE station_code=? AND updated_at=?"
      ).bind(input.call_sign,input.org_unit_id,input.is_active,newTimestamp,
        input.code,input.expected_updated_at).run();
      if(!result.meta?.changes)return json({
        error:"Запис уже було змінено або його не знайдено. Онови картку й повтори редагування."
      },409);
      return json({saved:true,code:input.code,updated_at:newTimestamp});
    }catch{
      return json({error:"Не вдалося зберегти облікові поля у D1"},503);
    }
  }

  try{
    if(section==="history"){
      const code=new URL(req.url).searchParams.get("code")?.trim()||"";
      if(!isValidCode(code))return json({error:"Некоректний код станції"},400);
      const station=await env.DB.prepare(
        "SELECT id FROM stations WHERE station_code=? LIMIT 1"
      ).bind(code).first();
      if(!station)return json({error:"Станцію не знайдено"},404);
      try{
        const events=await env.DB.prepare(
          "SELECT changed_at,old_call_sign,new_call_sign,"+
          "old_org_unit_label,new_org_unit_label,"+
          "old_is_active,new_is_active "+
          "FROM station_accounting_audit WHERE station_code=? "+
          "ORDER BY id DESC LIMIT 101"
        ).bind(code).all();
        const rows=events.results||[];
        return json({history_available:true,items:rows.slice(0,100),truncated:rows.length>100});
      }catch(e){
        if(/no such table: station_accounting_audit/i.test(String(e?.message||e))){
          return json({history_available:false,items:[],truncated:false});
        }
        throw e;
      }
    }
    if(section==="units"){
      const rows=await env.DB.prepare(
        "SELECT id,unit_code,short_name,full_name FROM org_units "+
        "WHERE is_active=1 ORDER BY unit_code COLLATE NOCASE LIMIT 501"
      ).all();
      const found=rows.results||[];
      return json({items:found.slice(0,500),truncated:found.length>500});
    }
    if(section==="data"){
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
    if(!isValidCode(code))return json({error:"Некоректний код станції"},400);
    const station=await env.DB.prepare(`
      SELECT s.station_code, s.call_sign, s.is_active,
             s.org_unit_id, s.updated_at AS station_updated_at,
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
    return json({station:publicStation,characteristics:characteristics.results||[]});
  }catch{
    return json({error:"Не вдалося прочитати обліковий довідник D1"},503);
  }
}
