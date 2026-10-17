import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_WORD_COLUMN_SPLIT_JS} from "../src/generic-word-column-split-assets.js";
import {GENERIC_PREVIEW_HTML} from "../src/generic-preview-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import {GENERIC_MAPPING_CORE_JS} from "../src/generic-mapping-core-assets.js";
import worker from "../src/index.js";

const ctx={Date};runInNewContext(GENERIC_WORD_COLUMN_SPLIT_JS,ctx);
const split=ctx.AnaliseWordColumnSplit;
const cell=(value,colSpan=1)=>({value,colSpan,merge:"none"});
const example={format:"docx",sheet:"Таблиця 1",rows:[
 [cell("Час, дата"),cell("Категорія"),cell("Орієнтовний н.п. виявлення"),cell("Статус")],
 [cell("Сектор А",4)],
 [cell("19:25 10.10.2026"),cell("Вантаж"),cell("87 Прикладове"),cell("Прийнято")],
 [cell("20:52 10.10.2026"),cell("Лист"),cell("89 Нова Долина"),cell("Завершено")],
 [cell("Сектор Б",4)],
 [cell("21:18 10.10.2026"),cell("Лист"),cell("69 Мале Озеро"),cell("Прийнято")]
]};
test("strict date/time splitting and invalid dates",()=>{
 assert.deepEqual({...split.dateTime("19:25 10.10.2026")},{date:"10.10.2026",time:"19:25"});
 assert.equal(split.dateTime("24:59 10.10.2026"),null);
 assert.equal(split.dateTime("21:60 10.10.2026"),null);
 assert.equal(split.dateTime("12:00 31.02.2026"),null);
 assert.equal(split.dateTime("19:25 not-a-date"),null);
});
test("number and multiword label are separated without loss",()=>{
 assert.deepEqual({...split.numberText("87 Нова Долина")},{number:"87",text:"Нова Долина"});
 assert.equal(split.numberText("Текст без числа"),null);
 assert.equal(split.numberText("87"),null);
});
test("only original first and third columns split; other fields remain intact",()=>{
 const mapped=split.transform(example);
 assert.notEqual(mapped,example);
 assert.equal(example.rows[0].length,4);
 assert.equal(mapped.rows.length,6);
 assert.equal(mapped.rows[0].length,6);
 assert.deepEqual(Array.from(mapped.rows[0],c=>c.value),[
  "Дата","Час","Категорія","Азимут","Населений пункт","Статус"
 ]);
 assert.deepEqual(Array.from(mapped.rows[2],c=>c.value),[
  "10.10.2026","19:25","Вантаж","87","Прикладове","Прийнято"
 ]);
 assert.deepEqual(Array.from(mapped.rows[3],c=>c.value),[
  "10.10.2026","20:52","Лист","89","Нова Долина","Завершено"
 ]);
 assert.equal(mapped.rows[1][0].colSpan,6);
 assert.equal(mapped.rows[4][0].colSpan,6);
 assert.equal(mapped.wordColumnSplit.issues.length,0);
});
test("ambiguous or malformed fields are preserved and flagged",()=>{
 const data={...example,rows:[...example.rows.slice(0,4),[
  cell("21:19 неповна дата"),cell("Не змінювати"),cell("без числа"),cell("Не змінювати також")
 ]]};
 const result=split.transform(data);
 assert.deepEqual(Array.from(result.rows[4],c=>c.value),[
  "21:19 неповна дата","","Не змінювати","","без числа","Не змінювати також"
 ]);
 assert.deepEqual(Array.from(result.wordColumnSplit.issues),[5]);
});
test("unrelated Word table stays unchanged without matching first and third columns",()=>{
 const table={format:"docx",rows:[
  [cell("Найменування"),cell("Кількість"),cell("Ціна"),cell("Деталі")],
  [cell("Папір"),cell("12"),cell("15,50"),cell("А4")],
  [cell("Папка"),cell("2"),cell("20,00"),cell("Тверда")]
 ]};
 assert.equal(split.transform(table),table);
});
test("existing local mapping works on six split columns",()=>{
 const mapctx={};runInNewContext(GENERIC_MAPPING_CORE_JS,mapctx);
 const mapped=split.transform(example);
 const core=mapctx.AnaliseMapping;
 assert.equal(core.maxColumns(mapped),6);
 assert.equal(core.columns(mapped,1)[3].header,"Азимут");
 assert.equal(core.columns(mapped,1)[4].header,"Населений пункт");
 const fields=[
  {name:"Дата",source:0,type:"date",required:true},
  {name:"Час",source:1,type:"text",required:true},
  {name:"Категорія",source:2,type:"text",required:true},
  {name:"Число",source:3,type:"integer",required:true},
  {name:"Місце",source:4,type:"text",required:true},
  {name:"Статус",source:5,type:"text",required:true}
 ];
 const valid=core.validate(mapped,{headerIndex:1,fields});
 assert.equal(valid.validCount,3);
 assert.equal(valid.rows[0].values["Дата"],"2026-10-10");
 assert.equal(valid.rows[0].values["Час"],"19:25");
 assert.equal(valid.rows[0].values["Число"],87);
});
test("new browser asset remains local-only and served behind Access",async()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_WORD_COLUMN_SPLIT_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_PREVIEW_HTML,/\/api\/generic-word-column-split\.js/);
 assert.match(GENERIC_PREVIEW_JS,/wordSplit\.transform/);
 assert.doesNotMatch(GENERIC_WORD_COLUMN_SPLIT_JS,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|WebSocket/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
 const response=await worker.fetch(new Request("https://example.invalid/api/generic-word-column-split.js"),{});
 assert.equal(response.status,503);
});
