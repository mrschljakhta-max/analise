// Restricted archival file-inventory statistics. No raw event rows or document text.
const HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'none'"
};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const formats=new Set(["xlsx","docx","pdf","csv","txt"]);
const keys=(value,allow)=>Object.keys(value).every(k=>allow.includes(k));
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;

export function validateQualityInventory(body){
  if(!body||typeof body!=="object"||Array.isArray(body)||!keys(body,["batch_key","nested_archives","files"]))
    throw new Error("Дозволено лише ідентифікатор пакета та кількості файлів");
  const batch_key=body.batch_key;
  if(typeof batch_key!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(batch_key))
    throw new Error("Неправильний batch_key");
  const nested_archives=body.nested_archives??0;
  if(!integer(nested_archives,0,100))throw new Error("Некоректна кількість вкладених архівів");
  if(!Array.isArray(body.files)||body.files.length<1||body.files.length>5)
    throw new Error("Очікується від 1 до 5 форматів файлів");
  const seen=new Set();
  const files=body.files.map(item=>{
    if(!item||typeof item!=="object"||Array.isArray(item)||!keys(item,["format","total","unique"]))
      throw new Error("Не дозволено передавати файли, назви, координати або вміст");
    const {format,total,unique}=item;
    if(!formats.has(format)||seen.has(format)||!integer(total,1,100000)||!integer(unique,0,total))
      throw new Error("Некоректні або повторні кількості за форматами");
    seen.add(format);
    return {format,total,unique};
  }).sort((a,b)=>a.format.localeCompare(b.format,"en"));
  const total=files.reduce((n,f)=>n+f.total,0);
  const unique=files.reduce((n,f)=>n+f.unique,0);
  if(total>100000)throw new Error("Перевищено ліміт записів інвентаризації");
  return {batch_key,nested_archives,files,total,unique,duplicates:total-unique};
}

async function parseBody(req){
  if(!String(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
    throw new Error("Потрібен Content-Type: application/json");
  if(Number(req.headers.get("content-length")||0)>8192)throw new Error("Завеликий запит");
  const txt=await req.text();
  if(new TextEncoder().encode(txt).length>8192)throw new Error("Завеликий запит");
  return JSON.parse(txt);
}
async function sha256(txt){
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(txt)));
  return Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
}
export async function qualityInventoryApi(req,env,user){
  if(!user||user.role!=="admin"||user.active!==1)return response({error:"Лише адміністратор"},403);
  if(req.method==="GET"){
    try{
      const rows=await env.DB.prepare(
        "SELECT id,batch_key,total_files,unique_files,duplicate_files,nested_archives,created_at FROM quality_inventory_batches ORDER BY created_at DESC,id DESC LIMIT 50"
      ).all();
      const batches=rows.results||[];
      if(!batches.length)return response({items:[],totals:{batches:0,files:0,unique:0,duplicates:0}});
      const formatRows=await env.DB.prepare(
        "SELECT batch_id,file_format,file_instances,unique_files,duplicate_files FROM quality_inventory_file_types WHERE batch_id IN (SELECT id FROM quality_inventory_batches ORDER BY created_at DESC,id DESC LIMIT 50) ORDER BY file_format"
      ).all();
      const byId=new Map(batches.map(b=>[b.id,{batch_key:b.batch_key,total:b.total_files,unique:b.unique_files,duplicates:b.duplicate_files,nested_archives:b.nested_archives,created_at:b.created_at,formats:[]}]));
      for(const r of formatRows.results||[])byId.get(r.batch_id)?.formats.push({format:r.file_format,total:r.file_instances,unique:r.unique_files,duplicates:r.duplicate_files});
      const items=[...byId.values()];
      return response({items,totals:{batches:items.length,files:items.reduce((n,x)=>n+x.total,0),
        unique:items.reduce((n,x)=>n+x.unique,0),duplicates:items.reduce((n,x)=>n+x.duplicates,0)},limit:50});
    }catch{return response({error:"Схема D1 недоступна. Перевір міграцію 0020."},503);}
  }
  if(req.method!=="POST")return response({error:"Дозволено GET або POST"},405);
  let data;
  try{data=validateQualityInventory(await parseBody(req));}
  catch{return response({error:"Некоректний формат агрегованих даних. Не надсилай первинні документи."},400);}
  const digest=await sha256(JSON.stringify(data));
  try{
    const existing=await env.DB.prepare("SELECT payload_sha256,id FROM quality_inventory_batches WHERE batch_key=?")
      .bind(data.batch_key).first();
    if(existing)return existing.payload_sha256===digest?
      response({ok:true,id:existing.id,already_imported:true}):
      response({error:"Такий batch_key уже існує з іншими даними"},409);
    const id=crypto.randomUUID();
    const statements=[env.DB.prepare(
      "INSERT INTO quality_inventory_batches(id,batch_key,payload_sha256,nested_archives,total_files,unique_files,duplicate_files,actor_id) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(id,data.batch_key,digest,data.nested_archives,data.total,data.unique,data.duplicates,user.id)];
    for(const f of data.files)statements.push(env.DB.prepare(
      "INSERT INTO quality_inventory_file_types(batch_id,file_format,file_instances,unique_files,duplicate_files) VALUES(?,?,?,?,?)"
    ).bind(id,f.format,f.total,f.unique,f.total-f.unique));
    await env.DB.batch(statements);
    return response({ok:true,id,batch_key:data.batch_key,total:data.total,unique:data.unique,duplicates:data.duplicates},201);
  }catch(e){
    if(/UNIQUE constraint failed/.test(String(e?.message||"")))
      return response({error:"Конфлікт: пакет уже записаний"},409);
    return response({error:"Запис не виконано. Перевір D1 і міграцію 0020."},503);
  }
}
