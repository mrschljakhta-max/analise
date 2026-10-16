// ANALISE UAV model import: insert-only administrative metadata.
// An .xlsx file is never uploaded. The browser sends a narrowly whitelisted
// preview of DICT_UAV; DICT_FPV statistics and all frequencies are excluded.
const HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'none'"
};
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const trim=v=>typeof v==="string"?v.trim():"";
const norm=v=>trim(v).replace(/\s+/g," ").toLocaleLowerCase("uk-UA");
const codeValid=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{2,80}$/.test(v);
const permitted=["source_row","code","name","airframe","subtype","entry_kind","country","manufacturer","purpose","note","is_active"];
const normalize=(raw)=>{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Некоректний рядок");
  if(Object.keys(raw).length!==permitted.length||
    Object.keys(raw).some(k=>!permitted.includes(k)))throw Error("Неприпустимі поля імпорту");
  const source_row=raw.source_row;
  if(!Number.isSafeInteger(source_row)||source_row<2||source_row>100001)throw Error("Некоректний номер рядка");
  const code=raw.code,name=trim(raw.name),
    airframe=raw.airframe,subtype=raw.subtype,entry_kind=raw.entry_kind;
  if(!codeValid(code)||!name||name.length>160||
     /[\u0000-\u001f\u007f]/.test(name))throw Error("Некоректний код або назва");
  if(!(
    (airframe==="wing"&&subtype==="")||
    (airframe==="multirotor"&&["fpv","quadcopter"].includes(subtype))
  ))throw Error("Некоректне поєднання типу та підтипу");
  if(!["model","generic"].includes(entry_kind))throw Error("Некоректна категорія");
  for(const [field,max] of [["country",120],["manufacturer",160],["purpose",160]]){
    if(typeof raw[field]!=="string"||raw[field].length>max||
       /[\u0000-\u001f\u007f]/.test(raw[field]))throw Error("Некоректне поле "+field);
  }
  if(typeof raw.note!=="string"||raw.note.length>2000||
     /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw.note)){
    throw Error("Некоректна примітка");
  }
  if(![0,1].includes(raw.is_active))throw Error("Некоректний стан");
  return {source_row,code,name,normalized_name:norm(name),airframe,subtype,entry_kind,
    country:trim(raw.country),manufacturer:trim(raw.manufacturer),
    purpose:trim(raw.purpose),note:trim(raw.note),is_active:raw.is_active};
};
async function parse(req){
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json")){
    throw Error("Потрібен JSON-запит");
  }
  const max=131072;
  if(Number(req.headers.get("content-length")||0)>max)throw Error("Запит завеликий");
  const raw=await req.text();
  if(new TextEncoder().encode(raw).length>max)throw Error("Запит завеликий");
  let data;
  try{data=JSON.parse(raw)}catch{throw Error("Некоректний JSON")}
  if(!data||typeof data!=="object"||Array.isArray(data)||
     Object.keys(data).some(k=>!["items","fingerprint","confirm"].includes(k))||
     !Array.isArray(data.items)||data.items.length>250){
    throw Error("Некоректна структура імпорту або забагато рядків");
  }
  if(data.confirm!==undefined&&typeof data.confirm!=="string")throw Error("Некоректне підтвердження");
  if(data.fingerprint!==undefined&&typeof data.fingerprint!=="string")throw Error("Некоректний контрольний код");
  return data;
}
function check(items){
  const errors=[],seenCodes=new Set(),seenNames=new Set(),rows=[];
  for(const [i,raw] of items.entries()){
    try{
      const row=normalize(raw),code=row.code.toLocaleLowerCase("uk-UA");
      if(seenCodes.has(code))errors.push({row:row.source_row,message:"Повтор коду в Excel"});
      if(seenNames.has(row.normalized_name))errors.push({row:row.source_row,message:"Повтор назви в Excel"});
      seenCodes.add(code);seenNames.add(row.normalized_name);rows.push(row);
    }catch(e){
      errors.push({row:Number.isInteger(raw?.source_row)?raw.source_row:i+2,message:e.message});
    }
  }
  return {rows,errors};
}
async function snapshot(DB){
  const r=await DB.prepare("SELECT code,normalized_name FROM uav_models ORDER BY code LIMIT 2001").all();
  const items=r.results||[];
  if(items.length>2000)throw Error("Забагато записів для безпечного порівняння");
  return items.map(x=>({code:x.code,name:norm(x.normalized_name)}));
}
function compare(imported,existing){
  const codes=new Map(existing.map(x=>[x.code.toLocaleLowerCase("uk-UA"),x]));
  const names=new Map(existing.map(x=>[x.name,x]));
  const errors=[],newItems=[],skipped=[];
  for(const row of imported){
    const code=codes.get(row.code.toLocaleLowerCase("uk-UA"));
    const name=names.get(row.normalized_name);
    if(code){
      if(code.name!==row.normalized_name){
        errors.push({row:row.source_row,message:"Код уже існує в D1 з іншою назвою; перезапис заборонений"});
      }else{
        skipped.push({row:row.source_row,code:row.code,name:row.name,message:"Код уже існує — пропущено"});
      }
    }else if(name){
      errors.push({row:row.source_row,message:"Назва вже існує в D1 під іншим кодом"});
    }else newItems.push(row);
  }
  return {errors,newItems,skipped};
}
async function fingerprint(items,existing){
  const encoded=new TextEncoder().encode(JSON.stringify({items,existing}));
  const hash=await crypto.subtle.digest("SHA-256",encoded);
  return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
export async function uavImportApi(req,env,user,seg){
  if(user?.role!=="admin"||user.active===0)return respond({error:"Лише адміністратор"},403);
  if(seg.length!==3||!["prepare","commit"].includes(seg[2]))return respond({error:"Невідомий маршрут"},404);
  const commit=seg[2]==="commit";
  if(req.method!=="POST")return respond({error:"Непідтримуваний метод"},405);
  const origin=req.headers.get("origin");
  if(origin&&origin!==new URL(req.url).origin)return respond({error:"Недозволене джерело"},403);
  if(!env.DB)return respond({error:"D1 недоступна"},503);
  let incoming;
  try{incoming=await parse(req)}catch(e){return respond({error:e.message},400)}
  const parsed=check(incoming.items);
  if(parsed.errors.length)return respond({
    ok:false,errors:parsed.errors,committed:false
  },422);
  let existing,verified,hash;
  try{
    const gate=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name='uav_model_audit_insert' LIMIT 1"
    ).first();
    if(!gate)return respond({error:"Спочатку застосуй міграцію довідника БпЛА 0009"},503);
    existing=await snapshot(env.DB);
    verified=compare(parsed.rows,existing);
    if(verified.errors.length)return respond({
      ok:false,errors:verified.errors,skipped:verified.skipped,committed:false
    },422);
    hash=await fingerprint(parsed.rows,existing);
  }catch{
    return respond({error:"Не вдалося перевірити довідник БпЛА в D1"},503);
  }
  const counts={
    input:parsed.rows.length,new:verified.newItems.length,existing:verified.skipped.length,
    frequencies:0
  };
  if(!commit){
    return respond({ok:true,counts,skipped:verified.skipped,errors:[],
      fingerprint:hash,committed:false});
  }
  if(incoming.confirm!=="IMPORT_UAV_NEW_ONLY"||incoming.fingerprint!==hash){
    return respond({error:"Склад даних або D1 змінилися. Повтори попередню перевірку.",committed:false},409);
  }
  if(!verified.newItems.length)return respond({
    ok:true,counts,committed:false,message:"Нових моделей немає — імпорт не потрібен"
  });
  // Batch is atomic, insert-only, and D1 model audit triggers record every new row.
  const timestamp=new Date().toISOString();
  const statements=verified.newItems.map(row=>env.DB.prepare(
    "INSERT INTO uav_models (id,code,name,normalized_name,airframe,subtype,entry_kind,"+
    "country,manufacturer,purpose,note,is_active,created_at,updated_at) "+
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(),row.code,row.name,row.normalized_name,
    row.airframe,row.subtype,row.entry_kind,row.country,row.manufacturer,
    row.purpose,row.note,row.is_active,timestamp,timestamp));
  try{
    const result=await env.DB.batch(statements);
    if(!Array.isArray(result)||result.length!==statements.length||
       result.some(x=>x.success===false||x.meta?.changes!==1)){
      throw Error("Неповна транзакція");
    }
    return respond({ok:true,counts,committed:true});
  }catch{
    return respond({error:"Імпорт не завершився. Перевір стан D1 перед повтором; старі записи не змінювалися.",
      committed:false},409);
  }
}