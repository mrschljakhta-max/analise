import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";

test("D1 Purgatory migration runs in SQLite and audits retrospective changes",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); "+
   "CREATE TABLE directory_types(id TEXT PRIMARY KEY); "+
   "CREATE TABLE directory_entries(id TEXT PRIMARY KEY,directory_id TEXT,archived_at TEXT);");
  db.exec("INSERT INTO users VALUES('actor'); INSERT INTO directory_types VALUES('general'); "+
   "INSERT INTO directory_entries VALUES('target','general',NULL);");
  db.exec(readFileSync(new URL("../migrations/0013_purgatory.sql",import.meta.url),"utf8"));
  const newItem=db.prepare(
   "INSERT INTO dq_occurrences(id,directory_id,source_id,source_ref,context_key,raw_value,normalized_value,created_by,updated_by) "+
   "VALUES (?,?,?,?,?,?,?,?,?)"
  );
  for(const [id,source] of [["one","one:field"],["two","two:field"]]){
   newItem.run(id,"general","source",source,"","Помилка","помилка","actor","actor");
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dq_occurrences WHERE status='pending'").get().n,2);
  db.prepare(
   "INSERT INTO dq_rules(id,directory_id,context_key,normalized_value,raw_example,target_id,created_by,updated_by) "+
   "VALUES(?,?,?,?,?,?,?,?)"
  ).run("rule","general","","помилка","Помилка","target","actor","actor");
  db.prepare(
   "UPDATE dq_occurrences SET status='resolved',resolution_origin='rule',target_id='target',updated_by='actor' "+
   "WHERE directory_id='general' AND normalized_value='помилка' AND active=1"
  ).run();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dq_occurrences WHERE status='resolved'").get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dq_audit WHERE entity_type='occurrence' AND action='updated'").get().n,2);
  db.exec("BEGIN");
  db.exec("UPDATE dq_occurrences SET status='pending',resolution_origin='none',target_id=NULL,updated_by='actor'");
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dq_occurrences WHERE status='resolved'").get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dq_audit").get().n,5);
 }finally{db.close()}
});
