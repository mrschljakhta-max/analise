import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {approvedOfficeImportApi,validateOfficeRequest,officeFingerprint,OFFICE_ITEMS} from "../src/approved-office-import-api.js";
import {databaseViewerApi} from "../src/database-viewer-api.js";
import {APPROVED_OFFICE_IMPORT_JS} from "../src/approved-office-import-client.js";
import {GENERIC_PREVIEW_HTML} from "../src/generic-preview-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import {DATABASE_VIEWER_JS} from "../src/database-viewer-client.js";

const origin="https://analise.example",actor={id:"admin-1",role:"admin",active:1};
function testDb(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('admin-1');");
 sqlite.exec(readFileSync(new URL("../migrations/0017_civil_office_inventory.sql",import.meta.url),"utf8"));
 const DB={
  prepare(sql){
   const statement=sqlite.prepare(sql);
   const bound=(args=[])=>({
    async first(){return statement.get(...args)||null},
    async all(){return {results:statement.all(...args)}},
    async run(){const value=statement.run(...args);return {meta:value}}
   });
   return {bind(...args){return bound(args)},...bound()};
  },
  async batch(stmts){
   sqlite.exec("BEGIN");
   try{
    const results=[];
    for(const stmt of stmts)results.push(await stmt.run());
    sqlite.exec("COMMIT");return results;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  }
 };
 return {sqlite,DB};
}
const item=(name="Ручка",amount=6,date="2026-10-16",price=12.5,row=2)=>({
 source_row:row,values:{item:name,quantity:amount,stock_date:date,unit_price:price}
});
const payload=(records=[item()])=>({schema:"office_inventory_v1",records});
async function api(DB,action,data,who=actor,method="POST"){
 return approvedOfficeImportApi(new Request(origin+"/api/approved-import/"+action,{
  method,headers:{"content-type":"application/json"},body:method==="POST"?JSON.stringify(data):undefined
 }),{DB},who,["api","approved-import",action]);
}
const hash=async obj=>officeFingerprint(validateOfficeRequest(obj));
test("migration is append-only, constrained and automatically audits inserts",()=>{
 const sql=readFileSync(new URL("../migrations/0017_civil_office_inventory.sql",import.meta.url),"utf8");
 assert.match(sql,/CHECK\(item_code IN/);
 assert.match(sql,/OFFICE_ITEM_CONFLICT/);
 assert.match(sql,/CREATE TRIGGER IF NOT EXISTS civil_office_row_logged/);
 assert.doesNotMatch(sql,/DROP TABLE|ALTER TABLE|UPDATE civil_office_items/);
 const {sqlite}=testDb();
 try{
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_items").get().n,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_audit").get().n,0);
 }finally{sqlite.close()}
});
test("preview does not write; confirm inserts records and item/import audit atomically",async()=>{
 const {DB,sqlite}=testDb();
 try{
  const draft=payload([item(),item("Папір А4",9,"2026-10-16",2.15,3)]);
  const preview=await api(DB,"inspect",draft);
  assert.equal(preview.status,200);
  const data=await preview.json();
  assert.equal(data.total,2);assert.equal(data.new_rows,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_items").get().n,0);
  const commit=await api(DB,"commit",{...draft,confirmed:true,expected_hash:data.fingerprint});
  assert.equal(commit.status,200);
  const saved=await commit.json();
  assert.equal(saved.new_rows,2);assert.equal(saved.existing_rows,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_items").get().n,2);
  assert.equal(sqlite.prepare("SELECT unit_price_cents AS p FROM civil_office_items WHERE item_code='pen'").get().p,1250);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_audit").get().n,3);
  assert.equal(sqlite.prepare("SELECT submitted_count FROM civil_office_imports").get().submitted_count,2);
  assert.equal(sqlite.prepare("SELECT batch_id FROM civil_office_items LIMIT 1").get().batch_id,saved.id);
 }finally{sqlite.close()}
});
test("identical retry is idempotent; new batch with one identical item creates no duplicate entry",async()=>{
 const {DB,sqlite}=testDb();
 try{
  const d=payload([item()]);
  const p=(await (await api(DB,"inspect",d)).json());
  const a=await (await api(DB,"commit",{...d,confirmed:true,expected_hash:p.fingerprint})).json();
  const b=await (await api(DB,"commit",{...d,confirmed:true,expected_hash:p.fingerprint})).json();
  assert.equal(b.reused,true);assert.equal(a.id,b.id);
  const extra=payload([item(),item("Маркер",3,"2026-10-17",null,3)]);
  const q=await (await api(DB,"inspect",extra)).json();
  assert.equal(q.new_rows,1);assert.equal(q.existing_rows,1);
  const c=await (await api(DB,"commit",{...extra,confirmed:true,expected_hash:q.fingerprint})).json();
  assert.equal(c.new_rows,1);assert.equal(c.existing_rows,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_items").get().n,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_imports").get().n,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_audit").get().n,4);
 }finally{sqlite.close()}
});
test("changed quantity for existing stock-date item is rejected without writing any part of a batch",async()=>{
 const {DB,sqlite}=testDb();
 try{
  const first=payload([item()]);
  await api(DB,"commit",{...first,confirmed:true,expected_hash:await hash(first)});
  const changed=payload([item("Маркер",1,"2026-10-17",null,5),item("Ручка",99,"2026-10-16",12.5,6)]);
  const preview=await api(DB,"inspect",changed);
  assert.equal(preview.status,409);
  const msg=await preview.json();
  assert.equal(msg.conflicts[0].item,"Ручка");
  const commit=await api(DB,"commit",{...changed,confirmed:true,expected_hash:await hash(changed)});
  assert.equal(commit.status,409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_items").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_imports").get().n,1);
  const rows=sqlite.prepare("SELECT quantity FROM civil_office_items WHERE item_code='pen'").get();
  assert.equal(rows.quantity,6);
 }finally{sqlite.close()}
});
test("SQL trigger forbids an unsafe overwrite even inside OR IGNORE and rolls back whole batch",async()=>{
 const {DB,sqlite}=testDb();
 try{
  const first=payload([item()]);
  await api(DB,"commit",{...first,confirmed:true,expected_hash:await hash(first)});
  const id="550e8400-e29b-41d4-a716-446655440000";
  const sql=[
   DB.prepare("INSERT INTO civil_office_imports(id,fingerprint,actor_id,submitted_count) VALUES(?,?,?,?)").bind(
    id,"a".repeat(64),"admin-1",2),
   DB.prepare("INSERT OR IGNORE INTO civil_office_items(id,batch_id,item_code,stock_date,quantity,unit_price_cents,source_row) VALUES(?,?,?,?,?,?,?)").bind(
    crypto.randomUUID(),id,"folder","2026-10-16",1,null,2),
   DB.prepare("INSERT OR IGNORE INTO civil_office_items(id,batch_id,item_code,stock_date,quantity,unit_price_cents,source_row) VALUES(?,?,?,?,?,?,?)").bind(
    crypto.randomUUID(),id,"pen","2026-10-16",999,1250,3)
  ];
  await assert.rejects(()=>DB.batch(sql),/OFFICE_ITEM_CONFLICT/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_items").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_imports").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_audit").get().n,2);
 }finally{sqlite.close()}
});
test("whitelist rejects unapproved names, free text, coordinates, unit prices and invalid dates",()=>{
 const scenarios=[
  [{...item(),values:{...item().values,item:"Позиція"}}],
  [{...item(),values:{...item().values,lat:48.1,lon:37.2}}],
  [{...item(),values:{...item().values,personal_contact:"example"}}],
  [item("Ручка",1,"2026-02-30",2)],
  [item("Ручка",-1,"2026-10-16",2)],
  [item("Ручка",1,"2026-10-16",1.234)],
  [item("Ручка",1,"2036-01-01",2)],
  [item("Ручка",1,"2026-10-16","3")],
  [item(),item("Ручка",6,"2026-10-16",12.5,5)]
 ];
 for(const x of scenarios)assert.throws(()=>validateOfficeRequest(payload(x)));
 assert.throws(()=>validateOfficeRequest({schema:"arbitrary",records:[item()]}));
 assert.throws(()=>validateOfficeRequest({...payload(),filename:"secret.docx"}));
 assert.throws(()=>validateOfficeRequest(payload(Array.from({length:101},(_,i)=>
  item("Ручка",1,"2026-10-16",1,i+1)))));
 assert.ok(Object.keys(OFFICE_ITEMS).length>=8);
});
test("commit requires explicit confirmation and preview fingerprint",async()=>{
 const {DB,sqlite}=testDb();
 try{
  const d=payload();
  assert.equal((await api(DB,"commit",d)).status,409);
  assert.equal((await api(DB,"commit",{...d,confirmed:true,expected_hash:"not-a-hash"})).status,409);
  assert.equal((await api(DB,"commit",{...d,confirmed:false,expected_hash:await hash(d)})).status,409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM civil_office_imports").get().n,0);
  assert.equal((await api(DB,"inspect",d,{...actor,role:"duty"})).status,403);
  assert.equal((await api(DB,"commit",{...d,confirmed:true,expected_hash:await hash(d)},{...actor,active:0})).status,403);
  assert.equal((await api(DB,"inspect",d,actor,"GET")).status,405);
 }finally{sqlite.close()}
});
test("saved rows and import receipts appear as approved read-only datasets in D1 viewer",async()=>{
 const {DB,sqlite}=testDb();
 try{
  const d=payload([item("Зошит",2,"2026-10-16",17)]);
  const commit=await api(DB,"commit",{...d,confirmed:true,expected_hash:await hash(d)});
  assert.equal(commit.status,200);
  const browse=(action)=>databaseViewerApi(
   new Request(origin+"/api/database-viewer/"+action),
   {DB},actor,["api","database-viewer",action.split("?")[0]]);
  const catalog=await (await browse("catalog")).json();
  const map=Object.fromEntries(catalog.datasets.map(x=>[x.id,x]));
  assert.equal(map.office_inventory.available,true);
  assert.equal(map.office_inventory.count,1);
  assert.equal(map.office_imports.count,1);
  const entries=await (await browse("data?dataset=office_inventory")).json();
  assert.equal(entries.rows.length,1);
  assert.equal(entries.rows[0].item_name,"Зошит");
  assert.equal(entries.rows[0].unit_price,17);
  assert.doesNotMatch(JSON.stringify(entries),/snapshot_json|source_file|coordinate/);
  const attempts=await (await browse("data?dataset=office_imports")).json();
  assert.equal(attempts.rows[0].submitted_count,1);
  assert.equal(attempts.rows[0].new_count,1);
  assert.equal((await browse("data?dataset=users")).status,400);
 }finally{sqlite.close()}
});
test("experimental office import stays tested but unexposed in the stable recovery UI",()=>{
 assert.doesNotThrow(()=>new Script(APPROVED_OFFICE_IMPORT_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.doesNotThrow(()=>new Script(DATABASE_VIEWER_JS));
 for(const id of ["pv-office-approve","pv-office-inspect","pv-office-save"]){
  assert.doesNotMatch(GENERIC_PREVIEW_HTML,new RegExp('id="'+id+'"'));
 }
 assert.doesNotMatch(GENERIC_PREVIEW_HTML,/approved-office-import\.js/);
 assert.match(GENERIC_PREVIEW_HTML,/id="pv-map-check"/);
 assert.match(APPROVED_OFFICE_IMPORT_JS,/window\.confirm/);
 assert.match(APPROVED_OFFICE_IMPORT_JS,/fetch\("\/api\/approved-import\/"/);
 assert.doesNotMatch(GENERIC_PREVIEW_JS,/\bfetch\s*\(/);
 assert.match(GENERIC_PREVIEW_JS,/AnaliseLocalBridge/);
 assert.match(DATABASE_VIEWER_JS,/new URLSearchParams\(globalThis\.location\.search\)/);
});
