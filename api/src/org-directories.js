// Generic organization-directory import. No actual organization records are embedded.
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const fail=(message,status=400)=>json({error:message},status);
const str=x=>String(x??"").trim();
function validate(payload){
 const units=payload?.units,relations=payload?.relations;
 if(!Array.isArray(units)||!Array.isArray(relations)||units.length>5000||relations.length>10000)throw Error("Очікуються масиви units і relations (макс. 5000/10000)");
 const keys=new Set(),codes=new Set(),byKey=new Map();
 for(const u of units){
  const key=str(u.import_key),code=str(u.unit_code);
  if(!key||!code||!str(u.full_name)||!str(u.short_name)||!str(u.unit_type))throw Error("Незаповнені обов'язкові поля підрозділу");
  if(keys.has(key)||codes.has(code))throw Error("Повторений ключ або код: "+key);
  keys.add(key);codes.add(code);byKey.set(key,u);
 }
 const parents=new Map(),edges=new Set(),relKeys=new Set();
 for(const r of relations){
  const key=str(r.import_key),child=str(r.child_key),parent=str(r.parent_key),type=str(r.relation_type);
  if(!key||relKeys.has(key))throw Error("Неунікальний ключ зв'язку");
  relKeys.add(key);
  if(!byKey.has(child)||!byKey.has(parent))throw Error("Відсутній підрозділ у зв'язку "+key);
  if(child===parent)throw Error("Самопідпорядкування: "+key);
  if(!["organizational","temporary"].includes(type))throw Error("Невідомий тип зв'язку: "+key);
  if(r.valid_from && !/^\d{4}-\d{2}-\d{2}$/.test(r.valid_from))throw Error("Невірна дата початку: "+key);
  if(r.valid_to && !/^\d{4}-\d{2}-\d{2}$/.test(r.valid_to))throw Error("Невірна дата завершення: "+key);
  if(r.valid_from&&r.valid_to&&r.valid_from>r.valid_to)throw Error("Завершення раніше початку: "+key);
  const edge=child+"|"+parent+"|"+type;
  if(edges.has(edge))throw Error("Повторений зв'язок: "+key);
  edges.add(edge);
  if(type==="organizational"){
   if(parents.has(child))throw Error("Два організаційні керівники: "+child);
   parents.set(child,parent);
  }
 }
 for(const key of keys){
  let cur=key,seen=new Set();
  while(parents.has(cur)){
   if(seen.has(cur))throw Error("Цикл організаційної ієрархії: "+key);
   seen.add(cur);cur=parents.get(cur);
  }
 }
 return {units,relations};
}
export async function orgApi(req,env,user,seg){
 if(user.role!=="admin")return fail("Лише адміністратор",403);
 if(req.method==="GET"){
  const [u,r]=await Promise.all([
   env.DB.prepare("SELECT import_key,unit_code,full_name,short_name,unit_type,is_active FROM org_units ORDER BY full_name").all(),
   env.DB.prepare("SELECT r.import_key,c.import_key child_key,p.import_key parent_key,r.relation_type,r.valid_from,r.valid_to,r.basis,r.state FROM org_relations r JOIN org_units c ON c.id=r.child_id JOIN org_units p ON p.id=r.parent_id ORDER BY r.relation_type,c.full_name").all()
  ]);
  return json({units:u.results,relations:r.results});
 }
 if(req.method!=="POST")return fail("Метод не підтримується",405);
 const bodyText=await req.text();
 if(bodyText.length>2000000)return fail("Файл завеликий",413);
 let data;try{data=validate(JSON.parse(bodyText));}catch(e){return fail(e.message)}
 const commit=seg[2]==="commit";
 if(!commit&&seg[2]!=="preview")return fail("Невідомий маршрут",404);
 const keys=data.units.map(u=>str(u.import_key));
 const current=await env.DB.prepare("SELECT import_key,id FROM org_units").all();
 const known=new Map(current.results.map(x=>[x.import_key,x.id]));
 const existingRel=await env.DB.prepare("SELECT import_key,id FROM org_relations").all();
 const relKnown=new Map(existingRel.results.map(x=>[x.import_key,x.id]));
 const changes={new_units:keys.filter(k=>!known.has(k)).length,updated_units:keys.filter(k=>known.has(k)).length,new_relations:data.relations.filter(r=>!relKnown.has(str(r.import_key))).length,updated_relations:data.relations.filter(r=>relKnown.has(str(r.import_key))).length};
 if(!commit)return json({ok:true,preview:changes,units:data.units.length,relations:data.relations.length});
 const idByKey=new Map(known);
 for(const k of keys)if(!idByKey.has(k))idByKey.set(k,crypto.randomUUID());
 const queries=[];
 for(const u of data.units)queries.push(env.DB.prepare(
  "INSERT INTO org_units(id,import_key,unit_code,full_name,short_name,unit_type,is_active) VALUES(?,?,?,?,?,?,?) ON CONFLICT(import_key) DO UPDATE SET unit_code=excluded.unit_code,full_name=excluded.full_name,short_name=excluded.short_name,unit_type=excluded.unit_type,is_active=excluded.is_active,updated_at=CURRENT_TIMESTAMP"
 ).bind(idByKey.get(str(u.import_key)),str(u.import_key),str(u.unit_code),str(u.full_name),str(u.short_name),str(u.unit_type),String(u.is_active).toLowerCase()==="ні"||u.is_active===false?0:1));
 for(const r of data.relations)queries.push(env.DB.prepare(
  "INSERT INTO org_relations(id,import_key,child_id,parent_id,relation_type,valid_from,valid_to,basis,state) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(import_key) DO UPDATE SET child_id=excluded.child_id,parent_id=excluded.parent_id,relation_type=excluded.relation_type,valid_from=excluded.valid_from,valid_to=excluded.valid_to,basis=excluded.basis,state=excluded.state,updated_at=CURRENT_TIMESTAMP"
 ).bind(relKnown.get(str(r.import_key))||crypto.randomUUID(),str(r.import_key),idByKey.get(str(r.child_key)),idByKey.get(str(r.parent_key)),str(r.relation_type),str(r.valid_from)||null,str(r.valid_to)||null,str(r.basis),str(r.state)==="closed"?"closed":"active"));
 queries.push(env.DB.prepare("INSERT INTO org_import_audit(id,actor_id,units_count,relations_count) VALUES(?,?,?,?)").bind(crypto.randomUUID(),user.id,data.units.length,data.relations.length));
 try{await env.DB.batch(queries);return json({ok:true,committed:true,changes});}catch(e){return fail("Імпорт не виконано: "+e.message,409)}
}