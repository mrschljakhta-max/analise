import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_MAPPING_CORE_JS} from "../src/generic-mapping-core-assets.js";
import {GENERIC_PREVIEW_HTML,GENERIC_PREVIEW_CSS} from "../src/generic-preview-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
const sandbox={};
runInNewContext(GENERIC_MAPPING_CORE_JS,sandbox);
const mapping=sandbox.AnaliseMapping;
const word={
 format:"docx",sheet:"Видатки",
 rows:[
  [{value:"Найменування",colSpan:1},{value:"Кількість",colSpan:1},{value:"Дата",colSpan:1}],
  [{value:"Зошит",colSpan:1},{value:"12",colSpan:1},{value:"29.02.2024",colSpan:1}],
  [{value:"Папір",colSpan:1},{value:"7",colSpan:1},{value:"31.02.2024",colSpan:1}],
  [{value:"",colSpan:1},{value:"",colSpan:1},{value:"",colSpan:1}],
  [{value:"Плівка",colSpan:1},{value:"x",colSpan:1},{value:"2024-05-20",colSpan:1}]
 ]
};
function cfg(){
 const fields=[
  {id:"a",name:"Товар",source:0,type:"text",required:true},
  {id:"b",name:"Кількість",source:1,type:"integer",required:true},
  {id:"c",name:"Дата",source:2,type:"date",required:true}
 ];
 return {headerIndex:1,fields};
}
test("browser mapping core is valid JS, self-contained and needs no network",()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_MAPPING_CORE_JS));
 assert.equal(typeof mapping.validate,"function");
 assert.doesNotMatch(GENERIC_MAPPING_CORE_JS,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|indexedDB/);
});
test("headers and column boundaries are computed from Word merged cells",()=>{
 const doc={format:"docx",rows:[[{value:"Об'єднано",colSpan:2},{value:"Ціна",colSpan:1}]]};
 assert.equal(mapping.maxColumns(doc),3);
 assert.equal(mapping.cellsAt(doc,doc.rows[0],3)[0],"Об'єднано");
 assert.equal(mapping.cellsAt(doc,doc.rows[0],3)[1],"");
 assert.equal(mapping.columns(doc,1)[0].header,"Об'єднано");
 assert.equal(mapping.defaultFields(doc,1).length,3);
});
test("Excel A/AA column indexing, sparse row numbers and named headers",()=>{
 const sheet={
  format:"xlsx",rows:[
   {index:4,cells:[{ref:"A4",value:"Назва"},{ref:"AA4",value:"Період"}]},
   {index:5,cells:[{ref:"A5",value:"Кава"},{ref:"AA5",value:"2026-10-16"}]}
  ]
 };
 assert.equal(mapping.maxColumns(sheet),27);
 assert.equal(mapping.colIndex("AA"),26);
 assert.equal(mapping.colLetter(26),"AA");
 assert.equal(mapping.guessHeader(sheet),4);
 const cols=mapping.columns(sheet,4);
 assert.equal(cols[26].header,"Період");
 assert.equal(mapping.cellsAt(sheet,sheet.rows[1],27)[0],"Кава");
 assert.equal(mapping.cellsAt(sheet,sheet.rows[1],27)[26],"2026-10-16");
 const checked=mapping.validate(sheet,{headerIndex:4,fields:[
  {name:"Назва",source:0,type:"text",required:true},
  {name:"Дата",source:26,type:"date",required:true}
 ]});
 assert.equal(checked.validCount,1);
 assert.equal(checked.rows[0].source_row,5);
});
test("validation reports exact Word row and field, excludes errors and skips empty rows",()=>{
 const result=mapping.validate(word,cfg());
 assert.equal(result.validCount,1);
 assert.equal(result.invalidCount,2);
 assert.equal(result.skippedCount,1);
 assert.equal(result.processedCount,3);
 assert.equal(result.issues[0].row,3);
 assert.equal(result.issues[0].field,"Дата");
 assert.equal(result.issues[1].row,5);
 assert.equal(result.issues[1].field,"Кількість");
 assert.equal(result.rows[0].values["Кількість"],12);
 assert.equal(result.rows[0].values["Дата"],"2024-02-29");
});
test("required fields and strict zero, decimal comma and boolean parsing",()=>{
 assert.equal(mapping.normalValue("0","integer").value,0);
 assert.equal(mapping.normalValue("-8","integer").value,-8);
 assert.equal(mapping.normalValue("12,25","decimal").value,12.25);
 assert.equal(mapping.normalValue("Так","boolean").value,true);
 assert.equal(mapping.normalValue("Ні","boolean").value,false);
 assert.equal(mapping.normalValue("31.11.2025","date").error,"Дата не існує");
 assert.equal(mapping.normalValue("1900-02-29","date").error,"Дата не існує");
 assert.ok(mapping.normalValue("123_000","decimal").error);
 assert.ok(mapping.normalValue("nan","integer").error);
 const result=mapping.validate({format:"docx",rows:[[{value:"Назва"}],[{value:"",colSpan:1},{value:"5"}]]},{
  headerIndex:1,fields:[{name:"Назва",source:0,type:"text",required:true},{name:"Кількість",source:1,type:"integer",required:true}]
 });
 assert.equal(result.invalidCount,1);
 assert.match(result.issues[0].message,/Обов'язкове/);
});
test("duplicate target names, non-existing columns and unknown types invalidate schema",()=>{
 const fields=[
  {name:"Поле",source:0,type:"text",required:true},
  {name:"поле",source:99,type:"unknown",required:false}
 ];
 const errors=mapping.checkConfig(word,{headerIndex:1,fields});
 assert.ok(errors.some(x=>x.includes("унікальними")));
 assert.ok(errors.some(x=>x.includes("колонка")));
 assert.ok(errors.some(x=>x.includes("тип")));
});
test("CSV protects formula-like strings and only includes explicit validated records",()=>{
 const cfg={headerIndex:0,fields:[{name:"Комірка",source:0,type:"text",required:true}]};
 const data=mapping.validate({format:"docx",rows:[
  [{value:"=HYPERLINK(\"https://example.org\")",colSpan:1}],
  [{value:"+SUM(1,1)",colSpan:1}],
  [{value:"Звичайний текст",colSpan:1}]
 ]},cfg);
 assert.equal(data.validCount,3);
 const out=mapping.csv(cfg,data.rows);
 assert.ok(out.startsWith("\ufeff"));
 assert.match(out,/'=HYPERLINK/);
 assert.match(out,/'\+SUM/);
 assert.match(out,/Звичайний текст/);
 assert.doesNotMatch(out,/\n=/);
});
test("existing preview stays browser-only and exposes all active mapping controls",()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_PREVIEW_HTML,/\/api\/generic-mapping-core\.js/);
 for(const id of ["pv-map-header","pv-map-fields","pv-map-check","pv-map-results",
  "pv-map-json","pv-map-csv","pv-map-template","pv-map-template-input","pv-map-add"]){
  assert.match(GENERIC_PREVIEW_HTML,new RegExp("id=\""+id+"\""));
 }
 assert.match(GENERIC_PREVIEW_JS,/mapper\.validate/);
 assert.match(GENERIC_PREVIEW_JS,/safeName/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|indexedDB/);
 assert.match(GENERIC_PREVIEW_CSS,/pv-map-field/);
});
