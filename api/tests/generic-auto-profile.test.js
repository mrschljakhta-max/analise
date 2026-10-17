import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_AUTO_PROFILE_JS} from "../src/generic-auto-profile-assets.js";
import {GENERIC_WORD_COLUMN_SPLIT_JS} from "../src/generic-word-column-split-assets.js";
import {GENERIC_PREVIEW_HTML} from "../src/generic-preview-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import worker from "../src/index.js";

const ctx={Date};runInNewContext(GENERIC_WORD_COLUMN_SPLIT_JS,ctx);
runInNewContext(GENERIC_AUTO_PROFILE_JS,ctx);
const auto=ctx.AnaliseAutoParse;
const cell=(value,colSpan=1)=>({value,colSpan});
function demoWord(records=76){
 const header=[cell("Час, дата"),cell("Категорія"),cell("Число і текст"),cell("Результат")];
 const row=i=>[cell("19:25 10.10.2026"),cell("Документ"),cell((i+1)+" Прикладове"),cell("Зареєстровано")];
 const rows=[header,[cell("Група A",4)],...Array.from({length:38},(_,i)=>row(i)),[cell("Група B",4)],...Array.from({length:records-38},(_,i)=>row(i+38))];
 return ctx.AnaliseWordColumnSplit.transform({format:"docx",sheet:"Таблиця 1",rows});
}
test("automatic Word recognition: 79 rows, 76 records, two groups",()=>{
 const t=demoWord();
 assert.equal(t.rows.length,79);
 const result=auto.inspect([t]);
 assert.equal(result.recognized_tables,1);
 assert.equal(result.records,76);
 assert.equal(result.valid,76);
 assert.equal(result.needs_review,0);
 assert.equal(result.tables[0].structure.groups,2);
 assert.equal(result.tables[0].structure.headings,1);
 assert.equal(result.tables[0].records[0].source_row,3);
 assert.equal(result.tables[0].records[0].group_label,"Група A");
 assert.equal(result.tables[0].records[38].group_label,"Група B");
 assert.deepEqual(Array.from(result.tables[0].records[0].raw_cells),[
  "19:25 10.10.2026","Документ","1 Прикладове","Зареєстровано"
 ]);
});
test("invalid Word row remains in output with validation issue",()=>{
 const t=demoWord();
 t.rows[3][0].value="31.02.2026";
 t.rows[3][1].value="";
 t.rows[3][3].value="";
 const result=auto.inspect([t]);
 assert.equal(result.records,76);
 assert.equal(result.valid,75);
 assert.equal(result.needs_review,1);
 assert(result.tables[0].issues.some(x=>x.row===4));
});
test("unrelated Word tables must not inherit matching profile",()=>{
 const result=auto.inspect([{sheet:"Приклад",format:"docx",rows:[
  [{value:"Опис"},{value:"Значення"}],
  [{value:"Папір"},{value:"10"}]
 ]}]);
 assert.equal(result.recognized_tables,0);
 assert.equal(result.records,0);
 assert.match(result.tables[0].issues[0].message,/не розпізнано/);
});
test("Excel A:AA labels and source references are retained automatically",()=>{
 const letters=Array.from({length:27},(_,i)=>i===26?"AA":String.fromCharCode(65+i));
 const header={index:1,cells:letters.map(l=>({ref:l+"1",value:"Заголовок "+l,type:"text"}))};
 const row={index:2,cells:letters.map((l,i)=>({ref:l+"2",value:String(i+2),raw:String(i+2),type:"number"}))};
 const result=auto.inspect([{format:"xlsx",sheet:"Бухгалтерія",rows:[header,row]}]);
 assert.equal(result.records,1);
 assert.equal(result.recognized_tables,1);
 assert.equal(result.tables[0].header_row,1);
 assert(result.tables[0].columns.includes("AA"));
 assert.equal(result.tables[0].records[0].values.AA,"28");
 assert.equal(result.tables[0].records[0].raw_cells.AA.ref,"AA2");
});
test("Excel incomplete cached formula is reported, not erased",()=>{
 const result=auto.inspect([{format:"xlsx",sheet:"Таблиця",rows:[
  {index:1,cells:[{ref:"A1",value:"Назва",type:"text"},{ref:"B1",value:"Результат",type:"text"},{ref:"C1",value:"Дата",type:"text"}]},
  {index:2,cells:[{ref:"A2",value:"X",type:"text"},{ref:"B2",value:"",formula:"SUM(1:2)",type:"number"},{ref:"C2",value:"2026-10-10",type:"date"}]}
 ]}]);
 assert.equal(result.needs_review,1);
 assert.match(result.tables[0].issues[0].message,/кешованого/);
});
test("new client bundle is local-only and private",async()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_AUTO_PROFILE_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_PREVIEW_HTML,/\/api\/generic-auto-profile\.js/);
 assert.match(GENERIC_PREVIEW_JS,/autoParser\.inspect\(state\.tables\)/);
 assert.doesNotMatch(GENERIC_AUTO_PROFILE_JS,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|indexedDB/);
 const response=await worker.fetch(new Request("https://example.invalid/api/generic-auto-profile.js"),{});
 assert.equal(response.status,503);
});
