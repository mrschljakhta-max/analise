import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_MAPPING_CORE_JS} from "../src/generic-mapping-core-assets.js";
import {GENERIC_PREVIEW_HTML,GENERIC_PREVIEW_CSS} from "../src/generic-preview-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";

const sandbox={};
runInNewContext(GENERIC_MAPPING_CORE_JS,sandbox);
const parser=sandbox.AnaliseMapping;
const cell=(value,span=1)=>({value,colSpan:span});
const schema={
 headerIndex:1,skipWordStructuralRows:true,fields:[
  {name:"Дата",source:0,type:"date",extract:"date_part",required:true},
  {name:"Час",source:0,type:"time",extract:"time_part",required:true},
  {name:"Товар",source:1,type:"text",required:true},
  {name:"Число",source:2,type:"integer",extract:"number_prefix",required:true},
  {name:"Текст",source:2,type:"text",extract:"text_suffix",required:true},
  {name:"Опис",source:3,type:"text",required:false}
 ]
};

test("split HH:MM DD.MM.YYYY into two independently typed values",()=>{
 assert.equal(parser.extractValue("08:15 17.10.2026","time_part").value,"08:15");
 assert.equal(parser.extractValue("08:15 17.10.2026","date_part").value,"17.10.2026");
 assert.equal(parser.normalValue("17.10.2026","date").value,"2026-10-17");
 assert.equal(parser.normalValue("08:15","time").value,"08:15");
 assert.equal(parser.normalValue("24:00","time").error,"Очікується час ГГ:ХХ");
 assert.ok(parser.extractValue("24:00 17.10.2026","time_part").error);
 assert.ok(parser.extractValue("08:60 17.10.2026","date_part").error);
});
test("generic prefix-number split handles whitespace, hyphens, and preserves input",()=>{
 const raw="  125   Місце-1, сектор А ";
 assert.equal(parser.extractValue(raw,"number_prefix").value,"125");
 assert.equal(parser.extractValue(raw,"text_suffix").value,"Місце-1, сектор А");
 assert.equal(parser.extractValue(raw,"whole").value,"125   Місце-1, сектор А");
 assert.ok(parser.extractValue("125","number_prefix").error);
 assert.ok(parser.extractValue("Місце без числа","text_suffix").error);
 assert.ok(parser.extractValue("125 Місце","unknown").error);
});
test("local DOCX split keeps four-column source, generates six typed fields and skips group headings",()=>{
 const source={format:"docx",rows:[
  [cell("Час і дата"),cell("Товар"),cell("Код і місце"),cell("Опис")],
  [cell("Склад А",4)],
  [cell("08:15 17.10.2026"),cell("Папір"),cell("125 Полиця 1"),cell("Надходження")],
  [cell("Час і дата"),cell("Товар"),cell("Код і місце"),cell("Опис")],
  [cell("Склад Б",4)],
  [cell("09:30 18.10.2026"),cell("Папка"),cell("250 Сектор Б"),cell("Інвентаризація")],
  [cell(""),cell(""),cell(""),cell("")]
 ]};
 assert.equal(parser.maxColumns(source),4);
 assert.equal(parser.checkConfig(source,schema).length,0);
 const r=parser.validate(source,schema);
 assert.equal(r.validCount,2);
 assert.equal(r.invalidCount,0);
 assert.equal(r.skippedCount,4);
 assert.equal(r.processedCount,2);
 assert.equal(r.rows[0].source_row,3);
 assert.equal(r.rows[0].values["Дата"],"2026-10-17");
 assert.equal(r.rows[0].values["Час"],"08:15");
 assert.equal(r.rows[0].values["Товар"],"Папір");
 assert.equal(r.rows[0].values["Число"],125);
 assert.equal(r.rows[0].values["Текст"],"Полиця 1");
 assert.equal(r.rows[0].values["Опис"],"Надходження");
 assert.equal(r.rows[1].source_row,6);
 assert.match(parser.csv(schema,r.rows),/2026-10-17/);
});
test("malformed date, malformed number and sparse non-merged rows yield issues (no guessing)",()=>{
 const source={format:"docx",rows:[
  [cell("Час і дата"),cell("Товар"),cell("Код і місце"),cell("Опис")],
  [cell("07:30 31.02.2026"),cell("Наліпки"),cell("125 Сектор"),cell("Тест")],
  [cell("07:30 17.10.2026"),cell("Наліпки"),cell("код без цифр"),cell("Тест")],
  [cell("Сирий текст"),cell(""),cell(""),cell("")]
 ]};
 const r=parser.validate(source,schema);
 assert.equal(r.validCount,0);
 assert.equal(r.invalidCount,3);
 assert.ok(r.issues.some(issue=>issue.field==="Дата"&&issue.message==="Дата не існує"));
 assert.ok(r.issues.some(issue=>issue.field==="Число"&&issue.message.includes("Очікується число")));
 assert.ok(r.issues.some(issue=>issue.row===4));
});
test("schema rejects incompatible types and unknown extract rules",()=>{
 const source={format:"docx",rows:[[cell("Дата"),cell("Товар"),cell("Код")]]};
 const config={headerIndex:1,fields:[{name:"Час",source:0,type:"text",extract:"time_part",required:true}]};
 assert.ok(parser.checkConfig(source,config).some(e=>e.includes("не відповідає")));
 config.fields[0].type="time";
 config.fields[0].extract="secretMethod";
 assert.ok(parser.checkConfig(source,config).some(e=>e.includes("Невідоме правило")));
});
test("browser exposes a single local split control with no new remote transport",()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_PREVIEW_HTML,/id="pv-map-split13"/);
 assert.match(GENERIC_PREVIEW_HTML,/Розділити колонки 1 і 3/);
 assert.match(GENERIC_PREVIEW_JS,/splitFirstAndThird/);
 assert.match(GENERIC_PREVIEW_JS,/skipWordStructuralRows/);
 assert.match(GENERIC_PREVIEW_JS,/extractionLabel/);
 assert.match(GENERIC_PREVIEW_CSS,/grid-template-columns/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|indexedDB/);
});
