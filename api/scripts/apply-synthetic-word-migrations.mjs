// Explicitly confirmed GitHub Actions migration runner. Applies only approved
// synthetic D1 migrations 0016 and 0019, never a broad pending migration queue.
// Reads schema first; refuses to proceed when prerequisites/partial DDL are found.
import {execFileSync} from "node:child_process";
import {planSyntheticWordMigrations} from "../src/synthetic-word-migration-plan.js";

if(process.env.ANALISE_SYNTHETIC_MIGRATIONS_CONFIRMED!=="true")
  throw Error("Operator must explicitly confirm synthetic migrations 0016 and 0019.");
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)
  throw Error("Cloudflare API credentials missing.");

const bin=process.platform==="win32"?"npx.cmd":"npx";
const prefix=["wrangler","d1","execute","analise-db","--remote","--json","--yes"];
function execute(args){
  let stdout;
  try{
    stdout=execFileSync(bin,[...prefix,...args],{
      encoding:"utf8",maxBuffer:4*1024*1024,timeout:120000,
      stdio:["ignore","pipe","pipe"]
    });
  }catch(error){
    // Don't log API environment variables or database response contents.
    const stderr=String(error.stderr||"");
    const sanitized=stderr.replace(/\/accounts\/[^/\s]+/g,"/accounts/[redacted]")
      .replace(/Bearer\s+[^\s]+/gi,"Bearer [redacted]");
    throw Error("Wrangler D1 operation failed: "+sanitized.slice(-900));
  }
  let body;
  try{body=JSON.parse(stdout)}catch{
    throw Error("Wrangler did not return structured JSON; stopped safely.");
  }
  const operations=Array.isArray(body)?body:[body];
  if(!operations.length||operations.some(x=>x?.success!==true))
    throw Error("Wrangler D1 operation reported an unsuccessful result.");
  return operations;
}
function query(sql){
  const operations=execute(["--command",sql]);
  if(operations.length!==1||!Array.isArray(operations[0].results))
    throw Error("Unexpected D1 query result; stopped safely.");
  return operations[0].results;
}
const inspect=()=>planSyntheticWordMigrations(
  query("SELECT name,type FROM sqlite_master WHERE type IN ('table','view','trigger','index')"),
  query("SELECT name FROM pragma_table_info('demo_import_documents')")
);
const state=inspect();
console.log("Synthetic D1 prerequisites inspected: 0016="+
 (state.apply0016?"missing":"present")+", 0019="+(state.apply0019?"missing":"present"));
if(state.apply0016){
  console.log("Applying missing synthetic report revision schema 0016.");
  execute(["--file","migrations/0016_synthetic_report_versions.sql"]);
  const after=inspect();
  if(after.apply0016||!after.apply0019)
    throw Error("Prerequisite 0016 verification failed; stopped before 0019.");
  console.log("Verified D1 migration 0016.");
}
if(state.apply0019){
  console.log("Applying synthetic Word row schema 0019.");
  execute(["--file","migrations/0019_synthetic_word_records.sql"]);
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
console.log("Verified physical synthetic Word rows: stored="+result.stored+
 ", ready="+result.ready+", pending="+result.pending+".");
console.log("Only synthetic D1 schemas 0016/0019 were considered. No 0017/0018 migration.");
