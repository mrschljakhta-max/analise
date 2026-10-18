import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {readFileSync} from "node:fs";
import {GIS_TRAINING_LAYERS_JS,GIS_TRAINING_LAYERS_CSS} from "../src/gis-training-layers-assets.js";
import {GIS_PREVIEW_HTML} from "../src/gis-preview-assets.js";
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");

test("three training legend categories exist, with existing read-only directory links",()=>{
 assert.doesNotThrow(()=>new Script(GIS_TRAINING_LAYERS_JS));
 for(const key of ["uav","vp","station"])
  assert.ok(GIS_TRAINING_LAYERS_JS.includes("key:'"+key+"'"));
 for(const page of ["/api/uav-catalog","/api/vp-directory","/api/station-directory"])
  assert.ok(GIS_TRAINING_LAYERS_JS.includes(page));
 for(const name of ["Крило","Мультироторний","FPV","ВП","СП","Виявлення","Подавлення","Комбінована"])
  assert.ok(GIS_TRAINING_LAYERS_JS.includes(name),name);
});
test("training markers are schematic, synthetic and never query military records",()=>{
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/\b(?:getBounds|project|mapbox|maplibre|latitude|longitude|mgrs|azimuth|sector_range)\b/i);
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/\/api\/(?:raw-documents|gis\/stations|gis\/uav|gis\/vp|station-compare)/);
 assert.doesNotMatch(GIS_TRAINING_LAYERS_JS,/[\w.]+\s*\.\s*(?:DB|D1|R2|DOCUMENTS)\b/);
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("preview.hidden=true"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("state=Object.fromEntries"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("Не використовуються") ||
           GIS_TRAINING_LAYERS_JS.includes("не використовуються"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("НЕ позначки на карті"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("map.append(overlay)"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("input.checked=true"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("allExamples"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("selectedItems.length===0"));
});
test("all three training groups create toggles, filters, click cards and a coordinate-free schematic",()=>{
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("dataset.trainingGroup"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("dataset.trainingFilter"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("stationDiagram()"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("createElementNS"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("Схема, не сектор дії станції"));
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("if(!active")===false);
 assert.ok(GIS_TRAINING_LAYERS_JS.includes("preview.hidden=active.length===0||previewDismissed"));
 for(const classname of [".gisp-training-layers",".gisp-training-preview",".gisp-training-station-svg",
   ".gisp-training-map-overlay",".gisp-training-map-marker"])
  assert.ok(GIS_TRAINING_LAYERS_CSS.includes(classname));
});
test("all new training assets are Access+admin protected and loaded after public D1 layer",()=>{
 assert.ok(index.includes('"/api/gis-training-layers.js"'));
 assert.ok(index.includes('"/api/gis-training-layers.css"'));
 assert.ok(index.includes('if(user.role!=="admin"||user.active!==1)return error(403'));
 assert.ok(GIS_PREVIEW_HTML.includes('/api/gis-training-layers.js'));
 assert.ok(GIS_PREVIEW_HTML.includes('/api/gis-training-layers.css'));
 assert.ok(GIS_PREVIEW_HTML.indexOf('/api/gis-settlements.js')<GIS_PREVIEW_HTML.indexOf('/api/gis-training-layers.js'));
 assert.ok(index.includes('script-src \'self\''));
});

test("browser renders 8 simultaneous markers, switches groups and filters by category",()=>{
 class Node {
  constructor(tag){this.tag=tag;this.children=[];this.parent=null;this.dataset={};
   this.style={};this.handlers={};this.hidden=false;this.checked=false;this.value='';
   this.className='';this.classList={toggle:()=>{},add:()=>{},remove:()=>{}};}
  append(...children){for(const n of children){if(!(n instanceof Node))continue;
   this.children.push(n);n.parent=this;}}
  replaceChildren(...children){for(const child of this.children)child.parent=null;
   this.children=[];this.append(...children);}
  after(n){if(!this.parent)return;const a=this.parent.children,i=a.indexOf(this);
   a.splice(i+1,0,n);n.parent=this.parent;}
  remove(){if(!this.parent)return;const p=this.parent;
   p.children=p.children.filter(x=>x!==this);this.parent=null;}
  setAttribute(k,v){this[k]=String(v);}
  addEventListener(name,callback){this.handlers[name]=callback;}
  closest(selector){if(selector==='[data-training-group]')return this.dataset.trainingGroup?this:null;
   if(selector==='[data-training-filter]')return this.dataset.trainingFilter?this:null;
   return null;}
  querySelector(selector){
   const match=/^\[data-training-column="(uav|vp|station)"\]$/.exec(selector);
   if(!match)return null;return find(this,x=>x.dataset.trainingColumn===match[1])[0]||null;
  }
 }
 function find(root,pred){const result=[];function walk(node){
  if(pred(node))result.push(node);for(const child of node.children)walk(child);
 }walk(root);return result;}
 const document={
  nodes:new Map(),
  createElement:tag=>new Node(tag),
  createElementNS:(_ns,tag)=>new Node(tag),
  getElementById(id){return this.nodes.get(id)||null}
 };
 const outer=new Node('main'),controls=new Node('div'),map=new Node('div');
 const inspector=new Node('div');
 outer.append(controls,map);
 document.nodes.set('gisp-layer-controls',controls);
 document.nodes.set('gisp-map',map);
 document.nodes.set('gisp-inspector',inspector);
 const sandbox={document};
 assert.doesNotThrow(()=>new Script(GIS_TRAINING_LAYERS_JS).runInNewContext(sandbox));
 const mark=()=>find(map,x=>x.tag==='button'&&x.className==='gisp-training-map-marker');
 const panel=find(map,x=>x.className==='gisp-training-map-overlay')[0];
 assert.ok(panel,"schematic marker overlay must be attached to the real map DOM");
 assert.equal(mark().length,8);
 assert.deepEqual([...new Set(mark().map(n=>n.dataset.trainingKind))].sort(),
  ['station','uav','vp']);
 assert.ok(mark().every(n=>n.style.left?.endsWith('%')&&n.style.top?.endsWith('%')));
 assert.ok(!GIS_TRAINING_LAYERS_JS.includes('bridge.project('));
 const block=find(outer,x=>x.className==='gisp-training-layers')[0];
 const toggles=find(block,x=>Boolean(x.dataset.trainingGroup));
 const filters=find(block,x=>Boolean(x.dataset.trainingFilter));
 assert.equal(toggles.length,3);assert.equal(filters.length,3);
 assert.ok(toggles.every(x=>x.checked===true));
 const uav=toggles.find(x=>x.dataset.trainingGroup==='uav');
 uav.checked=false;block.handlers.change({target:uav});
 assert.equal(mark().length,5);
 const vpFilter=filters.find(x=>x.dataset.trainingFilter==='vp');
 vpFilter.value='СП';block.handlers.change({target:vpFilter});
 assert.equal(mark().length,4);
 const selectStation=mark().find(x=>x.dataset.trainingKind==='station');
 selectStation.handlers.click();
 const card=find(map,x=>x.className==='gisp-training-preview')[0];
 assert.equal(card.hidden,false);
 assert.ok(find(inspector,x=>x.className==='gisp-inspector-name').length>0);
 const vp=toggles.find(x=>x.dataset.trainingGroup==='vp');
 const station=toggles.find(x=>x.dataset.trainingGroup==='station');
 vp.checked=false;block.handlers.change({target:vp});
 station.checked=false;block.handlers.change({target:station});
 assert.equal(mark().length,0);
 assert.equal(panel.hidden,true);
 uav.checked=true;block.handlers.change({target:uav});
 assert.equal(mark().length,3);assert.equal(panel.hidden,false);
});
