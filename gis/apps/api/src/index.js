// Isolated GIS API skeleton, NOT routed or deployed by ANALISE.
// Rejects all workspace/data requests until JWT and workspace memberships are implemented.
const headers={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff"};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(request.method==="GET" && path==="/_health"){
  return json({component:"map-studio",state:"not_provisioned",environment:env.DEPLOY_ENV||"local"});
 }
 return json({error:"GIS API disabled pending workspace authorization and isolated Cloudflare resources"},503);
}};
