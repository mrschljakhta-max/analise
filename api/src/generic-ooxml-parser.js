// Generic, data-agnostic OOXML table extraction. No network, database writes,
// military-specific field mappings, coordinates, or operational enrichment.
import {unzipSync} from "fflate";
const MAX=8*1024*1024;
const decoder=new TextDecoder();
const unescape=s=>s.replace(/&#x([0-9a-f]+);/gi,(_,v)=>String.fromCodePoint(parseInt(v,16)))
 .replace(/&#(\d+);/g,(_,v)=>String.fromCodePoint(Number(v)))
 .replace(/&(amp|lt|gt|quot|apos);/g,(_,v)=>({amp:"&",lt:"<",gt:">",quot:'"',apos:"'"}[v]));
const attrs=(xml,key)=>{const m=xml.match(new RegExp("\\b"+key+'="([^"]*)"'));return m?unescape(m[1]):null};
const textRuns=xml=>[...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)]
 .map(x=>unescape(x[1])).join("");
function archive(bytes){
 if(bytes.byteLength>MAX)throw Error("Файл перевищує 8 МБ");
 let count=0,size=0;
 const files=unzipSync(bytes,{filter:e=>{
  count++;size+=e.originalSize;
  if(count>500||size>MAX*2||e.originalSize>MAX)throw Error("Завеликий архів");
  return true;
 }});
 return files;
}
function tablesDocx(files){
 const xml=decoder.decode(files["word/document.xml"]||new Uint8Array());
 if(!xml)throw Error("Не знайдено таблиць Word");
 return [...xml.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)].map((t,index)=>{
  const rows=[...t[0].matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(r=>
   [...r[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(c=>({
    value:textRuns(c[0]),colSpan:Number(attrs(c[0].match(/<w:gridSpan\b[^>]*\/>/)?.[0]||"","w:val")||1),
    verticalMerge:/<w:vMerge\b/.test(c[0])
   })));
  return {sheet:"Таблиця "+(index+1),rows};
 });
}
function sharedStrings(files){
 const xml=decoder.decode(files["xl/sharedStrings.xml"]||new Uint8Array());
 return [...xml.matchAll(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g)].map(x=>textRuns(x[0]));
}
function sheetsXlsx(files){
 const strings=sharedStrings(files);
 const names=Object.keys(files).filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x)).sort((a,b)=>
  Number(a.match(/sheet(\d+)/)[1])-Number(b.match(/sheet(\d+)/)[1]));
 return names.map((path,index)=>{
  const xml=decoder.decode(files[path]),rows=[];
  for(const row of xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)){
   const cells=[];
   for(const cell of row[0].matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)){
    const tag=cell[0].match(/^<c\b[^>]*>/)?.[0]||cell[0];
    const ref=attrs(tag,"r")||"",kind=attrs(tag,"t");
    const raw=cell[0].match(/<v>([\s\S]*?)<\/v>/)?.[1]||"";
    const inline=cell[0].match(/<is>([\s\S]*?)<\/is>/)?.[1]||"";
    const value=kind==="s"?strings[Number(raw)]||"":kind==="inlineStr"?textRuns(inline):unescape(raw);
    cells.push({ref,value});
   }
   rows.push({index:Number(attrs(row[0].match(/^<row\b[^>]*>/)?.[0]||"","r")||rows.length+1),cells});
  }
  return {sheet:"Аркуш "+(index+1),rows};
 });
}
export function extractOoxmlTables(bytes,name){
 if(!(bytes instanceof Uint8Array))throw Error("Очікуються байти файлу");
 const ext=String(name).toLowerCase().split(".").pop();
 if(!["docx","xlsx"].includes(ext))throw Error("Підтримуються DOCX та XLSX");
 const files=archive(bytes);
 const tables=ext==="docx"?tablesDocx(files):sheetsXlsx(files);
 return {format:ext,table_count:tables.length,tables};
}
