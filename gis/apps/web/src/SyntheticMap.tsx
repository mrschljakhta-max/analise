import {useEffect,useRef} from "react";
import maplibregl from "maplibre-gl";
/** Offline, neutral synthetic geometry. This page never requests ANALISE data or basemap tiles. */
const style: maplibregl.StyleSpecification={
 version:8,
 name:"Synthetic blank map",
 sources:{"demo-points":{type:"geojson",data:{type:"FeatureCollection",features:[
   {type:"Feature",properties:{name:"Fixture A"},geometry:{type:"Point",coordinates:[-9.15,38.72]}},
   {type:"Feature",properties:{name:"Fixture B"},geometry:{type:"Point",coordinates:[-9.1,38.74]}}
 ]}}},
 layers:[
  {id:"background",type:"background",paint:{"background-color":"#102838"}},
  {id:"demo-circles",type:"circle",source:"demo-points",paint:{"circle-radius":9,"circle-color":"#5de0c1","circle-stroke-width":2,"circle-stroke-color":"#effffc"}}
 ]
};
export function SyntheticMap(){
 const mount=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!mount.current)return;
  const map=new maplibregl.Map({container:mount.current,style,center:[-9.13,38.73],zoom:10,attributionControl:false});
  map.addControl(new maplibregl.NavigationControl(),"top-right");
  return ()=>map.remove();
 },[]);
 return <div className="map-surface" ref={mount} role="img" aria-label="Синтетична карта з двома умовними маркерами"/>;
}
