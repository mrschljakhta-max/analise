import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {stationImportWriteApi} from "../src/station-import-write-api.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const base="/api/station-import";
const segments=mode=>["api","station-import",mode];
const admin={role:"admin"};
function sample(org_ref="UNIT-TEST",org_name="Тестовий відділ"){
  return {
    types:[{import_code:"TYPE-001",type_code:"T-001",name:"Тестова модель",
      normalized_name:"тестова модель",category:"тест",can_detect:0,can_jam:1,is_active:1,note:""}],
    bands:[{band_code:"B-001",type_import_code:"TYPE-001",antenna_kind:"omni_jam",
      mode:"jam",freq_from_mhz:100,freq_to_mhz:200,radius_km:1,coverage_type:"omni",
      width_deg:360,is_active:1}],
    stations:[{station_code:"S-001",call_sign:"Станція А",type_import_code:"TYPE-001",
      org_ref,org_name,is_active:1}],org_mapping:[]
  };
}
function stubDb(){
  const data={
    station_types:[],station_type_antennas:[],stations:[],
    org_units:[{id:"org-uuid-1",import_key:"UNIT-TEST",unit_code:"TEST",short_name:"Тестовий відділ",
      full_name:"Тестовий відділ",is_active:1}]
  };
  const writes=[];
  const db={
    prepare(sql){
      const match=sql.match(/(?:FROM|INTO)\s+(station_types|station_type_antennas|stations|org_units)\b/i);
      const table=match?.[1];assert.ok(table,sql);
      if(/^\s*SELECT/i.test(sql))return {all:async()=>({results:[...data[table]]})};
      assert.match(sql,/^\s*INSERT INTO /i);
      return {bind(...args){return {sql,table,args}}};
    },
    async batch(statements){
      // Stand-in for atomic, transactional D1 batch.
      for(const statement of statements){
        assert.match(statement.sql,/^\s*INSERT INTO /i);
        writes.push(statement);
      }
      data.station_types.push({import_code:"TYPE-001",type_code:"T-001"});
      data.station_type_antennas.push({band_code:"B-001"});
      data.stations.push({station_code:"S-001"});
      return statements.map(()=>({success:true}));
    }
  };
  return {DB:db,data,writes};
}
const post=(mode,payload)=>new Request("https://test.invalid"+base+"/"+mode,{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)
});
const get=(mode)=>new Request("https://test.invalid"+base+"/"+mode);
const call=async(mode,env,body,user=admin)=>
  stationImportWriteApi(post(mode,body),env,user,segments(mode));

test("read-only listing offers existing unit ids",async()=>{
  const env=stubDb(),r=await stationImportWriteApi(get("org-units"),env,admin,segments("org-units"));
  assert.equal(r.status,200);
  assert.equal((await r.json()).items[0].id,"org-uuid-1");
  assert.equal(env.writes.length,0);
});
test("reject unauthorised mutation",async()=>{
  const r=await call("commit",stubDb(),{payload:sample()},{role:"viewer"});
  assert.equal(r.status,403);
});
test("prepare previews, maps existing unit and never writes",async()=>{
  const env=stubDb(),r=await call("prepare",env,{payload:sample()});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.ok,true);
  assert.deepEqual(data.counts,{models:1,bands:1,stations:1,unassigned:0});
  assert.match(data.fingerprint,/^[0-9a-f]{64}$/);
  assert.equal(env.writes.length,0);
});
test("reject coordinates or unknown operational fields",async()=>{
  const env=stubDb(),p=sample();p.stations[0].mgrs="test";
  const r=await call("prepare",env,{payload:p});
  assert.equal(r.status,422);
  assert.equal(env.writes.length,0);
});
test("unresolved unit blocks preview",async()=>{
  const env=stubDb();
  const r=await call("prepare",env,{payload:sample("UNKNOWN-ORG","")});
  assert.equal(r.status,422);
  assert.equal((await r.json()).ok,false);
});
test("explicit unit assignment and separate commit confirmation",async()=>{
  const env=stubDb(),payload=sample("LEGACY-CODE","Legacy");
  payload.org_mapping=[{ref:"LEGACY-CODE",id:"org-uuid-1"}];
  const preview=await call("prepare",env,{payload});
  assert.equal(preview.status,200);
  const fingerprint=(await preview.json()).fingerprint;
  const noConfirm=await call("commit",env,{payload,fingerprint});
  assert.equal(noConfirm.status,409);
  assert.equal(env.writes.length,0);
  const changed=sample("LEGACY-CODE","Legacy");
  changed.org_mapping=[{ref:"LEGACY-CODE",id:"org-uuid-1"}];
  changed.stations[0].call_sign="Змінена станція";
  assert.equal((await call("commit",env,{payload:changed,fingerprint,confirm:"IMPORT_NEW_ONLY"})).status,409);
  assert.equal(env.writes.length,0);
  const committed=await call("commit",env,{payload,fingerprint,confirm:"IMPORT_NEW_ONLY"});
  assert.equal(committed.status,200);
  assert.equal((await committed.json()).committed,true);
  assert.equal(env.writes.length,3);
  assert.deepEqual(env.writes.map(w=>w.table),
    ["station_types","station_type_antennas","stations"]);
  assert.equal(env.writes[2].args[4],"org-uuid-1");
  assert.equal((await call("commit",env,{payload,fingerprint,confirm:"IMPORT_NEW_ONLY"})).status,409);
  assert.equal(env.writes.length,3);
});
test("blank org assignment remains explicitly unassigned",async()=>{
  const env=stubDb(),payload=sample("","");
  const response=await call("prepare",env,{payload});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.counts.unassigned,1);
  assert.equal(data.warnings.length,1);
});
test("invalid band shape is rejected before commit",async()=>{
  const env=stubDb(),payload=sample();
  payload.bands[0].width_deg=45;
  const r=await call("prepare",env,{payload});
  assert.equal(r.status,422);
  assert.equal(env.writes.length,0);
});
test("existing model code cannot overwrite an existing model",async()=>{
  const env=stubDb();
  env.data.station_types.push({import_code:"OTHER",type_code:"T-001"});
  const r=await call("prepare",env,{payload:sample()});
  assert.equal(r.status,422);
  assert.equal(env.writes.length,0);
});
