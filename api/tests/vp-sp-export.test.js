import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { VP_SP_EXPORT_JS } from "../src/vp-sp-export-assets.js";
import { VP_SP_HTML } from "../src/vp-sp-assets.js";
import { VP_SP_JS } from "../src/vp-sp-client.js";

function exporter(){
  const sandbox={window:{},TextEncoder,Blob};
  vm.runInNewContext(VP_SP_EXPORT_JS,sandbox,{timeout:1000});
  return sandbox.window.ANALISE_VP_EXPORT;
}
// The built-in ZIP writer uses stored (uncompressed) UTF-8 XML only.
function unpackStoredZip(bytes){
  const result=new Map(),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let pos=0;
  const decoder=new TextDecoder();
  while(pos+4<=bytes.length && v.getUint32(pos,true)===0x04034b50){
    const method=v.getUint16(pos+8,true);
    assert.equal(method,0);
    const size=v.getUint32(pos+18,true);
    const nameLen=v.getUint16(pos+26,true);
    const extra=v.getUint16(pos+28,true);
    const name=decoder.decode(bytes.subarray(pos+30,pos+30+nameLen));
    const body=pos+30+nameLen+extra;
    const data=bytes.subarray(body,body+size);
    assert.equal(data.length,size);
    result.set(name,decoder.decode(data));
    pos=body+size;
  }
  assert.equal(v.getUint32(pos,true),0x02014b50,"ZIP central directory starts at expected offset");
  return result;
}
test("VP/SP Excel export creates genuine XLSX with distinct VP, SP, and hierarchy sheets",async()=>{
  const xlsx=exporter().buildXlsx([
    {kind:"vp",code:"VP-AAA111222333",name:"Випробувальна назва",is_active:1},
    {kind:"sp",code:"SP-AAA111222333",name:"Спостережний тест",is_active:0}
  ]);
  assert.equal(xlsx.type,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const bytes=new Uint8Array(await xlsx.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
  const files=unpackStoredZip(bytes);
  assert.deepEqual([...files.keys()],[
    "[Content_Types].xml","_rels/.rels","xl/workbook.xml",
    "xl/_rels/workbook.xml.rels","xl/styles.xml",
    "xl/worksheets/sheet1.xml","xl/worksheets/sheet2.xml","xl/worksheets/sheet3.xml"
  ]);
  assert.match(files.get("xl/workbook.xml"),/ДОВІДНИК_ВП/);
  assert.match(files.get("xl/workbook.xml"),/ДОВІДНИК_СП/);
  assert.match(files.get("xl/workbook.xml"),/ПРАВИЛА/);
  assert.match(files.get("xl/worksheets/sheet1.xml"),/Назва ВП/);
  assert.match(files.get("xl/worksheets/sheet1.xml"),/Випробувальна назва/);
  assert.doesNotMatch(files.get("xl/worksheets/sheet1.xml"),/Спостережний тест/);
  assert.match(files.get("xl/worksheets/sheet2.xml"),/Назва СП/);
  assert.match(files.get("xl/worksheets/sheet2.xml"),/Спостережний тест/);
  assert.match(files.get("xl/worksheets/sheet3.xml"),/ДИВІЗІОНУ/);
  assert.match(files.get("xl/worksheets/sheet3.xml"),/Рота \/ батарея/);
  assert.match(files.get("xl/worksheets/sheet3.xml"),/Взвод/);
});
test("exporter cannot silently expose D1 extra columns or original spreadsheet fields",async()=>{
  const fixture={
    kind:"vp",name:"Безпечна назва",code:"VP-AAA111222333",is_active:1,
    mgrs:"SENSITIVE_COORDINATES",unit:"SENSITIVE_ORGANIZATION",
    metadata:"HIDDEN_PRIVATE_VALUE"
  };
  const bytes=new Uint8Array(await exporter().buildXlsx([fixture]).arrayBuffer());
  const all=[...unpackStoredZip(bytes).values()].join("\n");
  assert.doesNotMatch(all,/SENSITIVE_COORDINATES|SENSITIVE_ORGANIZATION|HIDDEN_PRIVATE_VALUE/);
  assert.match(all,/Безпечна назва/);
});
test("formula-like content is serialized as escaped inline text rather than Excel formulas",async()=>{
  const value='=HYPERLINK("https://example.invalid/?x=<unsafe>&a=1")';
  const file=exporter().buildXlsx([
    {kind:"vp",name:value,code:"VP-ABC111222333",is_active:1}
  ]);
  const text=unpackStoredZip(new Uint8Array(await file.arrayBuffer()))
    .get("xl/worksheets/sheet1.xml");
  assert.match(text,/t="inlineStr"/);
  assert.doesNotMatch(text,/<f>/);
  assert.match(text,/&lt;unsafe&gt;&amp;a=1/);
  assert.doesNotMatch(text,/<unsafe>/);
});
test("empty DB list exports a reusable Excel template with required import headers",async()=>{
  const data=new Uint8Array(await exporter().buildXlsx([]).arrayBuffer());
  const z=unpackStoredZip(data);
  assert.match(z.get("xl/worksheets/sheet1.xml"),/Назва ВП/);
  assert.match(z.get("xl/worksheets/sheet2.xml"),/Назва СП/);
});
test("malformed export lists are rejected rather than downloaded",()=>{
  const exp=exporter();
  assert.throws(()=>exp.buildXlsx([{kind:"vp",name:"Test",code:"A"}]));
  assert.throws(()=>exp.buildXlsx([{kind:"unrecognized",name:"Test",code:"A",is_active:1}]));
  assert.throws(()=>exp.buildXlsx({kind:"vp"}));
});
test("the VP/SP interface loads its Excel exporter before the primary client script",()=>{
  const exporterIndex=VP_SP_HTML.indexOf('<script defer src="/api/vp-export.js">');
  const directoryIndex=VP_SP_HTML.indexOf('<script defer src="/api/vp-directory.js">');
  assert.ok(exporterIndex>=0&&directoryIndex>exporterIndex);
  assert.match(VP_SP_HTML,/id="export-excel"/);
  assert.match(VP_SP_HTML,/id="export-status"/);
  assert.match(VP_SP_HTML,/тільки дивізіон/);
  assert.match(VP_SP_JS,/S\.catalogLoaded/);
  assert.match(VP_SP_JS,/S\.truncated/);
  assert.match(VP_SP_JS,/window\.ANALISE_VP_EXPORT\.downloadXlsx\(S\.rows\)/);
});
