// Explicitly approved civilian-only import. No raw DOCX/XLSX bytes, filenames,
// arbitrary free-text records, coordinates or operational identifiers are accepted.
const HEADERS={"content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store","x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer","content-security-policy":"default-src 'none'"};
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const fail=(status,error,extra={})=>respond({error,...extra},status);
export const OFFICE_SCHEMA="office_inventory_v1";
export const OFFICE_ITEMS=Object.freeze({
 "Папір А4":"paper_a4","Ручка":"pen","Олівець":"pencil",
 "Зошит":"notebook","Папка":"folder","Скріпки":"paperclips",
 "Стікери":"sticky_notes","Конверт":"envelope","Клей":"glue","Маркер":"marker"
});
const reverse=new Map(Object.entries(OFFICE_ITEMS).map(([label,code])=>[code,label]));
const has=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const exact=(obj,fields)=>obj&&typeof obj==="object"&&!Array.isArray(obj)&&
 Object.keys(obj).every(k=>fields.includes(k));
const dateOK=value=>{
 if(typeof value!=="string"||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
 const time=Date.parse(value+"T00:00:00Z");
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value&&
  value>="2020-01-01"&&value<="2035-12-31";
};
function validateRow(input,index){
 if(!exact(input,["source_row","values"])||!has(input,"source_row")||!has(input,"values"))
  throw Error("Некоректна форма запису "+index);
 if(!Number.isSafeInteger(input.source_row)||input.source_row<1||input.source_row>15000)
  throw Error("Некоректний номер рядка "+index);
 const v=input.values;
 if(!exact(v,["item","quantity","stock_date","unit_price"])||
    !has(v,"item")||!has(v,"quantity")||!has(v,"stock_date"))
  throw Error("Недозволені або відсутні поля у рядку "+input.source_row);
 if(typeof v.item!=="string"||!has(OFFICE_ITEMS,v.item))
  throw Error("Недозволена назва канцтовару у рядку "+input.source_row);
 if(!Number.isSafeInteger(v.quantity)||v.quantity<0||v.quantity>100000)
  throw Error("Кількість повинна бути цілим числом від 0 до 100000 у рядку "+input.source_row);
 if(!dateOK(v.stock_date))
  throw Error("Недозволена дата інвентаризації у рядку "+input.source_row);
 let cents=null;
 if(v.unit_price!==undefined&&v.unit_price!==null&&v.unit_price!==""){
  if(typeof v.unit_price!=="number"||!Number.isFinite(v.unit_price)||v.unit_price<0||
    v.unit_price>100000||Math.abs(v.unit_price*100-Math.round(v.unit_price*100))>1e-7)
   throw Error("Ціна повинна мати не більше двох знаків після коми у рядку "+input.source_row);
  cents=Math.round(v.unit_price*100);
 }
 return {
  source_row:input.source_row,item_code:OFFICE_ITEMS[v.item],
  quantity:v.quantity,stock_date:v.stock_date,unit_price_cents:cents
 };
}
export function validateOfficeRequest(payload){
 if(!exact(payload,["schema","records","confirmed","expected_hash"])||
  payload.schema!==OFFICE_SCHEMA||!Array.isArray(payload.records)||
  payload.records.length<1||payload.records.length>100)
  throw Error("Потрібні від 1 до 100 записів за затвердженою схемою канцтоварів");
 const rows=payload.records.map(validateRow);
 const unique=new Set();
 for(const row of rows){
  const key=row.item_code+"|"+row.stock_date;
  if(unique.has(key))throw Error("Повтор товару за ту саму дату в одному імпорті");
  unique.add(key);
 }
 return rows;
}
export async function officeFingerprint(rows){
 const sorted=[...rows].sort((a,b)=>
  (a.item_code+"|"+a.stock_date).localeCompare(b.item_code+"|"+b.stock_date));
 const source=JSON.stringify([OFFICE_SCHEMA,
  sorted.map(r=>[r.item_code,r.stock_date,r.quantity,r.unit_price_cents])]);
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(source));
 return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
export async function officeReady(DB){
 const x=await DB.prepare("SELECT name FROM sqlite_master "+
  "WHERE type='table' AND name='civil_office_imports' LIMIT 1").first();
 return Boolean(x);
}
async function inspectExisting(db,rows){
 const records=[];
 for(const row of rows){
  const existing=await db.prepare("SELECT quantity,unit_price_cents "+
   "FROM civil_office_items WHERE item_code=? AND stock_date=? LIMIT 1"
  ).bind(row.item_code,row.stock_date).first();
  if(!existing)records.push({status:"new",...row});
  else if(existing.quantity===row.quantity&&existing.unit_price_cents===row.unit_price_cents)
   records.push({status:"existing",...row});
  else records.push({status:"conflict",...row});
 }
 return {
  new_rows:records.filter(x=>x.status==="new").length,
  existing_rows:records.filter(x=>x.status==="existing").length,
  conflicts:records.filter(x=>x.status==="conflict").map(x=>({
   item:reverse.get(x.item_code),stock_date:x.stock_date,source_row:x.source_row
  }))
 };
}
async function parseRequest(req){
 if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
  throw Error("Потрібен application/json");
 const length=Number(req.headers.get("content-length")||0);
 if(length>65536)throw Error("Запит перевищує 64 КБ");
 const body=await req.text();
 if(new TextEncoder().encode(body).length>65536)throw Error("Запит перевищує 64 КБ");
 try{return JSON.parse(body)}catch{throw Error("Некоректний JSON")}
}
async function importNow(db,actor,rows,hash){
 const id=crypto.randomUUID();
 const prepared=[
  db.prepare("INSERT INTO civil_office_imports(id,fingerprint,actor_id,submitted_count) "+
   "VALUES(?,?,?,?)").bind(id,hash,actor,rows.length)
 ];
 for(const row of rows){
  prepared.push(db.prepare(
   "INSERT OR IGNORE INTO civil_office_items "+
   "(id,batch_id,item_code,stock_date,quantity,unit_price_cents,source_row) "+
   "VALUES(?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(),id,row.item_code,row.stock_date,
    row.quantity,row.unit_price_cents,row.source_row));
 }
 // Cloudflare D1 batch is atomic. The SQL trigger checks conflicts inside this
 // transaction, so simultaneous imports cannot silently overwrite stock counts.
 await db.batch(prepared);
 const inserted=await db.prepare(
  "SELECT COUNT(*) AS n FROM civil_office_items WHERE batch_id=?"
 ).bind(id).first();
 const newRows=inserted?.n||0;
 return {id,reused:false,total:rows.length,new_rows:newRows,existing_rows:rows.length-newRows};
}
export async function approvedOfficeImportApi(req,env,user,segments){
 if(!user||user.role!=="admin"||user.active!==1)return fail(403,"Лише адміністратор");
 if(req.method!=="POST")return fail(405,"Дозволено лише POST");
 if(!env.DB)return fail(503,"D1 недоступна");
 const action=segments[2];
 if(segments.length!==3||!["inspect","commit"].includes(action))
  return fail(404,"Маршрут не знайдено");
 try{
  if(!await officeReady(env.DB))return fail(503,"Спочатку застосуй міграцію D1 0017");
  const payload=await parseRequest(req);
  const rows=validateOfficeRequest(payload);
  const hash=await officeFingerprint(rows);
  if(action==="commit"&&(payload.confirmed!==true||payload.expected_hash!==hash))
   return fail(409,"Потрібно повторно перевірити та підтвердити незмінений набір");
  const reused=await env.DB.prepare(
   "SELECT id,submitted_count FROM civil_office_imports WHERE fingerprint=? LIMIT 1"
  ).bind(hash).first();
  if(reused)return respond({
   schema:OFFICE_SCHEMA,fingerprint:hash,
   id:reused.id,reused:true,total:reused.submitted_count,
   new_rows:0,existing_rows:reused.submitted_count
  });
  const summary=await inspectExisting(env.DB,rows);
  if(summary.conflicts.length)return fail(409,"Наявний запис за цю дату має іншу кількість або ціну. Дані не змінено.",{
   conflicts:summary.conflicts.slice(0,20),schema:OFFICE_SCHEMA
  });
  if(action==="inspect")return respond({schema:OFFICE_SCHEMA,fingerprint:hash,
   total:rows.length,new_rows:summary.new_rows,existing_rows:summary.existing_rows,
   conflicts:[],ready_to_commit:true});
  try{
   const saved=await importNow(env.DB,user.id,rows,hash);
   return respond({schema:OFFICE_SCHEMA,fingerprint:hash,...saved});
  }catch(e){
   if(/OFFICE_ITEM_CONFLICT/.test(String(e)))return fail(409,"Запис змінився під час перевірки. Повтори попередню перевірку");
   if(/UNIQUE constraint failed: civil_office_imports.fingerprint/.test(String(e)))
    return fail(409,"Цей набір уже оброблено паралельно. Онови перевірку");
   return fail(503,"Не вдалося завершити транзакцію D1");
  }
 }catch(e){
  if(e instanceof Error&&/^(Потрібні|Некоректн|Недозволен|Кількість|Ціна|Повтор товару|Запит перевищує|Потрібен application\/json)/.test(e.message))
   return fail(400,e.message);
  return fail(503,"Не вдалося перевірити дозволений набір");
 }
}
