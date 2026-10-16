import test from "node:test";
import assert from "node:assert/strict";
import {zipSync,strToU8} from "fflate";
import {parseSyntheticBundle,syntheticUploadApi} from "../src/synthetic-upload-api.js";
import {SYNTHETIC_UPLOAD_HTML,SYNTHETIC_UPLOAD_CSS} from "../src/synthetic-upload-assets.js";
import {SYNTHETIC_UPLOAD_JS} from "../src/synthetic-upload-client.js";
import {GLOBAL_NAV_JS} from "../src/global-navigation-assets.js";
const enc=x=>strToU8(x);
const manifest=(kind,n)=>JSON.stringify({marker:"ANALISE_SYNTHETIC_ONLY_V1",synthetic:true,date:"2026-10-11",kind,expected_rows:n});
function wordFile(){
 let rows=['<w:tr><w:tc><w:t>Час, дата</w:t></w:tc></w:tr>'];
 for(let i=0;i<76;i++){
  if(i===0||i===41)rows.push('<w:tr><w:tc><w:t>ДЕМО ГРУПА</w:t></w:tc></w:tr>');
  const value=['Альфа-демо','Альфа деммo','Бета-демо','Бетта-демо'][i%4];
  rows.push('<w:tr>'+['12:00 11.10.2026','ДЕМО',value,'ТЕСТ'].map(x=>'<w:tc><w:t>'+x+'</w:t></w:tc>').join('')+'</w:tr>');
 }
 return zipSync({'analise-fixture.json':enc(manifest("docx",76)),'word/document.xml':enc('<w:document>'+rows.join('')+'</w:document>')});
}
function excelFile(){
 let rows=['<x:row r="1"><x:c r="A1"><x:v>№</x:v></x:c></x:row>'];
 for(let i=1;i<=21;i++){
  const value=['Альфа-демо','Альфа деммo','Бета-демо','Бетта-демо'][i%4];
  rows.push('<x:row r="'+(i+1)+'"><x:c r="A'+(i+1)+'"><x:v>'+i+'</x:v></x:c>'+
  '<x:c r="N'+(i+1)+'"><x:v>'+value+'</x:v></x:c></x:row>');
 }
 return zipSync({'analise-fixture.json':enc(manifest("xlsx",21)),'xl/worksheets/sheet1.xml':enc('<x:worksheet>'+rows.join('')+'</x:worksheet>')});
}
test("synthetic DOCX parser counts 76 real rows and detects 38 typo occurrences",()=>{
 const parsed=parseSyntheticBundle(wordFile(),"ANALISE_ДЕМО_Word.docx");
 assert.equal(parsed.length,1);assert.equal(parsed[0].records,76);
 assert.equal(parsed[0].questions,38);
 assert.equal(parsed[0].detail[0].row,1);
});
test("synthetic XLSX parser counts 21 rows, ignores formatted/header row",()=>{
 const parsed=parseSyntheticBundle(excelFile(),"ANALISE_ДЕМО_Excel.xlsx");
 assert.equal(parsed[0].records,21);
 assert.equal(parsed[0].questions,11);
});
test("nested ZIP with Word and Excel returns 97 rows",()=>{
 const archive=zipSync({"demo/ANALISE_ДЕМО_Word.docx":wordFile(),"demo/ANALISE_ДЕМО_Excel.xlsx":excelFile()});
 const parsed=parseSyntheticBundle(archive,"ANALISE_ДЕМО_bundle.zip");
 assert.equal(parsed.reduce((n,d)=>n+d.records,0),97);
 assert.equal(parsed.reduce((n,d)=>n+d.questions,0),49);
});
test("real document with no fixture marker is not imported",()=>{
 assert.throws(()=>parseSyntheticBundle(zipSync({"word/document.xml":enc("<w:document/>")}),"report.docx"),/позначки синтетичного/);
});
test("forged synthetic marker with foreign content is rejected",()=>{
 const src=zipSync({"analise-fixture.json":enc(manifest("docx",76)),
  "word/document.xml":enc('<w:tr><w:tc><w:t>real data</w:t></w:tc></w:tr>')});
 assert.throws(()=>parseSyntheticBundle(src,"ANALISE_ДЕМО_Word.docx"),/Структура Word/);
});
test("missing admin Access role blocks ingestion before D1",async()=>{
 const r=await syntheticUploadApi(new Request("https://analise.test/api/synthetic-upload/ingest",{
  method:"POST",headers:{"content-type":"application/octet-stream"},body:wordFile()
 }),{DB:null},{id:"user",role:"user",active:1});
 assert.equal(r.status,403);
});
test("client keeps files out of the real ingestion API and provides single dropzone",()=>{
 assert.match(SYNTHETIC_UPLOAD_HTML,/id="ud-dropzone"/);
 assert.match(SYNTHETIC_UPLOAD_HTML,/webkitdirectory/);
 assert.match(SYNTHETIC_UPLOAD_JS,/ANALISE_ДЕМО_/);
 assert.match(SYNTHETIC_UPLOAD_JS,/application\/octet-stream/);
 assert.match(SYNTHETIC_UPLOAD_CSS,/prefers-reduced-motion/);
 assert.match(GLOBAL_NAV_JS,/synthetic-upload/);
});
