/* ANALISE · settlements directory XLSX exchange. Synthetic data only.
 * Relies on the app's existing, local ZIP reader/writer and vendored mgrs.js.
 */
(function(root){
"use strict";
const HEADERS=["Назва","Тип","Громада","Район","Область","MGRS","Lat","Lon"];
const FIELDS=["name","type","community","district","region","mgrs","lat","lon"];
const LIMIT=5000, MAX_FILE=8*1024*1024;
const SAMPLE=[
 ["Кленове","село","Навчальна громада А","Умовний район А","Умовна область А","","",""],
 ["Березове","селище","Навчальна громада Б","Умовний район Б","Умовна область Б","","",""],
 ["Кленове","село","Навчальна громада В","Умовний район В","Умовна область В","","",""]
];
function escape(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function normalizeMgrs(value){return String(value??"").toUpperCase().replace(/\s+/g,"");}
function checkCoordinates(mgrsText,convert){
 const value=normalizeMgrs(mgrsText);
 if(!value)return {mgrs:"",lat:"",lon:"",error:""};
 if(!/^(?:[1-9]|[1-5][0-9]|60)[C-HJ-NP-X][A-HJ-NP-Z]{2}(?:\d{2}){0,5}$/.test(value))
  return {mgrs:value,lat:"",lon:"",error:"MGRS: невірний запис (зона, літери або парна кількість цифр)"};
 if(!convert||typeof convert.toPoint!=="function")
  return {mgrs:value,lat:"",lon:"",error:"Модуль перетворення MGRS недоступний"};
 try{
  const point=convert.toPoint(value);
  if(!Array.isArray(point)||point.length!==2||!Number.isFinite(point[0])||!Number.isFinite(point[1])||
      point[0]<-180||point[0]>180||point[1]<-90||point[1]>90)throw Error("Неприпустимі координати");
  return {mgrs:value,lat:Number(point[1].toFixed(6)),lon:Number(point[0].toFixed(6)),error:""};
 }catch(e){return {mgrs:value,lat:"",lon:"",error:"MGRS: координати не розпізнано"};}
}
function mapRows(rows,convert){
 return rows.map((values,i)=>{
  const v=FIELDS.map((_,j)=>String(values[j]??"").trim());
  const coordinates=checkCoordinates(v[5],convert);
  return {name:v[0],type:v[1],community:v[2],district:v[3],region:v[4],
    mgrs:coordinates.mgrs,lat:coordinates.lat,lon:coordinates.lon,
    sourceRow:i+2,error:coordinates.error};
 });
}
function sample(convert){return mapRows(SAMPLE,convert);}
function nodeChildren(n,name){return Array.from(n?.children||[]).filter(x=>x.localName===name);}
function desc(n,name){return Array.from(n?.getElementsByTagNameNS("*",name)||[]);}
function parseXml(text){
 const result=new DOMParser().parseFromString(text,"application/xml");
 if(result.getElementsByTagName("parsererror").length)throw Error("Пошкоджений XML у файлі");
 return result;
}
function sheetPath(files){
 const book=files["xl/workbook.xml"],relations=files["xl/_rels/workbook.xml.rels"];
 if(!book)throw Error("У XLSX немає workbook.xml");
 const worksheets=desc(parseXml(book),"sheet"),targetSheet=worksheets.find(x=>x.getAttribute("name")==="Населені пункти");
 if(!targetSheet)throw Error("Не знайдено аркуш «Населені пункти»");
 const rid=targetSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id")||targetSheet.getAttribute("r:id");
 const rel=relations?desc(parseXml(relations),"Relationship").find(x=>x.getAttribute("Id")===rid):null;
 const target=rel?.getAttribute("Target")||"";
 if(target){
  const parts=[];
  for(const part of (target.startsWith("/")?target.slice(1):"xl/"+target).split("/")){
   if(part==="..")parts.pop();else if(part&&part!==".")parts.push(part);
  }
  const path=parts.join("/");
  if(!path.startsWith("xl/worksheets/"))throw Error("Непідтримуваний шлях аркуша");
  return path;
 }
 return "xl/worksheets/sheet"+(worksheets.indexOf(targetSheet)+1)+".xml";
}
function parseXlsxFiles(files,convert){
 const path=sheetPath(files),raw=files[path];
 if(!raw)throw Error("Аркуш Excel не знайдено в архіві");
 const shared=files["xl/sharedStrings.xml"]?desc(parseXml(files["xl/sharedStrings.xml"]),"si").map(si=>desc(si,"t").map(t=>t.textContent||"").join("")):[];
 const rows=desc(parseXml(raw),"row");
 if(!rows.length)throw Error("Аркуш не містить заголовків");
 const parsed=[];
 for(const row of rows){
  const values=Array(8).fill("");
  for(const c of nodeChildren(row,"c")){
   const ref=c.getAttribute("r")||"";
   const match=/^([A-Z]+)\d+$/.exec(ref);if(!match)continue;
   let index=0;for(const ch of match[1])index=index*26+ch.charCodeAt(0)-64;index--;
   if(index<0||index>=8)continue;
   const type=c.getAttribute("t");
   const value=desc(c,"v")[0]?.textContent||"";
   values[index]=type==="s"?(shared[Number(value)]||""):
     type==="inlineStr"?desc(c,"t").map(t=>t.textContent||"").join(""):value;
  }
  parsed.push({row:Number(row.getAttribute("r"))||parsed.length+1,values});
  if(parsed.length>LIMIT+1)throw Error("У файлі забагато рядків (максимум "+LIMIT+")");
 }
 if(HEADERS.some((h,i)=>String(parsed[0].values[i]??"").trim()!==h))
  throw Error("Заголовки мають точно відповідати 8 колонкам: "+HEADERS.join(", "));
 const content=parsed.slice(1).filter(r=>r.values.some(v=>String(v??"").trim()));
 const mapped=mapRows(content.map(r=>r.values),convert);
 mapped.forEach((r,i)=>r.sourceRow=content[i].row);
 return mapped;
}
function xmlCell(v,reference,numeric){
 if(v===null||v===undefined||v==="")return "";
 const safe=escape(v);
 return numeric?'<c r="'+reference+'"><v>'+safe+'</v></c>':
  '<c r="'+reference+'" t="inlineStr"><is><t xml:space="preserve">'+safe+'</t></is></c>';
}
function workbookParts(records){
 const rows=[HEADERS,...records.map(row=>FIELDS.map(key=>row[key]??""))];
 const xmlRows=rows.map((values,r)=>'<row r="'+(r+1)+'">'+values.map((v,c)=>
  xmlCell(v,String.fromCharCode(65+c)+(r+1),r>0&&c>=6)).join("")+'</row>').join("");
 const worksheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'+xmlRows+'</sheetData></worksheet>';
 return {
  "[Content_Types].xml":'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  "_rels/.rels":'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  "xl/workbook.xml":'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Населені пункти" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/worksheets/sheet1.xml":worksheet
 };
}
function duplicateNames(records){
 const by=new Map();
 for(const r of records){
  const name=r.name.toLocaleLowerCase("uk");
  if(name)by.set(name,(by.get(name)||0)+1);
 }
 return Array.from(by.values()).reduce((n,v)=>n+(v>1?v:0),0);
}
function view(data,staged){
 const records=data||[],issues=records.filter(x=>x.error).length,duplicates=duplicateNames(records);
 const buttons='<div class="actions">'+
  '<button class="btn" data-action="np-template">↓ Шаблон XLSX</button>'+
  '<button class="btn" data-action="np-sample">Взяти тестові записи</button>'+
  '<button class="btn" data-action="np-choose">↑ Імпорт XLSX</button>'+
  '<button class="btn primary" data-action="np-export">↓ Експорт XLSX</button>'+
  '</div><input id="np-import-input" type="file" accept=".xlsx" hidden>';
 const summary='<div class="recordmeta"><span>'+records.length+' записів</span><span>'+
  duplicates+' записів із повторними назвами (допустимо)</span><span>'+
  issues+' помилок MGRS</span></div>';
 const tab=(list)=>'<div class="tablewrap np-table"><table><thead><tr>'+
  HEADERS.map(x=>'<th>'+escape(x)+'</th>').join("")+'<th>Перевірка</th></tr></thead><tbody>'+
  list.slice(0,100).map(r=>'<tr>'+
  FIELDS.map(key=>'<td'+(key==="mgrs"?' class="mono"':"")+'>'+escape(r[key]??"")+'</td>').join("")+
  '<td>'+(r.error?'<span class="tag bad">'+escape(r.error)+'</span>':'<span class="tag good">OK</span>')+
  '</td></tr>').join("")+'</tbody></table></div>'+
  (list.length>100?'<p class="footnote">Показано перші 100 записів із '+list.length+'. Експорт охоплює всі записи.</p>':"");
 const preview=staged?'<div class="panel"><div class="panelhead"><h2>Попередній перегляд імпорту — '+
  escape(staged.name)+'</h2><span class="tag '+(staged.rows.some(x=>x.error)?"bad":"warn")+'">'+staged.rows.length+
  ' рядків</span></div><p class="paneldesc">Імпорт замінить поточний тестовий довідник цілком. Однакові назви не зливаються. Lat/Lon обчислюються з MGRS; самі значення з Excel не вважаються джерелом істини.</p>'+
  tab(staged.rows)+'<div class="actions" style="margin-top:14px"><button class="btn primary" data-action="np-apply"'+
  (staged.rows.some(x=>x.error)?" disabled":"")+'>Підтвердити імпорт</button><button class="btn quiet" data-action="np-cancel">Скасувати</button></div></div>':"";
 return '<div class="panel"><div class="panelhead"><div><h2>Населені пункти</h2><p class="paneldesc">8 колонок · основні координати MGRS · похідні Lat/Lon у WGS84</p></div><span class="tag info">Тестовий довідник</span></div>'+
 buttons+
 '<p class="footnote">Імпорт та експорт працюють локально. Усі записи синтетичні; не завантажуйте реальні службові документи. Дані зникають після перезавантаження вкладки.</p>'+
 summary+(records.length?tab(records):'<div class="empty">Довідник поки порожній. Завантаж шаблон або візьми тестові записи.</div>')+
 '</div>'+preview;
}
root.ASTRA_SETTLEMENTS={HEADERS,FIELDS,SAMPLE,checkCoordinates,mapRows,sample,parseXlsxFiles,workbookParts,duplicateNames,view,LIMIT,MAX_FILE};
if(typeof module!=="undefined"&&module.exports)module.exports=root.ASTRA_SETTLEMENTS;
})(typeof window!=="undefined"?window:globalThis);
