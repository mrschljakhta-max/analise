// Private ANALISE contacts: validate all data at the API boundary.
// A DELTA account is an identifier only. Never accept passwords, tokens or credentials.
export const CONTACT_FIELDS=[
 "name","aliases","group_label","phone","whatsapp","signal",
 "delta_account","email","direction","unit_name","duty_role","note",
 "verification_status","source_label","is_active"
];
export const CONTACT_GROUPS=["45 оабр","52 оабр","Корпус","Інше"];
export const CONTACT_MESSENGER=["yes","no","unknown"];
export const CONTACT_VERIFICATION=["unverified","verified","conflict"];
export function contactKeys(value,fields){
 if(!value||typeof value!=="object"||Array.isArray(value)||
  Object.keys(value).length!==fields.length||
  fields.some(k=>!Object.hasOwn(value,k))||
  Object.keys(value).some(k=>!fields.includes(k))){
  throw Error("Некоректний набір полів контакту");
 }
}
export function contactText(v,max,required=false,multiline=false){
 if(typeof v!=="string")throw Error("Текстове поле має бути рядком");
 const s=v.trim().normalize("NFC");
 if(s.length>max||(required&&!s))throw Error("Порожнє або надто довге значення");
 if((multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u:/[\u0000-\u001f\u007f]/u).test(s)){
  throw Error("Поле містить неприпустимі керівні символи");
 }
 return s;
}
export function contactPhone(value){
 let v=contactText(value,30).replace(/[\s().-]/g,"");
 if(!v||v==="—"||v==="-")return "";
 if(v.startsWith("00"))v="+"+v.slice(2);
 if(/^380\d{9}$/.test(v))v="+"+v;
 else if(/^0\d{9}$/.test(v))v="+38"+v;
 if(!/^\+[1-9]\d{6,14}$/.test(v))throw Error("Некоректний номер телефону");
 return v;
}
export function contactEmail(value){
 const v=contactText(value,254).toLowerCase();
 if(!v)return "";
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw Error("Некоректна електронна пошта");
 return v;
}
export function contactNormalize(value){
 const name=contactText(value,160,true).replace(/\s+/gu," ");
 return {name,normalized_name:name.toLocaleLowerCase("uk-UA")
  .replace(/[ʼ’'`]/gu,"").replace(/\s+/gu," ")};
}
export function contactGroup(value){
 const group_label=contactText(value,100,true);
 return {group_label,group_key:group_label.toLocaleLowerCase("uk-UA").replace(/\s+/gu," ")};
}
export function contactEnum(value,list){
 if(!list.includes(value))throw Error("Невідоме значення переліку");
 return value;
}
export function contactRecord(data,editing=false){
 contactKeys(data,editing?[...CONTACT_FIELDS,"code","version"]:CONTACT_FIELDS);
 const normalized=contactNormalize(data.name),group=contactGroup(data.group_label);
 if(data.is_active!==0&&data.is_active!==1)throw Error("Некоректний обліковий стан");
 const row={
  ...normalized,...group,
  aliases:contactText(data.aliases,500,false,true),
  phone:contactPhone(data.phone),
  whatsapp:contactEnum(data.whatsapp,CONTACT_MESSENGER),
  signal:contactEnum(data.signal,CONTACT_MESSENGER),
  delta_account:contactText(data.delta_account,160),
  email:contactEmail(data.email),
  direction:contactText(data.direction,120),
  unit_name:contactText(data.unit_name,160),
  duty_role:contactText(data.duty_role,160),
  note:contactText(data.note,1200,false,true),
  verification_status:contactEnum(data.verification_status,CONTACT_VERIFICATION),
  source_label:contactText(data.source_label,180),
  is_active:data.is_active
 };
 if(editing){
  if(typeof data.code!=="string"||!/^CT-[A-F0-9]{12}$/.test(data.code))throw Error("Некоректний код контакту");
  if(!Number.isSafeInteger(data.version)||data.version<1)throw Error("Некоректна версія");
  row.code=data.code;row.version=data.version;
 }
 return row;
}
