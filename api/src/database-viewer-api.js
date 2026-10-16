// ANALISE curated D1 database explorer.
// Absolutely no raw table names, SQL, column paths, or filter fragments supplied by clients.
// Never expose operational rows, coordinates, contact information, user accounts, or raw OOXML.
const HEADERS={
 "content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store",
 "x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'"
};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const fail=(code,error)=>response({error},code);
const LABELS="('Альфа-демо','Альфа деммo','Бета-демо','Бетта-демо')";
const SORTS=Object.freeze(["recent","oldest","name"]);
const ROWS_PER_PAGE=25;
const defs=Object.freeze({
 directories:{
  title:"Каталог довідників",subtitle:"Назви та версії довідників. Записи інших довідників відкривай у спеціалізованих розділах.",
  required:["directory_types"],from:"directory_types d",where:"1=1",id:"d.id",
  select:"d.id,d.title,d.version,d.updated_at",
  search:["d.title","d.id"],
  order:{recent:"d.updated_at DESC,d.id",oldest:"d.updated_at ASC,d.id",name:"d.title COLLATE NOCASE ASC,d.id"},
  columns:[["title","Довідник"],["id","Код"],["version","Версія"],["updated_at","Оновлено"]],
  filters:{all:"1=1"}
 },
 demo_labels:{
  title:"Тестовий довідник",subtitle:"Лише вигадані значення з довідника demo_quality_labels.",
  required:["directory_entries"],from:"directory_entries e",
  where:"e.directory_id='demo_quality_labels' AND e.archived_at IS NULL "+
   "AND json_extract(e.data_json,'$.name') IN "+LABELS,id:"e.id",
  select:"e.id,json_extract(e.data_json,'$.name') AS name,e.version,e.updated_at,e.created_at",
  search:["json_extract(e.data_json,'$.name')"],order:{
   recent:"e.updated_at DESC,e.id",oldest:"e.updated_at ASC,e.id",
   name:"name COLLATE NOCASE ASC,e.id"},
  columns:[["name","Назва"],["version","Версія"],["updated_at","Оновлено"]],
  filters:{all:"1=1"}
 },
 demo_occurrences:{
  title:"Входження «Чистилища»",subtitle:"Лише тестові входження, включно з уже виправленими.",
  required:["dq_occurrences"],from:"dq_occurrences o",
  where:"o.directory_id='demo_quality_labels' AND o.source_id IN ('synthetic-docx-2026-10-11','synthetic-xlsx-2026-10-11') AND o.raw_value IN "+LABELS,id:"o.id",
  select:"o.id,o.raw_value,o.status,o.resolution_origin,o.active,o.source_ref,o.created_at,o.updated_at",
  search:["o.raw_value","o.source_ref"],order:{
   recent:"o.updated_at DESC,o.id",oldest:"o.updated_at ASC,o.id",
   name:"o.raw_value COLLATE NOCASE ASC,o.id"},
  columns:[["raw_value","Вхідне значення"],["status","Статус"],["resolution_origin","Виправлено"],["updated_at","Оновлено"]],
  filters:{all:"1=1",pending:"o.active=1 AND o.status='pending'",
   resolved:"o.active=1 AND o.status='resolved'",ignored:"o.status='ignored'"},
  filterLabels:[["all","Усі"],["pending","Очікують"],["resolved","Виправлені"],["ignored","Пропущені"]]
 },
 demo_rules:{
  title:"Правила пам'яті",subtitle:"Підтверджені тестові правила зіставлення.",
  required:["dq_rules","directory_entries"],
  from:"dq_rules r LEFT JOIN directory_entries e ON e.id=r.target_id AND e.directory_id='demo_quality_labels'",
  where:"r.directory_id='demo_quality_labels' AND r.raw_example IN "+LABELS,id:"r.id",
  select:"r.id,r.raw_example,r.normalized_value,"+
   "CASE WHEN json_extract(e.data_json,'$.name') IN "+LABELS+" THEN json_extract(e.data_json,'$.name') ELSE NULL END AS target_name,"+
   "r.active,r.version,r.created_at,r.updated_at",
  search:["r.raw_example","r.normalized_value"],
  order:{recent:"r.updated_at DESC,r.id",oldest:"r.updated_at ASC,r.id",
   name:"r.raw_example COLLATE NOCASE ASC,r.id"},
  columns:[["raw_example","Початкове значення"],["target_name","Відповідник"],["active","Активне"],["updated_at","Оновлено"]],
  filters:{all:"1=1",active:"r.active=1",inactive:"r.active=0"},
  filterLabels:[["all","Усі"],["active","Активні"],["inactive","Відкликані"]]
 },
 demo_sessions:{
  title:"Сеанси завантажень",subtitle:"Дата, кількість файлів і підсумок синтетичного імпорту.",
  required:["demo_import_sessions"],from:"demo_import_sessions s",where:"1=1",id:"s.id",
  select:"s.id,s.created_at,s.updated_at,s.input_count,s.document_count,s.row_count,s.pending_count,s.auto_resolved_count,s.skipped_count",
  search:["s.id"],order:{recent:"s.created_at DESC,s.id",oldest:"s.created_at ASC,s.id",
   name:"s.id ASC"},
  columns:[["created_at","Дата імпорту"],["document_count","Документи"],["row_count","Рядки"],["auto_resolved_count","Виправлено"]],
  filters:{all:"1=1"}
 },
 demo_documents:{
  title:"Тестові документи",subtitle:"Результати Word/Excel, збережені у D1, без оригіналів файлів.",
  required:["demo_import_documents"],from:"demo_import_documents d",where:"1=1",id:"d.id",
  select:"d.id,d.session_id,d.document_name,d.kind,d.status,d.row_count,d.pending_count,d.auto_resolved_count,d.created_at",
  search:["d.document_name","d.kind"],order:{
   recent:"d.created_at DESC,d.id",oldest:"d.created_at ASC,d.id",
   name:"d.document_name COLLATE NOCASE ASC,d.id"},
  columns:[["document_name","Документ"],["kind","Формат"],["row_count","Рядки"],["pending_count","На перевірку"],["created_at","Дата імпорту"]],
  filters:{all:"1=1",docx:"d.kind='docx'",xlsx:"d.kind='xlsx'"},
  filterLabels:[["all","Усі"],["docx","Word"],["xlsx","Excel"]]
 },
 demo_versions:{
  title:"Версії документів",subtitle:"Чинні та архівні версії синтетичних результатів.",
  required:["demo_report_versions","demo_report_active"],
  from:"demo_report_versions v LEFT JOIN demo_report_active a ON a.kind=v.kind AND a.report_date=v.report_date",
  where:"1=1",id:"v.id",
  select:"v.id,v.kind,v.report_date,v.revision,v.source_name,v.created_at,v.previous_version_id,"+
   "CASE WHEN a.version_id=v.id THEN 1 ELSE 0 END AS active",
  search:["v.source_name","v.report_date"],
  order:{recent:"v.created_at DESC,v.id",oldest:"v.created_at ASC,v.id",
   name:"v.report_date DESC,v.kind ASC,v.revision DESC"},
  columns:[["report_date","Звітна дата"],["kind","Формат"],["revision","Версія"],["active","Чинна"],["created_at","Завантажено"]],
  filters:{all:"1=1",active:"a.version_id=v.id",archived:"a.version_id IS NULL OR a.version_id!=v.id"},
  filterLabels:[["all","Усі"],["active","Чинні"],["archived","Архівні"]]
 }
});
const safeLabels=new Set(["Альфа-демо","Альфа деммo","Бета-демо","Бетта-демо"]);
const uuidish=/^[A-Za-z0-9_-]{1,80}$/;
const publicDef=(key,d,count,available)=>({
 id:key,title:d.title,description:d.subtitle,count,available,
 columns:d.columns.map(([key,label])=>({key,label})),
 filters:(d.filterLabels||[["all","Усі"]]).map(([value,label])=>({value,label}))
});
export function databaseViewerDatasets(){return Object.keys(defs)}
const paramsCheck=p=>{
 const q=(p.get("q")||"").trim();
 if(q.length>100||/[\u0000-\u001f\u007f]/.test(q))throw Error("Пошук: максимум 100 символів");
 const offsetStr=p.get("offset")||"0";
 if(!/^(?:0|[1-9]\d{0,5})$/.test(offsetStr)||Number(offsetStr)>100000)
  throw Error("Некоректний номер сторінки");
 const sort=p.get("sort")||"recent";
 if(!SORTS.includes(sort))throw Error("Непідтримуване сортування");
 return {q,offset:Number(offsetStr),sort,filter:p.get("filter")||"all"};
};
const pattern=q=>"%"+q.replace(/[\\%_]/g,c=>"\\"+c)+"%";
const titleCase=q=>{
 const lower=q.toLocaleLowerCase("uk-UA");
 return lower.slice(0,1).toLocaleUpperCase("uk-UA")+lower.slice(1);
};
function listing(d,{q,offset,sort,filter}){
 const where=d.where+" AND ("+d.filters[filter]+")";
 const search=" AND ("+d.search.map(x=>"(LOWER("+x+") LIKE ? ESCAPE '\\' OR "+x+" LIKE ? ESCAPE '\\')").join(" OR ")+")";
 const sqlBase=" FROM "+d.from+" WHERE "+where+search;
 const binds=d.search.flatMap(()=>[pattern(q.toLocaleLowerCase("uk-UA")),pattern(titleCase(q))]);
 return {
  count:"SELECT COUNT(*) AS n"+sqlBase,
  query:"SELECT "+d.select+sqlBase+" ORDER BY "+d.order[sort]+" LIMIT 26 OFFSET ?",
  binds:[...binds],offset
 };
}
async function availableTables(db){
 const data=await db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN "+
  "('directory_types','directory_entries','dq_occurrences','dq_rules',"+
  "'demo_import_sessions','demo_import_documents','demo_report_versions','demo_report_active')"
 ).all();
 return new Set((data.results||[]).map(x=>x.name));
}
function ready(d,tables){return d.required.every(x=>tables.has(x))}
function rowsOnly(rows){return (rows?.results||[]).slice(0,25)}
function safeSnapshot(value){
 let data;try{data=JSON.parse(value)}catch{return []}
 if(!data||!Array.isArray(data.detail))return [];
 return data.detail.slice(0,100).filter(x=>
  x&&Number.isSafeInteger(x.row)&&x.row>0&&x.row<=100&&
  safeLabels.has(x.label)&&["known","resolved","review"].includes(x.status)
 ).map(x=>({row:x.row,label:x.label,status:x.status}));
}
async function enrichDetail(db,dataset,row){
 if(dataset==="demo_documents"){
  const d=await db.prepare("SELECT snapshot_json FROM demo_import_documents WHERE id=?").bind(row.id).first();
  return {details:safeSnapshot(d?.snapshot_json)};
 }
 if(dataset==="demo_versions"){
  const d=await db.prepare("SELECT snapshot_json FROM demo_report_versions WHERE id=?").bind(row.id).first();
  return {details:safeSnapshot(d?.snapshot_json)};
 }
 if(dataset==="demo_sessions"){
  const docs=await db.prepare(
   "SELECT document_name,kind,status,row_count,pending_count,auto_resolved_count "+
   "FROM demo_import_documents WHERE session_id=? ORDER BY member_index,id LIMIT 24"
  ).bind(row.id).all();
  return {documents:(docs.results||[]).map(x=>({
   name:x.document_name,kind:x.kind,status:x.status,rows:x.row_count,
   review:x.pending_count,resolved:x.auto_resolved_count
  }))};
 }
 return {};
}
export async function databaseViewerApi(req,env,user,segments){
 if(!user||user.role!=="admin"||user.active!==1)return fail(403,"Лише адміністратор");
 if(req.method!=="GET")return fail(405,"Лише перегляд GET");
 if(!env.DB)return fail(503,"D1 недоступна");
 if(segments.length!==3)return fail(404,"Невідомий маршрут");
 const action=segments[2];
 if(!["catalog","data"].includes(action))return fail(404,"Невідомий маршрут");
 try{
  const tables=await availableTables(env.DB);
  if(action==="catalog"){
   const sets=await Promise.all(Object.entries(defs).map(async([key,d])=>{
    if(!ready(d,tables))return publicDef(key,d,0,false);
    const n=await env.DB.prepare("SELECT COUNT(*) AS n FROM "+d.from+" WHERE "+d.where).first();
    return publicDef(key,d,n?.n||0,true);
   }));
   return response({datasets:sets,mode:"read_only",records_scope:"curated"});
  }
  const p=new URL(req.url).searchParams, dataset=p.get("dataset")||"";
  if(!Object.hasOwn(defs,dataset))return fail(400,"Набір даних недоступний для перегляду");
  const d=defs[dataset];
  if(!ready(d,tables))return fail(503,"Для цього набору ще не застосовано потрібні міграції D1");
  const id=p.get("id");
  if(id!==null){
   if(!uuidish.test(id))return fail(400,"Некоректний ідентифікатор запису");
   const sql="SELECT "+d.select+" FROM "+d.from+" WHERE "+d.where+" AND "+d.id+"=? LIMIT 1";
   const item=await env.DB.prepare(sql).bind(id).first();
   if(!item)return fail(404,"Запис не знайдено");
   const extra=await enrichDetail(env.DB,dataset,item);
   return response({dataset,record:item,...extra,mode:"read_only"});
  }
  const args=paramsCheck(p);
  if(!Object.hasOwn(d.filters,args.filter))return fail(400,"Недоступний фільтр");
  const queries=listing(d,args);
  const [count,records]=await Promise.all([
   env.DB.prepare(queries.count).bind(...queries.binds).first(),
   env.DB.prepare(queries.query).bind(...queries.binds,queries.offset).all()
  ]);
  const rows=rowsOnly(records);
  return response({dataset,columns:d.columns.map(([key,label])=>({key,label})),
   rows,offset:args.offset,page_size:ROWS_PER_PAGE,
   count:count?.n||0,has_more:(records.results||[]).length>ROWS_PER_PAGE,
   mode:"read_only"});
 }catch(err){
  if(err instanceof Error&&/^(Пошук:|Некоректний номер|Непідтримуване сортування)/.test(err.message))
   return fail(400,err.message);
  return fail(503,"Не вдалося прочитати вибраний набір із D1");
 }
}
