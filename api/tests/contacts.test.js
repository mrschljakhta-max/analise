import test from "node:test";
import assert from "node:assert/strict";
import {
 CONTACT_FIELDS,contactRecord,contactPhone,contactEmail,contactKeys
} from "../src/contact-common.js";
import {contactApi} from "../src/contact-api.js";
import {CONTACT_HTML,CONTACT_CSS} from "../src/contact-assets.js";
import {CONTACT_JS} from "../src/contact-client.js";
import {CONTACT_IMPORT_JS} from "../src/contact-import-client.js";
import {DASHBOARD_HTML} from "../src/dashboard-assets.js";

const admin={role:"admin",active:1,id:"synthetic-user"};
const viewer={role:"duty",active:1,id:"synthetic-viewer"};
const fields={
 name:"Контакт Тест",aliases:"Тест А",
 group_label:"45 оабр",phone:"+380000000001",whatsapp:"yes",signal:"unknown",
 delta_account:"test.delta",email:"test@example.invalid",
 direction:"",unit_name:"",duty_role:"",note:"",
 verification_status:"unverified",source_label:"Synthetic test",is_active:1
};
const req=(path,method="GET",payload,headers={})=>new Request(
 "https://example.test/api/contacts/"+path,{
 method,headers:method==="GET"?headers:{"content-type":"application/json",...headers},
 ...(method!=="GET"?{body:JSON.stringify(payload)}:{})
});
const seg=(...parts)=>["api","contacts",...parts];
const auditTriggerSql="SELECT name FROM sqlite_master";
function fakeDB(initial=[],settings={}){
 const rows=initial.map(x=>({...x})),queries=[],writeValues=[],batches=[];
 const db={
  prepare(sql){
   queries.push(sql);
   const stmt={
    args:[],
    bind(...args){this.args=args;return this},
    async first(){
     if(sql.includes("sqlite_master"))return settings.audit===false?null:{name:"contact_audit_insert"};
     return null;
    },
    async all(){
     if(sql.includes("FROM contacts ORDER BY group_key,normalized_name LIMIT 2001")){
      return {results:rows.map(x=>({
       code:x.code,group_key:x.group_key,normalized_name:x.normalized_name,
       phone:x.phone,email:x.email,delta_account:x.delta_account,version:x.version||1
      }))};
     }
     if(sql.includes("FROM contacts ORDER BY group_key,name COLLATE NOCASE LIMIT 2001")){
      return {results:rows.map(x=>({...x}))};
     }
     if(sql.includes("FROM contact_audit"))return {results:[]};
     return {results:[]};
    },
    async run(){
     if(sql.startsWith("INSERT INTO contacts")){
      const names=sql.match(/INSERT INTO contacts \(([^)]+)\)/)[1].split(",");
      const record=Object.fromEntries(names.map((n,i)=>[n,this.args[i]]));
      rows.push(record);writeValues.push(record);
      return {success:true,meta:{changes:2}};
     }
     if(sql.startsWith("UPDATE contacts")){
      // Intentionally simulate a concurrent edit for optimistic-lock tests.
      return {success:true,meta:{changes:0}};
     }
     return {meta:{changes:0}};
    }
   };
   return stmt;
  },
  async batch(statements){
   batches.push(statements);
   if(settings.failBatch)throw Error("Simulated D1 rollback");
   for(const statement of statements)await statement.run();
   return statements.map((_,i)=>({success:true,meta:{changes:2*(i+1)}}));
  }
 };
 return {DB:db,queries,writeValues,batches,rows};
}
const importRows=[{source_row:2,...fields}];

