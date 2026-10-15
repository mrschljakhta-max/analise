// Read-only administrative inventory comparison. No station positions or workbook data are sent.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
export async function stationCompareApi(req,env,user){
 if(user.role!=="admin")return json({error:"Лише адміністратор"},403);
 if(req.method!=="GET")return json({error:"Дозволено лише GET"},405);
 if(!env.DB)return json({error:"D1 недоступна"},503);
 try{
  const names=["station_types","station_type_antennas","stations"];
  const found=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('station_types','station_type_antennas','stations')").all();
  const present=new Set((found.results||[]).map(x=>x.name));
  if(names.some(n=>!present.has(n)))return json({ready:false,missing:names.filter(n=>!present.has(n)),committed:false},409);
  const [types,bands,stations]=await Promise.all([
   env.DB.prepare("SELECT import_code,type_code,name FROM station_types LIMIT 10000").all(),
   env.DB.prepare("SELECT band_code FROM station_type_antennas LIMIT 10000").all(),
   env.DB.prepare("SELECT station_code FROM stations LIMIT 10000").all()
  ]);
  return json({ready:true,types:types.results||[],bands:bands.results||[],stations:stations.results||[],committed:false});
 }catch(e){return json({error:"Не вдалося прочитати довідники D1",detail:String(e?.message||"").slice(0,180),committed:false},503);}
}
