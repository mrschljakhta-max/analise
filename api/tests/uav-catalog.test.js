import test from 'node:test';
import assert from 'node:assert/strict';
import {uavCatalogApi} from '../src/uav-catalog-api.js';
import {UAV_CATALOG_HTML,UAV_CATALOG_CSS} from '../src/uav-catalog-assets.js';
import {UAV_CATALOG_JS} from '../src/uav-catalog-client.js';

const admin={id:'admin-test',role:'admin',active:1};
const segment=name=>['api','uav-catalog',name];
const url=(name,q='')=>'https://example.test/api/uav-catalog/'+name+q;
const req=(name,method,body,origin)=>{
  const headers={'Content-Type':'application/json'};
  if(origin)headers.origin=origin;
  return new Request(url(name),{method,headers,body:JSON.stringify(body)});
};
const model={
  code:'UAV-0001',name:'Тестова модель',airframe:'multirotor',subtype:'fpv',
  entry_kind:'generic',country:'',manufacturer:'',purpose:'Навчальний зразок',
  note:'Тільки тестові дані',is_active:1
};
const profile={
  code:'UAV-0001',channel_kind:'video',freq_min_mhz:2400,freq_max_mhz:2450,
  bandwidth_mhz:null,modulation:'',source_label:'Тестовий документ',
  verification_status:'unverified',note:'Вигаданий приклад'
};
const material={
  code:'UAV-0001',title:'Навчальне фото',kind:'image',
  url:'https://example.com/image.png',note:'Тест'
};
function db({trigger=true,changes=1,exists=true,tableAbsent=false}={}){
  const queries=[],bindings=[];
  const prepare=sql=>{
    queries.push(sql);
    return {
      bind(...values){
        bindings.push(values);
        return {
          first:async()=>{
            if(sql.includes('sqlite_master'))return trigger?{name:'audit'}:null;
            if(!exists)return null;
            if(sql.includes('SELECT id FROM uav_models'))return {id:'uav-test-id'};
            if(sql.includes('SELECT code,name,airframe'))return {
              code:'UAV-0001',name:'Тестова модель',airframe:'multirotor',subtype:'fpv',
              entry_kind:'generic',country:'',manufacturer:'',purpose:'Навчальний зразок',
              note:'',is_active:1,version:1,created_at:'2026-10-16 09:00:00',
              updated_at:'2026-10-16 09:00:00'
            };
            throw Error('Unexpected SELECT: '+sql);
          },
          all:async()=>{
            if(tableAbsent)throw Error('D1_ERROR: no such table: uav_models');
            if(sql.includes('FROM uav_catalog_audit'))return {results:[{
              section:'general',action:'created',old_json:null,
              new_json:'{"name":"Тестова модель"}',changed_at:'2026-10-16 09:00:00'
            }]};
            if(sql.includes('uav_frequency_profiles'))return {results:[{
              id:'test-freq',channel_kind:'video',freq_min_mhz:2400,freq_max_mhz:2450,version:1
            }]};
            if(sql.includes('uav_materials'))return {results:[]};
            return {results:[]};
          },
          run:async()=>({meta:{changes}})
        };
      },
      all:async()=>{
        if(tableAbsent)throw Error('D1_ERROR: no such table: uav_models');
        return {results:[{
          code:'UAV-0001',name:'Тестова модель',airframe:'multirotor',subtype:'fpv',
          entry_kind:'generic',is_active:1,frequency_count:2,material_count:0
        }]};
      }
    };
  };
  return {env:{DB:{prepare}},queries,bindings};
}
test('catalog and all its mutation routes are administrator-only',async()=>{
  const d=db();
  const denied=await uavCatalogApi(new Request(url('data')),d.env,{role:'viewer',active:1},segment('data'));
  assert.equal(denied.status,403);
  assert.equal(d.queries.length,0);
  const post=await uavCatalogApi(req('models','POST',model),d.env,{role:'viewer'},segment('models'));
  assert.equal(post.status,403);
});
test('catalog shows only administrative fields and counts',async()=>{
  const d=db();
  const result=await uavCatalogApi(new Request(url('data')),d.env,admin,segment('data'));
  assert.equal(result.status,200);
  assert.equal((await result.json()).items[0].frequency_count,2);
  assert.ok(d.queries.every(sql=>sql.trimStart().startsWith('SELECT')));
  assert.doesNotMatch(d.queries.join('\n'),/station_location_history|deployment_status|operational_status|jamming|longitude|latitude/);
});
test('invalid routes and methods are rejected',async()=>{
  const d=db();
  assert.equal((await uavCatalogApi(new Request(url('models')),d.env,admin,segment('models'))).status,405);
  assert.equal((await uavCatalogApi(new Request(url('oops')),d.env,admin,segment('oops'))).status,404);
  assert.equal(d.queries.length,0);
});
test('POST model is audited and preserves wing/multirotor classification',async()=>{
  const d=db();
  const response=await uavCatalogApi(req('models','POST',model),d.env,admin,segment('models'));
  assert.equal(response.status,201);
  assert.equal((await response.json()).version,1);
  assert.match(d.queries[0],/sqlite_master/);
  assert.match(d.queries[1],/^INSERT INTO uav_models/);
  assert.equal(d.bindings[1][2],'Тестова модель');
  assert.equal(d.bindings[1][4],'multirotor');
  assert.equal(d.bindings[1][5],'fpv');
  assert.doesNotMatch(d.queries.join('\n'),/station_types|stations /);
});
test('wing cannot have FPV subtype and multirotor must have a leaf subtype',async()=>{
  for(const entry of [
    {...model,airframe:'wing',subtype:'fpv'},
    {...model,airframe:'multirotor',subtype:''},
    {...model,airframe:'multirotor',subtype:'optical'},
    {...model,airframe:'wing',subtype:'quadcopter'},
    {...model,is_active:'1'},
    {...model,code:'bad code'},
    {...model,frequency_mhz:123}
  ]){
    const d=db();
    const result=await uavCatalogApi(req('models','POST',entry),d.env,admin,segment('models'));
    assert.equal(result.status,400,JSON.stringify(entry));
    assert.equal(d.queries.length,0);
  }
  const d=db();
  const good=await uavCatalogApi(req('models','POST',{...model,airframe:'wing',subtype:''}),d.env,admin,segment('models'));
  assert.equal(good.status,201);
});
test('model edit uses version compare-and-swap',async()=>{
  const d=db({changes:0});
  const response=await uavCatalogApi(req('models','PATCH',{...model,version:4}),d.env,admin,segment('models'));
  assert.equal(response.status,409);
  assert.match(d.queries[1],/WHERE code=\? AND version=\?/);
});
test('writes are blocked if D1 audit triggers have not migrated',async()=>{
  const d=db({trigger:false});
  const response=await uavCatalogApi(req('models','POST',model),d.env,admin,segment('models'));
  assert.equal(response.status,503);
  assert.equal(d.queries.length,1);
  assert.match((await response.json()).error,/0009/);
});
test('frequency profiles accept numeric ranges and reject invalid values',async()=>{
  const d=db();
  const result=await uavCatalogApi(req('frequencies','POST',profile),d.env,admin,segment('frequencies'));
  assert.equal(result.status,201);
  assert.match(d.queries[2],/^INSERT INTO uav_frequency_profiles/);
  assert.equal(d.bindings[2][3],2400);
  assert.equal(d.bindings[2][4],2450);
  for(const changes of [
    {freq_min_mhz:2500,freq_max_mhz:2400},
    {freq_min_mhz:'2400'},
    {channel_kind:'jam'},
    {bandwidth_mhz:-5},
    {verification_status:'invented'},
    {extra_field:'forbidden'}
  ]){
    const m=db();
    const res=await uavCatalogApi(req('frequencies','POST',{...profile,...changes}),m.env,admin,segment('frequencies'));
    assert.equal(res.status,400,JSON.stringify(changes));
    assert.equal(m.queries.length,0);
  }
});
test('frequency changes cannot silently target another UAV and use version guard',async()=>{
  const d=db({changes:0});
  const result=await uavCatalogApi(req('frequencies','PATCH',{
    ...profile,id:'freq-record-id',version:5
  }),d.env,admin,segment('frequencies'));
  assert.equal(result.status,409);
  assert.match(d.queries[2],/WHERE id=\? AND uav_id=\? AND version=\?/);
});
test('material references permit only valid HTTPS without credentials',async()=>{
  const d=db();
  const result=await uavCatalogApi(req('materials','POST',material),d.env,admin,segment('materials'));
  assert.equal(result.status,201);
  for(const address of [
    'javascript:alert(1)','http://example.com/img.png',
    'https://user:pass@example.com/image.jpg','not a link','file:///tmp/test.png'
  ]){
    const m=db();
    const r=await uavCatalogApi(req('materials','POST',{...material,url:address}),m.env,admin,segment('materials'));
    assert.equal(r.status,400);
    assert.equal(m.queries.length,0);
  }
});
test('cross-origin edits are rejected before touching the database',async()=>{
  const d=db();
  const result=await uavCatalogApi(req('models','POST',model,'https://elsewhere.test'),
    d.env,admin,segment('models'));
  assert.equal(result.status,403);
  assert.equal(d.queries.length,0);
});
test('model card and history are read-only and return structured records',async()=>{
  const d=db();
  const res=await uavCatalogApi(new Request(url('card','?code=UAV-0001')),d.env,admin,segment('card'));
  assert.equal(res.status,200);
  const card=await res.json();
  assert.equal(card.model.id,undefined);
  assert.equal(card.frequencies.length,1);
  assert.equal(card.materials.length,0);
  const journal=await uavCatalogApi(new Request(url('history','?code=UAV-0001')),d.env,admin,segment('history'));
  assert.equal(journal.status,200);
  assert.equal((await journal.json()).items.length,1);
  assert.ok(d.queries.every(sql=>sql.trimStart().startsWith('SELECT')));
});
test('catalog responds safely before migration and when there is no database',async()=>{
  const d=db({tableAbsent:true});
  const failed=await uavCatalogApi(new Request(url('data')),d.env,admin,segment('data'));
  assert.equal(failed.status,503);
  assert.match((await failed.json()).error,/0009/);
  assert.equal((await uavCatalogApi(new Request(url('data')),{DB:null},admin,segment('data'))).status,503);
});
test('wing form permits explicit empty subtype while API validates multirotor subtype',()=>{
  assert.match(UAV_CATALOG_HTML,/<select id="model-subtype"><option value="">Без підтипу<\/option><\/select>/);
  assert.doesNotMatch(UAV_CATALOG_HTML,/<select id="model-subtype"[^>]*\srequired(?:\s|>)/);
  assert.match(UAV_CATALOG_JS,/new Option\('Без підтипу',''\)/);
  assert.match(UAV_CATALOG_JS,/new Option\('FPV','fpv'\)/);
});
test('UI contains four semantic tabs and all three editor forms',()=>{
  for(const tab of ['general','frequencies','materials','history']){
    assert.ok(UAV_CATALOG_HTML.includes('id="tab-'+tab+'"'));
    assert.ok(UAV_CATALOG_HTML.includes('id="panel-'+tab+'"'));
  }
  for(const id of ['model-form','freq-form','material-form','search','type-filter','subtype-filter']){
    assert.ok(UAV_CATALOG_HTML.includes('id="'+id+'"'));
  }
  assert.match(UAV_CATALOG_CSS,/#card\[open\]/);
  assert.match(UAV_CATALOG_JS,/uav-catalog\/history\?code=/);
  assert.match(UAV_CATALOG_JS,/encodeURIComponent/);
  assert.match(UAV_CATALOG_JS,/textContent/);
  assert.doesNotMatch(UAV_CATALOG_JS,/\.innerHTML\s*=/);
  assert.doesNotThrow(()=>new Function(UAV_CATALOG_JS));
});