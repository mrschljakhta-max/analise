import test from 'node:test';
import assert from 'node:assert/strict';
import {stationDirectoryApi} from '../src/station-directory-api.js';
import {STATION_DIRECTORY_HTML,STATION_DIRECTORY_JS,STATION_DIRECTORY_CSS}
  from '../src/station-directory-assets.js';

const admin={role:'admin',active:1};
const route=['api','station-directory','history'];
const base='https://example.test/api/station-directory/history?code=ST-TEST';
const event={
  changed_at:'2026-10-16 09:05:00',
  old_call_sign:'Стара назва',new_call_sign:'Нова назва',
  old_org_unit_label:'Підрозділ А',new_org_unit_label:'Підрозділ Б',
  old_is_active:1,new_is_active:0
};
function mock({found=true,unmigrated=false,events=[event]}={}){
  const queries=[];
  const db={DB:{prepare(sql){
    queries.push(sql);
    if(sql.includes('SELECT id FROM stations')){
      return {bind:()=>({first:async()=>found?{id:'id-1'}:null})};
    }
    if(sql.includes('FROM station_accounting_audit')){
      return {bind:()=>({all:async()=>{
        if(unmigrated)throw Error('D1_ERROR: no such table: station_accounting_audit');
        return {results:events};
      }})};
    }
    throw Error('Unexpected SQL');
  }}};
  return {db,queries};
}
test('audit history is admin-only and read-only',async()=>{
  const m=mock();
  assert.equal((await stationDirectoryApi(new Request(base),m.db,{role:'viewer'},route)).status,403);
  assert.equal((await stationDirectoryApi(new Request(base,{method:'POST'}),m.db,admin,route)).status,405);
  assert.equal(m.queries.length,0);
});
test('history returns actual old/new accounting fields, newest first',async()=>{
  const m=mock();
  const response=await stationDirectoryApi(new Request(base),m.db,admin,route);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(body,{history_available:true,items:[event],truncated:false});
  assert.match(m.queries[1],/ORDER BY id DESC LIMIT 101/);
  assert.ok(m.queries.every(sql=>sql.trimStart().startsWith('SELECT')));
  assert.doesNotMatch(m.queries.join('\n'),/station_location_history|deployment_status|operational_status/);
});
test('history distinguishes migration pending, unknown station and bad code',async()=>{
  const old=mock({unmigrated:true});
  assert.deepEqual(await (await stationDirectoryApi(new Request(base),old.db,admin,route)).json(),
    {history_available:false,items:[],truncated:false});
  const missing=mock({found:false});
  assert.equal((await stationDirectoryApi(new Request(base),missing.db,admin,route)).status,404);
  assert.equal(missing.queries.length,1);
  assert.equal((await stationDirectoryApi(
    new Request('https://example.test/api/station-directory/history?code=%20'),
    missing.db,admin,route)).status,400);
});
test('history endpoint caps displayed events to 100 records',async()=>{
  const m=mock({events:Array.from({length:101},()=>event)});
  const body=await (await stationDirectoryApi(new Request(base),m.db,admin,route)).json();
  assert.equal(body.items.length,100);
  assert.equal(body.truncated,true);
});
test('station administrative edits require the D1 audit trigger',async()=>{
  const env={DB:{prepare(sql){
    assert.match(sql,/station_accounting_audit_after_update/);
    return {first:async()=>null};
  }}};
  const response=await stationDirectoryApi(new Request('https://example.test/api/station-directory/card',{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({code:'ST-TEST',expected_updated_at:'2026-10-16 09:00:00',
      call_sign:'Demo',org_unit_id:null,is_active:1})
  }),env,admin,['api','station-directory','card']);
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/міграцію/);
});
test('station history tab is scrollable and renders values as text',()=>{
  assert.match(STATION_DIRECTORY_HTML,/Історія змін станції/);
  assert.match(STATION_DIRECTORY_JS,/function loadStationHistory\(/);
  assert.match(STATION_DIRECTORY_JS,/station-directory\/history\?code=/);
  assert.match(STATION_DIRECTORY_JS,/oldValue\.textContent=/);
  assert.match(STATION_DIRECTORY_JS,/newValue\.textContent=/);
  assert.match(STATION_DIRECTORY_JS,/historyState\.generation\+\+/);
  assert.match(STATION_DIRECTORY_CSS,/#history-details \.station-history-entry/);
  assert.doesNotThrow(()=>new Function(STATION_DIRECTORY_JS));
});
