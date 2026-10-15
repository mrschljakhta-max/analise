// Strictly administrative, insert-only equipment directory import.
// Accepts only whitelisted inventory metadata: no coordinates, placement or live operating state.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"no-store, private",
  "x-content-type-options":"nosniff","referrer-policy":"no-referrer"
}});
const text=v=>String(v??"").trim();
const norm=v=>text(v).toLocaleUpperCase("uk");
const issue=(errors,sheet,row,message)=>errors.push({sheet,row,message});
const keys={
  types:["import_code","type_code","name","normalized_name","category","can_detect","can_jam","is_active","note"],
  bands:["band_code","type_import_code","antenna_kind","mode","freq_from_mhz","freq_to_mhz","radius_km","coverage_type","width_deg","is_active"],
  stations:["station_code","call_sign","type_import_code","org_ref","org_name","is_active"],
  org_mapping:["ref","id"]
};
const maxLength=(v,n)=>text(v).length<=n;
const hasOnly=(obj,names)=>obj&&typeof obj==="object"&&!Array.isArray(obj)&&Object.keys(obj).every(k=>names.includes(k));
function yesNo(v){
  if(v===true||v===1||/^(так|yes|true|1)$/i.test(text(v)))return 1;
  if(v===false||v===0||/^(ні|no|false|0)$/i.test(text(v)))return 0;
  return null;
}
function finite(v,lo,hi){
  if(text(v)==="")return null;
  const n=Number(v);
  return Number.isFinite(n)&&n>=lo&&n<=hi?n:null;
}
function preparePayload(input){
  const errors=[],warnings=[];
  if(!hasOnly(input,["types","bands","stations","org_mapping"]))return {errors:[{message:"Невідомі поля запиту"}],warnings};
  for(const k of ["types","bands","stations"])if(!Array.isArray(input[k]))return {errors:[{message:"Потрібен масив "+k}],warnings};
  if((input.org_mapping!==undefined&&!Array.isArray(input.org_mapping))||
     input.types.length<1||input.types.length>150||input.bands.length<1||input.bands.length>450||
     input.stations.length<1||input.stations.length>750||(input.org_mapping||[]).length>150)
    return {errors:[{message:"Некоректна кількість записів"}],warnings};
  for(const k of ["types","bands","stations","org_mapping"]){
    for(const v of input[k]||[])if(!hasOnly(v,keys[k]))
      return {errors:[{message:"Неприпустимі поля у "+k+" (можна передавати лише облікові дані)"}],warnings};
  }
  const types=[],bands=[],stations=[],mapRows=[];
  const typeIds=new Set(),typeCodes=new Set(),bandIds=new Set(),stationCodes=new Set(),kindIds=new Set(),mapIds=new Set();
  input.types.forEach((v,i)=>{
    const row=i+2,import_code=text(v.import_code),type_code=text(v.type_code),name=text(v.name),
      category=text(v.category),normalized_name=text(v.normalized_name)||name.toLocaleLowerCase("uk"),
      note=text(v.note),can_detect=yesNo(v.can_detect),can_jam=yesNo(v.can_jam),is_active=yesNo(v.is_active);
    if(!import_code||!maxLength(import_code,90)||!type_code||!maxLength(type_code,80)||!name||!maxLength(name,200)||
       !maxLength(normalized_name,200)||!category||!maxLength(category,80)||!maxLength(note,2000)||
       can_detect===null||can_jam===null||is_active===null)
      issue(errors,"DICT_STATION_TYPES",row,"Неповні або некоректні поля моделі");
    if(typeIds.has(norm(import_code))||typeCodes.has(norm(type_code)))
      issue(errors,"DICT_STATION_TYPES",row,"Повторний код моделі");
    typeIds.add(norm(import_code));typeCodes.add(norm(type_code));
    types.push({import_code,type_code,name,normalized_name,category,can_detect,can_jam,is_active,note});
  });
  input.bands.forEach((v,i)=>{
    const row=i+2,band_code=text(v.band_code),type_import_code=text(v.type_import_code),
      antenna_kind=text(v.antenna_kind),mode=text(v.mode),coverage_type=text(v.coverage_type),
      freq_from_mhz=finite(v.freq_from_mhz,0,1000000),freq_to_mhz=finite(v.freq_to_mhz,0,1000000),
      radius_km=finite(v.radius_km,0.000001,100000),width_deg=finite(v.width_deg,0.000001,360),
      is_active=yesNo(v.is_active);
    if(!band_code||!maxLength(band_code,80)||!typeIds.has(norm(type_import_code))||is_active===null)
      issue(errors,"DICT_STATION_TYPE_BANDS",row,"Некоректний код характеристики, модель або прапорець активності");
    if(bandIds.has(norm(band_code)))issue(errors,"DICT_STATION_TYPE_BANDS",row,"Повторний код характеристики");
    bandIds.add(norm(band_code));
    const key=norm(type_import_code)+"|"+antenna_kind;
    if(kindIds.has(key))issue(errors,"DICT_STATION_TYPE_BANDS",row,"Повторний вид характеристики для моделі");
    kindIds.add(key);
    if(!["detection","omni_jam","directional_jam"].includes(antenna_kind)||
       !["jam","detect"].includes(mode)||
       (antenna_kind==="detection"&&mode!=="detect")||
       (antenna_kind!=="detection"&&mode!=="jam")||
       (antenna_kind==="omni_jam"&&coverage_type!=="omni")||
       (antenna_kind==="directional_jam"&&coverage_type!=="sector")||
       !["omni","sector"].includes(coverage_type)||
       freq_from_mhz===null||freq_to_mhz===null||freq_to_mhz<freq_from_mhz||
       radius_km===null||width_deg===null||
       (coverage_type==="omni"&&width_deg!==360)||
       (coverage_type==="sector"&&width_deg>=360))
      issue(errors,"DICT_STATION_TYPE_BANDS",row,"Некоректні параметри характеристики");
    bands.push({band_code,type_import_code,antenna_kind,mode,freq_from_mhz,freq_to_mhz,radius_km,
      coverage_type,width_deg,is_active});
  });
  input.stations.forEach((v,i)=>{
    const row=i+2,station_code=text(v.station_code),call_sign=text(v.call_sign),
      type_import_code=text(v.type_import_code),org_ref=text(v.org_ref),org_name=text(v.org_name),
      is_active=yesNo(v.is_active);
    if(!station_code||!maxLength(station_code,100)||!call_sign||!maxLength(call_sign,180)||
       !typeIds.has(norm(type_import_code))||!maxLength(org_ref,160)||!maxLength(org_name,200)||
       is_active===null)
      issue(errors,"DICT_STATIONS",row,"Некоректна назва, код, модель або прапорець активності");
    if(stationCodes.has(norm(station_code)))issue(errors,"DICT_STATIONS",row,"Повторний код станції");
    stationCodes.add(norm(station_code));
    stations.push({station_code,call_sign,type_import_code,org_ref,org_name,is_active});
  });
  (input.org_mapping||[]).forEach((m,i)=>{
    const ref=text(m.ref),id=text(m.id);
    if(!ref||!id||!maxLength(ref,200)||!maxLength(id,100)||mapIds.has(norm(ref)))
      issue(errors,"MAPPING",i+1,"Некоректне або повторне зіставлення підрозділу");
    mapIds.add(norm(ref));mapRows.push({ref,id});
  });
  for(const t of types){
    const relevant=bands.filter(b=>norm(b.type_import_code)===norm(t.import_code));
    if(t.can_detect&&!relevant.some(b=>b.mode==="detect"))
      warnings.push({sheet:"DICT_STATION_TYPES",message:"Для моделі "+t.type_code+" задекларовано виявлення без характеристики"});
    if(t.can_jam&&!relevant.some(b=>b.mode==="jam"))
      warnings.push({sheet:"DICT_STATION_TYPES",message:"Для моделі "+t.type_code+" задекларовано подавлення без характеристики"});
  }
  return {errors,warnings,data:{types,bands,stations,org_mapping:mapRows}};
}
async function bodyFrom(req){
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
    throw Error("Очікується application/json");
  const limit=256*1024;
  if(Number(req.headers.get("content-length")||0)>limit)throw Error("Завеликий запит");
  const raw=await req.text();
  if(new TextEncoder().encode(raw).length>limit)throw Error("Завеликий запит");
  let parsed;
  try{parsed=JSON.parse(raw)}catch{throw Error("Некоректний JSON")}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("Очікується JSON-об'єкт");
  return parsed;
}
async function queryDb(db){
  const [models,antennas,stations,units]=await Promise.all([
    db.prepare("SELECT import_code,type_code FROM station_types LIMIT 10001").all(),
    db.prepare("SELECT band_code FROM station_type_antennas LIMIT 10001").all(),
    db.prepare("SELECT station_code FROM stations LIMIT 10001").all(),
    db.prepare("SELECT id,import_key,unit_code,short_name,full_name,is_active FROM org_units LIMIT 1001").all()
  ]);
  const datasets=[models.results||[],antennas.results||[],stations.results||[],units.results||[]];
  if(datasets.some((rows,i)=>rows.length> ([10000,10000,10000,1000][i])))
    throw Error("Забагато записів для безпечної перевірки");
  return {models:datasets[0],antennas:datasets[1],stations:datasets[2],units:datasets[3]};
}
function resolveAndCheck(data,dbRows){
  const errors=[],warnings=[],resolved=[];
  const existingImportCodes=new Set(dbRows.models.map(x=>norm(x.import_code)));
  const existingTypeCodes=new Set(dbRows.models.map(x=>norm(x.type_code)));
  const existingBandCodes=new Set(dbRows.antennas.map(x=>norm(x.band_code)));
  const existingStations=new Set(dbRows.stations.map(x=>norm(x.station_code)));
  data.types.forEach((v,i)=>{
    if(existingImportCodes.has(norm(v.import_code))||existingTypeCodes.has(norm(v.type_code)))
      issue(errors,"DICT_STATION_TYPES",i+2,"Модель уже існує в D1. Оновлення існуючих записів заборонено");
  });
  data.bands.forEach((v,i)=>{
    if(existingBandCodes.has(norm(v.band_code)))
      issue(errors,"DICT_STATION_TYPE_BANDS",i+2,"Характеристика вже існує в D1");
  });
  const unitsById=new Map(dbRows.units.map(x=>[x.id,x]));
  const maps=new Map(data.org_mapping.map(x=>[norm(x.ref),x.id]));
  for(const m of data.org_mapping)if(!unitsById.has(m.id))
    issue(errors,"MAPPING",null,"Вказано неіснуючий ID підрозділу");
  let unassigned=0;
  data.stations.forEach((v,i)=>{
    if(existingStations.has(norm(v.station_code)))
      issue(errors,"DICT_STATIONS",i+2,"Станція з таким кодом уже існує в D1");
    const key=v.org_ref||v.org_name;
    let id=null;
    if(key){
      const manual=maps.get(norm(key));
      if(manual)id=manual;
      else{
        const matching=dbRows.units.filter(x=>[x.id,x.import_key,x.unit_code].some(candidate=>norm(candidate)===norm(key)));
        if(matching.length===1)id=matching[0].id;
        else issue(errors,"DICT_STATIONS",i+2,"Не зіставлено підрозділ. Обери його явно в таблиці відповідностей");
      }
      const unit=id?unitsById.get(id):null;
      if(unit&&Number(unit.is_active)!==1)
        issue(errors,"DICT_STATIONS",i+2,"Вказаний підрозділ неактивний");
      if(id&&!unit)issue(errors,"DICT_STATIONS",i+2,"Неіснуючий підрозділ");
    }else unassigned++;
    resolved.push({...v,org_unit_id:id});
  });
  if(unassigned)warnings.push({sheet:"DICT_STATIONS",message:"Без підрозділу: "+unassigned+" (у вихідному Excel обидва поля порожні)"});
  return {errors,warnings,stations:resolved,unassigned};
}
async function fingerprint(data){
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  const buf=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export async function stationImportWriteApi(req,env,user,segments){
  if(user?.role!=="admin")return json({error:"Лише адміністратор"},403);
  if(segments.length!==3||!["org-units","prepare","commit"].includes(segments[2]))
    return json({error:"Невідомий маршрут"},404);
  const mode=segments[2];
  if(req.method!==(mode==="org-units"?"GET":"POST"))return json({error:"Метод не підтримується"},405);
  if(!env.DB)return json({error:"D1 недоступна"},503);
  if(mode==="org-units"){
    try{
      const items=await env.DB.prepare("SELECT id,import_key,unit_code,short_name,full_name,is_active FROM org_units ORDER BY unit_code LIMIT 1001").all();
      if((items.results||[]).length>1000)return json({error:"Забагато підрозділів"},409);
      return json({items:items.results||[]});
    }catch{return json({error:"Не вдалося прочитати довідник підрозділів"},503)}
  }
  let body;
  try{body=await bodyFrom(req)}catch(e){return json({error:e.message},400)}
  if(!hasOnly(body,["payload","fingerprint","confirm"]))return json({error:"Невідомі поля запиту"},400);
  const parsed=preparePayload(body.payload);
  if(parsed.errors.length)return json({ok:false,errors:parsed.errors,warnings:parsed.warnings,committed:false},422);
  let dbRows;
  try{dbRows=await queryDb(env.DB)}
  catch{return json({error:"Не вдалося перевірити вміст D1",committed:false},503)}
  const checked=resolveAndCheck(parsed.data,dbRows);
  const errors=[...parsed.errors,...checked.errors],warnings=[...parsed.warnings,...checked.warnings];
  const counts={models:parsed.data.types.length,bands:parsed.data.bands.length,
    stations:parsed.data.stations.length,unassigned:checked.unassigned};
  const dataToWrite={types:parsed.data.types,bands:parsed.data.bands,stations:checked.stations};
  const hash=await fingerprint(dataToWrite);
  if(mode==="prepare")
    return json({ok:errors.length===0,errors,warnings,counts,fingerprint:errors.length===0?hash:null,
      committed:false},errors.length?422:200);
  if(errors.length)return json({ok:false,errors,warnings,committed:false},409);
  if(body.confirm!=="IMPORT_NEW_ONLY"||typeof body.fingerprint!=="string"||body.fingerprint!==hash)
    return json({error:"Спершу виконай попередню перевірку та підтвердь незмінений склад даних",
      committed:false},409);
  // Rechecks above are required on every commit. D1 batch executes statements atomically.
  const ids=new Map(parsed.data.types.map(t=>[norm(t.import_code),crypto.randomUUID()]));
  const statements=[];
  for(const t of parsed.data.types){
    statements.push(env.DB.prepare(
      "INSERT INTO station_types (id,import_code,type_code,name,normalized_name,category,can_detect,can_jam,is_active,note) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(ids.get(norm(t.import_code)),t.import_code,t.type_code,t.name,t.normalized_name,t.category,t.can_detect,t.can_jam,t.is_active,t.note));
  }
  for(const b of parsed.data.bands){
    statements.push(env.DB.prepare(
      "INSERT INTO station_type_antennas (id,band_code,station_type_id,antenna_kind,mode,freq_from_mhz,freq_to_mhz,radius_km,coverage_type,width_deg,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(crypto.randomUUID(),b.band_code,ids.get(norm(b.type_import_code)),b.antenna_kind,b.mode,
      b.freq_from_mhz,b.freq_to_mhz,b.radius_km,b.coverage_type,b.width_deg,b.is_active));
  }
  for(const s of checked.stations){
    statements.push(env.DB.prepare(
      "INSERT INTO stations (id,station_code,call_sign,station_type_id,org_unit_id,is_active) VALUES (?,?,?,?,?,?)"
    ).bind(crypto.randomUUID(),s.station_code,s.call_sign,ids.get(norm(s.type_import_code)),s.org_unit_id,s.is_active));
  }
  try{
    const result=await env.DB.batch(statements);
    if(!Array.isArray(result)||result.length!==statements.length||result.some(x=>x.success===false))
      throw Error("D1 batch incomplete");
    return json({ok:true,committed:true,counts});
  }catch{
    return json({error:"Не вдалося завершити транзакцію D1. Перевір стан бази перед повтором",committed:false},409);
  }
}
