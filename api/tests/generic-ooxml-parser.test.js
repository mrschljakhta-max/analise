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
