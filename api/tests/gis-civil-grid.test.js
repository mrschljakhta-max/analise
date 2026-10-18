import test from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {readFileSync} from "node:fs";
import {parseCivilGridCell,CIVIL_GRID_SQL,gisCivilGridApi} from "../src/gis-civil-grid-api.js";
import {GIS_PUBLIC_SETTLEMENTS_JS,GIS_PUBLIC_SETTLEMENTS_CSS} from "../src/gis-public-settlements-assets.js";
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const url="https://example.invalid/api/gis/civil-grid";
const admin={role:"admin",active:1};

test("civil grid API enforces admin auth, GET-only, bounded cell degrees",async()=>{
 let calls=0;
 const env={DB:{prepare(){calls++;throw Error("private query should not run")}}};
 assert.equal((await gisCivilGridApi(new Request(url,{method:"POST"}),env,admin)).status,405);
 for(const user of [{role:"duty",active:1},{role:"admin",active:0}]){
  assert.equal((await gisCivilGridApi(new Request(url),env,user)).status,403);
 }
 for(const invalid of ["?cell=0","?cell=3","?cell=1&cell=2",
  "?cell=1&lat=48","?region=Kharkiv","?cell=01"]){
  const response=await gisCivilGridApi(new Request(url+invalid),env,admin);
  assert.equal(response.status,400,invalid);
 }
 assert.equal((await gisCivilGridApi(new Request(url),{},admin)).status,503);
 assert.equal(calls,0);
 assert.equal(parseCivilGridCell(url),1);
 assert.equal(parseCivilGridCell(url+"?cell=2"),2);
});
test("coarse civilian cells are counted in D1 from public gazetteer only",async()=>{
 let sql="",args=[];
 const env={DB:{prepare(query){
  sql=query;
  return {bind(...p){
   args=p;
   return {all:async()=>({results:[
    {y:138,x:217,n:156},{y:139,x:217,n:32}
   ]})};
  }};
 }}};
 const response=await gisCivilGridApi(new Request(url+"?cell=1"),env,admin);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.status,"available");
 assert.equal(result.source,"directory_entries:settlements");
 assert.equal(result.kind,"civilian_grid");
 assert.equal(result.read_only,true);
 assert.equal(result.centers_are_cell_centers,true);
 assert.deepEqual(result.items,[
  {id:"217-138",lat:48.5,lon:37.5,count:156},
  {id:"217-139",lat:49.5,lon:37.5,count:32}
 ]);
 assert.deepEqual(args,[1,1]);
 assert.equal(sql,CIVIL_GRID_SQL);
 assert.match(sql,/FROM directory_entries/);
 assert.match(sql,/directory_id='settlements'/);
 assert.match(sql,/GROUP BY y,x/);
 assert.match(sql,/LIMIT 501/);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
 assert.doesNotMatch(sql,/operational_report|station|vp_sp|uav_models|unit_name|mgrs/i);
 assert.doesNotMatch(JSON.stringify(result),/station_name|unit_name|uav|wp_sp|mgrs|azimuth|frequency/i);
});
test("grid remains bounded, does not invent data and labels SQL failures",async()=>{
 const make=rows=>({DB:{prepare(){return{bind(){return{all:async()=>({results:rows})}}}}}});
 const empty=await (await gisCivilGridApi(new Request(url),make([]),admin)).json();
 assert.deepEqual(empty.items,[]);assert.equal(empty.status,"available");
 const rows=Array.from({length:501},(_,i)=>({
  y:130+(i%12),x:200+Math.floor(i/12),n:1
 }));
 const truncated=await (await gisCivilGridApi(new Request(url),make(rows),admin)).json();
 assert.equal(truncated.items.length,500);assert.equal(truncated.truncated,true);
 const invalid=await gisCivilGridApi(new Request(url),
  make([{y:138,x:217,n:-5}]),admin);
 assert.equal(invalid.status,503);
 assert.equal((await invalid.json()).status,"query_failed");
 const failure=await gisCivilGridApi(new Request(url),{DB:{prepare(){
  throw Error("private D1 error string")}}},admin);
 assert.equal(failure.status,503);
 assert.doesNotMatch(JSON.stringify(await failure.json()),/private D1 error string/);
});
test("civil overlay now uses D1 geographical clusters at low zoom and precise points at zoom 7+",()=>{
 assert.match(index,/gisCivilGridApi\(req,env,user\)/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/fetch\('\/api\/gis\/civil-grid\?cell='/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/view\.zoom<=4\?2:1/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/bridge\.project\(item\.lat,item\.lon\)/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/bridge\.centerOn\(item\.lat,item\.lon,7\)/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/if\(view\.zoom<7\)/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_JS,/cancelGrid\(\)/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_CSS,/\.gisp-civil-grid-marker/);
 assert.match(GIS_PUBLIC_SETTLEMENTS_CSS,/pointer-events:auto/);
 assert.doesNotMatch(GIS_PUBLIC_SETTLEMENTS_JS,/\/api\/gis\/(?:operational|stations|vp|uav)/);
});
test("client paints real grid D1 cells over map, zoom click works and layer toggle clears markers",async()=>{
 class Node{
  constructor(tag){this.tag=tag;this.id='';this.parent=null;this.children=[];
   this.handlers={};this.attrs={};this.style={};this.hidden=false;this.checked=false;
   this.value='';this.textContent='';this.className='';
   this.classList={toggle:()=>{}};}
  append(...items){for(const item of items){this.children.push(item);
   if(item&&typeof item==="object")item.parent=this;}}
  prepend(...items){for(const item of items.reverse()){this.children.unshift(item);
   if(item&&typeof item==="object")item.parent=this;}}
  replaceChildren(...items){for(const child of this.children)if(child?.parent===this)child.parent=null;
   this.children=[];this.append(...items)}
  addEventListener(name,fn){this.handlers[name]=fn}
  setAttribute(name,value){this.attrs[name]=value}
  remove(){if(!this.parent)return;this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null}
 }
 function collect(root,fn){const output=[];const walk=node=>{
  if(!node||typeof node!=="object")return;
  if(fn(node))output.push(node);
  for(const c of node.children||[])walk(c);
 };walk(root);return output}
 const document={
  nodes:new Map(),createElement:tag=>new Node(tag),
  createTextNode:str=>({textContent:String(str)}),
  getElementById(id){return this.nodes.get(id)||null}
 };
 const map=new Node('div'),controls=new Node('div');
 document.nodes.set('gisp-map',map);
 document.nodes.set('gisp-layer-controls',controls);
 let zoom=6,center=null;
 const listeners={};
 const bridge={
  getView:()=>({lat:48.6,lon:37.6,width:1200,height:800,zoom}),
  getBounds:()=>({south:43,west:29,north:54,east:45}),
  project:(lat,lon)=>({x:600+(lon-37)*14,y:390+(48.5-lat)*25}),
  centerOn:(lat,lon,z)=>{center={lat,lon,z};zoom=z}
 };
 const window={GISDemoBridge:bridge,addEventListener(k,fn){listeners[k]=fn}};
 let requests=0;
 const fetch=async(path,opts)=>{
  requests++;
  assert.equal(path,'/api/gis/civil-grid?cell=1');
  assert.equal(opts.credentials,'same-origin');
  return{ok:true,status:200,json:async()=>({
   status:'available',source:'directory_entries:settlements',
   kind:'civilian_grid',read_only:true,cell_degrees:1,
   centers_are_cell_centers:true,truncated:false,
   items:[{id:'217-138',lat:48.5,lon:37.5,count:156},
    {id:'217-139',lat:49.5,lon:37.5,count:32}]
  })};
 };
 new Script(GIS_PUBLIC_SETTLEMENTS_JS).runInNewContext({
  document,window,fetch,AbortController,URLSearchParams,
  setTimeout,clearTimeout
 });
 await new Promise(setImmediate);
 assert.equal(requests,1);
 const markers=collect(map,x=>x.className==='gisp-civil-grid-marker');
 assert.equal(markers.length,2);
 assert.deepEqual(markers.map(x=>x.textContent),['156','32']);
 assert.ok(markers.every(x=>x.style.left.endsWith('px')&&x.style.top.endsWith('px')));
 markers[0].handlers.click();
 assert.deepEqual(center,{lat:48.5,lon:37.5,z:7});
 const toggle=collect(controls,x=>x.id==='gisp-public-settlements-toggle')[0];
 assert.ok(toggle);
 toggle.checked=false;
 toggle.handlers.change();
 assert.equal(collect(map,x=>x.className==='gisp-civil-grid-marker').length,0);
});
