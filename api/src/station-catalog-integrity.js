// Administrative catalog validation. Does not process locations or deployment data.
export function validateCatalogLinks({models=[],antennas=[],stations=[],states=[]}={}){
 const errors=[];
 const byModel=new Map(models.map(x=>[x.id,x]));
 const byAntenna=new Map(antennas.map(x=>[x.id,x]));
 const byStation=new Map(stations.map(x=>[x.id,x]));
 const seen=new Set();
 for(const a of antennas){
  const model=byModel.get(a.station_type_id);
  if(!model){errors.push({code:"UNKNOWN_MODEL",record:a.id});continue;}
  if(a.mode==="detect"&&!Boolean(model.can_detect))errors.push({code:"DETECT_DISABLED",record:a.id});
  if(a.mode==="jam"&&!Boolean(model.can_jam))errors.push({code:"JAM_DISABLED",record:a.id});
  const key=a.station_type_id+"|"+a.antenna_kind;
  if(seen.has(key))errors.push({code:"DUPLICATE_KIND",record:a.id});
  seen.add(key);
 }
 const pairs=new Set();
 for(const state of states){
  const station=byStation.get(state.station_id),antenna=byAntenna.get(state.type_antenna_id);
  if(!station||!antenna){errors.push({code:"MISSING_REFERENCE",record:state.station_id});continue;}
  if(station.station_type_id!==antenna.station_type_id)errors.push({code:"MODEL_MISMATCH",record:state.station_id});
  const pair=state.station_id+"|"+state.type_antenna_id;
  if(pairs.has(pair))errors.push({code:"DUPLICATE_STATE",record:state.station_id});
  pairs.add(pair);
 }
 return {ok:errors.length===0,errors};
}
