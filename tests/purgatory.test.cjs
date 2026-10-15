"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const pg=require("../purgatory-demo.js");

function group(s,kind,raw,stationId=""){
 return pg.groups(s).find(g=>g.kind===kind&&pg.normal(g.raw)===pg.normal(raw)&&(g.stationId||"")===stationId);
}
test("normalizes case, spaces, dashes, and apostrophes without changing raw",()=>{
 assert.equal(pg.normal("  СЕКТОР—01  "),pg.normal("сектор-01"));
 assert.equal(pg.normal("О’БРАЄН"),pg.normal("о'браєн"));
 const s=pg.seed(),old=s.issues[0].raw;
 pg.normal(old);
 assert.equal(s.issues[0].raw,old);
});
test("groups repeated raw values but separates settlement by station",()=>{
 const s=pg.seed();
 const sokil=group(s,"station","CОКІЛ");
 assert.equal(sokil.items.length,2);
 assert.equal(pg.groups(s).filter(g=>g.kind==="settlement").length,2);
 assert.notEqual(pg.groups(s).find(g=>g.stationId==="s1").key,pg.groups(s).find(g=>g.stationId==="s2").key);
});
test("highlights confusable Latin letters and numbers only when unknown",()=>{
 const s=pg.seed();
 const alpha=pg.diagnostics(s,group(s,"station","CОКІЛ"));
 assert.equal(alpha[0].index,0);
 assert.equal(alpha[0].replace,"С");
 assert.match(pg.highlighted(s,group(s,"station","CОКІЛ")),/<mark/);
 const digit=pg.diagnostics(s,group(s,"station","С0КІЛ"));
 assert.equal(digit[0].replace,"О");
 assert.equal(pg.addDemo(s,"station","СЕКТОР-01","").known,true);
 assert.equal(pg.diagnostics(s,{kind:"station",raw:"СЕКТОР-01"}).length,0);
});
test("suggestions are never automatically confirmed",()=>{
 const s=pg.seed();
 const g=group(s,"station","ЛЕЕВ");
 assert.equal(pg.suggestions(s,g)[0].name,"ЛЕВ");
 assert.equal(s.issues.find(x=>x.id==="i4").status,"pending");
});
test("confirmed aliases resolve future occurrences while preserving original",()=>{
 const s=pg.seed(),g=group(s,"station","CОКІЛ");
 const resolution=pg.resolve(s,g.key,"s1","group");
 assert.equal(resolution.count,2);
 assert.equal(pg.groups(s).some(x=>x.key===g.key),false);
 assert.equal(s.issues[0].raw,"CОКІЛ");
 assert.equal(pg.addDemo(s,"station","CОКІЛ","").known,true);
 assert.equal(s.aliases.length,1);
});
test("individual override only changes one entry and creates no alias",()=>{
 const s=pg.seed(),g=group(s,"station","CОКІЛ");
 assert.equal(pg.resolve(s,g.key,"s1","one").count,1);
 assert.equal(pg.groups(s).find(x=>x.key===g.key).items.length,1);
 assert.equal(s.aliases.length,0);
});
test("settlement choice is station-scoped even with identical canonical names",()=>{
 const s=pg.seed(),one=group(s,"settlement","Клeнове","s1");
 pg.resolve(s,one.key,"p1","group");
 assert.equal(pg.addDemo(s,"settlement","Клeнове","s1").known,true);
 assert.equal(pg.addDemo(s,"settlement","Клeнове","s2").known,false);
 const two=group(s,"settlement","Клeнове","s2");
 pg.resolve(s,two.key,"p2","group");
 assert.equal(pg.findKnown(s,"settlement","Клeнове","s2").id,"p2");
 assert.equal(pg.findKnown(s,"settlement","Клeнове","s1").id,"p1");
});
test("archived or conflicting aliases are not silently treated as valid",()=>{
 const s=pg.seed(),g=group(s,"station","CОКІЛ");
 pg.resolve(s,g.key,"s1","group");
 s.aliases[0].active=false;
 assert.equal(pg.findKnown(s,"station","CОКІЛ",""),null);
 assert.equal(pg.addDemo(s,"station","СОКІЛ","").known,true);
});
test("blank values do not become tasks and HTML values are escaped",()=>{
 const s=pg.seed();
 assert.throws(()=>pg.addDemo(s,"station","  ",""),/Порожні/);
 const x=pg.addDemo(s,"station",'<img src=x onerror=alert(1)>',"");
 assert.equal(x.known,false);
 const html=pg.view(s);
 assert.equal(html.includes('<img src=x onerror=alert(1)>'),false);
 assert.ok(html.includes("&lt;img"));
});
test("new values are created in the demo dictionary after operator action",()=>{
 const s=pg.seed(),g=group(s,"station","ЛЕЕВ");
 pg.createCanonical(s,g.key,"ЛЕЕВ");
 assert.equal(pg.findKnown(s,"station","ЛЕЕВ","").name,"ЛЕЕВ");
 assert.equal(s.decisions[0].count,1);
});
test("menu integration and click handler exist in the existing page",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 assert.match(html,/data-view="purgatory"/);
 assert.match(html,/purgatory-demo\.js/);
 assert.match(html,/purgatoryAction\(b\)/);
 assert.match(html,/ASTRA_PURGATORY\.view/);
});

test("visible suggestion offers explicit selection without automatic approval",()=>{
 const state=pg.seed();
 const html=pg.view(state);
 assert.match(html,/Схожі назви з довідника/);
 assert.match(html,/data-action="pg-choose"/);
 assert.match(html,/data-pg-target="s1"/);
 assert.match(html,/Вибір підказки не підтверджує/);
 assert.equal(state.issues.find(x=>x.id==="i1").status,"pending");
});

test("station context control is initially hidden unless settlement is selected",()=>{
 const html=pg.view(pg.seed());
 assert.match(html,/class="formgroup hidden" id="pg-station-context"/);
 assert.match(html,/id="pg-station" disabled/);
 const main=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 assert.match(main,/t\.id==="pg-kind"/);
 assert.match(main,/t\.value==="settlement"/);
 assert.match(main,/context\.classList\.toggle\("hidden",!show\)/);
});

test("review animations are optional and reduced-motion friendly",()=>{
 const main=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 assert.match(main,/\.pg-actions\{display:grid/);
 assert.match(main,/\.pg-card\.pg-complete/);
 assert.match(main,/prefers-reduced-motion:reduce/);
 assert.match(main,/function pgFinish\(card,message\)/);
 assert.match(main,/pgFinish\(card,"Підтверджено/);
});
