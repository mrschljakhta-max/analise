// ANALISE UAV model directory: administrative reference data only.
// No operational sites, mission data, real-time signal processing, or countermeasure recommendations.
const headers={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store, private",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'none'"
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const codeOK=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{2,80}$/.test(v);
const idOK=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{8,100}$/.test(v);
const text=(value,max,{required=false,multi=false}={})=>{
  if(typeof value!=="string")throw Error("Некоректне текстове поле");
  const clean=value.trim();
  if(clean.length>max||(required&&!clean))throw Error("Перевищено довжину або не заповнено обов'язкове поле");
  if((multi?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(clean)){
    throw Error("Некоректні символи у полі");
  }
  return clean;
};
const normal=v=>v.replace(/\s+/g," ").toLocaleLowerCase("uk-UA");
const enumOf=(value,accepted)=>{if(!accepted.includes(value))throw Error("Некоректне значення переліку");return value};
const active=v=>{if(v!==0&&v!==1)throw Error("Стан обліку повинен бути 0 або 1");return v};
const version=v=>{if(!Number.isSafeInteger(v)||v<1)throw Error("Некоректна версія запису");return v};
const nameFields=["code","name","airframe","subtype","entry_kind","use_side","operating_countries","manufacturer","purpose","note","is_active"];
function cleanCountries(value){
  if(!Array.isArray(value)||value.length>30)throw Error("Обери до 30 країн використання");
  const codes=new Set();
  for(const code of value){
    if(typeof code!=="string"||!/^[A-Z]{2}$/.test(code)||codes.has(code)){
      throw Error("Некоректний або повторний код країни");
    }
    codes.add(code);
  }
  return [...codes].sort();
}
const decodeCountries=value=>{
  try{
    const parsed=JSON.parse(value||"[]");
    return Array.isArray(parsed)?parsed.filter(c=>typeof c==="string"&&/^[A-Z]{2}$/.test(c)):[];
  }catch{return []}
};
async function verifyCountryCodes(DB,codes){
  if(!codes.length)return true;
  const placeholders=codes.map(()=>"?").join(",");
  const found=await DB.prepare(
    "SELECT code FROM uav_countries WHERE is_active=1 AND code IN ("+placeholders+")"
  ).bind(...codes).all();
  return new Set((found.results||[]).map(r=>r.code)).size===codes.length;
}

const rfFields=["code","channel_kind","freq_min_mhz","freq_max_mhz","bandwidth_mhz","modulation","source_label","verification_status","note"];
const materialFields=["code","title","kind","url","note"];
function keys(input,expected){
  if(Object.keys(input).length!==expected.length||expected.some(k=>!(k in input))||
     Object.keys(input).some(k=>!expected.includes(k)))throw Error("Некоректний набір полів");
}
function cleanModel(input,editing){
  keys(input,editing?[...nameFields,"version"]:nameFields);
  if(!codeOK(input.code))throw Error("Некоректний код БпЛА");
  const airframe=enumOf(input.airframe,["wing","multirotor"]);
  const subtype=enumOf(input.subtype,["","quadcopter","fpv"]);
  if((airframe==="wing"&&subtype!=="")||
     (airframe==="multirotor"&&!["quadcopter","fpv"].includes(subtype))){
    throw Error("Невірне поєднання типу й підтипу БпЛА");
  }
  const name=text(input.name,160,{required:true});
  return {
    code:input.code,name,normalized_name:normal(name),airframe,subtype,
    entry_kind:enumOf(input.entry_kind,["model","generic"]),
    use_side:text(input.use_side,100),
    operating_countries:cleanCountries(input.operating_countries),
    manufacturer:text(input.manufacturer,160),
    purpose:text(input.purpose,160),note:text(input.note,2000,{multi:true}),
    is_active:active(input.is_active),
    ...(editing?{version:version(input.version)}:{})
  };
}
const number=(v,label)=>{
  if(typeof v!=="number"||!Number.isFinite(v)||v<=0||v>100000){
    throw Error("Некоректне значення: "+label);
  }
  return v;
};
function cleanRF(input,method){
  const existing=method!=="POST";
  if(method==="DELETE"){
    keys(input,["code","id","version"]);
    if(!codeOK(input.code)||!idOK(input.id))throw Error("Некоректний ідентифікатор");
    return {code:input.code,id:input.id,version:version(input.version)};
  }
  keys(input,existing?[...rfFields,"id","version"]:rfFields);
  if(!codeOK(input.code)||(existing&&!idOK(input.id)))throw Error("Некоректний ідентифікатор");
  const lo=number(input.freq_min_mhz,"Початок діапазону, МГц");
  const hi=number(input.freq_max_mhz,"Кінець діапазону, МГц");
  if(hi<lo)throw Error("Кінець частотного діапазону менший за початок");
  const bandwidth=input.bandwidth_mhz===null?null:number(input.bandwidth_mhz,"Смуга сигналу, МГц");
  return {
    code:input.code,
    ...(existing?{id:input.id,version:version(input.version)}:{}),
    channel_kind:enumOf(input.channel_kind,["control","telemetry","navigation","video","backup_video","other"]),
    freq_min_mhz:lo,freq_max_mhz:hi,bandwidth_mhz:bandwidth,
    modulation:text(input.modulation,120),
    source_label:text(input.source_label,180),
    verification_status:enumOf(input.verification_status,["unverified","verified","reference"]),
    note:text(input.note,1200,{multi:true})
  };
}
function cleanMaterial(input,method){
  const existing=method!=="POST";
  if(method==="DELETE"){
    keys(input,["code","id","version"]);
    if(!codeOK(input.code)||!idOK(input.id))throw Error("Некоректний ідентифікатор");
    return {code:input.code,id:input.id,version:version(input.version)};
  }
  keys(input,existing?[...materialFields,"id","version"]:materialFields);
  if(!codeOK(input.code)||(existing&&!idOK(input.id)))throw Error("Некоректний ідентифікатор");
  const url=text(input.url,1000,{required:true});
  let parsed;
  try{parsed=new URL(url)}catch{throw Error("Некоректне посилання")}
  if(parsed.protocol!=="https:"||!parsed.hostname||parsed.username||parsed.password){
    throw Error("Дозволені лише посилання HTTPS без облікових даних");
  }
  return {
    code:input.code,
    ...(existing?{id:input.id,version:version(input.version)}:{}),
    title:text(input.title,180,{required:true}),
    kind:enumOf(input.kind,["image","document","link"]),
    url:parsed.toString(),
    note:text(input.note,1200,{multi:true})
  };
}
async function body(req){
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json")){
    throw Error("Потрібен Content-Type: application/json");
  }
  if(Number(req.headers.get("content-length")||0)>8192)throw Error("Завеликий запит");
  let data;
  try{
    const raw=await req.text();
    if(new TextEncoder().encode(raw).length>8192)throw Error("Завеликий запит");
    data=JSON.parse(raw);
  }catch(e){throw Error(e.message==="Завеликий запит"?e.message:"Некоректний JSON")}
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Очікується JSON-об'єкт");
  return data;
}
function fail(message,status){return json({error:message},status)}
async function auditReady(DB,trigger){
  return Boolean(await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name=? LIMIT 1"
  ).bind(trigger).first());
}
async function modelByCode(DB,code){
  return DB.prepare("SELECT id FROM uav_models WHERE code=? LIMIT 1").bind(code).first();
}
const conflict=()=>fail("Запис змінено в іншій вкладці або його вже немає. Онови картку й повтори дію.",409);
export async function uavCatalogApi(req,env,user,seg){
  if(user?.role!=="admin"||user.active===0)return fail("Лише адміністратор",403);
  if(seg.length!==3||!["data","card","history","models","frequencies","materials","countries"].includes(seg[2])){
    return fail("Невідомий маршрут",404);
  }
  const section=seg[2],method=req.method;
  if(!(
    (method==="GET"&&["data","card","history","countries"].includes(section))||
    ((method==="POST"||method==="PATCH")&&["models","frequencies","materials"].includes(section))||
    (method==="POST"&&section==="countries")||
    (method==="DELETE"&&["frequencies","materials"].includes(section))
  ))return fail("Непідтримувана дія",405);
  if(!env.DB)return fail("D1 недоступна",503);
  if(method!=="GET"){
    const origin=req.headers.get("origin");
    if(origin&&origin!==new URL(req.url).origin)return fail("Недозволене джерело запиту",403);
    let input;
    try{
      const raw=await body(req);
      if(section==="countries"){
        keys(raw,["code","name_uk"]);
        if(typeof raw.code!=="string"||!/^[A-Z]{2}$/.test(raw.code)){
          throw Error("Потрібен дволітерний код ISO держави (наприклад, UA)");
        }
        input={code:raw.code,name_uk:text(raw.name_uk,100,{required:true})};
      }else{
        input=section==="models"?cleanModel(raw,method==="PATCH"):
          section==="frequencies"?cleanRF(raw,method):cleanMaterial(raw,method);
      }
    }catch(e){return fail(e.message,400)}
    const trigger=section==="countries"?"uav_model_operating_audit_update":section==="models"?
      (method==="POST"?"uav_model_audit_insert":"uav_model_audit_update"):
      section==="frequencies"?"uav_frequency_audit_"+(method==="POST"?"insert":method==="PATCH"?"update":"delete"):
      "uav_material_audit_"+(method==="POST"?"insert":method==="PATCH"?"update":"delete");
    try{
      if(!await auditReady(env.DB,trigger)){
        return fail("Спочатку застосуй міграцію 0009 довідника БпЛА. Редагування заблоковано.",503);
      }
      if(section==="countries"){
        await env.DB.prepare(
          "INSERT INTO uav_countries(code,name_uk,is_active) VALUES(?,?,1)"
        ).bind(input.code,input.name_uk).run();
        return json({saved:true,code:input.code},201);
      }
      if(section==="models"&&!await auditReady(env.DB,"uav_model_operating_audit_update")){
        return fail("Потрібна міграція 0010: країни використання та історія змін",503);
      }
      if(section==="models"&&!await verifyCountryCodes(env.DB,input.operating_countries)){
        return fail("Одна або кілька країн відсутні в довіднику держав",400);
      }
      const timestamp=new Date().toISOString();
      if(section==="models"){
        if(method==="POST"){
          const id=crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO uav_models (id,code,name,normalized_name,airframe,subtype,entry_kind,country,"+
            "manufacturer,purpose,note,is_active,use_side,operating_country_codes,created_at,updated_at) "+
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
          ).bind(id,input.code,input.name,input.normalized_name,input.airframe,input.subtype,
            input.entry_kind,"",input.manufacturer,input.purpose,input.note,
            input.is_active,input.use_side,JSON.stringify(input.operating_countries),
            timestamp,timestamp).run();
          return json({saved:true,code:input.code,version:1},201);
        }
        const result=await env.DB.prepare(
          "UPDATE uav_models SET name=?,normalized_name=?,airframe=?,subtype=?,entry_kind=?,"+
          "manufacturer=?,purpose=?,note=?,is_active=?,use_side=?,operating_country_codes=?,"+
          "version=version+1,updated_at=? WHERE code=? AND version=?"
        ).bind(input.name,input.normalized_name,input.airframe,input.subtype,input.entry_kind,
          input.manufacturer,input.purpose,input.note,input.is_active,
          input.use_side,JSON.stringify(input.operating_countries),
          timestamp,input.code,input.version).run();
        if(!result.meta?.changes)return conflict();
        return json({saved:true,code:input.code,version:input.version+1});
      }
      const parent=await modelByCode(env.DB,input.code);
      if(!parent)return fail("Модель БпЛА не знайдено",404);
      if(section==="frequencies"){
        if(method==="POST"){
          const id=crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO uav_frequency_profiles (id,uav_id,channel_kind,freq_min_mhz,freq_max_mhz,"+
            "bandwidth_mhz,modulation,source_label,verification_status,note,created_at,updated_at) "+
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
          ).bind(id,parent.id,input.channel_kind,input.freq_min_mhz,input.freq_max_mhz,
            input.bandwidth_mhz,input.modulation,input.source_label,input.verification_status,
            input.note,timestamp,timestamp).run();
          return json({saved:true,id,version:1},201);
        }
        if(method==="PATCH"){
          const result=await env.DB.prepare(
            "UPDATE uav_frequency_profiles SET channel_kind=?,freq_min_mhz=?,freq_max_mhz=?,"+
            "bandwidth_mhz=?,modulation=?,source_label=?,verification_status=?,note=?,"+
            "version=version+1,updated_at=? WHERE id=? AND uav_id=? AND version=?"
          ).bind(input.channel_kind,input.freq_min_mhz,input.freq_max_mhz,
            input.bandwidth_mhz,input.modulation,input.source_label,input.verification_status,
            input.note,timestamp,input.id,parent.id,input.version).run();
          if(!result.meta?.changes)return conflict();
          return json({saved:true,id:input.id,version:input.version+1});
        }
        const deleted=await env.DB.prepare(
          "DELETE FROM uav_frequency_profiles WHERE id=? AND uav_id=? AND version=?"
        ).bind(input.id,parent.id,input.version).run();
        if(!deleted.meta?.changes)return conflict();
        return json({deleted:true,id:input.id});
      }
      if(method==="POST"){
        const id=crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO uav_materials (id,uav_id,title,kind,url,note,created_at,updated_at) "+
          "VALUES (?,?,?,?,?,?,?,?)"
        ).bind(id,parent.id,input.title,input.kind,input.url,input.note,timestamp,timestamp).run();
        return json({saved:true,id,version:1},201);
      }
      if(method==="PATCH"){
        const result=await env.DB.prepare(
          "UPDATE uav_materials SET title=?,kind=?,url=?,note=?,version=version+1,updated_at=? "+
          "WHERE id=? AND uav_id=? AND version=?"
        ).bind(input.title,input.kind,input.url,input.note,timestamp,input.id,parent.id,input.version).run();
        if(!result.meta?.changes)return conflict();
        return json({saved:true,id:input.id,version:input.version+1});
      }
      const removed=await env.DB.prepare(
        "DELETE FROM uav_materials WHERE id=? AND uav_id=? AND version=?"
      ).bind(input.id,parent.id,input.version).run();
      if(!removed.meta?.changes)return conflict();
      return json({deleted:true,id:input.id});
    }catch(e){
      if(/UNIQUE constraint failed/i.test(String(e?.message||"")))return fail("Такий код уже існує",409);
      return fail("Не вдалося зберегти дані довідника БпЛА у D1",503);
    }
  }
  try{
    if(section==="countries"){
      const countries=await env.DB.prepare(
        "SELECT code,name_uk FROM uav_countries WHERE is_active=1 ORDER BY name_uk COLLATE NOCASE LIMIT 500"
      ).all();
      return json({items:countries.results||[]});
    }
    if(section==="data"){
      const result=await env.DB.prepare(
        "SELECT m.code,m.name,m.airframe,m.subtype,m.entry_kind,m.use_side,"+
        "m.operating_country_codes,m.purpose,m.is_active,m.updated_at,"+
        "(SELECT COUNT(*) FROM uav_frequency_profiles f WHERE f.uav_id=m.id) AS frequency_count,"+
        "(SELECT COUNT(*) FROM uav_materials a WHERE a.uav_id=m.id) AS material_count "+
        "FROM uav_models m ORDER BY m.name COLLATE NOCASE,m.code LIMIT 2001"
      ).all();
      const rows=result.results||[];
      return json({items:rows.slice(0,2000).map(r=>({
        ...r,operating_countries:decodeCountries(r.operating_country_codes),
        operating_country_codes:undefined
      })),truncated:rows.length>2000});
    }
    const code=new URL(req.url).searchParams.get("code")||"";
    if(!codeOK(code))return fail("Некоректний код моделі БпЛА",400);
    const model=await env.DB.prepare(
      "SELECT code,name,airframe,subtype,entry_kind,use_side,operating_country_codes,"+
      "manufacturer,purpose,note,is_active,version,created_at,updated_at "+
      "FROM uav_models WHERE code=? LIMIT 1"
    ).bind(code).first();
    if(!model)return fail("Модель БпЛА не знайдено",404);
    if(section==="history"){
      const events=await env.DB.prepare(
        "SELECT section,action,old_json,new_json,changed_at "+
        "FROM uav_catalog_audit WHERE uav_code=? ORDER BY id DESC LIMIT 101"
      ).bind(code).all();
      const rows=events.results||[];
      return json({history_available:true,items:rows.slice(0,100),truncated:rows.length>100});
    }
    const rf=await env.DB.prepare(
      "SELECT id,channel_kind,freq_min_mhz,freq_max_mhz,bandwidth_mhz,modulation,"+
      "source_label,verification_status,note,version,updated_at "+
      "FROM uav_frequency_profiles WHERE uav_id=(SELECT id FROM uav_models WHERE code=?) "+
      "ORDER BY channel_kind,id LIMIT 501"
    ).bind(code).all();
    const mats=await env.DB.prepare(
      "SELECT id,title,kind,url,note,version,updated_at "+
      "FROM uav_materials WHERE uav_id=(SELECT id FROM uav_models WHERE code=?) "+
      "ORDER BY title COLLATE NOCASE,id LIMIT 501"
    ).bind(code).all();
    const publicModel={...model,operating_countries:decodeCountries(model.operating_country_codes)};
    delete publicModel.operating_country_codes;
    return json({model:publicModel,frequencies:(rf.results||[]).slice(0,500),
      materials:(mats.results||[]).slice(0,500),
      truncated_frequencies:(rf.results||[]).length>500,
      truncated_materials:(mats.results||[]).length>500});
  }catch(e){
    if(/no such table: uav_|no such column: (use_side|operating_country_codes)/i.test(String(e?.message||""))){
      return fail("Потрібно застосувати міграції довідника БпЛА D1 (до 0010 включно).",503);
    }
    return fail("Не вдалося прочитати довідник БпЛА з D1",503);
  }
}