import test from "node:test";
import assert from "node:assert/strict";
import {zipSync,strToU8} from "fflate";
import {extractOoxmlTables} from "../src/generic-ooxml-parser.js";
const zip=files=>zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])));
test("extracts a generic Word table without special fixture markers",()=>{
 const bytes=zip({"word/document.xml":'<w:document><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Назва</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Значення</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:document>'});
 const result=extractOoxmlTables(bytes,"example.docx");
 assert.equal(result.table_count,1);
 assert.equal(result.tables[0].rows[0][0].value,"Назва");
 assert.equal(result.tables[0].rows[0][1].value,"Значення");
});
test("extracts generic Excel cells with shared strings and numbers",()=>{
 const bytes=zip({
  "xl/sharedStrings.xml":'<sst><si><t>Назва</t></si><si><t>Приклад</t></si></sst>',
  "xl/worksheets/sheet1.xml":'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>17</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>'
 });
 const result=extractOoxmlTables(bytes,"example.xlsx");
 assert.equal(result.table_count,1);
 assert.equal(result.tables[0].rows[0].cells[0].value,"Назва");
 assert.equal(result.tables[0].rows[0].cells[1].value,"17");
 assert.equal(result.tables[0].rows[1].cells[0].value,"Приклад");
});
test("rejects unsupported extensions and invalid archives",()=>{
 assert.throws(()=>extractOoxmlTables(new Uint8Array([1,2]),"sample.pdf"),/Підтримуються/);
 assert.throws(()=>extractOoxmlTables(new Uint8Array([1,2]),"sample.xlsx"));
});


test("Word gridSpan and verticalMerge are preserved without fixture-specific columns",()=>{
 const bytes=zip({"word/document.xml":'<w:document><w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Заголовок</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t></w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:document>'});
 const result=extractOoxmlTables(bytes,"demo.docx");
 assert.equal(result.tables[0].rows.length,2);
 assert.equal(result.tables[0].rows[0][0].colSpan,2);
 assert.equal(result.tables[0].rows[0][0].verticalMergeState,"restart");
 assert.equal(result.tables[0].rows[1][0].verticalMergeState,"continue");
});
test("Excel workbook names, cached formula, merged ranges and date style",()=>{
 const bytes=zip({
  "xl/workbook.xml":'<workbook><sheets><sheet name="Фінансовий підсумок" sheetId="1" r:id="rId2"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":'<Relationships><Relationship Id="rId2" Target="worksheets/sheet3.xml"/></Relationships>',
  "xl/styles.xml":'<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  "xl/worksheets/sheet3.xml":'<worksheet><sheetData><row r="3"><c r="A3" s="1"><v>25569</v></c><c r="B3"><f>2+2</f><v>4</v></c><c r="C3" t="inlineStr"><is><t>Привіт</t></is></c></row></sheetData><mergeCells><mergeCell ref="D3:E3"/></mergeCells></worksheet>'
 });
 const table=extractOoxmlTables(bytes,"budget.xlsx").tables[0];
 assert.equal(table.sheet,"Фінансовий підсумок");
 assert.equal(table.rows[0].index,3);
 assert.equal(table.rows[0].cells[0].value,"1970-01-01");
 assert.equal(table.rows[0].cells[0].type,"date");
 assert.equal(table.rows[0].cells[1].formula,"2+2");
 assert.equal(table.rows[0].cells[1].value,"4");
 assert.equal(table.rows[0].cells[2].value,"Привіт");
 assert.deepEqual(table.merges,["D3:E3"]);
});
test("date serial 60 is not silently converted to a real day",()=>{
 const bytes=zip({
  "xl/styles.xml":'<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>',
  "xl/worksheets/sheet1.xml":'<worksheet><sheetData><row r="1"><c r="A1" s="0"><v>60</v></c></row></sheetData></worksheet>'
 });
 assert.equal(extractOoxmlTables(bytes,"demo.xlsx").tables[0].rows[0].cells[0].value,"1900-02-29");
});
test("local preview is private, parses scripts and does not upload document bytes",async()=>{
 const {Script}=await import("node:vm");
 const {GENERIC_PREVIEW_HTML,GENERIC_PREVIEW_CSS}=await import("../src/generic-preview-assets.js");
 const {GENERIC_PREVIEW_JS}=await import("../src/generic-preview-client.js");
 const {GLOBAL_NAV_JS}=await import("../src/global-navigation-assets.js");
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_PREVIEW_HTML,/id="pv-zone"/);
 assert.match(GENERIC_PREVIEW_HTML,/не відправляються на сервер/);
 assert.match(GENERIC_PREVIEW_CSS,/prefers-reduced-motion/);
 assert.match(GLOBAL_NAV_JS,/\/api\/generic-preview/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\bfetch\s*\(/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB/);
 assert.match(GENERIC_PREVIEW_JS,/DecompressionStream/);
});
