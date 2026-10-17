import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_DEMO_DICTIONARY_JS} from "../src/generic-demo-dictionary-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import {GENERIC_PREVIEW_HTML} from "../src/generic-preview-assets.js";
import worker from "../src/index.js";

const ctx={};
runInNewContext(GENERIC_DEMO_DICTIONARY_JS,ctx);
const dict=ctx.AnaliseDemoDictionary;
const items=[
 {id:"demo_quality_alpha_v1",name:"Альфа-демо"},
 {id:"demo_quality_beta_v1",name:"Бета-демо"}
];
const wtable={format:"docx",rows:[
 [{value:"Дата"},{value:"Час"},{value:"Категорія"},{value:"Число"},{value:"Текст"},{value:"Результат"}]
]};
const report=records=>({tables:[{format:"docx",recognized:true,sheet:"Таблиця 1",
 header_row:1,records:records.map((value,i)=>({source_row:i+2,values:{value_2:value}}))}]});

test("normalization agrees with the existing Purgatory's spacing and dashes",()=>{
 assert.equal(dict.normalize("  АЛЬФА—ДЕМО  "),"альфа-демо");
 assert.equal(dict.normalize("  Бета-демо "),dict.normalize("бета-демо"));
});

test("exact demo matches versus unknown values are distinguished without alteration",()=>{
 const r=dict.validate(report(["Альфа-демо"," Бета—демо ","Невідоме"]),[wtable],items);
 assert.equal(r.status,"checked");
 assert.equal(r.matched,2);
 assert.equal(r.missing,1);
 assert.equal(r.checked_rows,3);
 assert.equal(r.checks[2].status,"missing");
 assert.equal(r.checks[2].original_value,"Невідоме");
 assert.equal(r.checks[0].entry_id,"demo_quality_alpha_v1");
});

test("unrelated Word tables do not get forced onto a demo dictionary",()=>{
 const r=dict.validate(report(["Альфа-демо"]),[{format:"docx",rows:[
 [{value:"Дата"},{value:"Час"},{value:"Службове поле"},{value:"Число"},{value:"Текст"},{value:"Результат"}]
 ]}],items);
 assert.equal(r.unmapped_tables,1);
 assert.equal(r.checked_rows,0);
});

test("Excel selects only a uniquely named neutral category field",()=>{
 const data={tables:[{format:"xlsx",sheet:"Аркуш 1",recognized:true,
  column_headers:{A:"№",B:"Категорія",C:"Коментар"},
  records:[{source_row:4,values:{A:"1",B:"Альфа-демо",C:"Демо"}}]}]};
 const r=dict.validate(data,[{format:"xlsx"}],items);
 assert.equal(r.matched,1);
 assert.equal(r.checks[0].field,"B");
 data.tables[0].column_headers.C="Назва";
 const ambiguous=dict.validate(data,[{format:"xlsx"}],items);
 assert.equal(ambiguous.checked_rows,0);
 assert.equal(ambiguous.ambiguous,1);
 assert.equal(ambiguous.checks[0].status,"ambiguous_mapping");
});

test("duplicate canonical names and empty values are not silently accepted",()=>{
 const r=dict.validate(report(["Альфа-демо",""]),[wtable],[
 ...items,{id:"duplicate",name:"АЛЬФА-ДЕМО"}]);
 assert.equal(r.ambiguous,1);
 assert.equal(r.empty,1);
 assert.equal(r.matched,0);
});

test("empty or potentially truncated catalog must fail closed",()=>{
 assert.throws(()=>dict.validate(report(["Альфа-демо"]),[wtable],[]),/порожній/);
 assert.throws(()=>dict.validate(report(["Альфа-демо"]),[wtable],
  Array.from({length:40},(_,i)=>({id:"entry"+i,name:"Демо "+i}))),/неповною/);
 assert.throws(()=>dict.validate(report(["Альфа-демо"]),[],items),/вихідних таблиць/);
});

test("catalog fetch requests no document values and uses only GET",async()=>{
 const calls=[];
 const custom={fetch:async (...args)=>{
  calls.push(args);
  return {ok:true,json:async()=>({items})};
 }};
 runInNewContext(GENERIC_DEMO_DICTIONARY_JS,custom);
 const loaded=await custom.AnaliseDemoDictionary.load();
 assert.equal(loaded.length,2);
 assert.deepEqual(Array.from(calls[0],(x,i)=>i===1?{...x}:x),[
  "/api/purgatory/candidates?directory_id=demo_quality_labels",
  {method:"GET",credentials:"same-origin",cache:"no-store"}
 ]);
});

test("private JS asset and preview integration retain local document processing",async()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_DEMO_DICTIONARY_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_PREVIEW_HTML,/\/api\/generic-demo-dictionary\.js/);
 assert.match(GENERIC_PREVIEW_JS,/demoDictionary\.validate/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\bfetch\s*\(/);
 const r=await worker.fetch(new Request("https://example.invalid/api/generic-demo-dictionary.js"),{});
 assert.equal(r.status,503);
});
