// Safe, synchronous remote D1 migration orchestration for fictional Word fixtures.
// Queries require strict JSON, but Wrangler --file prints human-readable output.
// A zero-exit file command is NEVER treated as proof: each DDL application is
// verified by querying sqlite_master and pragma_table_info before continuing.
import {planSyntheticWordMigrations} from "./synthetic-word-migration-plan.js";

const toOps=stdout=>{
 let value;
 try{value=JSON.parse(stdout)}catch{
  throw Error("D1 schema query did not return structured JSON; stopped safely.");
 }
 const operations=Array.isArray(value)?value:[value];
 if(operations.length!==1||operations[0]?.success!==true||
    !Array.isArray(operations[0].results))
  throw Error("D1 schema query was unsuccessful or malformed.");
 return operations[0].results;
};
export function runSyntheticWordMigrations(executeCommand,report=()=>{}){
 if(typeof executeCommand!=="function")throw Error("Missing Wrangler executor.");
 const query=sql=>toOps(executeCommand(["--json","--command",sql]));
 const inspect=()=>planSyntheticWordMigrations(
  query("SELECT name,type FROM sqlite_master WHERE type IN ('table','view','trigger','index')"),
  query("SELECT name FROM pragma_table_info('demo_import_documents')")
 );
 const first=inspect();
 report("Synthetic D1 prerequisites inspected: 0016="+
  (first.apply0016?"missing":"present")+", 0019="+(first.apply0019?"missing":"present"));
 if(first.apply0016){
  report("Applying missing synthetic report revision schema 0016.");
  executeCommand(["--file","migrations/0016_synthetic_report_versions.sql"]);
  // Wrangler --file is not guaranteed to emit JSON. Always independently
  // verify all tables, triggers, indexes and the version_id column.
  const after=inspect();
  if(after.apply0016||!after.apply0019)
   throw Error("Prerequisite 0016 verification failed; stopped before 0019.");
  report("Verified D1 migration 0016.");
 }
 if(first.apply0019){
  report("Applying synthetic Word row schema 0019.");
  executeCommand(["--file","migrations/0019_synthetic_word_records.sql"]);
 }
 const done=inspect();
 if(done.apply0016||done.apply0019)
  throw Error("Migration verification incomplete; inspect schema before retrying.");
 const totals=query("SELECT COUNT(*) AS stored, "+
  "COALESCE(SUM(CASE WHEN canonical_label IS NOT NULL THEN 1 ELSE 0 END),0) AS ready, "+
  "COALESCE(SUM(CASE WHEN canonical_label IS NULL THEN 1 ELSE 0 END),0) AS pending "+
  "FROM demo_word_rows");
 const result=totals[0];
 if(!result||!Number.isInteger(result.stored)||!Number.isInteger(result.ready)||
  !Number.isInteger(result.pending))
  throw Error("Unexpected D1 verification values.");
 report("Verified physical synthetic Word rows: stored="+result.stored+
  ", ready="+result.ready+", pending="+result.pending+".");
 report("Only synthetic D1 schemas 0016/0019 were considered. No 0017/0018 migration.");
 return Object.freeze({stored:result.stored,ready:result.ready,pending:result.pending});
}
