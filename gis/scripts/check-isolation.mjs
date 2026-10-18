import {readFileSync} from "node:fs";
const names=["dev","staging","production"];
export function verifyTemplates(templates){
 templates??=Object.fromEntries(names.map(e=>[e,readFileSync(new URL("../infra/wrangler."+e+".toml.example",import.meta.url),"utf8")]));
 const seen=new Set();
 for(const env of names){
  const text=templates[env];if(typeof text!=="string")throw Error("Missing template: "+env);
  for(const value of ['name = "analise-gis-'+env+'"','DEPLOY_ENV = "'+env+'"','workers_dev = false',
   'binding = "GIS_DB"','binding = "GIS_R2"','binding = "GIS_KV"','binding = "GIS_QUEUE"']){
   if(!text.includes(value))throw Error("Template "+env+" missing "+value);
  }
  if(/analise-db|analise-private-documents/.test(text))throw Error("ANALISE production binding leaked into GIS "+env);
  for(const key of ["database_name","database_id","bucket_name","queue"]){
   const match=new RegExp('^'+key+'\\s*=\\s*"([^"]+)"','m').exec(text);
   if(!match)throw Error(key+" missing: "+env);
   const value=match[1];
   if(!value.toLowerCase().includes(env))throw Error("Misbound "+key+" in "+env);
   if(seen.has(key+":"+value))throw Error("Cross-env resource reuse: "+key);
   seen.add(key+":"+value);
  }
 }
 return true;
}
if(process.argv[1] && import.meta.url===new URL("file://"+process.argv[1]).href){
 verifyTemplates();console.log("PASS GIS environment templates (NOT actual cloud resource isolation)");
}
