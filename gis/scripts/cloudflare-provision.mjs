/** GIS Dev / Staging only. No Workers, migrations, production reads, or deletes. */
const apiHost='https://api.cloudflare.com/client/v4';
const kinds=['d1','r2','kv','queue'];
const endpoints={d1:'/d1/database',r2:'/r2/buckets',kv:'/storage/kv/namespaces',queue:'/queues'};
const field={d1:['name','uuid'],r2:['name','name'],kv:['title','id'],queue:['queue_name','queue_id']};
export function namesFor(env){
 if(!['dev','staging'].includes(env))throw Error('Only dev or staging may be provisioned');
 return {d1:'analise-gis-'+env+'-db',r2:'analise-gis-'+env+'-geodata',kv:'analise-gis-'+env+'-cache',queue:'analise-gis-'+env+'-jobs'};
}
export function createClient({accountId,token,fetchImpl=fetch}){
 if(!/^[a-f0-9]{32}$/i.test(accountId||''))throw Error('Invalid Cloudflare account ID');
 if(typeof token!=='string'||token.length<20)throw Error('Missing dedicated GIS provision token');
 const base=apiHost+'/accounts/'+accountId;
 async function call(method,endpoint,payload){
  if(!['GET','POST'].includes(method)||!kinds.some(k=>endpoint.split('?')[0]===endpoints[k]))throw Error('Cloudflare operation not allowlisted');
  const response=await fetchImpl(base+endpoint,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json',...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
  let body;try{body=await response.json()}catch{}
  if(!response.ok||body?.success!==true){
   const code=Number(body?.errors?.[0]?.code);
   throw Error('Cloudflare HTTP '+response.status+(Number.isSafeInteger(code)?' (error '+code+')':''));
  }
  return body;
 }
 async function list(kind){
  if(!kinds.includes(kind))throw Error('Unknown resource kind');
  const all=[];let cursor=null;
  for(let page=1;page<=50;page++){
   const params=new URLSearchParams();
   if(kind==='r2'){if(cursor)params.set('cursor',cursor)}
   else{params.set('page',String(page));params.set('per_page','100')}
   const data=await call('GET',endpoints[kind]+'?'+params);
   const values=kind==='r2'?data.result?.buckets:
    kind==='queue'?(Array.isArray(data.result)?data.result:data.result?.queues):data.result;
   if(!Array.isArray(values))throw Error('Incomplete Cloudflare inventory: '+kind);
   all.push(...values);
   if(kind==='r2'){
    const next=data.result?.cursor||data.result_info?.cursor||null;
    if(!next)return all;
    if(next===cursor)throw Error('Unchanged R2 cursor');
    cursor=next;
   }else{
    if(Number.isInteger(data.result_info?.total_pages)&&page>=data.result_info.total_pages)return all;
    if(values.length<100)return all;
   }
  }
  throw Error('Cloudflare inventory pagination limit exceeded');
 }
 return {call,list};
}
export async function getInventory(client){
 const result={};
 for(const kind of kinds){
  const [name,id]=field[kind];
  result[kind]=(await client.list(kind)).map(x=>({name:x[name],id:x[id]}));
 }
 return result;
}
export function checkInventory(inventory,env,{requireExisting=false,requireAbsent=false}={}){
 const desired=namesFor(env),other=namesFor(env==='dev'?'staging':'dev'),found={};
 for(const kind of kinds){
  const rows=inventory[kind];
  if(!Array.isArray(rows)||rows.some(r=>typeof r.name!=='string'||typeof r.id!=='string'||!r.id))throw Error('Invalid resource inventory: '+kind);
  const ours=rows.filter(r=>r.name===desired[kind]);
  const theirs=rows.filter(r=>r.name===other[kind]);
  if(ours.length>1||theirs.length>1)throw Error('Duplicate resource names for '+kind);
  if(ours.length&&theirs.length&&ours[0].id===theirs[0].id)throw Error('Dev/Staging share '+kind+' identity');
  if(requireExisting&&!ours.length)throw Error('Missing '+kind+' in '+env);
  if(requireAbsent&&ours.length)throw Error('Existing '+kind+' found in '+env+'; refusing to overwrite or adopt; use verify');
  found[kind]=ours[0]||null;
 }
 return found;
}
export async function execute(client,env,operation,confirm=''){
 const names=namesFor(env);
 if(!['plan','verify','create'].includes(operation))throw Error('Invalid operation');
 if(operation==='plan')return {environment:env,status:'offline_plan',names};
 if(operation==='create'&&confirm!=='CREATE_GIS_'+env.toUpperCase())throw Error('Exact confirmation is required');
 const before=await getInventory(client);
 const found=checkInventory(before,env,operation==='create'?{requireAbsent:true}:{requireExisting:true});
 if(operation==='verify')return {environment:env,status:'verified',names,found};
 const payloads={d1:{name:names.d1},r2:{name:names.r2},kv:{title:names.kv},queue:{queue_name:names.queue}};
 const created=[];
 try{
  for(const kind of kinds){await client.call('POST',endpoints[kind],payloads[kind]);created.push(kind)}
 }catch(e){throw Error('Partial provisioning for '+env+'; created '+created.join(',')+'. Do not delete automatically; reconcile manually. '+e.message)}
 const after=await getInventory(client);
 return {environment:env,status:'created_and_verified',names,found:checkInventory(after,env,{requireExisting:true})};
}
export function safeSummary(result){return {environment:result.environment,status:result.status,names:result.names,workerDeployed:false,d1MigrationsApplied:false,productionModified:false}}
async function main(){
 const env=process.env.GIS_TARGET_ENV||'dev',operation=process.env.GIS_OPERATION||'plan';
 namesFor(env);
 const client=operation==='plan'?null:createClient({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_GIS_PROVISION_TOKEN});
 const result=await execute(client,env,operation,process.env.GIS_CONFIRM||'');
 const summary=safeSummary(result);
 console.log('GIS Cloudflare:',JSON.stringify(summary));
 if(process.env.GITHUB_STEP_SUMMARY){
  const {appendFileSync}=await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,'### GIS '+env+': '+summary.status+'\n'+Object.entries(summary.names).map(([k,v])=>'- '+k+': '+v).join('\n')+'\nNo GIS Worker deployment, SQL migration, or production resource modification.\n');
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1});
