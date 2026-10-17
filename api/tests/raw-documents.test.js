import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {readFileSync} from "node:fs";
import {rawDocumentsApi,validateRawSnapshot} from "../src/raw-documents-api.js";
import {GENERIC_RAW_SAVE_JS} from "../src/generic-raw-save-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import {GENERIC_PREVIEW_HTML} from "../src/generic-preview-assets.js";
import worker from "../src/index.js";

function fixture(){
 const rows=[
  {source_row:3,group_label:"Група А",raw_cells:["09:17   10.10.2026","Вигадана категорія"," 1 Паперова  ","Зареєстровано"],
   values:{date:"10.10.2026",time:"09:17",value_2:"Вигадана категорія",number_3:"1",
    text_3:"Паперова",value_4:"Зареєстровано"},valid:true},
  {source_row:4,group_label:"Група А",raw_cells:["11:11 10.10.2026","Перевірити"," 2 Паперова  ","Виправити"],
   values:{date:"10.10.2026",time:"11:11",value_2:"Перевірити",number_3:"2",
    text_3:"Паперова",value_4:"Виправити"},valid:false}
 ];
 return {schema_version:"ANALISE_RAW_SAVE_V1",classification:"storage_authorized",
  acknowledged:true,document_name:"Цивільний приклад.docx",
  report:{schema_version:"ANALISE_AUTO_LOCAL_V1",source:"browser_only",
   checked_against_d1:false,persisted_in_d1:false,table_count:1,
   recognized_tables:1,records:2,valid:1,needs_review:1,tables:[{
    sheet:"Таблиця 1",format:"docx",profile:"four_column_with_groups",
    recognized:true,header_row:1,columns:["date","time","value_2","number_3","text_3","value_4"],
    records:rows,issues:[{row:4,code:"invalid_value",message:"Потрібна перевірка"}],
    structure:{groups:1,headings:1,empty:0}
   }]}
 };
}
const admin={id:"admin-id",role:"admin",active:1};
const req=(method,body,url="https://unit.example/api/raw-documents")=>new Request(url,{
 method,...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})
});
function mockDB(){
 const rows=[],queries=[];
 const DB={prepare(sql){return{
  args:[],bind(...a){this.args=a;return this},
  async first(){
   queries.push({sql,args:this.args});
   if(sql.includes("WHERE id=?"))return rows.find(x=>x.id===this.args[0])||null;
   if(sql.includes("WHERE report_name=?"))return rows.filter(x=>x.report_name===this.args[0])
    .sort((a,b)=>b.version-a.version)[0]||null;
   throw Error("Unexpected first: "+sql);
  },
  async all(){
   queries.push({sql,args:this.args});
   return {results:rows.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at))};
  },
  async run(){
   queries.push({sql,args:this.args});
   const [id,report_name,version,snapshot_json,created_by,created_at,match,expected]=this.args;
   assert.equal(report_name,match);
   const current=Math.max(0,...rows.filter(x=>x.report_name===match).map(x=>x.version));
   if(current!==expected)return {meta:{changes:0}};
   rows.push({id,report_name,version,snapshot_json,created_by,created_at});
   return {meta:{changes:1}};
  }
 }}};
 return {DB,rows,queries};
}
test("RAW preserves exact original cells, records, groups and pending status",()=>{
 const d=validateRawSnapshot(fixture());
 assert.equal(d.review_status,"pending");
 assert.equal(d.checked_against_directories,false);
 assert.equal(d.record_count,2);
 assert.equal(d.tables[0].records[0].raw_cells[0],"09:17   10.10.2026");
 assert.equal(d.tables[0].records[0].group_label,"Група А");
 assert.equal(d.tables[0].records[1].valid,false);
});
test("unverified dictionary values never block RAW save",async()=>{
 const db=mockDB(),env={DB:db.DB,RAW_SAVE_ENABLED:"true"};
 const r=await rawDocumentsApi(req("POST",fixture()),env,admin,["api","raw-documents"]);
 assert.equal(r.status,201);const j=await r.json();
 assert.equal(j.review_status,"pending");
 assert.equal(j.records,2);assert.equal(db.rows.length,1);
 const data=JSON.parse(db.rows[0].snapshot_json);
 assert.equal(data.tables[0].records[1].values.value_2,"Перевірити");
 assert.equal(db.rows[0].version,1);
 assert.equal(db.rows[0].report_name.startsWith("ANALISE-RAW-V1:"),true);
});
test("idempotent exact repost reuses D1 version and changed content creates revision",async()=>{
 const db=mockDB(),env={DB:db.DB,RAW_SAVE_ENABLED:"true"};
 const first=await rawDocumentsApi(req("POST",fixture()),env,admin,["api","raw-documents"]);
 assert.equal((await first.json()).version,1);
 const second=await rawDocumentsApi(req("POST",fixture()),env,admin,["api","raw-documents"]);
 assert.equal(second.status,200);assert.equal((await second.json()).reused,true);
 assert.equal(db.rows.length,1);
 const f=fixture();
 f.report.tables[0].records[1].values.value_2="Інша вигадана категорія";
 const third=await rawDocumentsApi(req("POST",f),env,admin,["api","raw-documents"]);
 assert.equal(third.status,201);assert.equal((await third.json()).version,2);
 assert.equal(db.rows.length,2);
 assert.equal(JSON.parse(db.rows[0].snapshot_json).tables[0].records[1].values.value_2,"Перевірити");
});
test("read back versions from D1 without changing saved RAW",async()=>{
 const db=mockDB(),env={DB:db.DB,RAW_SAVE_ENABLED:"true"};
 const saved=await rawDocumentsApi(req("POST",fixture()),env,admin,["api","raw-documents"]);
 const {id}=await saved.json();
 const list=await rawDocumentsApi(req("GET"),env,admin,["api","raw-documents"]);
 assert.equal(list.status,200);
 const listing=await list.json();assert.equal(listing.items.length,1);
 assert.equal(listing.items[0].source_name,"Цивільний приклад.docx");
 const read=await rawDocumentsApi(req("GET",null,"https://unit.example/api/raw-documents/"+id),
  env,admin,["api","raw-documents",id]);
 assert.equal(read.status,200);
 const j=await read.json();assert.equal(j.data.tables[0].records.length,2);
 assert.equal(j.data.review_status,"pending");
});
test("client cannot persist without explicit storage authorization",()=>{
 const good=fixture();
 for(const bad of [
  {...good,acknowledged:false},{...good,classification:"restricted"},
  {...good,document_name:"c.pdf"},
  {...good,untrusted_field:"x"},
  {...good,report:{...good.report,recognized_tables:0}},
  {...good,report:{...good.report,tables:[{...good.report.tables[0],recognized:false}]}},
  {...good,report:{...good.report,tables:[{...good.report.tables[0],records:[
   {...good.report.tables[0].records[0],raw_cells:["x","y","z"]},
   good.report.tables[0].records[1]]}]}}
 ])assert.throws(()=>validateRawSnapshot(bad));
});
test("RAW store default-off and admin-only; never writes if disabled",async()=>{
 const db=mockDB();
 const f=fixture();
 for(const user of [null,{role:"duty",active:1,id:"u"},{role:"admin",active:0,id:"u"}]){
  const r=await rawDocumentsApi(req("POST",f),{DB:db.DB,RAW_SAVE_ENABLED:"true"},user,["api","raw-documents"]);
  assert.equal(r.status,403);
 }
 let r=await rawDocumentsApi(req("POST",f),{DB:db.DB},admin,["api","raw-documents"]);
 assert.equal(r.status,503);assert.equal(db.rows.length,0);
 r=await rawDocumentsApi(req("PUT",f),{DB:db.DB,RAW_SAVE_ENABLED:"true"},admin,["api","raw-documents"]);
 assert.equal(r.status,405);
});
test("browser integration contains independent RAW button and protected route",async()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_RAW_SAVE_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_RAW_SAVE_JS,/Зберегти RAW у D1/);
 assert.ok(GENERIC_PREVIEW_HTML.includes("/api/generic-raw-save.js"));
 assert.ok(GENERIC_PREVIEW_JS.indexOf("rawSave.mount")<GENERIC_PREVIEW_JS.indexOf("demoDictionary.load"));
 assert.ok(GENERIC_PREVIEW_JS.includes("raw_d1_save"));
 assert.match(GENERIC_RAW_SAVE_JS,/check\.checked/);
 const r=await worker.fetch(new Request("https://unit.example/api/raw-documents"),{});
 assert.equal(r.status,503);
});

test("one persistent config switch permits storage while authorization remains mandatory",async()=>{
 const cfg=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 assert.match(cfg,/^RAW_SAVE_ENABLED = "true"$/m);
 assert.doesNotMatch(cfg,/^RAW_NONRESTRICTED_ENABLED/m);
 const fake=mockDB(),env={DB:fake.DB,RAW_SAVE_ENABLED:"true"};
 const withoutApproval=fixture();withoutApproval.acknowledged=false;
 const blocked=await rawDocumentsApi(req("POST",withoutApproval),env,admin,["api","raw-documents"]);
 assert.equal(blocked.status,400);
 assert.equal(fake.rows.length,0);
 const yes=await rawDocumentsApi(req("POST",fixture()),env,admin,["api","raw-documents"]);
 assert.equal(yes.status,201);
 assert.equal(fake.rows.length,1);
 assert.match(GENERIC_RAW_SAVE_JS,/зберігання цього документа дозволене/);
 assert.match(GENERIC_RAW_SAVE_JS,/classification:'storage_authorized'/);
});
