import test from 'node:test';
import assert from 'node:assert/strict';
import {stationDirectoryApi} from '../src/station-directory-api.js';
import {STATION_DIRECTORY_HTML,STATION_DIRECTORY_CSS,STATION_DIRECTORY_JS} from '../src/station-directory-assets.js';

const url='https://example.test/api/station-directory/data';
const req=method=>new Request(url,{method});
const segments=['api','station-directory','data'];
const user={role:'admin'};
const json=async response=>response.json();

test('station directory is admin-only',async()=>{
  const response=await stationDirectoryApi(req('GET'),{}, {role:'viewer'},segments);
  assert.equal(response.status,403);
});

test('station directory has no write method',async()=>{
  const response=await stationDirectoryApi(req('POST'),{},user,segments);
  assert.equal(response.status,405);
});

test('station directory only serves /data',async()=>{
  const response=await stationDirectoryApi(req('GET'),{},user,['api','station-directory','other']);
  assert.equal(response.status,404);
});

test('station directory fails safely without database',async()=>{
  const response=await stationDirectoryApi(req('GET'),{},user,segments);
  assert.equal(response.status,503);
});

test('station directory returns administrative fields, with no mutation',async()=>{
  let calls=0;
  const result={
    station_code:'ST-TEST-001',call_sign:'Тестова станція',is_active:1,
    updated_at:'2026-01-01 12:00:00',station_type:'Модель A',
    type_code:'TYPE-A',org_unit:'Тестовий підрозділ'
  };
  const env={DB:{prepare(sql){
    calls++;
    assert.match(sql,/FROM stations s/);
    assert.match(sql,/JOIN station_types st/);
    assert.match(sql,/LEFT JOIN org_units ou/);
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
    assert.doesNotMatch(sql,/station_location_history|deployment_status|operational_status/i);
    return {all:async()=>({results:[result]})};
  }}};
  const response=await stationDirectoryApi(req('GET'),env,user,segments);
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(calls,1);
  assert.deepEqual(await json(response),{items:[result],truncated:false});
});

test('station directory empty database is valid',async()=>{
  const env={DB:{prepare:()=>({all:async()=>({results:[]})})}};
  const response=await stationDirectoryApi(req('GET'),env,user,segments);
  assert.deepEqual(await json(response),{items:[],truncated:false});
});

test('station directory never returns more than 5000 records',async()=>{
  const rows=Array.from({length:5001},(_,i)=>({station_code:'ST-'+i}));
  const env={DB:{prepare:()=>({all:async()=>({results:rows})})}};
  const response=await stationDirectoryApi(req('GET'),env,user,segments);
  const body=await json(response);
  assert.equal(body.items.length,5000);
  assert.equal(body.truncated,true);
});

const cardUrl='https://example.test/api/station-directory/card?code=ST-0001';
const cardSegment=['api','station-directory','card'];
function detailDb(){
  const station={
    station_code:'ST-0001',call_sign:'Тестова станція',is_active:1,
    station_updated_at:'2026-10-16 07:22:00',station_type_id:'type-uuid',
    station_type:'Демо',type_code:'STT-0001',type_import_code:'PDR-001',
    category:'тестова',can_detect:1,can_jam:1,type_is_active:1,
    type_updated_at:'2026-10-15 11:00:00',
    org_unit:'Тестовий підрозділ',org_unit_code:'TEST'
  };
  const queries=[],params=[];
  return {queries,params,env:{DB:{prepare(sql){
    queries.push(sql);
    if(sql.includes('WHERE s.station_code=?'))return {bind(code){
      params.push(code);return {first:async()=>code==='ST-0001'?station:null};
    }};
    if(sql.includes('FROM station_type_antennas'))return {bind(id){
      params.push(id);return {all:async()=>({results:[
        {antenna_kind:'detection',is_active:1},
        {antenna_kind:'directional_jam',is_active:1}
      ]})};
    }};
    throw Error('Unexpected SQL');
  }}}};
}

