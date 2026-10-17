// RAW snapshots for documents authorized for this Cloudflare environment.
// Independent of directories and Purgatory; uses existing report_versions (migration 0001).
// One persistent RAW_SAVE_ENABLED switch controls the feature, not the document's classification.
const HEADERS={
 "content-type":"application/json; charset=utf-8","cache-control":"private, no-store",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const PREFIX="ANALISE-RAW-V1:";
// Excel A:AA records are wider than Word; allow a bounded, single D1 snapshot.
const LIMIT_BYTES=800_000,MAX_RECORDS=1200,MAX_TABLES=20;
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const fail=(msg,status=400)=>response({error:msg},status);
const reject=msg=>{throw Error(msg)};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function fields(value,allowed){
 if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))reject("Невідома структура даних");
}
function string(x,max,{empty=true}={}){
 if(typeof x!=="string"||x.length>max||(!empty&&!x.trim())||
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x))
  reject("Некоректне текстове поле");
 return x;
}
function limitedJson(value,max){
 const json=JSON.stringify(value);
 if(!json||new TextEncoder().encode(json).length>max)reject("Завеликий масив даних");
 return JSON.parse(json);
}
function simpleMap(input,maxKeys,maxText=800){
 if(!object(input)||Object.keys(input).length>maxKeys)reject("Забагато колонок");
 const clean={};
 for(const [key,v] of Object.entries(input)){
  if(!/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(key))reject("Некоректне поле");
  clean[key]=string(v,maxText);
 }
 return clean;
}
function rawCells(value,kind){
 if(kind==="docx"){
  if(!Array.isArray(value)||value.length!==4)reject("Очікуємо чотири вихідні клітинки Word");
  return value.map(v=>string(v,1800));
 }
 if(!object(value)||Object.keys(value).length<1||Object.keys(value).length>80)
  reject("Некоректні вихідні клітинки Excel");
 const map={};
 for(const [key,v] of Object.entries(value)){
  if(!/^[A-Z]{1,3}$/.test(key)||!object(v))reject("Некоректний стовпець Excel");
  fields(v,["ref","raw","type","has_formula","formula"]);
  if(typeof v.ref!=="string"||!new RegExp("^"+key+"[1-9][0-9]{0,5}$").test(v.ref))
   reject("Некоректна адреса клітинки");
  if(v.formula!==undefined&&v.has_formula!==true)
   reject("Формула Excel має бути позначена як формула");
  map[key]={ref:v.ref,raw:string(v.raw,1800),
   type:string(v.type,25),...(v.has_formula===true?{has_formula:true}:{}),
   ...(v.formula!==undefined?{formula:string(v.formula,1400,{empty:false})}:{})};
 }
 return map;
}
export function validateRawSnapshot(payload){
 fields(payload,["schema_version","document_name","classification","acknowledged","report"]);
 if(payload.schema_version!=="ANALISE_RAW_SAVE_V1"||
    payload.classification!=="storage_authorized"||payload.acknowledged!==true)
  reject("Необхідно підтвердити дозвіл зберігати цей документ у цьому середовищі");
 const name=string(payload.document_name,140,{empty:false});
 if(!/\.(docx|xlsx)$/i.test(name))reject("Непідтримуваний документ");
 const kind=name.toLowerCase().endsWith(".docx")?"docx":"xlsx";
 const report=payload.report;
 fields(report,["schema_version","source","checked_against_d1","persisted_in_d1",
  "table_count","recognized_tables","records","valid","needs_review","tables"]);
 if(report.schema_version!=="ANALISE_AUTO_LOCAL_V1"||report.source!=="browser_only"||
  report.persisted_in_d1!==false||report.checked_against_d1!==false||
  !Array.isArray(report.tables)||report.tables.length<1||report.tables.length>MAX_TABLES)
  reject("Невідома версія результатів парсингу");
 const tables=[],usedSheets=new Set();let records=0,valid=0,recognizedTables=0;
 for(const table of report.tables){
  fields(table,["sheet","format","profile","recognized","header_row","columns",
   "column_headers","records","issues","structure"]);
  const sheet=string(table.sheet,80,{empty:false});
  if(usedSheets.has(sheet))reject("Повторна назва таблиці");usedSheets.add(sheet);
  if(table.format!==kind||typeof table.recognized!=="boolean"||
   !Array.isArray(table.records)||!Array.isArray(table.columns)||
   table.columns.length>80||
   !Number.isSafeInteger(table.header_row)||table.header_row<0||table.header_row>15000)
   reject("Нерозпізнана або некоректна таблиця");
  // Empty XLSX worksheets are legitimate; record them, but never silently
  // discard unrecognized sheets containing rows.
  if(!table.recognized){
   if(kind!=="xlsx"||table.records.length!==0||table.columns.length!==0||
    table.header_row!==0||!table.issues?.some(x=>x.code==="empty_sheet"))
    reject("В аркуші є нерозпізнані дані — збереження не виконано");
  }else{
   if(!table.records.length||!table.columns.length)
    reject("Таблиця не містить розпізнаних рядків");
   recognizedTables++;
  }
  const columns=table.columns.map(v=>string(v,40,{empty:false}));
  if(new Set(columns).size!==columns.length)reject("Дублікати колонок");
  const rows=[],seen=new Set();
  for(const entry of table.records){
   fields(entry,["source_row","group_label","raw_cells","values","valid"]);
   if(!Number.isSafeInteger(entry.source_row)||entry.source_row<1||
    entry.source_row>15000||seen.has(entry.source_row)||typeof entry.valid!=="boolean")
    reject("Некоректний номер або стан рядка");
   seen.add(entry.source_row);
   if(entry.group_label!==undefined&&entry.group_label!==null)
    string(entry.group_label,100);
   const values=simpleMap(entry.values,80,1800);
   if(Object.keys(values).length===0)reject("Порожній рядок");
   rows.push({source_row:entry.source_row,
    ...(entry.group_label===null||entry.group_label===undefined?{}:
      {group_label:entry.group_label}),
    raw_cells:rawCells(entry.raw_cells,kind),values,valid:entry.valid});
   if(entry.valid)valid++;
   records++;
   if(records>MAX_RECORDS)reject("Для однієї версії дозволено до 1200 рядків");
  }
  const issues=Array.isArray(table.issues)?table.issues:[];
  if(issues.length>500)reject("Забагато зауважень");
  const cleanedIssues=issues.map(x=>{
   fields(x,["row","code","message"]);
   if(x.row!==null&&(!Number.isSafeInteger(x.row)||x.row<1||x.row>15000))
    reject("Некоректний номер зауваження");
   return {row:x.row,code:string(x.code,50),message:string(x.message,160)};
  });
  const structure=object(table.structure)?table.structure:{};
  fields(structure,["groups","headings","empty"]);
  const st={};
  for(const key of ["groups","headings","empty"]){
   if(!Number.isSafeInteger(structure[key])||structure[key]<0)reject("Некоректна структура");
   st[key]=structure[key];
  }
  let headers=null;
  if(table.column_headers!==undefined&&table.column_headers!==null)
   headers=simpleMap(table.column_headers,80,100);
  tables.push({sheet,format:kind,profile:string(table.profile,80),
   recognized:table.recognized,header_row:table.header_row,
   columns,records:rows,issues:cleanedIssues,
   structure:st,...(headers?{column_headers:headers}:{})});
 }
 if(!records||report.table_count!==tables.length||
  report.recognized_tables!==recognizedTables||report.records!==records||
  report.valid!==valid||report.needs_review!==records-valid)
  reject("Показники парсингу не збігаються з рядками");
 const snapshot={schema_version:"ANALISE_RAW_D1_V1",source_name:name,
  kind,review_status:"pending",checked_against_directories:false,
  raw_immutable:true,record_count:records,valid_structure_count:valid,
  sheet_count:tables.length,recognized_sheet_count:recognizedTables,tables};
 limitedJson(snapshot,LIMIT_BYTES);
 return snapshot;
}
const sha256=async value=>{
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
};
export async function rawDocumentsApi(req,env,user,seg){
 if(!user||user.role!=="admin"||user.active!==1)return fail("Лише адміністратор",403);
 if(!env.DB)return fail("D1 недоступна",503);
 if(env.RAW_SAVE_ENABLED!=="true")
  return fail("RAW-збереження вимкнено адміністратором",503);
 if(seg.length===2&&req.method==="GET"){
  try{
   const rows=await env.DB.prepare(
    "SELECT id,report_name,version,created_at,snapshot_json FROM report_versions "+
    "WHERE report_name GLOB 'ANALISE-RAW-V1:*' ORDER BY created_at DESC,id DESC LIMIT 30"
   ).all();
   return response({items:(rows.results||[]).map(r=>{
    const data=JSON.parse(r.snapshot_json);
    return {id:r.id,version:r.version,created_at:r.created_at,
     source_name:data.source_name,record_count:data.record_count,review_status:data.review_status};
   })});
  }catch{return fail("Не вдалося прочитати реєстр RAW",503)}
 }
 if(seg.length===3&&req.method==="GET"){
  if(!/^[0-9a-f-]{36}$/i.test(seg[2]))return fail("Некоректний ID",400);
  try{
   const row=await env.DB.prepare(
    "SELECT id,report_name,version,snapshot_json,created_at FROM report_versions WHERE id=? "+
    "AND report_name GLOB 'ANALISE-RAW-V1:*' LIMIT 1"
   ).bind(seg[2]).first();
   if(!row)return fail("RAW-версію не знайдено",404);
   return response({id:row.id,version:row.version,created_at:row.created_at,
    data:JSON.parse(row.snapshot_json)});
  }catch{return fail("Не вдалося прочитати RAW-версію",503)}
 }
 if(seg.length!==2||req.method!=="POST")return fail("Непідтримуваний метод",405);
 if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
  return fail("Потрібен JSON",415);
 if(Number(req.headers.get("content-length")||0)>LIMIT_BYTES+10_000)
  return fail("Запит перевищує ліміт",413);
 let snapshot;
 try{
  const text=await req.text();
  if(new TextEncoder().encode(text).length>LIMIT_BYTES+10_000)
   return fail("Запит перевищує ліміт",413);
  snapshot=validateRawSnapshot(JSON.parse(text));
 }catch(e){
  if(e?.message==="Завеликий масив даних")return fail(
   "RAW перевищує 800 КБ. Потрібно розділити книгу або додати пакетне збереження.",413);
  return fail("Некоректні дані RAW або відсутнє підтвердження дозволу на зберігання",400);
 }
 try{
  const name=PREFIX+await sha256(user.id+"|"+snapshot.source_name.normalize("NFC").toLocaleLowerCase("uk-UA"));
  const raw=JSON.stringify(snapshot),hash=await sha256(raw);
  const last=await env.DB.prepare(
   "SELECT id,version,snapshot_json FROM report_versions WHERE report_name=? "+
   "ORDER BY version DESC LIMIT 1"
  ).bind(name).first();
  if(last&&await sha256(last.snapshot_json)===hash)
   return response({storage:"cloudflare_d1",reused:true,id:last.id,
    version:last.version,review_status:"pending",records:snapshot.record_count});
  const expected=last?.version||0,version=expected+1,id=crypto.randomUUID();
  const result=await env.DB.prepare(
   "INSERT INTO report_versions(id,report_name,version,status,snapshot_json,created_by,created_at) "+
   "SELECT ?,?,?,'draft',?,?,? WHERE "+
   "(SELECT COALESCE(MAX(version),0) FROM report_versions WHERE report_name=?)=?"
  ).bind(id,name,version,raw,user.id,new Date().toISOString(),name,expected).run();
  if(result.meta?.changes!==1)return fail("Конфлікт версій. Повтори збереження.",409);
  return response({storage:"cloudflare_d1",reused:false,id,version,
   review_status:"pending",records:snapshot.record_count},201);
 }catch(e){
  if(/UNIQUE constraint|SQLITE_CONSTRAINT/i.test(String(e?.message||"")))
   return fail("Конфлікт версій. Повтори збереження.",409);
  return fail("Запис RAW у D1 не підтверджено",503);
 }
}
