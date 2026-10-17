import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_WORD_STRUCTURE_JS} from "../src/generic-word-structure-assets.js";
import {GENERIC_PREVIEW_HTML,GENERIC_PREVIEW_CSS} from "../src/generic-preview-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import worker from "../src/index.js";
const env={};runInNewContext(GENERIC_WORD_STRUCTURE_JS,env);
const inspect=env.AnaliseWordStructure.inspect;
const cell=(value,span=1)=>({value,colSpan:span,merge:'none'});

test("structure recognizer is local-only and does not know domain semantics",()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_WORD_STRUCTURE_JS));
 assert.doesNotMatch(GENERIC_WORD_STRUCTURE_JS,/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|indexedDB|localStorage|sessionStorage/);
 assert.doesNotMatch(GENERIC_WORD_STRUCTURE_JS,/БпЛА|РЕБ|FPV|азимут|подавлен/i);
 assert.equal(inspect({format:"xlsx",rows:[]}),null);
});
test("merged DOCX grouping, page-repeated headings, data and blank rows are classified",()=>{
 const table={format:"docx",rows:[
  [cell("Час"),cell("Товар"),cell("Кількість"),cell("Примітка")],
  [cell("Склад А",4)],
  [cell("08:15"),cell("Папір"),cell("12"),cell("Надійшло")],
  [cell("Час"),cell("Товар"),cell("Кількість"),cell("Примітка")],
  [cell("Склад Б",4)],
  [cell("10:20"),cell("Ручки"),cell("3"),cell("Списано")],
  [cell(""),cell(""),cell(""),cell("")]
 ]};
 const r=inspect(table);
 assert.equal(r.rowCount,7);
 assert.equal(r.width,4);
 assert.equal(r.headerRow,1);
 assert.equal(r.counts.header,1);
 assert.equal(r.counts.repeatedHeader,1);
 assert.equal(r.counts.group,2);
 assert.equal(r.counts.data,2);
 assert.equal(r.counts.empty,1);
 assert.equal(r.mergedCells,2);
 assert.deepEqual(Array.from(r.outline,x=>x.row),[2,5]);
 assert.deepEqual(Array.from(r.rowKinds,x=>x.kind),
  ["header","group","data","repeatedHeader","group","data","empty"]);
});
test("ordinary sparse rows are not mistaken for full-width group headings",()=>{
 const table={format:"docx",rows:[
  [cell("Назва"),cell("Кількість")],
  [cell("Олівець"),cell("")],
  [cell("Можливий розділ")],
  [cell("Архів",2)]
 ]};
 const r=inspect(table);
 assert.equal(r.counts.group,1);
 assert.equal(r.counts.possibleGroup,1);
 assert.equal(r.counts.data,1);
 assert.equal(r.outline.length,2);
});
test("explicit header selection can override automatic header guessing",()=>{
 const table={format:"docx",rows:[
  [cell("Звіт за квартал",3)],
  [cell("Дата"),cell("Номер"),cell("Сума")],
  [cell("01.04"),cell("А1"),cell("125")],
  [cell("Дата"),cell("Номер"),cell("Сума")]
 ]};
 const r=inspect(table,2);
 assert.equal(r.headerRow,2);
 assert.equal(r.counts.group,1);
 assert.equal(r.counts.repeatedHeader,1);
 assert.equal(r.counts.data,1);
});
test("vertical merges are counted without inferring group labels",()=>{
 const table={format:"docx",rows:[
  [cell("Відділ"),cell("Назва")],
  [{value:"Канцелярія",colSpan:1,merge:"restart"},cell("Папір")],
  [{value:"",colSpan:1,merge:"continue"},cell("Ручка")]
 ]};
 const r=inspect(table);
 assert.equal(r.verticalMerges,2);
 assert.equal(r.counts.group,0);
 assert.equal(r.counts.data,2);
});
test("preview serves protected local structure JS and surfaces safe counts",()=>{
 assert.match(GENERIC_PREVIEW_HTML,/\/api\/generic-word-structure\.js/);
 assert.match(GENERIC_PREVIEW_HTML,/id="pv-word-structure"/);
 assert.match(GENERIC_PREVIEW_HTML,/id="pv-structure-summary"/);
 assert.match(GENERIC_PREVIEW_HTML,/Дані залишаються в браузері/);
 assert.match(GENERIC_PREVIEW_CSS,/\.pv-structure/);
 assert.match(GENERIC_PREVIEW_JS,/wordStructure\.inspect/);
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});
test("new asset remains inaccessible when Cloudflare Access is not configured",async()=>{
 const response=await worker.fetch(new Request("https://example.invalid/api/generic-word-structure.js"),{});
 assert.equal(response.status,503);
});
