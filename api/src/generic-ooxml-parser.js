// Generic OOXML table reader. No uploads, persistence, geolocation, or operational mappings.
import {unzipSync} from "fflate";
const MAX=8*1024*1024,EXPANDED=16*1024*1024;
const decode=new TextDecoder("utf-8",{fatal:true});
const unescape=s=>String(s).replace(/&#x([a-f0-9]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
 .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
 .replace(/&(amp|lt|gt|quot|apos);/g,(_,n)=>({amp:"&",lt:"<",gt:">",quot:'"',apos:"'"}[n]));
const tag=(xml,n)=>[...String(xml).matchAll(new RegExp("<(?:[\\w.-]+:)?"+n+"(?=[\\s/>])[^>]*(?:\\/>|>[\\s\\S]*?<\\/(?:[\\w.-]+:)?"+n+">)","g"))].map(x=>x[0]);
const head=s=>s.slice(0,s.indexOf(">")+1);
const attr=(xml,name)=>{const m=String(xml).match(new RegExp("(?:\\s|^)"+name+"\\s*=\\s*([\"'])(.*?)\\1","s"));return m?unescape(m[2]):null};
const text=s=>tag(s,"t").map(x=>unescape(x.replace(/^<[^>]+>/,"").replace(/<\/[^>]+>$/,""))).join("");
const content=(s,n)=>tag(s,n)[0]?.replace(/^<[^>]+>/,"").replace(/<\/[^>]+>$/,"")||"";
function archive(bytes){
 if(!(bytes instanceof Uint8Array))throw Error("Очікуються байти файла");
 if(bytes.length>MAX)throw Error("Файл перевищує 8 МБ");
 if(bytes.length<4||bytes[0]!==80||bytes[1]!==75)throw Error("Неправильний OOXML-архів");
 let size=0,count=0;
 const files=unzipSync(bytes,{filter:f=>{
  count++;size+=f.originalSize;
  if(count>400||size>EXPANDED||f.originalSize>MAX)throw Error("Перевищено безпечні обмеження архіву");
  return true;
 }});
 return files;
}
const read=(files,path)=>files[path]?decode.decode(files[path]):"";
function docx(files){
 const xml=read(files,"word/document.xml");
 if(!xml)throw Error("Не знайдено документ Word");
 return tag(xml,"tbl").map((t,i)=>({
  sheet:"Таблиця "+(i+1),
  rows:tag(t,"tr").map(row=>tag(row,"tc").map(cell=>{
   const span=tag(cell,"gridSpan")[0],merge=tag(cell,"vMerge")[0];
   const count=span?Number(attr(head(span),"w:val")||attr(head(span),"val")||1):1;
   if(!Number.isSafeInteger(count)||count<1||count>100)throw Error("Некоректна ширина комірки");
   const paragraphs=tag(cell,"p");
   return {value:paragraphs.length?paragraphs.map(text).join("\n"):text(cell),
    colSpan:count,verticalMerge:!!merge,
    verticalMergeState:merge?(attr(head(merge),"w:val")||attr(head(merge),"val")||"continue"):"none"};
  })),merges:[]
 }));
}
function shared(files){return tag(read(files,"xl/sharedStrings.xml"),"si").map(text)}
function paths(files){
 const wb=read(files,"xl/workbook.xml"),rels=read(files,"xl/_rels/workbook.xml.rels");
 if(wb&&rels){
  const map=new Map(tag(rels,"Relationship").map(x=>[attr(head(x),"Id"),attr(head(x),"Target")]));
  const sheets=tag(wb,"sheet").map((x,i)=>{
   const h=head(x),target=(map.get(attr(h,"r:id"))||"").replace(/^\/+/,"").replace(/^xl\//,"").replace(/^\.\//,"");
   const path=target.startsWith("worksheets/")?"xl/"+target:null;
   return {sheet:attr(h,"name")||"Аркуш "+(i+1),path};
  }).filter(x=>x.path&&Object.hasOwn(files,x.path));
  if(sheets.length)return sheets;
 }
 return Object.keys(files).filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x))
  .sort((a,b)=>Number(a.match(/sheet(\d+)/)[1])-Number(b.match(/sheet(\d+)/)[1]))
  .map((path,i)=>({sheet:"Аркуш "+(i+1),path}));
}
function formats(files){
 const xml=read(files,"xl/styles.xml");
 const customs=new Map(tag(xml,"numFmt").map(x=>[Number(attr(head(x),"numFmtId")),attr(head(x),"formatCode")||""]));
 const xf=tag(xml,"cellXfs")[0]||"";
 return tag(xf,"xf").map(x=>{
  const id=Number(attr(head(x),"numFmtId")||0);
  const pattern=(customs.get(id)||"").replace(/"[^"]*"|\\.|_.|\*./g,"").replace(/\[[^\]]+\]/g,"");
  return [14,15,16,17,18,19,20,21,22,45,46,47].includes(id)||/[ymdhs]/i.test(pattern);
 });
}
function excelDate(value,date1904){
 const n=Number(value);if(!Number.isFinite(n)||n<0||n>2958465)return null;
 const day=Math.floor(n),fract=n-day;
 if(!date1904&&day===60)return "1900-02-29";
 const epoch=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30);
 const adjusted=date1904?day:day<60?day+1:day;
 const date=new Date(epoch+adjusted*86400000+Math.round(fract*86400000));
 const result=date.toISOString();
 return fract?result.slice(0,19).replace("T"," "):result.slice(0,10);
}
function xlsx(files){
 const strings=shared(files),dates=formats(files);
 const date1904=/date1904\s*=\s*["'](?:1|true)["']/.test(read(files,"xl/workbook.xml"));
 return paths(files).map(({sheet,path})=>{
  const xml=read(files,path);
  const rows=tag(xml,"row").map((row,i)=>{
   const cells=tag(row,"c").map(c=>{
    const h=head(c),ref=attr(h,"r")||"",kind=attr(h,"t")||"n";
    const raw=unescape(content(c,"v")),formula=content(c,"f"),style=Number(attr(h,"s")||0);
    const formatted=kind==="n"&&dates[style]&&raw?excelDate(raw,date1904):null;
    const value=kind==="s"?(strings[Number(raw)]??""):
     kind==="inlineStr"?text(content(c,"is")):
     kind==="b"?(raw==="1"?"TRUE":"FALSE"):formatted??raw;
    return {ref,value,raw,type:formatted?"date":
     ["s","inlineStr","str"].includes(kind)?"text":kind==="b"?"boolean":kind==="e"?"error":"number",
     ...(formula?{formula:unescape(formula)}:{})};
   });
   const n=Number(attr(head(row),"r")||i+1);
   return {index:Number.isSafeInteger(n)&&n>0?n:i+1,cells};
  });
  const merges=tag(xml,"mergeCell").map(m=>attr(head(m),"ref")).filter(Boolean);
  return {sheet,rows,merges};
 });
}
export function extractOoxmlTables(bytes,name){
 const ext=String(name||"").toLowerCase().split(".").pop();
 if(!["docx","xlsx"].includes(ext))throw Error("Підтримуються DOCX і XLSX");
 const files=archive(bytes),tables=ext==="docx"?docx(files):xlsx(files);
 return {format:ext,table_count:tables.length,tables};
}
