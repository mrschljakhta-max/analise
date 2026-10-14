/* ANALISE browser-only import: local standard XLSX & DOCX readers.
 * No network requests. Never submit real or sensitive documents to the public demo.
 */
window.ANALISE_TEMPLATE_IMPORT=(function() {
"use strict";
const MAX_FILE=8*1024*1024,MAX_XML=15*1024*1024,MAX_ROWS=20000,PAGE=25;
const SHEET_HEADERS=[null,'Дата запиту','Час запиту','Тип дії','Від кого','Вид прикриття',"Об'єкт прикриття","Підрозділ об'єкта",'Назва н.п.','Координати (MGRS)','Час початку','Час завершення','Кого повідомили','Станція','Частоти','Підрозділ','Екіпаж','Тип засобу','Пілот','Час початку 2','Час завершення 2','Частоти (звільнити)','Населений пункт','Координати','Маршрут','Контакт','Черговий','Нагадування','Lat','Lon'];
const $=id=>document.getElementById(id);
const normal=s=>String(s??'').replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('uk');
let state={data:null,filtered:[],page:0};
function elm(tag,contents){let e=document.createElement(tag);e.textContent=String(contents??'');return e;}
function xml(input){const d=new DOMParser().parseFromString(input,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('XML документа пошкоджений.');return d;}
function direct(n,local){return Array.from(n?.children||[]).filter(x=>x.localName===local);}
function deep(n,local){return Array.from(n?.getElementsByTagNameNS('*',local)||[]);}
async function zipOpen(file){
 if(file.size>MAX_FILE)throw Error('Файл перевищує ліміт 8 МБ.');
 const buf=await file.arrayBuffer(), dv=new DataView(buf),len=buf.byteLength;
 const u16=i=>dv.getUint16(i,true),u32=i=>dv.getUint32(i,true);
 let eocd=-1;
 for(let i=len-22;i>=Math.max(0,len-65557);i--){if(u32(i)===0x06054b50){eocd=i;break;}}
 if(eocd===-1)throw Error('Не знайдено ZIP-структури Office.');
 const count=u16(eocd+10),off=u32(eocd+16),size=u32(eocd+12);
 if(count>2000||off+size>len)throw Error('Некоректний або надто складний ZIP-архів.');
 const entries=new Map();let p=off;
 for(let i=0;i<count;i++){
  if(p+46>len||u32(p)!==0x02014b50)throw Error('Помилка центрального каталогу ZIP.');
  const flags=u16(p+8),method=u16(p+10),compressed=u32(p+20),unpacked=u32(p+24),n=u16(p+28),extra=u16(p+30),comment=u16(p+32),localOffset=u32(p+42);
  if(p+46+n+extra+comment>len)throw Error('Пошкоджений запис ZIP.');
  const name=new TextDecoder().decode(new Uint8Array(buf,p+46,n));
  if(entries.has(name))throw Error('Дубльовані компоненти ZIP.');
  if(flags&1)throw Error('Зашифровані Office-файли не підтримуються.');
  entries.set(name,{method,compressed,unpacked,localOffset});p+=46+n+extra+comment;
 }
 async function read(name){
  const e=entries.get(name);if(!e)return null;
  if(e.unpacked>MAX_XML||e.compressed>MAX_FILE)throw Error('Компонент XML завеликий.');
  let pos=e.localOffset;
  if(pos+30>len||u32(pos)!==0x04034b50)throw Error('Неправильний локальний заголовок ZIP.');
  let start=pos+30+u16(pos+26)+u16(pos+28),end=start+e.compressed;
  if(end>len)throw Error('Некоректний розмір ZIP-компонента.');
  const part=new Uint8Array(buf,start,e.compressed);let output;
  if(e.method===0)output=part;
  else if(e.method===8){
   if(!('DecompressionStream' in window))throw Error('Браузер не підтримує ZIP-розпакування.');
   const stream=new Blob([part]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
   const reader=stream.getReader(),chunks=[];let n=0;
   while(true){let v=await reader.read();if(v.done)break;n+=v.value.byteLength;if(n>MAX_XML){await reader.cancel();throw Error('Розпакований XML перевищує ліміт.');}chunks.push(v.value);}
   output=new Uint8Array(n);let offset=0;for(const c of chunks){output.set(c,offset);offset+=c.length;}
  }else throw Error('Непідтримуваний ZIP-метод.');
  if(output.length!==e.unpacked||output.length>MAX_XML)throw Error('Порушення розміру компонента Office.');
  return new TextDecoder('utf-8',{fatal:true}).decode(output);
 }
 return {read};
}
function columnIndex(a){let n=0;for(let i=0;i<a.length;i++)n=n*26+a.charCodeAt(i)-64;return n-1;}
function cellText(c,shared){
 const t=c.getAttribute('t')||'';
 if(t==='inlineStr')return deep(c,'t').map(x=>x.textContent||'').join('');
 const v=deep(c,'v')[0]?.textContent||'';
 if(t==='s')return shared[Number(v)]||'';
 if(t==='b')return v==='1'?'так':'ні';
 return v;
}
function parseRow(r,shared){
 let values=Array(30).fill('');
 for(const c of direct(r,'c')){
  const m=/^([A-Z]+)\d+$/.exec(c.getAttribute('r')||'');if(!m)continue;
  const idx=columnIndex(m[1]);if(idx>=0&&idx<30)values[idx]=cellText(c,shared);
 }
 return values;
}
function resolvePath(base,target){
 if(target.startsWith('/'))return target.slice(1);
 const parts=base.split('/').slice(0,-1);
 for(const part of target.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}
 return parts.join('/');
}
async function parseXlsx(zip,fileName){
 const book=await zip.read('xl/workbook.xml');if(!book)throw Error('Не знайдено workbook.xml.');
 const wb=xml(book),sheets=deep(wb,'sheet');
 const rel=await zip.read('xl/_rels/workbook.xml.rels'),relations=new Map();
 if(rel)for(const item of deep(xml(rel),'Relationship'))relations.set(item.getAttribute('Id'),item.getAttribute('Target'));
 const ss=await zip.read('xl/sharedStrings.xml');
 const shared=ss?deep(xml(ss),'si').map(si=>deep(si,'t').map(t=>t.textContent||'').join('')):[];
 const sheet=sheets.find(x=>normal(x.getAttribute('name'))==='запити');
 if(!sheet)throw Error('Аркуш «Запити» не знайдено. Це не еталонний формат звіту.');
 const idx=sheets.indexOf(sheet),ref=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttribute('r:id');
 const target=relations.get(ref),path=target?resolvePath('xl/workbook.xml',target):'xl/worksheets/sheet'+(idx+1)+'.xml';
 const raw=await zip.read(path);if(!raw)throw Error('Не знайдено XML аркуша «Запити».');
 const rows=deep(xml(raw),'row');if(!rows.length)throw Error('Аркуш порожній.');
 const headerRow=rows.find(r=>Number(r.getAttribute('r'))===1)||rows[0];
 const headers=parseRow(headerRow,shared);
 const errors=[];
 for(let i=1;i<30;i++)if(normal(headers[i])!==normal(SHEET_HEADERS[i]))errors.push(String.fromCharCode(65+i)+': «'+SHEET_HEADERS[i]+'»');
 if(errors.length)throw Error('Невідповідність еталонним заголовкам: '+errors.join('; '));
 let records=[],warnings=[];
 if(!['№','id','ідентифікатор'].includes(normal(headers[0])))warnings.push('Назва A1 нестандартна. Колонка A зберігається як у джерелі.');
 for(const r of rows){
  const index=Number(r.getAttribute('r'))||0;
  if(index<=1)continue;
  if(records.length>=MAX_ROWS){warnings.push('Ліміт '+MAX_ROWS+' рядків: решту не завантажено.');break;}
  const values=parseRow(r,shared);
  if(values.some(v=>String(v).trim()))records.push({row:index,values});
 }
 const incomplete=records.filter(r=>!r.values[1]||!r.values[3]).length;
 if(incomplete)warnings.push(incomplete+' рядків не мають дати запиту або типу дії. Дані не змінено.');
 return {profile:'Excel / 30 колонок',name:fileName,headers,records,warnings,sections:[],columns:30};
}
function docText(node){return deep(node,'t').map(x=>x.textContent||'').join('').replace(/\s+/g,' ').trim();}
function parseDocx(text,fileName){
 const body=deep(xml(text),'body')[0];if(!body)throw Error('Не знайдено тіло Word-документа.');
 let started=false,section='',sections=[],paragraphs=[],records=[],warnings=[];
 for(const child of Array.from(body.children)){
  if(child.localName==='p'){
   const t=docText(child);
   if(/^3\.2\.(?!\d)/.test(t)){started=true;section='3.2';continue;}
   if(started&&/^3\.(?:3|4|5|6|7|8|9)\./.test(t))break;
   if(!started||!t)continue;
   const m=/^(3\.2(?:\.\d+)+)\.?\s*/.exec(t);
   if(m){section=m[1];sections.push({code:section,title:t});}
   paragraphs.push({section,text:t});
  }else if(child.localName==='tbl'&&started){
   for(const tr of direct(child,'tr')){
    if(records.length>=MAX_ROWS){warnings.push('Таблицю обмежено '+MAX_ROWS+' рядками.');break;}
    const tcs=direct(tr,'tc');
    let values=tcs.map(docText),heading=false;
    if(tcs.length===1){
      const spanNode=deep(tcs[0],'gridSpan')[0];
      const span=Number(spanNode?.getAttribute('w:val')||spanNode?.getAttribute('val')||1);
      if(span===4){heading=true;values=[values[0],'','',''];}
    }
    if(values.some(v=>v.trim()))records.push({row:records.length+1,values,heading});
   }
  }
 }
 if(!started)throw Error('Розділ 3.2 не знайдено. Це не еталонний формат Word.');
 if(!sections.some(x=>x.code==='3.2.1'))warnings.push('Підрозділ 3.2.1 не знайдено.');
 if(!sections.some(x=>x.code==='3.2.2'))warnings.push('Підрозділ 3.2.2 не знайдено.');
 if(!records.length)warnings.push('Таблиця розділу 3.2 відсутня або порожня.');
 let mismatched=records.filter(r=>r.values.length!==4&&!r.heading).length;
 if(mismatched)warnings.push('У '+mismatched+' рядках таблиці не 4 клітинки. Значення залишено як є.');
 return {profile:'Word / розділ 3.2',name:fileName,headers:['Колонка 1','Колонка 2','Колонка 3','Колонка 4'],records,warnings,sections,paragraphs,columns:4};
}
async function parse(file){
 if(!/\.(?:xlsx|docx)$/i.test(file.name))throw Error('Підтримуються лише XLSX та DOCX.');
 const zip=await zipOpen(file);
 if(/\.xlsx$/i.test(file.name))return parseXlsx(zip,file.name);
 const raw=await zip.read('word/document.xml');if(!raw)throw Error('Не знайдено document.xml.');
 return parseDocx(raw,file.name);
}
function excelPreview(value,col){
 const str=String(value??'').trim();
 if(col===1&&/^\d{5}(?:\.\d+)?$/.test(str)){
  const d=new Date(Date.UTC(1899,11,30)+Math.round(Number(str)*86400000));
  if(!isNaN(d.getTime()))return d.toLocaleDateString('uk-UA',{timeZone:'UTC'});
 }
 // Excel time is a fraction of a 24-hour day; the original cell format is irrelevant.
 // The numeric XML value may be decimal (0.036111...) or scientific (3.6111E-2).
 // Text times such as 03:01 are deliberately kept unchanged.
 if([2,10,11,19,20].includes(col)&&/^[+\-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+\-]?\d+)?$/i.test(str)){
  const fraction=Number(str.replace(',','.'));
  if(Number.isFinite(fraction)&&fraction>=0&&fraction<=1){
   const minutes=Math.round(fraction*1440)%1440;
   return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  }
 }
 return str;
}


function splitDateAndTime(raw){
  const original=String(raw??"").replace(/\u00a0/g," ").trim();
  const match=original.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
    || original.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(!match)return {original,date:"",time:"",valid:false};
  const timeFirst=/^\d{1,2}:\d{2}/.test(original);
  const hour=Number(timeFirst?match[1]:match[4]), minute=Number(timeFirst?match[2]:match[5]);
  const day=Number(timeFirst?match[4]:match[1]),month=Number(timeFirst?match[5]:match[2]),year=Number(timeFirst?match[6]:match[3]);
  const seconds=Number(timeFirst?(match[3]||0):(match[6]||0));
  const dt=new Date(Date.UTC(year,month-1,day));
  const valid=year>=1900&&hour<=23&&minute<=59&&seconds<=59&&dt.getUTCFullYear()===year
    &&dt.getUTCMonth()===month-1&&dt.getUTCDate()===day;
  return {original,date:valid?year+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0"):"",
    time:valid?String(hour).padStart(2,"0")+":"+String(minute).padStart(2,"0"):"",
    valid};
}
function splitBearingAndPlace(raw){
  const original=String(raw??"").replace(/\u00a0/g," ").trim();
  const m=/^(\d{1,3}(?:[.,]\d+)?)\s+(.+)$/.exec(original);
  if(!m)return {original,azimuth:"",settlement:"",valid:false};
  const azimuth=Number(m[1].replace(",","."));
  const settlement=m[2].trim();
  const valid=Number.isFinite(azimuth)&&azimuth>=0&&azimuth<=360&&Boolean(settlement);
  return {original,azimuth:valid?azimuth:"",settlement:valid?settlement:"",valid};
}
function normalize(result){
  if(result.profile.startsWith("Excel")){
    const records=result.records.map(row=>({
      row:row.row,
      raw:row.values.slice(),
      cells:row.values.map((v,i)=>excelPreview(v,i)),
      problems:[],
      status:"ready"
    }));
    return {kind:"excel",headers:result.headers.slice(),records,
      warnings:result.warnings.slice()};
  }
  let station="",counter=0,records=[],warnings=result.warnings.slice();
  for(const row of result.records){
    const cells=row.values||[];
    if(row.heading){station=String(cells[0]||"").trim();continue;}
    const dateText=String(cells[0]||"").trim();
    if(!dateText||(/час|дата/i.test(dateText)&&!/\d{1,2}:\d{2}/.test(dateText)))continue;
    const dt=splitDateAndTime(cells[0]);
    const place=splitBearingAndPlace(cells[2]);
    const problems=[];
    if(cells.length!==4)problems.push("Очікується 4 колонки");
    if(!station)problems.push("Станцію не визначено");
    if(!dt.valid)problems.push("Не розпізнано дату й час");
    if(!place.valid)problems.push("Не розпізнано азимут і населений пункт");
    records.push({row:row.row||++counter,raw:cells.slice(),station,
      event_date:dt.date,event_time:dt.time,
      type:String(cells[1]||""),azimuth:place.azimuth,settlement:place.settlement,
      result:String(cells[3]||""),datetime_original:dt.original,location_original:place.original,
      problems,status:problems.length?"error":"ready"});
  }
  return {kind:"word",headers:["Станція","Дата","Час","Тип","Азимут","Населений пункт","Результат","Статус"],
    records,warnings};
}
return {parse,normalize,splitDateAndTime,splitBearingAndPlace};

})();
