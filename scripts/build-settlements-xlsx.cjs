/**
 * Build an eight-column XLSX directory for Kharkiv, Donetsk and Luhansk oblasts.
 * Source: pinned public ua-geo KATOTTG + OSM dataset (see README).
 * Uses only Node standard-library for writing OOXML ZIP, and existing vendored mgrs.
 *
 * Usage: node scripts/build-settlements-xlsx.cjs input/katottg.csv downloads/output.xlsx
 */
"use strict";
const fs=require("node:fs"),zlib=require("node:zlib"),path=require("node:path");
const mgrs=require("../vendor/mgrs.min.js");
const INPUT=process.argv[2],OUTPUT=process.argv[3];
if(!INPUT||!OUTPUT)throw Error("Usage: node script.cjs source.csv target.xlsx");
const HEADERS=["Назва","Тип","Громада","Район","Область","MGRS","Lat","Lon"];
const wanted=new Map([
 ["UA63000000000041885","Харківська"],
 ["UA14000000000091971","Донецька"],
 ["UA44000000000018893","Луганська"]
]);
function csvRows(s){
 // A single field may contain commas/newlines; parse quotes, not just split(",").
 const lines=[],one=[];let value="",quoted=false;
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(c==='"'){if(quoted&&s[i+1]==='"'){value+='"';i++}else quoted=!quoted;}
  else if(c===","&&!quoted){one.push(value);value="";}
  else if((c==="\r"||c==="\n")&&!quoted){
   if(c==="\r"&&s[i+1]==="\n")i++;
   one.push(value);value="";if(one.some(x=>x!==""))lines.push(one.splice(0));
  }else value+=c;
 }
 if(value||one.length){one.push(value);lines.push(one);}
 if(quoted)throw Error("Malformed quoted CSV");
 return lines;
}
const all=csvRows(fs.readFileSync(INPUT,"utf8"));
const header=all.shift();const idx=Object.fromEntries(header.map((x,i)=>[x,i]));
for(const col of ["code","name","level","category","region_code","raion_code","hromada_code","lat","lon"])
 if(idx[col]===undefined)throw Error("Missing source column "+col);
const data=all.map(row=>Object.fromEntries(header.map((h,i)=>[h,row[i]||""])));
const byCode=new Map(data.map(r=>[r.code,r]));
const sheets={"Населені пункти":[],"Харківська":[],"Донецька":[],"Луганська":[]};
let missingPosition=0,badPosition=0,unresolvedParents=0;
for(const place of data){
 if(place.level!=="4"||!wanted.has(place.region_code))continue;
 const region=wanted.get(place.region_code);
 const district=byCode.get(place.raion_code)?.name||"";
 const community=byCode.get(place.hromada_code)?.name||"";
 if(!district||!community)unresolvedParents++;
 const type={"M":"місто","X":"селище","C":"село"}[place.category]||place.category_name||"";
 let m="",lat="",lon="";
 if(place.lat!==""&&place.lon!==""){
  try{
   const sourceLat=Number(place.lat),sourceLon=Number(place.lon);
   if(!Number.isFinite(sourceLat)||!Number.isFinite(sourceLon)||
      sourceLat<43||sourceLat>54||sourceLon<20||sourceLon>43)throw Error("Out-of-country coordinates");
   m=mgrs.forward([sourceLon,sourceLat],5);
   const center=mgrs.toPoint(m);
   lon=Number(center[0].toFixed(6));lat=Number(center[1].toFixed(6));
  }catch(e){badPosition++;m="";lat="";lon="";}
 }else missingPosition++;
 const row=[place.name,type,community?community+" громада":"",district?district+" район":"",region+" область",m,lat,lon];
 sheets[region].push(row);
 sheets["Населені пункти"].push(row);
}
const sort=(a,b)=>a[4].localeCompare(b[4],"uk")||a[3].localeCompare(b[3],"uk")||
 a[2].localeCompare(b[2],"uk")||a[0].localeCompare(b[0],"uk")||a[1].localeCompare(b[1],"uk");
for(const rows of Object.values(sheets))rows.sort(sort);
const counts=Object.fromEntries(Object.entries(sheets).map(([k,v])=>[k,v.length]));
if(counts["Харківська"]!==1751||counts["Донецька"]!==1298||counts["Луганська"]!==926||
 counts["Населені пункти"]!==3975)throw Error("Unexpected source record counts: "+JSON.stringify(counts));
