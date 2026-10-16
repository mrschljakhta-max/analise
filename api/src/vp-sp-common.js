// Non-operational VP/SP name directory helpers. No location or unit fields.
export const vpNormalizeName=raw=>{
  if(typeof raw!=="string")throw Error("Назва має бути текстом");
  if(/[\u0000-\u001f\u007f]/u.test(raw))throw Error("Некоректні символи в назві");
  let name=raw.trim().replace(/\s+/gu," ");
  if(/^ВП$/iu.test(name))throw Error("Відсутня назва ВП");
  name=name.replace(/^ВП(?:[\s.:–—-])+/iu,"").trim();
  if(/^матє$/iu.test(name))name="Мате";
  if(!name||name.length>160||/[\u0000-\u001f\u007f]/u.test(name)){
    throw Error("Назва відсутня або має некоректні символи");
  }
  const comparable=name.normalize("NFC").toLocaleLowerCase("uk-UA")
    .replace(/[ʼ’'\x60]/gu,"").replace(/\s+/gu," ").trim();
  if(["обєкт прикриття","інше","невідомо","не встановлено"].includes(comparable)){
    throw Error("Загальний запис без власної назви не можна додати як окрему ВП");
  }
  return {name,normalized_name:comparable};
};
export const vpKind=value=>{
  if(value!=="vp"&&value!=="sp")throw Error("Потрібен тип ВП або СП");
  return value;
};
export const vpActive=value=>{
  if(value!==0&&value!==1)throw Error("Стан обліку: 0 або 1");
  return value;
};
export const vpFields=(v,fields)=>{
  if(!v||typeof v!=="object"||Array.isArray(v)||
    Object.keys(v).length!==fields.length||fields.some(k=>!Object.hasOwn(v,k))||
    Object.keys(v).some(k=>!fields.includes(k))){
    throw Error("Некоректний набір полів (координати та підрозділи не приймаються)");
  }
};
export const vpVersion=v=>{
  if(!Number.isSafeInteger(v)||v<1)throw Error("Некоректна версія запису");
  return v;
};
export const vpCode=v=>{
  if(typeof v!=="string"||!/^(VP|SP)-[A-F0-9]{12}$/u.test(v)){
    throw Error("Некоректний код запису");
  }
  return v;
};
