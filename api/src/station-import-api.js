import {validateStationWorkbook} from "./station-import-validation.js";
import {validateCatalogLinks} from "./station-catalog-integrity.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function stationImportApi(req,user,seg){
 if(user.role!=="admin")return json({error:"Лише адміністратор"},403);
 if(seg.length!==3||seg[2]!=="preview")return json({error:"Невідомий маршрут"},404);
 if(req.method!=="POST")return json({error:"Метод не підтримується"},405);
 if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))return json({error:"Очікується JSON"},415);
 if(Number(req.headers.get("content-length")||0)>262144)return json({error:"Завеликий запит"},413);
 const raw=await req.text();
 if(new TextEncoder().encode(raw).length>262144)return json({error:"Завеликий запит"},413);
 let payload;
 try{payload=JSON.parse(raw);}catch{return json({error:"Некоректний JSON"},400);}
 if(!payload||typeof payload!=="object"||Array.isArray(payload))return json({error:"Очікується об'єкт"},400);
 const {types,bands,stations,states=[]}=payload;
 if(!Array.isArray(types)||!Array.isArray(bands)||!Array.isArray(stations)||!Array.isArray(states)||
    types.length>500||bands.length>1500||stations.length>5000||states.length>15000)
   return json({error:"Некоректні масиви або перевищено ліміти"},400);
 const workbook=validateStationWorkbook({types,bands,stations});
 const links=validateCatalogLinks({models:types.map(t=>({...t,id:String(t.id??"")})),
  antennas:bands.map(b=>({...b,id:String(b.id??b.band_code??""),station_type_id:String(b.station_type_id??"")})),
  stations:stations.map(s=>({...s,id:String(s.id??s.station_code??""),station_type_id:String(s.station_type_id??"")})),
  states});
 return json({valid:workbook.valid&&links.ok,counts:workbook.counts,
  errors:[...workbook.errors,...links.errors],warnings:workbook.warnings,
  committed:false});
}
