/**
 * FND-004: verify two existing GIS Cloudflare environment inventories and
 * compile ephemeral Wrangler bindings. NO Cloudflare write requests.
 *
 * Never deploy Workers or run SQL here. Generated files are gitignored and
 * are only suitable for an offline Wrangler --dry-run. Access + RBAC gates
 * must be accepted independently before real deployment.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createClient,getInventory,checkInventory,namesFor} from "./cloudflare-provision.mjs";

const ENVS=["dev","staging"];
const root=new URL("../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kvId=/^[a-f0-9]{32}$/i;

export function inspectCloudBindings(inventory,productionWorkerConfig){
 if(typeof productionWorkerConfig!=="string")
  throw Error("Existing ANALISE Worker configuration is required");
 const prodD1=/^database_id\s*=\s*"([^"]+)"/m.exec(productionWorkerConfig)?.[1];
 const prodD1Name=/^database_name\s*=\s*"([^"]+)"/m.exec(productionWorkerConfig)?.[1];
 const prodR2=/^bucket_name\s*=\s*"([^"]+)"/m.exec(productionWorkerConfig)?.[1];
 if(!prodD1||!prodD1Name||!prodR2)
  throw Error("Cannot establish existing ANALISE production resource identities");
 const bindings={};
 for(const env of ENVS){
  const got=checkInventory(inventory,env,{requireExisting:true});
  const expected=namesFor(env);
  for(const kind of ["d1","r2","kv","queue"]){
   if(got[kind]?.name!==expected[kind]||!got[kind]?.id)
    throw Error("Missing valid "+kind+" resource in "+env);
  }
  if(!uuid.test(got.d1.id))throw Error("Invalid GIS D1 ID for "+env);
  if(!kvId.test(got.kv.id))throw Error("Invalid GIS KV ID for "+env);
  if(got.d1.id===prodD1||got.d1.name===prodD1Name)
   throw Error("Production ANALISE D1 binding detected in "+env);
  if(got.r2.name===prodR2)
   throw Error("Production ANALISE R2 binding detected in "+env);
  bindings[env]=got;
 }
 for(const kind of ["d1","r2","kv","queue"]){
  if(bindings.dev[kind].id===bindings.staging[kind].id)
   throw Error("GIS Dev and Staging share "+kind+" resource identity");
 }
 return bindings;
}
export function renderWrangler(environment,bindings,template){
 if(!ENVS.includes(environment))throw Error("Cannot render production or unknown GIS environment");
 const name=namesFor(environment);
 const b=bindings?.[environment];
 if(!b||typeof template!=="string")throw Error("Resource binding audit has not passed");
 for(const kind of ["d1","r2","kv","queue"]){
  if(b[kind]?.name!==name[kind])throw Error("Resource mismatch for "+environment+"/"+kind);
 }
 const keys=[
  [environment.toUpperCase()+"_D1_UUID_REQUIRED",b.d1.id],
  [environment.toUpperCase()+"_KV_ID_REQUIRED",b.kv.id]
 ];
 let output=template;
 for(const [marker,value] of keys){
  const needle='"'+marker+'"';
  if(output.split(needle).length!==2)throw Error("Expected placeholder not found: "+marker);
  output=output.replace(needle,JSON.stringify(value));
 }
 if(/(?:[A-Z]+_D1_UUID_REQUIRED|[A-Z]+_KV_ID_REQUIRED)/.test(output))
  throw Error("Unresolved GIS binding placeholders");
 const required=[
  'name = "analise-gis-'+environment+'"','workers_dev = false',
  'DEPLOY_ENV = "'+environment+'"',
  'database_name = "'+name.d1+'"',
  'bucket_name = "'+name.r2+'"',
  'queue = "'+name.queue+'"',
  'binding = "GIS_DB"','binding = "GIS_R2"',
  'binding = "GIS_KV"','binding = "GIS_QUEUE"'
 ];
 for(const x of required)if(!output.includes(x))throw Error("Incorrect GIS Wrangler template: "+x);
 if(output.includes('database_name = "analise-db"')||
  output.includes('bucket_name = "analise-private-documents"'))
  throw Error("Refusing ANALISE production storage bindings");
 return output;
}
export function safeReport(bindings){
 const result={stage:"FND-004",status:"resource_identities_distinct",worker_deployed:false,
  worker_access_policy_verified:false,production_modified:false,environments:{}};
 for(const env of ENVS){
  const n=namesFor(env);
  result.environments[env]={
   d1:n.d1,r2:n.r2,kv:n.kv,queue:n.queue,
   d1_id_verified:true,kv_id_verified:true
  };
 }
 // Do not emit resource IDs, Authorization headers or any API secrets.
 return result;
}
async function main(){
 const mode=process.env.GIS_BINDINGS_MODE||"audit";
 if(!["audit","bundle"].includes(mode))throw Error("GIS binding mode must be audit or bundle");
 const client=createClient({
  accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_GIS_PROVISION_TOKEN
 });
 const inventory=await getInventory(client);
 const existing=read("../api/wrangler.toml");
 const bindings=inspectCloudBindings(inventory,existing);
 if(mode==="bundle"){
  for(const env of ENVS){
   const template=read("infra/wrangler."+env+".toml.example");
   const content=renderWrangler(env,bindings,template);
   const file=new URL("infra/wrangler."+env+".toml",root);
   writeFileSync(fileURLToPath(file),content,{mode:0o600,flag:"w"});
  }
 }
 const summary=safeReport(bindings);
 console.log("GIS Dev/Staging bindings:",JSON.stringify(summary));
 if(process.env.GITHUB_STEP_SUMMARY){
  const {appendFileSync}=await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
   "### GIS FND-004 · verified binding identities\n"+
   "Distinct D1, R2, KV and Queue IDs across Dev/Staging. "+
   "Production ANALISE D1/R2 are not used.\n\n"+
   "GIS workers **not deployed**. Access/RBAC and runtime isolation still pending.\n");
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(e=>{console.error("GIS bindings audit:",e.message);process.exitCode=1});
}
