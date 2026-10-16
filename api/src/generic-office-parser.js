// General-purpose Office table extraction. Does not infer or process operational meaning.
// Only finite, explicitly bounded OOXML input is accepted. No external resources or XML DTD.
import {unzipSync} from "fflate";
import {XMLParser} from "fast-xml-parser";

const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",
  textNodeName:"#text",parseTagValue:false,parseAttributeValue:false,
  trimValues:false,processEntities:true,removeNSPrefix:false});
const decoder=new TextDecoder("utf-8",{fatal:true});
const FILE_LIMIT=8*1024*1024,EXPANDED_LIMIT=24*1024*1024,PART_LIMIT=7*1024*1024;
const MAX_ROWS=400,MAX_COLS=40,MAX_TABLES=30,MAX_CELL=3000;
const arr=v=>v===undefined||v===null?[]:Array.isArray(v)?v:[v];
const plain=v=>v===undefined||v===null?"":typeof v==="object"?String(v["#text"]??""):String(v);
const clean=value=>String(value??"").replace(/\u0000/g,"").slice(0,MAX_CELL);
function xml(body,label){
 if(body.length>PART_LIMIT||/<!\s*(DOCTYPE|ENTITY)\b/i.test(body))
  throw Error("Небезпечна або завелика XML-частина: "+label);
 return parser.parse(body);
}
function unzip(bytes){
 if(bytes.byteLength>FILE_LIMIT)throw Error("Файл перевищує ліміт 8 МБ");
 if(bytes.byteLength<4||bytes[0]!==80||bytes[1]!==75)
  throw Error("Файл не є коректним контейнером Office/ZIP");
 let count=0,total=0;
 const result=unzipSync(bytes,{filter:entry=>{
  count++;total+=entry.originalSize||0;
  if(count>350||total>EXPANDED_LIMIT||entry.originalSize>PART_LIMIT)
   throw Error("Архів перевищує обмеження безпечного розпакування");
  return true;
 }});
 if(!Object.keys(result).length)throw Error("Архів порожній");
 return result;
}
function part(zip,key,required=true){
 const bytes=zip[key];
 if(!bytes){if(required)throw Error("Немає обов'язкової частини "+key);return ""}
 try{return decoder.decode(bytes)}catch{throw Error("Пошкоджене кодування XML: "+key)}
}
function recursiveText(node){
 if(node===undefined||node===null)return "";
 if(Array.isArray(node))return node.map(recursiveText).join("");
 if(typeof node!=="object")return plain(node);
 let value="";
 for(const [key,child] of Object.entries(node)){
  if(key==="w:t"||key==="t")value+=arr(child).map(plain).join("");
  else if(key==="w:tab")value+="\t";
  else if(key==="w:br"||key==="w:cr")value+="\n";
  else if(key[0]!=="@"&&key!=="#text")value+=recursiveText(child);
 }
 return value;
}
function buildTable(rows,source,title,warnings=[]){
 if(rows.length===0)return null;
 const width=Math.max(...rows.map(r=>r.cells.length));
 if(width>MAX_COLS)throw Error("Таблиця має понад "+MAX_COLS+" колонок");
 if(rows.length>MAX_ROWS+1)throw Error("Таблиця має понад "+MAX_ROWS+" рядків");
 const padded=rows.map(row=>({source_row:row.source_row,cells:Array.from({length:width},(_,i)=>clean(row.cells[i]??""))}));
 const columns=Array.from({length:width},(_,i)=>"Колонка "+(i+1));
 const first=padded[0].cells;
 const names=new Set();
 for(let i=0;i<width;i++){
  let h=first[i].trim().slice(0,80)||columns[i],suffix=2,proposed=h;
  while(names.has(proposed.toLocaleLowerCase("uk-UA"))){proposed=h+" ("+suffix+")";suffix++}
  columns[i]=proposed;names.add(proposed.toLocaleLowerCase("uk-UA"));
 }
 return {key:source,title,columns,rows:padded,warnings,kind:null};
}
function parseDocxParts(parts,filename){
 const root=xml(part(parts,"word/document.xml"),"word/document.xml");
 const body=root?.["w:document"]?.["w:body"];
 if(!body)throw Error("Некоректна структура Word");
 const tables=arr(body["w:tbl"]);
 if(!tables.length)throw Error("У Word не знайдено таблиць");
 if(tables.length>MAX_TABLES)throw Error("Забагато таблиць у Word");
 return tables.map((tbl,t)=>{
  const rows=arr(tbl["w:tr"]).map((row,ri)=>{
   const cells=[];
   for(const tc of arr(row["w:tc"])){
    const grid=Number(tc?.["w:tcPr"]?.["w:gridSpan"]?.["@_w:val"]||1);
    if(!Number.isInteger(grid)||grid<1||grid>MAX_COLS)throw Error("Некоректне об'єднання комірок Word");
    const value=clean(recursiveText(tc["w:p"]));
    cells.push(value);
    for(let j=1;j<grid;j++)cells.push("");
   }
   return {source_row:ri+1,cells};
  }).filter(r=>r.cells.some(v=>v!==""));
  const table=buildTable(rows,"docx:"+t,"Таблиця Word "+(t+1));
  if(table)table.kind="docx";
  return table;
 }).filter(Boolean);
}
function excelColumn(ref){
 let col=0;
 for(const c of ref.toUpperCase()){
  const x=c.charCodeAt(0)-64;
  if(x<1||x>26)return -1;
  col=col*26+x;
  if(col>MAX_COLS)return -1;
 }
 return col-1;
}
function styleDateIds(zip){
 const body=part(zip,"xl/styles.xml",false);
 if(!body)return new Set();
 const root=xml(body,"styles");
 const style=root?.styleSheet;
 const fmt=new Map(arr(style?.numFmts?.numFmt).map(x=>[Number(x["@_numFmtId"]),String(x["@_formatCode"]||"")]));
 const xfs=arr(style?.cellXfs?.xf),ids=new Set();
 for(let i=0;i<xfs.length;i++){
  const id=Number(xfs[i]["@_numFmtId"]||0);
  if([14,15,16,17,18,19,20,21,22,45,46,47].includes(id)||
    (/([dmyhHsS])/i.test((fmt.get(id)||"").replace(/"[^"]*"|\[[^\]]*\]/g,""))))ids.add(i);
 }
 return ids;
}
function excelDate(serial){
 const n=Number(serial);
 if(!Number.isFinite(n)||n<0||n>100000)return String(serial);
 // OOXML default 1900-based numbering; 1904 workbooks unsupported in v1.
 const ms=Math.round((n-25569)*86400000);
 const date=new Date(ms);
 if(Number.isNaN(date.getTime()))return String(serial);
 return Number.isInteger(n)?date.toISOString().slice(0,10):date.toISOString().replace(".000Z","Z");
}
function relPath(target){
 const t=String(target||"").replace(/^\/+/,"");
 const combined=t.startsWith("xl/")?t:"xl/"+t;
 const stack=[];
 for(const piece of combined.split("/")){
  if(piece==="."||piece==="")continue;
  if(piece===".."){if(stack.length<=1)throw Error("Некоректний шлях Excel");stack.pop()}
  else stack.push(piece);
 }
 const resolved=stack.join("/");
 if(!resolved.startsWith("xl/")||resolved.includes("\\"))throw Error("Некоректний шлях Excel");
 return resolved;
}
function parseXlsxParts(parts){
 const workbook=xml(part(parts,"xl/workbook.xml"),"workbook");
 const book=workbook.workbook;
 if(!book)throw Error("Відсутній workbook.xlsx");
 if(book.workbookPr?.["@_date1904"]==="1"||book.workbookPr?.["@_date1904"]==="true")
  throw Error("Книги з датами Excel 1904 поки не підтримуються");
 const rel=xml(part(parts,"xl/_rels/workbook.xml.rels"),"workbook relations");
 const rels=new Map(arr(rel.Relationships?.Relationship).map(r=>[
   String(r["@_Id"]),String(r["@_Target"]||"")
 ]));
 const sharedRaw=part(parts,"xl/sharedStrings.xml",false);
 const ss=sharedRaw?xml(sharedRaw,"sharedStrings"):null;
 const shared=arr(ss?.sst?.si).map(x=>clean(recursiveText(x)));
 const dateStyles=styleDateIds(parts);
 const sheets=arr(book.sheets?.sheet);
 if(sheets.length>MAX_TABLES)throw Error("Забагато аркушів Excel");
 const output=[];
 for(let i=0;i<sheets.length;i++){
  const sheet=sheets[i],name=String(sheet["@_name"]||"Аркуш "+(i+1)).slice(0,100);
  const target=rels.get(String(sheet["@_r:id"]));
  if(!target)throw Error("Не вдалося знайти аркуш "+name);
  const key=relPath(target);
  const sh=xml(part(parts,key),key)?.worksheet;
  if(!sh)throw Error("Пошкоджений аркуш "+name);
  const warnings=[];
  const rows=[];
  for(const r of arr(sh.sheetData?.row)){
   const ri=Number(r["@_r"]||rows.length+1);
   if(!Number.isInteger(ri)||ri<1||ri>1048576)throw Error("Некоректний номер рядка");
   const values=[];
   for(const c of arr(r.c)){
    const coord=String(c["@_r"]||"");
    const m=/^([A-Z]+)(\d+)$/i.exec(coord);
    if(!m)continue;
    const j=excelColumn(m[1]);
    if(j<0)continue; // Columns outside the supported 40-column projection are excluded.
    let value="";
    const kind=String(c["@_t"]||"n"),raw=plain(c.v);
    if(kind==="inlineStr")value=recursiveText(c.is);
    else if(kind==="s"){
      const k=Number(raw);value=Number.isInteger(k)&&k>=0&&k<shared.length?shared[k]:"";
      if(value==="")warnings.push("Порожній або відсутній спільний рядок "+coord);
    } else if(kind==="b")value=raw==="1"?"Так":"Ні";
    else if(kind==="e"){value=raw;warnings.push("Excel помилка у "+coord)}
    else if(kind==="str")value=raw;
    else if(raw!==""&&dateStyles.has(Number(c["@_s"]||0)))value=excelDate(raw);
    else value=raw;
    if(c.f!==undefined&&c.v===undefined){warnings.push("Формула без обчисленого значення: "+coord);value=""}
    values[j]=clean(value);
   }
   if(values.some(v=>v!==undefined&&v!==""))rows.push({source_row:ri,cells:values});
   if(rows.length>MAX_ROWS+1)throw Error("Аркуш перевищує "+MAX_ROWS+" рядків для одного імпорту");
  }
  if(rows.length){
   const t=buildTable(rows,"xlsx:"+i,name,[...new Set(warnings)].slice(0,25));
   t.kind="xlsx";output.push(t);
  }
 }
 if(!output.length)throw Error("Excel не містить непорожніх таблиць у перших 40 колонках");
 return output;
}
export function parseGeneralOffice(bytes,name){
 if(!(bytes instanceof Uint8Array))throw Error("Очікується файл");
 const ext=String(name||"").toLocaleLowerCase().split(".").pop();
 if(!["docx","xlsx","zip"].includes(ext))throw Error("Підтримуються лише DOCX, XLSX та ZIP");
 const parts=unzip(bytes);
 if(ext==="docx")return [{name,tables:parseDocxParts(parts,name)}];
 if(ext==="xlsx")return [{name,tables:parseXlsxParts(parts)}];
 const documents=[],entries=Object.entries(parts).filter(([path])=>
  /\.(docx|xlsx)$/i.test(path)&&!path.startsWith("__MACOSX/"));
 if(entries.length>10)throw Error("У ZIP понад 10 документів");
 for(const [path,raw] of entries){
  if(path.includes("..")||path.startsWith("/")||path.includes("\\"))
   throw Error("Небезпечний шлях у ZIP");
  documents.push(...parseGeneralOffice(raw,path.split("/").pop()));
 }
 if(!documents.length)throw Error("ZIP не містить DOCX або XLSX");
 if(documents.reduce((n,d)=>n+d.tables.length,0)>MAX_TABLES)throw Error("Забагато таблиць");
 return documents;
}
export function tableIndex(docs){
 const list=[];
 docs.forEach((d,di)=>d.tables.forEach((t,ti)=>list.push({
  ref:di+":"+ti,name:d.name,title:t.title,kind:t.kind,columns:t.columns,
  rows:t.rows,warnings:t.warnings
 })));
 return list;
}
export const parserLimits={fileBytes:FILE_LIMIT,rows:MAX_ROWS,columns:MAX_COLS};
