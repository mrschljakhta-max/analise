export const QUALITY_HTML=`<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>ANALISE — Якість архіву</title>
<link rel="stylesheet" href="/api/quality-inventory/view.css"><script src="/api/quality-inventory/view.js" defer></script></head>
<body><main class="shell"><header><div><p class="eyebrow">ANALISE / DATA QUALITY</p>
<h1>Інвентаризація архівів</h1><p>Тільки узагальнені кількості файлів. Не завантажуй сюди первинні документи або оперативні дані.</p></div>
<a href="/api/dashboard">← На головну</a></header>
<section class="stats"><article><span>Пакетів</span><strong id="batches">—</strong></article>
<article><span>Усього примірників</span><strong id="files">—</strong></article>
<article><span>Унікальних</span><strong id="unique">—</strong></article>
<article><span>Дублікатів</span><strong id="duplicates">—</strong></article></section>
<section class="panel"><h2>Імпорт агрегованого JSON</h2>
<p>Структура: batch_key, nested_archives, files з format / total / unique. Дозволені формати: xlsx, docx, pdf, csv, txt.</p>
<label for="jsonfile">Вибрати підготовлений файл JSON</label><input id="jsonfile" type="file" accept=".json,application/json">
<label for="payload">Або вставити JSON</label>
<textarea id="payload" spellcheck="false" placeholder='{"batch_key":"archive_example_01","nested_archives":0,"files":[{"format":"xlsx","total":3,"unique":2}]}'></textarea>
<div class="actions"><button id="validate" type="button">Перевірити</button><button id="save" type="button" class="primary">Зберегти у D1</button><button id="refresh" type="button">Оновити</button></div>
<p id="notice" role="status" aria-live="polite"></p></section>
<section class="panel"><h2>Збережені пакети</h2><div class="tablewrap"><table><thead><tr><th>Пакет</th><th>Формати</th><th>Усього</th><th>Унікальні</th><th>Дублікати</th></tr></thead>
<tbody id="table"><tr><td colspan="5">Завантаження…</td></tr></tbody></table></div></section>
<footer>Зберігаються лише підсумки інвентаризації. Чинні довідники, Чистилище й операційні таблиці не змінюються.</footer></main></body></html>`;
export const QUALITY_CSS=`
:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#0d1524;color:#ecf3ff}
*{box-sizing:border-box}body{margin:0}.shell{max-width:1100px;margin:auto;padding:36px 22px}
header{display:flex;justify-content:space-between;gap:24px;align-items:start}h1{font-size:clamp(1.8rem,3.8vw,2.8rem);margin:0}h2{margin:0 0 8px}
p{color:#a6b4c9;margin:8px 0 14px}.eyebrow{font-size:12px;letter-spacing:.18em;color:#6fcbe1}
a{color:#86d5ff;text-decoration:none}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:25px 0}
article,.panel{border:1px solid #26364d;border-radius:16px;background:#121f32;padding:20px}
article span{display:block;font-size:13px;color:#9bb1c6}article strong{font-size:32px;display:block;margin-top:6px}
.panel{margin:18px 0}label{display:block;font-size:14px;font-weight:600;margin:13px 0 5px}
input,textarea,button{font:inherit}input{max-width:100%}textarea{width:100%;height:150px;background:#0d1929;border:1px solid #3e5068;border-radius:10px;color:#f3f6ff;padding:12px;resize:vertical}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}button{border:1px solid #46647e;border-radius:10px;padding:10px 16px;background:#21354b;color:white;cursor:pointer}
button.primary{background:#1a819a;border-color:#1d9cb8}button:disabled{opacity:.5;cursor:wait}
#notice{min-height:24px}.tablewrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}
td,th{border-bottom:1px solid #283b50;padding:12px 9px}th{color:#9bafc6;font-size:13px}td{font-size:14px}
footer{color:#8296ad;font-size:13px;margin:24px 0}
@media(max-width:680px){.stats{grid-template-columns:repeat(2,1fr)}header{display:block}}
`;
export const QUALITY_JS=`
"use strict";
const el=id=>document.getElementById(id);
function validate(p){
 if(!p||typeof p!=="object"||Array.isArray(p)||Object.keys(p).some(k=>!["batch_key","nested_archives","files"].includes(k)))throw Error("Неправильні поля об'єкта");
 if(typeof p.batch_key!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(p.batch_key))throw Error("Некоректний batch_key");
 if(!Number.isInteger(p.nested_archives??0)||(p.nested_archives??0)<0||(p.nested_archives??0)>100)throw Error("Некоректні архіви");
 if(!Array.isArray(p.files)||p.files.length<1||p.files.length>5)throw Error("Неправильний files");
 const seen=new Set();
 for(const f of p.files){
  if(!f||typeof f!=="object"||Object.keys(f).some(k=>!["format","total","unique"].includes(k))||!["xlsx","docx","pdf","csv","txt"].includes(f.format)||seen.has(f.format)||!Number.isSafeInteger(f.total)||!Number.isSafeInteger(f.unique)||f.total<1||f.total>100000||f.unique<0||f.unique>f.total)throw Error("Неправильні файли або надлишкові поля");
  seen.add(f.format);
 }
 return p;
}
const notice=(txt)=>{el("notice").textContent=txt};
async function load(){
 try{const r=await fetch("/api/quality-inventory",{cache:"no-store",credentials:"same-origin"});
 const data=await r.json();if(!r.ok)throw Error(data.error||r.status);
 for(const id of ["batches","files","unique","duplicates"])el(id).textContent=data.totals[id].toLocaleString("uk-UA");
 const root=el("table");root.replaceChildren();
 for(const item of data.items){
  const tr=document.createElement("tr");
  for(const cell of [item.batch_key,item.formats.map(f=>f.format+": "+f.total).join(", "),item.total,item.unique,item.duplicates]){
   const td=document.createElement("td");td.textContent=String(cell);tr.append(td);
  }root.append(tr);
 }
 if(!data.items.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="Поки немає пакетів";tr.append(td);root.append(tr)}
 }catch(e){notice("Читання D1: "+e.message)}
}
el("jsonfile").addEventListener("change",async e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(file.size>8192||!file.name.toLowerCase().endsWith(".json"))return notice("Потрібен JSON до 8 КБ");
 el("payload").value=await file.text();notice("JSON завантажено локально");
});
el("validate").addEventListener("click",()=>{
 try{const p=validate(JSON.parse(el("payload").value));notice("Перевірено: "+p.files.reduce((n,f)=>n+f.total,0)+" примірників файлів")}catch(e){notice("Помилка: "+e.message)}
});
el("save").addEventListener("click",async()=>{
 try{
 const p=validate(JSON.parse(el("payload").value));el("save").disabled=true;
 const r=await fetch("/api/quality-inventory",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(p)});
 const b=await r.json();if(!r.ok)throw Error(b.error||r.status);
 notice(b.already_imported?"Пакет уже є у D1":"Дані успішно записані у D1");await load();
 }catch(e){notice("Помилка запису: "+e.message)}finally{el("save").disabled=false}
});
el("refresh").addEventListener("click",load);load();
`;
