import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {
 FIXED_FILES,extractExpectedObjects,normalizeDefinition,
 reviewD1Reconciliation,buildLedgerInsertSql
} from "../src/d1-migration-reconcile.js";

const migrations=Object.fromEntries(FIXED_FILES.map(name=>[
 name,readFileSync("migrations/"+name,"utf8")
]));
const baseline=readdirSync("migrations").filter(n=>/^\d{4}_.+\.sql$/.test(n))
 .filter(n=>Number(n.slice(0,4))<=15).sort();
const initialCounts={versions:1,active_versions:1,word_rows:76,audit_events:114};

function fixture(recorded=false){
 const objects=FIXED_FILES.flatMap(file=>
  [...extractExpectedObjects(migrations[file])].map(([name,x])=>({
   name,type:x.type,sql:x.sql
  })));
 const history=(recorded?[...baseline,...FIXED_FILES]:baseline)
  .map((name,i)=>({id:i+1,name}));
 return {
  objects,history,documentColumns:[{name:"version_id",type:"TEXT"}],
  foreignKeys:[{from:"version_id",table:"demo_report_versions",to:"id"}],
  foreignKeyViolations:[],quickCheck:"ok",baseMigrationNames:baseline,
  expectedMigrationFiles:migrations,counts:initialCounts
 };
}

test("full SQL definitions verified before allowing ledger-only fix",()=>{
 const result=reviewD1Reconciliation(fixture());
 assert.equal(result.decision,"eligible_for_manual_ledger_only_repair");
 assert.equal(result.verifiedDefinitions,18);
 assert.equal(result.writeRequired,true);
 assert.match(result.sql,/^INSERT INTO d1_migrations/);
 assert.doesNotMatch(result.sql,/\b(?:ALTER|DROP|DELETE|UPDATE|CREATE)\s+/i);
});
test("already reconciled is a no-op",()=>{
 const result=reviewD1Reconciliation(fixture(true));
 assert.equal(result.writeRequired,false);
 assert.equal(result.sql,null);
 assert.equal(result.decision,"already_reconciled");
});
test("SQL mismatch fails closed",()=>{
 const input=fixture();
 const item=input.objects.find(x=>x.name==="demo_word_rows");
 item.sql=item.sql.replace("Бета-демо","Бета-чужий");
 assert.throws(()=>reviewD1Reconciliation(input),/SQL mismatch/);
});
test("broken version_id foreign key fails closed",()=>{
 const input=fixture();input.foreignKeys=[];
 assert.throws(()=>reviewD1Reconciliation(input),/foreign key mismatch/);
});
test("quick_check or foreign key violations block reconciliation",()=>{
 const input=fixture();input.quickCheck="not ok";
 assert.throws(()=>reviewD1Reconciliation(input),/integrity check/);
 const other=fixture();other.foreignKeyViolations=[{table:"x"}];
 assert.throws(()=>reviewD1Reconciliation(other),/integrity check/);
});
test("unregistered 0017 objects prohibit reconciliation",()=>{
 const input=fixture();input.objects.push({name:"civil_office_imports",type:"table",sql:"CREATE TABLE civil_office_imports(id TEXT)"});
 assert.throws(()=>reviewD1Reconciliation(input),/Unexpected D1 migration state/);
});
test("mismatched migration history blocks the repair",()=>{
 const input=fixture();input.history[2].name="unexpected.sql";
 assert.throws(()=>reviewD1Reconciliation(input),/migration ledger/);
});
test("partially reconciled ledger fails closed",()=>{
 const input=fixture();input.history.push({id:16,name:FIXED_FILES[0]});
 assert.throws(()=>reviewD1Reconciliation(input),/Partially reconciled/);
});
test("SQL normalizer preserves literal whitespace and escaping",()=>{
 const x=normalizeDefinition("CREATE TABLE IF NOT EXISTS t (name TEXT CHECK(name IN ('A B','I''m'))) ;");
 const y=normalizeDefinition("CREATE TABLE t(name TEXT CHECK(name IN ('A B', 'I''m')))");
 assert.equal(x,y);
 assert.notEqual(x,normalizeDefinition("CREATE TABLE t(name TEXT CHECK(name IN ('AB','I''m')))"));
});
function ledger(){
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL)");
 const stmt=db.prepare("INSERT INTO d1_migrations(name) VALUES (?)");
 for(const filename of baseline)stmt.run(filename);
 return db;
}
test("atomic reconciliation inserts exactly two ledger names and a retry inserts zero",()=>{
 const db=ledger();
 db.exec(buildLedgerInsertSql());
 const rows=db.prepare("SELECT id,name FROM d1_migrations ORDER BY id").all();
 assert.equal(rows.length,17);
 assert.deepEqual(rows.slice(-2).map(x=>x.name),FIXED_FILES);
 db.exec(buildLedgerInsertSql());
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n,17);
 db.close();
});
test("unexpected 0017 schema makes guarded ledger INSERT a no-op",()=>{
 const db=ledger();
 db.exec("CREATE TABLE civil_office_imports(id TEXT)");
 db.exec(buildLedgerInsertSql());
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n,15);
 db.close();
});
test("unexpected baseline history makes guarded ledger INSERT a no-op",()=>{
 const db=ledger();
 db.exec("INSERT INTO d1_migrations(name) VALUES ('unexpected.sql')");
 db.exec(buildLedgerInsertSql());
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n,16);
 db.close();
});
