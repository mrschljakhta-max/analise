import test from 'node:test';
import assert from 'node:assert/strict';
import {stationModelsApi} from '../src/station-models-api.js';
import {
  STATION_MODELS_HTML,STATION_MODELS_CSS,STATION_MODELS_JS
} from '../src/station-models-assets.js';

const user={id:'test-admin',role:'admin',active:1};
const seg=mode=>['api','station-models',mode];
const url=mode=>'https://example.test/api/station-models/'+mode;
const body={
  code:'MODEL-001',expected_updated_at:'2026-10-16 09:00:00',
  name:'  Модель  Тест  ',category:' Тестова  категорія ',
  note:'Редакційна примітка',is_active:1
};
const patch=(obj=body,headers={})=>new Request(url('card'),{
  method:'PATCH',headers:{'Content-Type':'application/json',...headers},
  body:JSON.stringify(obj)
});
function mockDatabase({changed=1,existing=true,auditReady=true,auditMissing=false}={}){
  const queries=[],params=[];
  const env={DB:{prepare(sql){
    queries.push(sql);
    if(sql.includes("FROM sqlite_master WHERE type='trigger'")){
      return {first:async()=>auditReady?{name:'station_model_audit_after_update'}:null};
    }
    if(sql.startsWith('UPDATE station_types')){
      return {bind(...values){params.push(...values);return{
        run:async()=>({meta:{changes:changed}})
      }}};
    }
    if(sql.includes('FROM station_types st WHERE st.import_code=?')){
      return {bind(code){params.push(code);return {
        first:async()=>existing?{
          import_code:code,type_code:'TYPE-001',name:'Модель',category:'Тест',
          note:'',is_active:1,updated_at:'2026-10-16 09:00:00',
          station_count:5,profile_count:2
        }:null
      }}};
    }
    if(sql.startsWith('SELECT antenna_kind,is_active FROM station_type_antennas')){
      return {bind(code){params.push(code);return {all:async()=>({results:[
        {antenna_kind:'directional_jam',is_active:1}
      ]})}}};
    }
    if(sql.includes('FROM station_model_audit')){
      return {bind(code){params.push(code);return {all:async()=>{
        if(auditMissing)throw Error('D1_ERROR: no such table: station_model_audit');
        return {results:[{
          changed_at:'2026-10-16 08:05:00',
          old_name:'Модель',new_name:'Модель',
          old_category:'Тест',new_category:'Тест',
          old_note:'',new_note:'Тестове редагування',
          old_is_active:1,new_is_active:1
        }]};
      }}}};
    }
    if(sql.includes('FROM station_types st ORDER BY')){
      return {all:async()=>({results:[{
        import_code:'MODEL-001',type_code:'TYPE-001',name:'Модель',category:'Тест',
        is_active:1,updated_at:'2026-10-16 09:00:00',
        station_count:5,profile_count:2
      }]})};
    }
    throw Error('Unexpected SQL: '+sql);
  }}};
  return {env,queries,params};
}

