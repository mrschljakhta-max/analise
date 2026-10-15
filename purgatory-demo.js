/* ANALISE · ASTRA 3.0. Purgatory prototype with synthetic/session-only data.
 * Does not read imported files, send requests, or persist user data.
 */
(function(root) {
"use strict";
const kindNames={station:"Станція",settlement:"Населений пункт",action:"Тип дії"};
const latinToCyr={A:"А",a:"а",B:"В",C:"С",c:"с",E:"Е",e:"е",H:"Н",I:"І",i:"і",K:"К",k:"к",M:"М",O:"О",o:"о",P:"Р",p:"р",T:"Т",X:"Х",x:"х",Y:"У",y:"у"};
const digitToCyr={"0":"О","1":"І","3":"З"};
function normal(value){
 return String(value??"").normalize("NFC").replace(/[’‘ʼ\u02bc\u0060]/g,"'")
  .replace(/[‐‑‒–—−]/g,"-").replace(/\s+/gu," ").trim().toLocaleLowerCase("uk");
}
function escape(value){
 return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function activeList(state,kind){return state.dictionary[kind].filter(x=>x.active);}
function scope(kind,stationId){return kind==="settlement"?String(stationId||""):"";}
function groupKey(issue){return JSON.stringify([issue.kind,scope(issue.kind,issue.stationId),normal(issue.raw)]);}
function matchesCanonical(state,kind,raw){
 return activeList(state,kind).filter(x=>normal(x.name)===normal(raw));
}
function matchedAlias(state,kind,raw,stationId){
 return state.aliases.filter(a=>a.kind===kind&&a.active&&a.normalized===normal(raw)&&
  a.stationId===scope(kind,stationId)).map(a=>activeList(state,kind).find(x=>x.id===a.targetId)).filter(Boolean);
}
function findKnown(state,kind,raw,stationId){
 // A verified station-scoped settlement choice takes precedence over duplicate names.
 const aliases=matchedAlias(state,kind,raw,stationId);
 const byAlias=Array.from(new Map(aliases.map(x=>[x.id,x])).values());
 if(byAlias.length)return byAlias.length===1?byAlias[0]:null;
 const canonical=matchesCanonical(state,kind,raw);
 return canonical.length===1?canonical[0]:null;
}
function seed(){
 return {
 dictionary:{
  station:[{id:"s1",name:"СОКІЛ",active:true},{id:"s2",name:"ЛЕВ",active:true},{id:"s3",name:"СЕКТОР-01",active:true}],
  settlement:[{id:"p1",name:"Кленове",detail:"Умовна громада №1",active:true},
    {id:"p2",name:"Кленове",detail:"Умовна громада №2",active:true},
    {id:"p3",name:"Березове",detail:"Умовна громада №3",active:true}],
  action:[{id:"a1",name:"Звернення",active:true},{id:"a2",name:"Уточнення",active:true}]
 },aliases:[],issues:[
  {id:"i1",kind:"station",stationId:"",raw:"CОКІЛ",source:"Демо XLSX · рядок 2",status:"pending"},
  {id:"i2",kind:"station",stationId:"",raw:"CОКІЛ",source:"Демо XLSX · рядок 8",status:"pending"},
  {id:"i3",kind:"station",stationId:"",raw:"С0КІЛ",source:"Демо DOCX · рядок 4",status:"pending"},
  {id:"i4",kind:"station",stationId:"",raw:"ЛЕЕВ",source:"Демо DOCX · рядок 6",status:"pending"},
  {id:"i5",kind:"settlement",stationId:"s1",raw:"Клeнове",source:"Демо DOCX · рядок 3",status:"pending"},
  {id:"i6",kind:"settlement",stationId:"s2",raw:"Клeнове",source:"Демо XLSX · рядок 9",status:"pending"},
  {id:"i7",kind:"action",stationId:"",raw:"Уточненя",source:"Демо XLSX · рядок 5",status:"pending"}
 ],decisions:[],nextId:20,filter:"",kindFilter:"all",proposals:{},choices:{}};
}
function groups(state){
 const data=new Map();
 for(const issue of state.issues){
  if(issue.status!=="pending")continue;
  const key=groupKey(issue);
  if(!data.has(key))data.set(key,{key,kind:issue.kind,stationId:issue.stationId||"",raw:issue.raw,items:[]});
  data.get(key).items.push(issue);
 }
 return [...data.values()];
}
function correction(raw){
 return Array.from(String(raw)).map(c=>latinToCyr[c]||c).join("");
}
function correctionWithDigits(raw){
 return Array.from(correction(raw)).map(c=>digitToCyr[c]||c).join("");
}
function editDistance(a,b){
 const m=Array.from(a),n=Array.from(b),dp=Array.from({length:n.length+1},(_,i)=>i);
 for(let i=1;i<=m.length;i++){
  let prev=dp[0];dp[0]=i;
  for(let j=1;j<=n.length;j++){const tmp=dp[j];dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(m[i-1]===n[j-1]?0:1));prev=tmp;}
 }
 return dp[n.length];
}
function suggestions(state,group){
 const original=normal(group.raw);
 const variants=[original,normal(correction(group.raw)),normal(correctionWithDigits(group.raw))];
 return activeList(state,group.kind).map(item=>{
  const target=normal(item.name);
  const score=Math.min(...variants.map(v=>editDistance(v,target)));
  return {...item,score};
 }).filter(x=>x.score<=Math.max(2,Math.floor(original.length/3))).sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name,"uk"));
}
function diagnostics(state,group){
 if(findKnown(state,group.kind,group.raw,group.stationId))return [];
 const chars=Array.from(group.raw),hasCyr=chars.some(c=>/[А-Яа-яІіЇїЄєҐґ]/u.test(c)),out=[];
 const fixed=normal(correctionWithDigits(group.raw));
 const similar=activeList(state,group.kind).some(item=>normal(item.name)===fixed);
 chars.forEach((c,i)=>{
  if(hasCyr&&/[A-Za-z]/.test(c))out.push({index:i,char:c,replace:latinToCyr[c]||"",reason:"Латинська літера серед кириличних"});
  else if(digitToCyr[c]&&similar)out.push({index:i,char:c,replace:digitToCyr[c],reason:"Схожа цифра замість літери"});
 });
 return out;
}
function highlighted(state,group){
 const diag=new Map(diagnostics(state,group).map(x=>[x.index,x]));
 return Array.from(group.raw).map((c,i)=>{
  const d=diag.get(i);
  return d?'<mark class="pg-warn-character" title="'+escape(d.reason)+' · U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,"0")+'">'+escape(c)+'</mark>':escape(c);
 }).join("");
}
function matchingGroup(state,key){
 const group=groups(state).find(g=>g.key===key);
 if(!group)throw Error("Завдання вже опрацьовано або не знайдено");
 return group;
}
function conflict(state,kind,raw,targetId,stationId){
 const context=scope(kind,stationId),norm=normal(raw);
 const aliases=state.aliases.filter(a=>a.active&&a.kind===kind&&a.stationId===context&&a.normalized===norm&&a.targetId!==targetId);
 if(aliases.length)return true;
 if(kind!=="settlement"&&matchesCanonical(state,kind,raw).some(x=>x.id!==targetId))return true;
 return false;
}
function resolve(state,key,targetId,mode){
 const group=matchingGroup(state,key),target=activeList(state,group.kind).find(x=>x.id===targetId);
 if(!target)throw Error("Оберіть активне значення довідника");
 if(mode!=="one"&&mode!=="group")throw Error("Непідтримувана дія");
 if(mode==="group"&&conflict(state,group.kind,group.raw,target.id,group.stationId))throw Error("Аліас конфліктує з іншим активним значенням");
 const items=mode==="one"?[group.items[0]]:group.items;
 for(const issue of items){issue.status="verified";issue.targetId=target.id;issue.decision=mode==="one"?"Виняток для запису":"Підтверджено групу";}
 if(mode==="group"&&(group.kind==="settlement"||normal(group.raw)!==normal(target.name))){
  const stationId=scope(group.kind,group.stationId),normalized=normal(group.raw);
  if(!state.aliases.some(a=>a.kind===group.kind&&a.normalized===normalized&&a.stationId===stationId&&a.targetId===target.id&&a.active)){
   state.aliases.push({kind:group.kind,normalized,raw:group.raw,stationId,targetId:target.id,active:true});
  }
 }
 state.decisions.unshift({kind:group.kind,raw:group.raw,target:target.name,count:items.length,mode});
 delete state.proposals[key];
 delete state.choices[key];
 return {count:items.length,target:target.name,kind:group.kind};
}
function createCanonical(state,key,name){
 const group=matchingGroup(state,key),val=String(name??"").trim();
 if(!val)throw Error("Вкажи назву нового значення");
 if(val.length>100)throw Error("Назва занадто довга");
 if(group.kind!=="settlement"&&matchesCanonical(state,group.kind,val).length)throw Error("Така назва вже є в довіднику");
 const id="local-"+state.nextId++;
 state.dictionary[group.kind].push({id,name:val,detail:group.kind==="settlement"?"Створено в демосесії":"",active:true});
 return resolve(state,key,id,"group");
}
function addDemo(state,kind,raw,stationId){
 if(!Object.hasOwn(kindNames,kind))throw Error("Оберіть тип поля");
 const val=String(raw??"").trim();
 if(!val)throw Error("Порожні значення не потребують перевірки");
 if(val.length>100)throw Error("Назва занадто довга");
 if(kind==="settlement"&&!activeList(state,"station").some(x=>x.id===stationId))throw Error("Оберіть станцію для населеного пункту");
 const known=findKnown(state,kind,val,stationId);
 const issue={id:"i"+state.nextId++,kind,raw:val,stationId:scope(kind,stationId),
  source:"Ручний синтетичний приклад",status:known?"verified":"pending"};
 if(known)issue.targetId=known.id;
 state.issues.push(issue);
 return {known:!!known,name:known?.name||"",issue};
}
function card(state,g){
 const options=activeList(state,g.kind),suggested=suggestions(state,g),found=new Set(suggested.map(x=>x.id));
 const ordered=[...suggested,...options.filter(x=>!found.has(x.id))];
 const diagnostic=diagnostics(state,g),candidate=state.proposals[g.key]||"";
 const selectId="pg-target-"+state.issues.indexOf(g.items[0]);
 const selected=state.choices[g.key]||"";
 const desc=diagnostic.length?diagnostic.map(d=>"Позиція "+(d.index+1)+": «"+d.char+"» — "+d.reason+
  (d.replace?" (можливо, «"+d.replace+"»)":"")).join(" · "):
  "Невідома назва або орфографічна розбіжність. Остаточну відповідність обирає оператор.";
 const context=g.kind==="settlement"?(activeList(state,"station").find(x=>x.id===g.stationId)?.name||"Невідома станція"):"Без контексту станції";
 const btn=(label,act,extra)=>'<button class="btn tiny '+(act==="pg-confirm"?"primary":"")+'" data-action="'+act+'" data-pg-key="'+escape(g.key)+'" '+(extra||"")+'>'+label+'</button>';
 const choices=ordered.map((x,i)=>'<option value="'+escape(x.id)+'"'+(x.id===selected?' selected':'')+'>'+escape(x.name)+
  (x.detail?" · "+escape(x.detail):"")+(x.score!==undefined?" · підказка":"")+'</option>').join("");
 return '<article class="panel pg-card" data-pg-group="'+escape(g.key)+'">'+
  '<div class="panelhead"><div><span class="tag warn">'+escape(kindNames[g.kind])+'</span> '+
  '<span class="tag">'+g.items.length+' входж.</span></div><span class="muted">'+escape(context)+'</span></div>'+
  '<div class="pg-value">'+highlighted(state,g)+'</div>'+
  '<p class="paneldesc">'+escape(desc)+'</p>'+
  (candidate?'<div class="pg-suggestion">Запропоноване виправлення: <strong>'+escape(candidate)+'</strong></div>':"")+
  '<div class="pg-fields"><label class="formgroup"><span>Підтверджена відповідність</span><select id="'+selectId+'" class="pg-target" data-pg-key="'+escape(g.key)+'">'+
  '<option value="">— Обрати зі словника —</option>'+choices+'</select></label>'+
  '<label class="formgroup"><span>Нова назва (за потреби)</span><input type="text" class="pg-new-name" data-pg-key="'+escape(g.key)+'" placeholder="Створити новий запис…" maxlength="100"></label></div>'+
  '<div class="actions pg-actions">'+
  (diagnostic.some(d=>d.replace)?btn("Виправити символи","pg-fix"):"")+
  btn("Підтвердити всю групу","pg-confirm")+btn("Створити нову назву","pg-new")+
  (g.items.length>1?btn("Підтвердити лише 1 запис","pg-one"):"")+'</div>'+
  '<details class="pg-details"><summary>Показати всі входження ('+g.items.length+')</summary>'+
  '<div class="pg-records">'+g.items.map(i=>'<div>'+escape(i.source)+' · '+escape(i.raw)+'</div>').join("")+'</div></details></article>';
}
function view(state){
 const all=groups(state);
 const filtered=all.filter(g=>(state.kindFilter==="all"||g.kind===state.kindFilter)&&
  (!state.filter||[g.raw,kindNames[g.kind],...g.items.map(i=>i.source)].join(" ").toLocaleLowerCase("uk").includes(state.filter.toLocaleLowerCase("uk"))));
 const pending=state.issues.filter(x=>x.status==="pending").length;
 const confirmed=state.issues.filter(x=>x.status==="verified").length;
 return '<div class="pagehead"><div><div class="eyebrow">ASTRA 3.0 · ВЕРИФІКАЦІЯ</div><h1>Чистилище</h1>'+
  '<p class="sub">Групування невідомих назв, підсвічування символів та підтвердження відповідностей. Усі приклади синтетичні.</p></div>'+
  '<div class="actions"><button class="btn" data-action="pg-reset">↻ Скинути приклади</button></div></div>'+
  '<div class="banner"><strong>Локальний прототип.</strong> Ця черга використовує лише демонстраційні назви та не отримує рядків з імпортованих файлів. Рішення й аліаси зникають після перезавантаження сторінки.</div>'+
  '<div class="stats">'+stat("Очікують перевірки",pending,"Входжень","◇",true)+stat("Груп у черзі",all.length,"Однакові значення разом","▤")+
  stat("Підтверджено",confirmed,"Записів у цій сесії","✓")+stat("Нові аліаси",state.aliases.filter(x=>x.active).length,"Запам’ятовані локально","▦")+'</div>'+
  '<div class="panel"><div class="panelhead"><h2>Додати синтетичний приклад</h2><span class="tag info">Без файлів</span></div>'+
  '<div class="pg-add-grid"><label class="formgroup"><span>Поле</span><select id="pg-kind"><option value="station">Станція</option><option value="settlement">Населений пункт</option><option value="action">Тип дії</option></select></label>'+
  '<label class="formgroup"><span>Значення</span><input id="pg-raw" maxlength="100" placeholder="Наприклад, CОКІЛ"></label>'+
  '<label class="formgroup"><span>Контекст для населеного пункту</span><select id="pg-station">'+activeList(state,"station").map(s=>'<option value="'+escape(s.id)+'">'+escape(s.name)+'</option>').join("")+'</select></label>'+
  '<button class="btn primary" data-action="pg-add">Додати до перевірки</button></div>'+
  '<p class="footnote">Не вводь службову інформацію. Порожнє поле не створює завдання.</p></div>'+
  '<div class="panel"><div class="panelhead"><h2>Завдання перевірки</h2><span class="tag">'+filtered.length+' груп</span></div>'+
  '<div class="filt"><input type="search" id="pg-filter" class="field" placeholder="Пошук назви…" value="'+escape(state.filter)+'">'+
  '<select id="pg-kind-filter"><option value="all">Усі типи</option>'+
  Object.keys(kindNames).map(k=>'<option value="'+k+'"'+(k===state.kindFilter?" selected":"")+'>'+escape(kindNames[k])+'</option>').join("")+'</select></div>'+
  (filtered.length?'<div class="pg-grid">'+filtered.map(g=>card(state,g)).join("")+'</div>':
  '<div class="empty">За цими параметрами завдань немає.</div>')+'</div>'+
  '<div class="panel"><div class="panelhead"><h2>Рішення цієї сесії</h2><span class="tag">'+state.decisions.length+'</span></div>'+
  (state.decisions.length?'<div class="pg-records">'+state.decisions.map(d=>
   '<div>'+escape(kindNames[d.kind])+' · <b>'+escape(d.raw)+'</b> → <b>'+escape(d.target)+'</b>'+
   ' · '+escape(d.count)+' записів · '+escape(d.mode==="one"?"індивідуальний виняток":"аліас для групи")+'</div>').join("")+'</div>':
   '<div class="empty">Поки немає підтверджених рішень.</div>')+'</div>';
}
function stat(label,num,hint,icon,highlight){
 return '<div class="stat '+(highlight?"highlight":"")+'"><div class="label">'+escape(label)+'</div>'+
 '<div class="sico">'+icon+'</div><div class="value">'+num+'</div><div class="hint">'+escape(hint)+'</div></div>';
}
const api={kindNames,seed,normal,groups,diagnostics,highlighted,suggestions,correction,correctionWithDigits,
 findKnown,resolve,createCanonical,addDemo,view,matchingGroup};
root.ASTRA_PURGATORY=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
