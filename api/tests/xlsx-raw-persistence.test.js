import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {GENERIC_AUTO_PROFILE_JS} from "../src/generic-auto-profile-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import {rawDocumentsApi,validateRawSnapshot} from "../src/raw-documents-api.js";

const ctx={};runInNewContext(GENERIC_AUTO_PROFILE_JS,ctx);
const auto=ctx.AnaliseAutoParse;
const col=n=>{let out="";for(n++;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out};
const c=(ref,value,type="text",raw=value,formula="")=>({ref,value,type,raw,formula});
function sample(){
 const cols=Array.from({length:27},(_,i)=>col(i));
 const head={index:1,cells:cols.map(x=>c(x+"1","Заголовок "+x))};
 const row2={index:2,cells:cols.map((x,i)=>
  x==="F"?c("F2","12","number","12","SUM(10,2)"):
  x==="K"?c("K2","2026-10-17","date","46312"):
  x==="AA"?c("AA2","Значення AA","shared_string","22"):
  c(x+"2",String(i+100),"number",String(i+100)))};
 const row3={index:3,cells:[c("A3","2","number"),c("N3","Помітка","text"),c("AA3","", "number", "", "1+1")]};
 const raw=auto.inspect([
  {format:"xlsx",sheet:"Облік",rows:[head,row2,row3]},
  {format:"xlsx",sheet:"Порожній аркуш",rows:[]},
  {format:"xlsx",sheet:"Додаткова примітка",rows:[{index:1,cells:[c("A1","Примітка")]}]}
 ]);
 return {schema_version:"ANALISE_RAW_SAVE_V1",classification:"storage_authorized",
  acknowledged:true,document_name:"Демонстраційний_реєстр.xlsx",report:raw};
}
function db(){
 const rows=[];
 return {rows,DB:{prepare(sql){return{
  args:[],bind(...args){this.args=args;return this},
  async first(){
   if(sql.includes("WHERE id=?"))return rows.find(x=>x.id===this.args[0])||null;
   return rows.filter(x=>x.report_name===this.args[0]).sort((a,b)=>b.version-a.version)[0]||null;
  },
  async all(){return {results:rows.slice()}},
  async run(){
   const [id,report_name,version,snapshot_json,created_by,created_at,_,expected]=this.args;
   const current=Math.max(0,...rows.filter(x=>x.report_name===report_name).map(x=>x.version));
   if(expected!==current)return {meta:{changes:0}};
   rows.push({id,report_name,version,snapshot_json,created_by,created_at});
   return {meta:{changes:1}};
  }
 };}}};
}
const admin={id:"approved-admin",role:"admin",active:1};
function request(method,body,url="https://example.invalid/api/raw-documents"){
 return new Request(url,{method,...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
}
test("XLSX A:AA multi-sheet snapshot retains raw serial dates, formula source and skipped empty sheet",()=>{
 const f=sample(),r=f.report;
 assert.equal(r.recognized_tables,2);
 assert.equal(r.table_count,3);
 assert.equal(r.records,3);
 assert.equal(r.needs_review,2);
 const full=validateRawSnapshot(f);
 assert.equal(full.kind,"xlsx");
 assert.equal(full.record_count,3);
 assert.equal(full.sheet_count,3);
 assert.equal(full.recognized_sheet_count,2);
 assert.equal(full.review_status,"pending");
 assert.equal(full.checked_against_directories,false);
 assert.ok(full.tables[0].columns.includes("AA"));
 assert.equal(full.tables[0].records[0].raw_cells.F2,undefined);
 assert.equal(full.tables[0].records[0].raw_cells.F.formula,"SUM(10,2)");
 assert.equal(full.tables[0].records[0].raw_cells.F.raw,"12");
 assert.equal(full.tables[0].records[0].raw_cells.F.has_formula,true);
 assert.equal(full.tables[0].records[0].raw_cells.K.raw,"46312");
 assert.equal(full.tables[0].records[0].values.K,"2026-10-17");
 assert.equal(full.tables[0].records[0].raw_cells.AA.raw,"22");
 assert.equal(full.tables[0].records[0].values.AA,"Значення AA");
 assert.equal(full.tables[1].recognized,false);
 assert.equal(full.tables[1].records.length,0);
 assert.equal(full.tables[2].records[0].valid,false);
 assert.equal(full.tables[0].records[1].raw_cells.AA.formula,"1+1");
});
test("XLSX files save and read back unchanged without Purgatory",async()=>{
 const m=db(),env={DB:m.DB,RAW_SAVE_ENABLED:"true"},f=sample();
 const saved=await rawDocumentsApi(request("POST",f),env,admin,["api","raw-documents"]);
 assert.equal(saved.status,201);
 const {id,records,version}=await saved.json();
 assert.equal(records,3);assert.equal(version,1);assert.equal(m.rows.length,1);
 assert.equal(JSON.parse(m.rows[0].snapshot_json).tables[0].records[0].raw_cells.F.formula,"SUM(10,2)");
 const listed=await rawDocumentsApi(request("GET"),env,admin,["api","raw-documents"]);
 assert.equal((await listed.json()).items[0].record_count,3);
 const opened=await rawDocumentsApi(request("GET",null,
  "https://example.invalid/api/raw-documents/"+id),env,admin,["api","raw-documents",id]);
 const data=(await opened.json()).data;
 assert.equal(data.tables[0].records[0].raw_cells.K.raw,"46312");
 assert.equal(data.tables[1].sheet,"Порожній аркуш");
 const again=await rawDocumentsApi(request("POST",f),env,admin,["api","raw-documents"]);
 assert.equal(again.status,200);
 assert.equal((await again.json()).reused,true);
 assert.equal(m.rows.length,1);
});
test("Narrow XLSX sheets store valid RAW rows rather than being silently omitted",()=>{
 const r=auto.inspect([{format:"xlsx",sheet:"Примітка",rows:[
  {index:1,cells:[c("A1","Внутрішня примітка")]}
 ]}]);
 assert.equal(r.recognized_tables,1);
 assert.equal(r.records,1);
 assert.equal(r.needs_review,1);
 const f={schema_version:"ANALISE_RAW_SAVE_V1",classification:"storage_authorized",
  acknowledged:true,document_name:"notes.xlsx",report:r};
 assert.equal(validateRawSnapshot(f).tables[0].records[0].values.A,"Внутрішня примітка");
});
test("Excel invalid cell coordinates and inconsistent formulas are rejected",()=>{
 const f=sample();
 f.report.tables[0].records[0].raw_cells.F.formula="SUM(10,2)";
 f.report.tables[0].records[0].raw_cells.F.has_formula=false;
 assert.throws(()=>validateRawSnapshot(f),/Формула/);
 const next=sample();
 next.report.tables[0].records[0].raw_cells.AA.ref="AB2";
 assert.throws(()=>validateRawSnapshot(next),/адреса/);
});
test("Large A:AA workbook receives higher RAW bound without losing rows",()=>{
 const cols=Array.from({length:27},(_,i)=>col(i));
 const header={index:1,cells:cols.map(k=>c(k+"1","Заголовок "+k))};
 const rows=Array.from({length:90},(_,i)=>({index:i+2,
  cells:cols.map(k=>c(k+(i+2),"Тестове значення "+k+"-"+(i+2)))}));
 const parsed=auto.inspect([{format:"xlsx",sheet:"Широкий аркуш",rows:[header,...rows]}]);
 const result=validateRawSnapshot({schema_version:"ANALISE_RAW_SAVE_V1",
  classification:"storage_authorized",acknowledged:true,
  document_name:"wide.xlsx",report:parsed});
 assert.equal(result.record_count,90);
 assert.equal(result.tables[0].records[89].raw_cells.AA.ref,"AA91");
 assert.ok(new TextEncoder().encode(JSON.stringify(result)).length>190_000);
 assert.ok(new TextEncoder().encode(JSON.stringify(result)).length<800_000);
});
test("Browser XLSX OOXML cell parser retains raw XML data and type",()=>{
 assert.ok(GENERIC_PREVIEW_JS.includes("raw:kind==='inlineStr'?txt(inline):raw"));
 assert.ok(GENERIC_PREVIEW_JS.includes("kind==='s'?'shared_string'"));
});
