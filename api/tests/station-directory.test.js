import test from 'node:test';
import assert from 'node:assert/strict';
import {stationDirectoryApi} from '../src/station-directory-api.js';

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