if(unresolvedParents)throw Error("Unresolved administrative hierarchy for "+unresolvedParents+" records");
const context=[
 ["Відомості","Джерело або пояснення"],
 ["Перелік і адміністративна належність","КАТОТТГ (Мінрозвитку України), зведений відкритий набір ua-geo"],
 ["Джерело даних","https://github.com/alexbabintsev/ua-geo"],
 ["Вихідний CSV","https://raw.githubusercontent.com/alexbabintsev/ua-geo/d37d5e967e3bb45255d180ea740e5a6ca90e00cc/data/out/katottg.csv"],
 ["Координати","Публічні об’єкти OpenStreetMap, зведені з КАТОТТГ. Точка є довідковою; для окремих сіл це OSM-точка, а не обчислений центроїд полігона."],
 ["MGRS","Сформовано із WGS84-координат джерела, точність сітки 1 м"],
 ["Lat / Lon","Обчислено з MGRS (WGS84), округлено до 6 десяткових знаків"],
 ["Порожні координати","Географічна точка у джерелі відсутня або некоректна; координати не вигадуються"],
 ["Принцип записів","Кожен запис КАТОТТГ є окремим рядком, у тому числі однакові назви"],
 ["Харківська область",String(counts["Харківська"])],
 ["Донецька область",String(counts["Донецька"])],
 ["Луганська область",String(counts["Луганська"])],
 ["Усього",String(counts["Населені пункти"])],
 ["Без координат",String(missingPosition+badPosition)],
 ["Ліцензія геоданих","OpenStreetMap contributors · ODbL 1.0"],
 ["Посилання на OSM","https://www.openstreetmap.org/copyright"],
 ["Публікація","Публічний довідковий набір. Не є службовим документом."]
];
function xml(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function cell(v,r,c,head){
 if(v===null||v===undefined||v==="")return "";
 const a=String.fromCharCode(65+c)+r;const kind=typeof v==="number"?"n":"inlineStr";
 return kind==="n"?'<c r="'+a+'" s="'+(head?1:0)+'"><v>'+v+'</v></c>':
  '<c r="'+a+'" s="'+(head?1:0)+'" t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';
}
function sheetXml(rows,columns,meta=false){
 const matrix=[columns,...rows];
 const rowContent=matrix.map((row,i)=>'<row r="'+(i+1)+'"'+(i===0?' ht="27" customHeight="1"':'')+'>'+
  row.map((v,j)=>cell(v,i+1,j,i===0)).join("")+'</row>').join("");
 const widths=meta?[{min:1,max:1,width:30,customWidth:1},{min:2,max:2,width:80,customWidth:1}]:
  [27,15,31,29,26,24,16,16].map((w,i)=>({min:i+1,max:i+1,width:w,customWidth:1}));
 const columnsXml=widths.map(w=>'<col min="'+w.min+'" max="'+w.max+'" width="'+w.width+'" customWidth="1"/>').join("");
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
  '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
  '<cols>'+columnsXml+'</cols><sheetData>'+rowContent+'</sheetData>'+
  '<autoFilter ref="A1:'+(meta?"B": "H")+matrix.length+'"/>'+
  '</worksheet>';
}
const names=[...Object.keys(sheets),"Про джерела"];
const files={};
names.forEach((name,i)=>{
 const rows=name==="Про джерела"?context.slice(1):sheets[name];
 const headers=name==="Про джерела"?context[0]:HEADERS;
 files["xl/worksheets/sheet"+(i+1)+".xml"]=sheetXml(rows,headers,name==="Про джерела");
});
const xmlns='http://schemas.openxmlformats.org/package/2006/relationships';
files["[Content_Types].xml"]='<?xml version="1.0" encoding="UTF-8"?>'+
 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
 '<Default Extension="xml" ContentType="application/xml"/>'+
 '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
 '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
 names.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("")+
 '</Types>';
files["_rels/.rels"]='<?xml version="1.0"?><Relationships xmlns="'+xmlns+'"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
files["xl/workbook.xml"]='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+
 names.map((n,i)=>'<sheet name="'+xml(n)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join("")+
 '</sheets></workbook>';
files["xl/_rels/workbook.xml.rels"]='<?xml version="1.0"?><Relationships xmlns="'+xmlns+'">'+
 names.map((n,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join("")+
 '<Relationship Id="rId'+(names.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
files["xl/styles.xml"]='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
 '<fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'+
 '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+
 '<fill><patternFill patternType="solid"><fgColor rgb="FF113449"/><bgColor indexed="64"/></patternFill></fill></fills>'+
 '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
 '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
 '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
 '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>'+
 '</styleSheet>';
function crc32(buf){
 let crc=0xffffffff;
 for(const byte of buf){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function zip(entries){
 const locals=[],centers=[];let offset=0;
 for(const [filename,value] of Object.entries(entries)){
  const name=Buffer.from(filename,"utf8"),data=Buffer.from(value,"utf8");
  const compressed=zlib.deflateRawSync(data,{level:6}),crc=crc32(data);
  const local=Buffer.alloc(30),cent=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);
  local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  locals.push(local,name,compressed);
  cent.writeUInt32LE(0x02014b50,0);cent.writeUInt16LE(20,4);cent.writeUInt16LE(20,6);
  cent.writeUInt16LE(0x800,8);cent.writeUInt16LE(8,10);cent.writeUInt32LE(crc,16);
  cent.writeUInt32LE(compressed.length,20);cent.writeUInt32LE(data.length,24);
  cent.writeUInt16LE(name.length,28);cent.writeUInt32LE(offset,42);
  centers.push(cent,name);offset+=local.length+name.length+compressed.length;
 }
 const centralBuffer=Buffer.concat(centers);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);
 end.writeUInt32LE(centralBuffer.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,centralBuffer,end]);
}
fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});fs.writeFileSync(OUTPUT,zip(files));
console.log(JSON.stringify({output:OUTPUT,counts,missingPosition,badPosition,bytes:fs.statSync(OUTPUT).size}));
