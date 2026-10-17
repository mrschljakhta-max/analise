import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_LOCAL_EXPORT_JS} from "../src/generic-local-export-assets.js";
import {GENERIC_WORD_COLUMN_SPLIT_JS} from "../src/generic-word-column-split-assets.js";
import {GENERIC_WORD_STRUCTURE_JS} from "../src/generic-word-structure-assets.js";
import {GENERIC_MAPPING_CORE_JS} from "../src/generic-mapping-core-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import {GENERIC_PREVIEW_HTML} from "../src/generic-preview-assets.js";
import worker from "../src/index.js";

const globals={Date};for(const code of [
 GENERIC_MAPPING_CORE_JS,GENERIC_WORD_STRUCTURE_JS,GENERIC_WORD_COLUMN_SPLIT_JS,
 GENERIC_LOCAL_EXPORT_JS
])runInNewContext(code,globals);
const mapping=globals.AnaliseMapping,inspect=globals.AnaliseWordStructure.inspect,
 split=globals.AnaliseWordColumnSplit.transform,exporter=globals.AnaliseLocalExport;
const plain=v=>JSON.parse(JSON.stringify(v));
const cell=(value,colSpan=1)=>({value,colSpan,merge:"none"});
const table=split({format:"docx",sheet:"Аркуш інвентаризації",rows:[
 [cell("Дата й час"),cell("Товар"),cell("Код і склад"),cell("Статус")],
 [cell("Склад А",4)],
 [cell("08:20 10.10.2026"),cell("Папір"),cell("15 Склад А"),cell("Отримано")],
 [cell("09:30 10.10.2026"),cell("Папка"),cell("25 Склад А"),cell("Видано")],
 [cell("Дата й час"),cell("Товар"),cell("Код і склад"),cell("Статус")],
 [cell("Склад Б",4)],
 [cell("99:99 10.10.2026"),cell("Зошит"),cell("немає коду"),cell("Очікується")],
 [cell("11:45 11.10.2026"),cell("Маркер"),cell("17 Склад Б"),cell("Прийнято")]
]});
const config={headerIndex:1,skipWordStructuralRows:true,fields:[
 {name:"Дата",source:0,type:"date",required:true},
 {name:"Час",source:1,type:"time",required:true},
 {name:"Найменування",source:2,type:"text",required:true},
 {name:"Код",source:3,type:"integer",required:true},
 {name:"Склад",source:4,type:"text",required:true},
 {name:"Статус",source:5,type:"text",required:true}
]};
function build(){
 const validation=mapping.validate(table,config);
 return exporter.build({table,config,validation,filename:"warehouse_demo.docx",
  tableName:table.sheet,tableIndex:1,structure:inspect(table,1)});
}
test("v1 record contract stays unchanged; metadata is additive",()=>{
 const payload=plain(build());
 assert.equal(payload.schema_version,"ANALISE_LOCAL_ROWS_V1");
 assert.deepEqual(Object.keys(payload.records[0]),["source_row","values"]);
 assert.equal(payload.records.length,3);
 assert.equal(payload.valid_count,3);
 assert.equal(payload.invalid_count,1);
 assert.equal(payload.metadata.metadata_version,"ANALISE_LOCAL_METADATA_V1");
 assert.equal(payload.metadata.table.row_count,8);
 assert.equal(payload.metadata.table.parsed_columns,6);
 assert.equal(payload.metadata.table.original_columns,4);
 assert.equal(payload.metadata.table.header_row,1);
 assert.equal(payload.metadata.table.table_index,1);
 assert.equal(payload.metadata.table.format,"docx");
});
test("group headings and repeated header rows preserved as table structure only",()=>{
 const m=plain(build()).metadata;
 assert.deepEqual(m.table.structural_row_counts,{
  header:1,repeatedHeader:1,group:2,possibleGroup:0,data:4,empty:0
 });
 assert.deepEqual(m.table.structural_rows.map(x=>({row:x.row,kind:x.kind})),[
  {row:1,kind:"header"},{row:2,kind:"group"},
  {row:5,kind:"repeatedHeader"},{row:6,kind:"group"}
 ]);
 assert.deepEqual(m.table.structural_rows.filter(x=>x.kind==="group").map(x=>x.label),[
  "Склад А","Склад Б"
 ]);
 assert.ok(!m.table.structural_rows.some(x=>x.row===3));
});
test("provenance maps each parsed six-column row back to original four raw cells",()=>{
 const payload=plain(build());
 const sources=payload.metadata.column_origins;
 assert.deepEqual(sources.map(x=>x.source_column),[1,1,2,3,3,4]);
 assert.deepEqual(sources.map(x=>x.parsed_column),[1,2,3,4,5,6]);
 assert.deepEqual(sources.map(x=>x.transform),[
  "date_part","time_part","whole","number_prefix","text_suffix","whole"
 ]);
 assert.deepEqual(payload.metadata.record_provenance.map(r=>r.source_row),[3,4,8]);
 assert.deepEqual(payload.metadata.record_provenance[0].source_cells,[
  {column:1,text:"08:20 10.10.2026"},
  {column:2,text:"Папір"},
  {column:3,text:"15 Склад А"},
  {column:4,text:"Отримано"}
 ]);
 assert.equal(payload.records[0].values["Дата"],"2026-10-10");
 assert.equal(payload.records[0].values["Час"],"08:20");
});
test("local validation report describes its scope and preserves error raw values",()=>{
 const {validation}=plain(build()).metadata;
 assert.equal(validation.scope,"local_types_and_required_fields_only");
 assert.equal(validation.checked_against_d1_directories,false);
 assert.equal(validation.processed_count,4);
 assert.equal(validation.valid_count,3);
 assert.equal(validation.invalid_count,1);
 assert.equal(validation.skipped_count,3);
 assert.equal(validation.issue_count,3);
 assert.equal(validation.issues_truncated,false);
 assert.equal(validation.exported_issue_count,3);
 assert.ok(validation.issues.some(x=>x.raw_value==="99:99 10.10.2026"));
 assert.ok(validation.issues.some(x=>x.raw_value==="немає коду"));
 assert.ok(validation.issues.every(x=>x.source_row===7));
});
test("source extraction handles sparse Excel cells without guessing column order",()=>{
 const xlsx={format:"xlsx",sheet:"Канцелярія",rows:[
  {index:4,cells:[{ref:"A4",value:"Предмет"},{ref:"C4",value:"Кількість"}]},
  {index:5,cells:[{ref:"A5",value:"Папір"},{ref:"C5",value:"7"}]},
  {index:10,cells:[{ref:"A10",value:"Ручка"},{ref:"C10",value:"2"}]}
 ]};
 const cfg={headerIndex:4,fields:[
  {name:"Предмет",source:0,type:"text",required:true},
  {name:"Кількість",source:2,type:"integer",required:true}
 ]};
 const check=mapping.validate(xlsx,cfg);
 const p=plain(exporter.build({table:xlsx,config:cfg,validation:check,
  filename:"office.xlsx",tableIndex:1,tableName:"Канцелярія",structure:null}));
 assert.equal(p.valid_count,2);
 assert.equal(p.metadata.table.format,"xlsx");
 assert.equal(p.metadata.table.structural_row_counts,null);
 assert.deepEqual(p.metadata.table.structural_rows,[]);
 assert.deepEqual(p.metadata.column_origins.map(x=>x.source_column),[1,3]);
 assert.deepEqual(p.metadata.record_provenance[0].source_cells,[
  {column:1,text:"Папір"},{column:3,text:"7"}
 ]);
 assert.equal(p.records[1].source_row,10);
});
test("exporter rejects invalid schema or an export without accepted records",()=>{
 const invalid=mapping.validate(table,config);
 assert.throws(()=>exporter.build({table,config,validation:{...invalid,configErrors:["problem"]}}),
  /Схема колонок/);
 assert.throws(()=>exporter.build({table,config,validation:{...invalid,validCount:0}}),
  /Немає коректних рядків/);
});
test("extension stays browser-only and is protected by Cloudflare Access",async()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_LOCAL_EXPORT_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_PREVIEW_HTML,/\/api\/generic-local-export\.js/);
 assert.match(GENERIC_PREVIEW_JS,/localExporter\.build/);
 assert.match(GENERIC_PREVIEW_HTML,/JSON \+ метадані/);
 assert.doesNotMatch(GENERIC_LOCAL_EXPORT_JS,/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|indexedDB|localStorage|sessionStorage/);
 const response=await worker.fetch(new Request("https://example.invalid/api/generic-local-export.js"),{});
 assert.equal(response.status,503);
});
