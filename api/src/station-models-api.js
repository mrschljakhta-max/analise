// ANALISE model catalog: administrative metadata only.
// No geolocation, performance parameters, antenna configuration or operational state.
const headers={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store, private",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer"
};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const isCode=s=>typeof s==="string"&&s.length>0&&s.length<=100&&/^[A-Za-z0-9_-]+$/.test(s);
const normalizeName=s=>s.trim().replace(/\s+/g," ").toLocaleLowerCase("uk-UA");

async function parseChange(req){
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json")){
    return {error:"Потрібен JSON-запит"};
  }
  if(Number(req.headers.get("content-length")||0)>4096)return {error:"Завеликий запит"};
  let input;
  try{
    const data=await req.text();
    if(new TextEncoder().encode(data).length>4096)return {error:"Завеликий запит"};
    input=JSON.parse(data);
  }catch{return {error:"Некоректний JSON"}}
  if(!input||Array.isArray(input)||typeof input!=="object")return {error:"Очікується JSON-об’єкт"};
  const allowed=["code","expected_updated_at","name","category","note","is_active"];
  if(Object.keys(input).some(key=>!allowed.includes(key))||allowed.some(key=>!(key in input))){
    return {error:"Редагувати можна тільки назву, категорію, примітку та стан моделі"};
  }
  if(!isCode(input.code))return {error:"Некоректний код моделі"};
  if(typeof input.expected_updated_at!=="string"||
    input.expected_updated_at.length>80||!input.expected_updated_at.trim()){
    return {error:"Немає версії запису"};
  }
  const name=typeof input.name==="string"?input.name.trim().replace(/\s+/g," "):"";
  const category=typeof input.category==="string"?input.category.trim().replace(/\s+/g," "):"";
  const note=typeof input.note==="string"?input.note.trim():"";
  if(!name||name.length>160||/[\u0000-\u001f\u007f]/.test(name)){
    return {error:"Назва моделі повинна містити 1–160 символів"};
  }
  if(!category||category.length>120||/[\u0000-\u001f\u007f]/.test(category)){
    return {error:"Категорія повинна містити 1–120 символів"};
  }
  if(note.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)){
    return {error:"Примітка має бути коротшою за 2000 символів"};
  }
  if(![0,1].includes(input.is_active)){
    return {error:"Обліковий стан повинен бути 0 або 1"};
  }
  return {value:{code:input.code,expected_updated_at:input.expected_updated_at,
    name,normalized_name:normalizeName(name),category,note,is_active:input.is_active}};
}

export async function stationModelsApi(req,env,user,segments){
  if(user?.role!=="admin"||user.active===0)return reply({error:"Лише адміністратор"},403);
  if(segments.length!==3||!["data","card"].includes(segments[2])){
    return reply({error:"Невідомий маршрут"},404);
  }
  const mode=segments[2];
  if(req.method!=="GET"&&!(req.method==="PATCH"&&mode==="card")){
    return reply({error:"Непідтримувана дія"},405);
  }
  if(!env.DB)return reply({error:"D1 недоступна"},503);
  if(req.method==="PATCH"){
    const origin=req.headers.get("origin");
    if(origin&&origin!==new URL(req.url).origin)return reply({error:"Недозволене джерело"},403);
    const parsed=await parseChange(req);
    if(parsed.error)return reply({error:parsed.error},400);
    const input=parsed.value;
    try{
      const oldIso=input.expected_updated_at.includes("T")
        ?input.expected_updated_at
        :input.expected_updated_at.replace(" ","T")+"Z";
      const millis=Date.parse(oldIso);
      const timestamp=Number.isFinite(millis)&&millis>=Date.now()
        ?new Date(millis+1).toISOString():new Date().toISOString();
      // Compare-and-swap protects concurrent updates. Stable keys & relationships stay intact.
      const res=await env.DB.prepare(
        "UPDATE station_types SET name=?,normalized_name=?,category=?,note=?,is_active=?,updated_at=? "+
        "WHERE import_code=? AND updated_at=?"
      ).bind(input.name,input.normalized_name,input.category,input.note,input.is_active,
        timestamp,input.code,input.expected_updated_at).run();
      if(!res.meta?.changes)return reply({
        error:"Модель уже змінено або не знайдено. Онови картку й повтори спробу."
      },409);
      return reply({saved:true,code:input.code,updated_at:timestamp});
    }catch{
      return reply({error:"Не вдалося оновити модель у D1"},503);
    }
  }

  try{
    if(mode==="data"){
      const list=await env.DB.prepare(
        "SELECT st.import_code,st.type_code,st.name,st.category,st.is_active,st.updated_at,"+
        "(SELECT COUNT(*) FROM stations s WHERE s.station_type_id=st.id) AS station_count,"+
        "(SELECT COUNT(*) FROM station_type_antennas a WHERE a.station_type_id=st.id) AS profile_count "+
        "FROM station_types st ORDER BY st.name COLLATE NOCASE,st.import_code LIMIT 501"
      ).all();
      const found=list.results||[];
      return reply({items:found.slice(0,500),truncated:found.length>500});
    }

    const code=new URL(req.url).searchParams.get("code")||"";
    if(!isCode(code))return reply({error:"Некоректний код моделі"},400);
    const model=await env.DB.prepare(
      "SELECT st.import_code,st.type_code,st.name,st.category,st.note,st.is_active,st.updated_at,"+
      "(SELECT COUNT(*) FROM stations s WHERE s.station_type_id=st.id) AS station_count,"+
      "(SELECT COUNT(*) FROM station_type_antennas a WHERE a.station_type_id=st.id) AS profile_count "+
      "FROM station_types st WHERE st.import_code=? LIMIT 1"
    ).bind(code).first();
    if(!model)return reply({error:"Модель не знайдено"},404);
    return reply({model});
  }catch{
    return reply({error:"Не вдалося отримати довідник моделей із D1"},503);
  }
}
