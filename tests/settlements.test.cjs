"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const settlements=require("../settlements-exchange.js");

function realMgrs(){
 const context={};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../vendor/mgrs.min.js"),"utf8"),context);
 assert.equal(typeof context.mgrs?.toPoint,"function");
 return context.mgrs;
}
test("the settlement dictionary has exactly the agreed eight headers",()=>{
 assert.deepEqual(settlements.HEADERS,["Назва","Тип","Громада","Район","Область","MGRS","Lat","Lon"]);
});
test("synthetic duplicate names remain distinct individual rows",()=>{
 const rows=settlements.sample(realMgrs());
 assert.equal(rows.length,3);
 assert.equal(rows.filter(x=>x.name==="Кленове").length,2);
 assert.notEqual(rows[0].community,rows[2].community);
 assert.equal(rows[0].mgrs,"");
 assert.equal(rows[0].lat,"");
 assert.equal(rows[0].lon,"");
 assert.equal(settlements.duplicateNames(rows),2);
});
test("incorrect MGRS never produces fake geographic coordinates",()=>{
 const coordinate=settlements.checkCoordinates("not mgrs",realMgrs());
 assert.match(coordinate.error,/MGRS/);
 assert.equal(coordinate.lat,"");
 assert.equal(coordinate.lon,"");
});
test("MGRS converts to bounded WGS84 latitude/longitude with vendored converter",()=>{
 const testValue="33UXP0402053617";
 const coordinate=settlements.checkCoordinates(testValue,realMgrs());
 assert.equal(coordinate.error,"");
 assert.equal(coordinate.mgrs,testValue);
 assert.equal(typeof coordinate.lat,"number");
 assert.equal(typeof coordinate.lon,"number");
 assert.ok(coordinate.lat>=-90&&coordinate.lat<=90);
 assert.ok(coordinate.lon>=-180&&coordinate.lon<=180);
});
test("all export columns appear in their exact order and duplicate rows stay separate",()=>{
 const files=settlements.workbookParts(settlements.sample(realMgrs()));
 const sheet=files["xl/worksheets/sheet1.xml"];
 for(const h of settlements.HEADERS)assert.ok(sheet.includes(h));
 assert.equal((sheet.match(/<row r="/g)||[]).length,4);
 assert.ok(sheet.includes('sheetViews'));
 assert.ok(files["xl/workbook.xml"].includes("Населені пункти"));
 assert.ok(sheet.includes("Навчальна громада А"));
 assert.ok(sheet.includes("Навчальна громада В"));
});
test("special characters cannot break the exported worksheet XML",()=>{
 const rows=settlements.mapRows([["Село <А&B>","село","","","","","",""]],realMgrs());
 const files=settlements.workbookParts(rows);
 assert.match(files["xl/worksheets/sheet1.xml"],/Село &lt;А&amp;B&gt;/);
 assert.equal(files["xl/worksheets/sheet1.xml"].includes("<А&B>"),false);
});
test("existing ANALISE interface includes explicit settlement import/export actions",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 assert.match(html,/settlements-exchange\.js/);
 assert.match(html,/vendor\/mgrs\.min\.js/);
 assert.match(html,/window\.ASTRA_SETTLEMENTS\.view/);
 assert.match(html,/settlementImport\(file\)/);
 assert.match(html,/data-action="np-export"/);
});