test('model card exposes only catalog fields and reference completeness',async()=>{
  const db=detailDb();
  const res=await stationDirectoryApi(new Request(cardUrl),db.env,user,cardSegment);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.station.station_code,'ST-0001');
  assert.equal(body.station.org_unit_code,'TEST');
  assert.equal(body.characteristics.length,2);
  assert.equal(body.history_available,false);
  assert.equal(body.station.station_type_id,undefined);
  assert.deepEqual(db.params,['ST-0001','type-uuid']);
  assert.doesNotMatch(JSON.stringify(body),/latitude|longitude|mgrs|deployment_status|operational_status|freq_from_mhz|radius_km/);
  assert.doesNotMatch(db.queries.join('\n'),/latitude|longitude|mgrs|deployment_status|operational_status|freq_from_mhz|freq_to_mhz|radius_km|station_location_history/);
  assert.ok(db.queries.every(sql=>/^\s*SELECT/i.test(sql)));
});

test('station card rejects bad and unknown station codes',async()=>{
  const db=detailDb();
  const bad=await stationDirectoryApi(new Request('https://example.test/api/station-directory/card?code=%20'),
    db.env,user,cardSegment);
  assert.equal(bad.status,400);
  const missing=await stationDirectoryApi(new Request(cardUrl.replace('ST-0001','UNKNOWN')),
    db.env,user,cardSegment);
  assert.equal(missing.status,404);
});

test('station card is admin-only and GET-only',async()=>{
  const db=detailDb();
  assert.equal((await stationDirectoryApi(new Request(cardUrl),db.env,{role:'viewer'},cardSegment)).status,403);
  assert.equal((await stationDirectoryApi(new Request(cardUrl,{method:'POST'}),db.env,user,cardSegment)).status,405);
  assert.equal(db.queries.length,0);
});

test('station detail tabs are present with accessible roles and valid browser script',()=>{
  for(const key of ['general','characteristics','history']){
    assert.ok(STATION_DIRECTORY_HTML.includes('id="tab-'+key+'"'));
    assert.ok(STATION_DIRECTORY_HTML.includes('id="panel-'+key+'"'));
  }
  assert.match(STATION_DIRECTORY_HTML,/role="tablist"/);
  assert.match(STATION_DIRECTORY_HTML,/role="tabpanel"/);
  assert.match(STATION_DIRECTORY_CSS,/\.card-panel\[hidden\]/);
  assert.match(STATION_DIRECTORY_JS,/cardRequestSerial/);
  assert.match(STATION_DIRECTORY_JS,/encodeURIComponent/);
  assert.doesNotThrow(()=>new Function(STATION_DIRECTORY_JS));
});

test('station card heading remains fixed while only active tab body scrolls',()=>{
  const opening=STATION_DIRECTORY_HTML.indexOf('<div class="card-shell-head">');
  const heading=STATION_DIRECTORY_HTML.indexOf('class="dialog-top"',opening);
  const tabs=STATION_DIRECTORY_HTML.indexOf('class="card-tabs"',heading);
  const scroll=STATION_DIRECTORY_HTML.indexOf('class="card-scroll"',tabs);
  const general=STATION_DIRECTORY_HTML.indexOf('id="panel-general"',scroll);
  const history=STATION_DIRECTORY_HTML.indexOf('id="panel-history"',general);
  assert.ok(opening>=0&&opening<heading&&heading<tabs&&tabs<scroll&&scroll<general&&general<history);
  assert.match(STATION_DIRECTORY_CSS,/#card\[open\]\s*\{[^}]*display:flex/);
  assert.match(STATION_DIRECTORY_CSS,/#card \.card-scroll\s*\{[^}]*overflow-y:auto/);
  assert.match(STATION_DIRECTORY_CSS,/#card \.card-shell-head\s*\{[^}]*flex:0 0 auto/);
  assert.match(STATION_DIRECTORY_JS,/\$\('card-scroll'\)\.scrollTop=0/);
  assert.doesNotThrow(()=>new Function(STATION_DIRECTORY_JS));
});
