import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_MAPPING_CORE_JS} from "../src/generic-mapping-core-assets.js";
import {GENERIC_WORD_COLUMN_SPLIT_JS} from "../src/generic-word-column-split-assets.js";
import {GENERIC_PREVIEW_HTML,GENERIC_PREVIEW_CSS} from "../src/generic-preview-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";

const sandbox={Date};runInNewContext(GENERIC_MAPPING_CORE_JS,sandbox);
runInNewContext(GENERIC_WORD_COLUMN_SPLIT_JS,sandbox);
const mapping=sandbox.AnaliseMapping,split=sandbox.AnaliseWordColumnSplit;
const cell=(value,span=1)=>({value,colSpan:span,merge:"none"});
const fixture={format:"docx",rows:[
 [cell("Дата й час"),cell("Категорія"),cell("Номер і місце"),cell("Результат")],
 [cell("Відділ 1",4)],
 [cell("12:10 16.10.2026"),cell("Папір"),cell("12 Склад А"),cell("Отримано")],
 [cell("13:20 16.10.2026"),cell("Папка"),cell("15 Склад Б"),cell("Видано")],
 [cell("Дата й час"),cell("Категорія"),cell("Номер і місце"),cell("Результат")],
 [cell("Відділ 2",4)],
 [cell("99:70 16.10.2026"),cell("Зошит"),cell("не число"),cell("Очікується")],
 [cell("14:45 17.10.2026"),cell("Маркер"),cell("17 Склад В"),cell("Видано")],
 [cell(""),cell(""),cell(""),cell("")]
]};
const cfg=()=>({headerIndex:1,skipWordStructuralRows:true,fields:[
 {name:"Дата",source:0,type:"date",required:true},
 {name:"Час",source:1,type:"time",required:true},
 {name:"Категорія",source:2,type:"text",required:true},
 {name:"Число",source:3,type:"integer",required:true},
 {name:"Місце",source:4,type:"text",required:true},
 {name:"Результат",source:5,type:"text",required:true}
]});
test("validates neutral split Word rows and skips structural group/headings",()=>{
 const table=split.transform(fixture);
 assert.equal(table.rows.length,9);
 assert.equal(table.wordColumnSplit.outputColumns,6);
 const result=mapping.validate(table,cfg());
 assert.equal(result.validCount,3);
 assert.equal(result.invalidCount,1);
 assert.equal(result.skippedCount,4);
 assert.equal(result.processedCount,4);
 assert.equal(result.issueCount,3);
 assert.deepEqual(Array.from(result.issues,x=>x.row),[7,7,7]);
});
test("validation review retains raw original for failed date-time or number-text splits",()=>{
 const table=split.transform(fixture);
 const result=mapping.validate(table,cfg());
 assert.ok(result.issues.find(x=>x.field==="Дата"&&x.value==="99:70 16.10.2026"));
 assert.ok(result.issues.find(x=>x.field==="Час"&&x.value==="99:70 16.10.2026"));
 assert.ok(result.issues.find(x=>x.field==="Число"&&x.value==="не число"));
 assert.equal(mapping.issueCategory(result.issues.find(x=>x.field==="Дата")),"Дата / час");
 assert.equal(mapping.issueCategory(result.issues.find(x=>x.field==="Час")),"Не заповнено");
 assert.equal(mapping.issueCategory(result.issues.find(x=>x.field==="Число")),"Не заповнено");
});
test("local issue categories are stable, neutral, and useful for manual review",()=>{
 assert.equal(mapping.issueCategory({message:"Дата не існує"}),"Дата / час");
 assert.equal(mapping.issueCategory({message:"Очікується час ГГ:ХХ"}),"Час");
 assert.equal(mapping.issueCategory({message:"Очікується число, пробіл і текст"}),"Поділ комірки");
 assert.equal(mapping.issueCategory({message:"Очікується ціле число"}),"Числове поле");
 assert.equal(mapping.issueCategory({message:"Обов'язкове поле не заповнене"}),"Не заповнено");
 assert.equal(mapping.issueCategory({message:"Текст довший за 4096 символів"}),"Довжина тексту");
 assert.equal(mapping.issueCategory({message:"Невідома помилка"}),"Невідповідність формату");
});
test("review panel exists with columns and remains browser-only",()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_MAPPING_CORE_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 for(const id of ["pv-issue-review","pv-issue-table","pv-issue-note"]){
  assert.match(GENERIC_PREVIEW_HTML,new RegExp('id="'+id+'"'));
 }
 assert.match(GENERIC_PREVIEW_HTML,/Результати перевірки/);
 assert.match(GENERIC_PREVIEW_CSS,/\.pv-issue-review/);
 for(const heading of ["Рядок","Поле","Тип помилки","Вихідне значення","Пояснення"])
  assert.match(GENERIC_PREVIEW_JS,new RegExp(heading));
 assert.match(GENERIC_PREVIEW_JS,/mapper\.issueCategory/);
 assert.match(GENERIC_PREVIEW_JS,/function suggestedFields/);
 assert.match(GENERIC_PREVIEW_JS,/if\(table\.format==='docx'&&table\.wordColumnSplit\)runValidation\(\)/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|indexedDB|localStorage|sessionStorage/);
});
test("unchanged neutral tables still use operator configured mapping",()=>{
 const table={format:"docx",rows:[
  [cell("Назва"),cell("Кількість")],
  [cell("Папка"),cell("три")],
  [cell("Папір"),cell("4")]
 ]};
 const cfg={headerIndex:1,fields:[
  {name:"Назва",source:0,type:"text",required:true},
  {name:"Кількість",source:1,type:"integer",required:true}
 ]};
 const result=mapping.validate(table,cfg);
 assert.equal(result.invalidCount,1);
 assert.equal(result.validCount,1);
 assert.equal(result.issues[0].value,"три");
 assert.equal(result.issues[0].row,2);
 assert.equal(mapping.issueCategory(result.issues[0]),"Числове поле");
});