test("contact fields include optional DELTA identifier and email",()=>{
 assert.ok(CONTACT_FIELDS.includes("delta_account"));
 assert.ok(CONTACT_FIELDS.includes("email"));
 const x=contactRecord(fields);
 assert.equal(x.delta_account,"test.delta");
 assert.equal(x.email,"test@example.invalid");
 assert.equal(x.group_key,"45 оабр");
 assert.equal(x.whatsapp,"yes");
});
test("phone and email input are normalized and strict",()=>{
 assert.equal(contactPhone("380000000001"),"+380000000001");
 assert.equal(contactPhone(""),"");
 assert.equal(contactEmail("TEST@EXAMPLE.INVALID"),"test@example.invalid");
 assert.throws(()=>contactPhone("543"));
 assert.throws(()=>contactEmail("not-an-email"));
 assert.throws(()=>contactRecord({...fields,delta_account:"line\nsecret"}));
});
test("unknown fields such as password or token are never accepted",()=>{
 assert.throws(()=>contactRecord({...fields,password:"secret"}));
 assert.throws(()=>contactKeys({...fields,token:"test"},CONTACT_FIELDS));
});
test("non-admin and inactive users cannot access any contact API",async()=>{
 const db=fakeDB();
 for(const user of [viewer,{...admin,active:0}]){
  for(const args of [
   [req("data"),seg("data")],
   [req("create","POST",fields),seg("create")],
   [req("import/prepare","POST",{items:importRows,fingerprint:"",confirm:""}),seg("import","prepare")]
  ]){
   const res=await contactApi(args[0],{DB:db.DB},user,args[1]);
   assert.equal(res.status,403);
  }
 }
 assert.equal(db.queries.length,0);
});
test("cross-origin contact updates and imports are rejected",async()=>{
 const db=fakeDB();
 const headers={origin:"https://other.invalid"};
 const a=await contactApi(req("create","POST",fields,headers),{DB:db.DB},admin,seg("create"));
 const b=await contactApi(req("import/prepare","POST",{items:importRows,fingerprint:"",confirm:""},headers),
  {DB:db.DB},admin,seg("import","prepare"));
 assert.equal(a.status,403);
 assert.equal(b.status,403);
 assert.equal(db.queries.length,0);
});
test("GET list responds with private no-store and full admin contact fields",async()=>{
 const db=fakeDB([{...contactRecord(fields),code:"CT-ABCDEF123456",version:1}]);
 const response=await contactApi(req("data"),{DB:db.DB},admin,seg("data"));
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.items[0].delta_account,fields.delta_account);
 assert.equal(data.items[0].email,fields.email);
 assert.match(response.headers.get("cache-control"),/no-store/);
});
test("create requires applied audit trigger and captures actor",async()=>{
 const absent=fakeDB([],{audit:false});
 const a=await contactApi(req("create","POST",fields),{DB:absent.DB},admin,seg("create"));
 assert.equal(a.status,503);
 const live=fakeDB();
 const response=await contactApi(req("create","POST",fields),{DB:live.DB},admin,seg("create"));
 assert.equal(response.status,201);
 assert.match((await response.json()).code,/^CT-[A-F0-9]{12}$/);
 assert.equal(live.writeValues.length,1);
 assert.equal(live.writeValues[0].delta_account,fields.delta_account);
 assert.equal(live.writeValues[0].email,fields.email);
 assert.equal(live.writeValues[0].created_by,admin.id);
});
test("editing a stale contact uses optimistic versioning",async()=>{
 const db=fakeDB();
 const p={...fields,code:"CT-ABCDEF123456",version:1};
 const response=await contactApi(req("update","PATCH",p),{DB:db.DB},admin,seg("update"));
 assert.equal(response.status,409);
 const q=db.queries.find(x=>x.startsWith("UPDATE contacts"));
 assert.match(q,/WHERE code=\? AND version=\?/);
 assert.match(q,/delta_account=\?/);
 assert.match(q,/email=\?/);
});
test("prepare import is read only and flags source-specific conflicts",async()=>{
 const previous=contactRecord({...fields,phone:"+380000000002"});
 const db=fakeDB([{...previous,code:"CT-ABCDEF123456",version:1}]);
 const response=await contactApi(req("import/prepare","POST",{
  items:importRows,fingerprint:"",confirm:""
 }),{DB:db.DB},admin,seg("import","prepare"));
 assert.equal(response.status,200);
 const data=await response.json();
 assert.deepEqual(data.counts,{input:1,new:0,existing:1,review:1});
 assert.ok(data.review[0].fields.includes("phone"));
 assert.equal(db.writeValues.length,0);
 assert.match(data.fingerprint,/^[a-f0-9]{64}$/);
});
test("prepare detects shared numbers across differently named contacts",async()=>{
 const db=fakeDB();
 const response=await contactApi(req("import/prepare","POST",{
  items:[importRows[0],{...importRows[0],source_row:3,name:"Інший контакт"}],
  fingerprint:"",confirm:""
 }),{DB:db.DB},admin,seg("import","prepare"));
 const data=await response.json();
 assert.equal(data.counts.new,2);
 assert.equal(data.counts.review,1);
 assert.match(data.review[0].fields.join(","),/Однаковий телефон/);
});
test("commit uses digest and verifies persisted records regardless of trigger changes",async()=>{
 const db=fakeDB();
 const prep=await contactApi(req("import/prepare","POST",{
  items:importRows,fingerprint:"",confirm:""
 }),{DB:db.DB},admin,seg("import","prepare"));
 const {fingerprint}=await prep.json();
 const bad=await contactApi(req("import/commit","POST",{
  items:importRows,fingerprint:"0".repeat(64),confirm:"IMPORT_CONTACTS_NEW_ONLY"
 }),{DB:db.DB},admin,seg("import","commit"));
 assert.equal(bad.status,409);
 assert.equal(db.batches.length,0);
 const saved=await contactApi(req("import/commit","POST",{
  items:importRows,fingerprint,confirm:"IMPORT_CONTACTS_NEW_ONLY"
 }),{DB:db.DB},admin,seg("import","commit"));
 assert.equal(saved.status,200);
 assert.equal((await saved.json()).verified,true);
 assert.equal(db.writeValues.length,1);
});
test("bulk import rejects unexpected extra columns including credentials",async()=>{
 const db=fakeDB();
 const response=await contactApi(req("import/prepare","POST",{
  items:[{...importRows[0],password:"not-allowed"}],fingerprint:"",confirm:""
 }),{DB:db.DB},admin,seg("import","prepare"));
 assert.equal(response.status,422);
 assert.equal(db.writeValues.length,0);
});
test("private contact HTML contains DELTA/email and a two-stage Excel flow",()=>{
 for(const id of ["ct-delta","ct-email","ct-import","ct-file","ct-preview",
   "ct-confirm","ct-compare","ct-commit","ct-dialog","ct-tab-history"]){
  assert.ok(CONTACT_HTML.includes('id="'+id+'"'),"Missing "+id);
 }
 assert.match(CONTACT_HTML,/src="\/api\/contacts\.js"/);
 assert.match(CONTACT_HTML,/src="\/api\/contacts-import\.js"/);
 assert.match(CONTACT_HTML,/src="\/api\/global-nav\.js"/);
 assert.match(CONTACT_CSS,/@media\(max-width:610px\)/);
 assert.doesNotThrow(()=>new Function(CONTACT_JS));
 assert.doesNotThrow(()=>new Function(CONTACT_IMPORT_JS));
 assert.doesNotMatch(CONTACT_JS,/\.innerHTML\s*=/);
 assert.doesNotMatch(CONTACT_IMPORT_JS,/\.innerHTML\s*=/);
 assert.match(DASHBOARD_HTML,/data-count="contacts"/);
 assert.match(DASHBOARD_HTML,/href="\/api\/contacts"/);
});
