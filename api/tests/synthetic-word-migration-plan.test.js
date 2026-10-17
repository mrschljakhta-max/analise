import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {
  planSyntheticWordMigrations,PREREQUISITES,SCHEMA_0016,SCHEMA_0019
} from "../src/synthetic-word-migration-plan.js";

const objectRows=schema=>Object.entries(schema).map(([name,type])=>({name,type}));
const prerequisites=objectRows(PREREQUISITES);
const sixteen=objectRows(SCHEMA_0016);
const nineteen=objectRows(SCHEMA_0019);
const versions=[{name:"version_id"}];

test("missing 0016/0019 safely plans only those two synthetic migrations",()=>{
 assert.deepEqual(
  {...planSyntheticWordMigrations(prerequisites,[])},
  {apply0016:true,apply0019:true,versionColumnPresent:false}
 );
});
test("complete 0016 plans only 0019",()=>{
 assert.deepEqual(
  {...planSyntheticWordMigrations([...prerequisites,...sixteen],versions)},
  {apply0016:false,apply0019:true,versionColumnPresent:true}
 );
});
test("complete 0016 and 0019 skip both on repeated run",()=>{
 const p=planSyntheticWordMigrations([...prerequisites,...sixteen,...nineteen],versions);
 assert.equal(p.apply0016,false);
 assert.equal(p.apply0019,false);
});
test("missing 0013/0015 prerequisite is rejected before any SQL writes",()=>{
 assert.throws(()=>planSyntheticWordMigrations([],[]),/Missing prerequisite/);
 assert.throws(()=>planSyntheticWordMigrations(prerequisites.filter(x=>x.name!=="demo_import_documents"),[]),
  /demo_import_documents/);
});
test("partial 0016 DDL is rejected instead of blindly replaying ALTER TABLE",()=>{
 assert.throws(()=>planSyntheticWordMigrations([...prerequisites,sixteen[0]],[]),/Incomplete migration 0016/);
 assert.throws(()=>planSyntheticWordMigrations([...prerequisites,...sixteen],[]),/Incomplete migration 0016/);
 assert.throws(()=>planSyntheticWordMigrations(prerequisites,versions),/Incomplete migration 0016/);
});
test("partial 0019 or malformed object types are rejected",()=>{
 assert.throws(()=>planSyntheticWordMigrations(
  [...prerequisites,...sixteen,nineteen[0]],versions),/Incomplete migration 0019/);
 assert.throws(()=>planSyntheticWordMigrations(
  [...prerequisites,{name:"demo_word_rows",type:"trigger"}],[]),/Unexpected D1 schema object type/);
 assert.throws(()=>planSyntheticWordMigrations(
  [...prerequisites,prerequisites[0]],[]),/Ambiguous remote D1 schema/);
});
test("real migration chain 0015 -> 0016 -> 0019 works with empty test database",()=>{
 const sqlite=new DatabaseSync(":memory:");
 try{
  sqlite.exec("PRAGMA foreign_keys=ON");
  const apply=name=>sqlite.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
  for(const name of ["0001_initial.sql","0002_directories.sql","0013_purgatory.sql",
   "0014_synthetic_import_demo.sql","0015_synthetic_upload_history.sql"])apply(name);
  const inspect=()=>planSyntheticWordMigrations(
   sqlite.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','view','trigger','index')").all(),
   sqlite.prepare("SELECT name FROM pragma_table_info('demo_import_documents')").all()
  );
  assert.equal(inspect().apply0016,true);
  apply("0016_synthetic_report_versions.sql");
  assert.equal(inspect().apply0016,false);
  assert.equal(inspect().apply0019,true);
  apply("0019_synthetic_word_records.sql");
  assert.equal(inspect().apply0019,false);
  assert.equal(inspect().apply0016,false);
  assert.equal(sqlite.prepare(
   "SELECT COUNT(*) stored FROM demo_word_rows").get().stored,0);
 }finally{sqlite.close()}
});