test('model catalog lists record counts from existing station and model tables',async()=>{
  const db=mockDatabase();
  const res=await stationModelsApi(new Request(url('data')),db.env,user,seg('data'));
  assert.equal(res.status,200);
  const payload=await res.json();
  assert.equal(payload.items[0].station_count,5);
  assert.equal(payload.items[0].profile_count,2);
  assert.equal(payload.truncated,false);
  assert.deepEqual(db.params,[]);
  assert.ok(db.queries.every(q=>q.trimStart().startsWith('SELECT')));
});
test('catalog card reads model administrative metadata only',async()=>{
  const db=mockDatabase();
  const res=await stationModelsApi(new Request(url('card')+'?code=MODEL-001'),db.env,user,seg('card'));
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.model.import_code,'MODEL-001');
  assert.equal(data.model.station_count,5);
  assert.equal(data.model.profile_count,2);
  assert.deepEqual(data.profiles,[{antenna_kind:'directional_jam',is_active:1}]);
  assert.doesNotMatch(JSON.stringify(data),/freq_from_mhz|radius_km|latitude|longitude|mgrs|operational_status/);
  assert.ok(db.queries.every(q=>q.trimStart().startsWith('SELECT')));
});
test('model administrative edits leave model codes and station relationships untouched',async()=>{
  const db=mockDatabase();
  const res=await stationModelsApi(patch(),db.env,user,seg('card'));
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.saved,true);
  assert.equal(data.code,'MODEL-001');
  assert.equal(db.queries.length,2);
  assert.match(db.queries[0],/SELECT name FROM sqlite_master/);
  assert.match(db.queries[1],/^UPDATE station_types SET name=/);
  assert.match(db.queries[1],/WHERE import_code=\? AND updated_at=\?/);
  assert.doesNotMatch(db.queries[1],/\b(DELETE|INSERT|DROP|ALTER)\b|station_location_history|\bstations\b|freq_from_mhz|radius_km/);
  assert.equal(db.params[0],'Модель Тест');
  assert.equal(db.params[1],'модель тест');
  assert.equal(db.params[2],'Тестова категорія');
  assert.equal(db.params[3],'Редакційна примітка');
  assert.deepEqual(db.params.slice(-2),['MODEL-001','2026-10-16 09:00:00']);
});
test('concurrent model edits return conflict instead of replacing another edit',async()=>{
  const db=mockDatabase({changed:0});
  const res=await stationModelsApi(patch(),db.env,user,seg('card'));
  assert.equal(res.status,409);
});
test('invalid model updates do not reach D1',async()=>{
  for(const changes of [
    {freq_from_mhz:360},
    {can_detect:1},
    {type_code:'NEW-CODE'},
    {name:'  '},
    {category:''},
    {is_active:'1'},
    {note:'z'.repeat(2001)},
    {code:'BAD CODE'},
    {expected_updated_at:''}
  ]){
    const db=mockDatabase();
    const res=await stationModelsApi(patch({...body,...changes}),db.env,user,seg('card'));
    assert.equal(res.status,400,JSON.stringify(changes));
    assert.equal(db.queries.length,0);
  }
});
test('model edits require administrator and same-origin request',async()=>{
  const db=mockDatabase();
  const denied=await stationModelsApi(patch(),db.env,{role:'viewer'},seg('card'));
  assert.equal(denied.status,403);
  const external=await stationModelsApi(patch(body,{'origin':'https://elsewhere.example'}),db.env,user,seg('card'));
  assert.equal(external.status,403);
  assert.equal(db.queries.length,0);
});
test('model directory limits HTTP methods and responds correctly when data is absent',async()=>{
  const db=mockDatabase({existing:false});
  const missing=await stationModelsApi(new Request(url('card')+'?code=UNKNOWN'),db.env,user,seg('card'));
  assert.equal(missing.status,404);
  assert.equal((await stationModelsApi(new Request(url('card')),db.env,user,seg('card'))).status,400);
  assert.equal((await stationModelsApi(new Request(url('data'),{method:'POST'}),db.env,user,seg('data'))).status,405);
  assert.equal((await stationModelsApi(new Request(url('data')),{},{role:'admin'},seg('data'))).status,503);
});
test('model directory includes accessible editing form and valid client-side JS',()=>{
  for(const id of ['search','category','active','rows','card','overview','fields',
    'edit','edit-form','edit-name','edit-category','edit-note','edit-active','save','cancel']){
    assert.ok(STATION_MODELS_HTML.includes('id="'+id+'"'),id);
  }
  assert.match(STATION_MODELS_JS,/hasChanges/);
  assert.match(STATION_MODELS_JS,/expected_updated_at/);
  assert.match(STATION_MODELS_JS,/method:'PATCH'/);
  assert.match(STATION_MODELS_JS,/confirm\(/);
  assert.match(STATION_MODELS_CSS,/#card\[open\].*display:flex/);
  assert.doesNotThrow(()=>new Function(STATION_MODELS_JS));
});


test('history endpoint returns real administrative before/after values',async()=>{
  const db=mockDatabase();
  const response=await stationModelsApi(
    new Request(url('history')+'?code=MODEL-001'),db.env,user,seg('history'));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.history_available,true);
  assert.equal(data.items.length,1);
  assert.equal(data.items[0].new_note,'Тестове редагування');
  assert.equal(data.items[0].old_note,'');
  assert.match(db.queries[0],/FROM station_model_audit/);
  assert.match(db.queries[0],/ORDER BY id DESC LIMIT 101/);
  assert.ok(db.queries.every(q=>q.trimStart().startsWith('SELECT')));
});

test('history view states explicitly if migration has not been applied',async()=>{
  const db=mockDatabase({auditMissing:true});
  const response=await stationModelsApi(
    new Request(url('history')+'?code=MODEL-001'),db.env,user,seg('history'));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    history_available:false,items:[],truncated:false
  });
});

test('model editing is blocked if the audit trigger has not been migrated',async()=>{
  const db=mockDatabase({auditReady:false});
  const response=await stationModelsApi(patch(),db.env,user,seg('card'));
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/міграцію/);
  assert.equal(db.queries.length,1);
  assert.ok(db.queries[0].includes('sqlite_master'));
});

test('model directory tabs preserve editing and expose actual audit only after migration',()=>{
  for(const name of ['general','passport','history']){
    assert.match(STATION_MODELS_HTML,new RegExp('id="tab-'+name+'"'));
    assert.match(STATION_MODELS_HTML,new RegExp('id="panel-'+name+'"'));
  }
  assert.match(STATION_MODELS_HTML,/role="tablist"/);
  assert.match(STATION_MODELS_HTML,/aria-controls="panel-history"/);
  assert.match(STATION_MODELS_JS,/function activateTab\(/);
  assert.match(STATION_MODELS_JS,/state\.editing&&!cancelEdit\(\)/);
  assert.match(STATION_MODELS_JS,/loadHistory\(state\.model\.import_code\)/);
  assert.match(STATION_MODELS_JS,/\/api\/station-models\/history\?code=/);
  assert.match(STATION_MODELS_JS,/state\.historyLoaded=false/);
  assert.match(STATION_MODELS_CSS,/#card \.card-tabs button\[aria-selected="true"\]/);
});
