// Cloudflare D1 ledger reconciliation: read-only by default, gated manual mutation.
// Never apply migration SQL; writes ONLY two validated d1_migrations rows.
import {execFileSync} from "node:child_process";
import {readFileSync,readdirSync} from "node:fs";
import {reviewD1Reconciliation,FIXED_FILES} from "../src/d1-migration-reconcile.js";

const mode=process.env.ANALISE_D1_LEDGER_MODE||"audit";
if(!["audit","apply"].includes(mode))throw Error("Invalid reconciliation mode");
if(mode==="apply"&&(
 process.env.ANALISE_D1_LEDGER_CONFIRM!=="RECONCILE_0016_0019_ONLY"||
 process.env.ANALISE_D1_BOOKMARK_CONFIRMED!=="true"||
 process.env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
 process.env.GITHUB_REF_NAME!=="main"
))throw Error("Manual approval, backup acknowledgement and main-branch dispatch required");
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)
 throw Error("Cloudflare credentials are unavailable");

const names=readdirSync("migrations").filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
const baseline=names.filter(n=>Number(n.slice(0,4))<=15);
const expected=Object.fromEntries(FIXED_FILES.map(name=>[
 name,readFileSync("migrations/"+name,"utf8")
]));

function execute(sql){
 let output;
 try{
  output=execFileSync(process.platform==="win32"?"npx.cmd":"npx",[
   "wrangler","d1","execute","analise-db","--remote","--yes","--json","--command",sql
  ],{encoding:"utf8",timeout:90000,maxBuffer:5000000,
    stdio:["ignore","pipe","pipe"]});
 }catch{
  // Do not leak private D1 response bodies or secrets to public Actions logs.
  throw Error("D1 query failed; review Cloudflare permissions or state privately");
 }
 let value;
 try{value=JSON.parse(output)}catch{throw Error("D1 response is not valid JSON");}
 const ops=Array.isArray(value)?value:[value];
 if(ops.length!==1||ops[0]?.success!==true||!Array.isArray(ops[0].results))
  throw Error("D1 returned an unsuccessful or malformed response");
 return ops[0].results;
}
const sqlCounts="SELECT "+
 "(SELECT COUNT(*) FROM demo_report_versions) AS versions,"+
 "(SELECT COUNT(*) FROM demo_report_active) AS active_versions,"+
 "(SELECT COUNT(*) FROM demo_word_rows) AS word_rows,"+
 "(SELECT COUNT(*) FROM demo_word_row_audit) AS audit_events";
function inspect(){
 const objects=execute("SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%'");
 const history=execute("SELECT id,name FROM d1_migrations ORDER BY id");
 const documentColumns=execute("SELECT name,type FROM pragma_table_info('demo_import_documents')");
 const foreignKeys=execute("SELECT * FROM pragma_foreign_key_list('demo_import_documents')");
 const foreignKeyViolations=execute("PRAGMA foreign_key_check");
 const q=execute("PRAGMA quick_check");
 const counts=execute(sqlCounts)[0];
 const quickCheck=q.length===1?q[0]?.quick_check:null;
 return reviewD1Reconciliation({
  objects,history,documentColumns,foreignKeys,foreignKeyViolations,
  quickCheck,expectedMigrationFiles:expected,baseMigrationNames:baseline,counts
 });
}
const before=inspect();
console.log("Schema definitions verified: "+before.verifiedDefinitions);
console.log("Ledger status: "+before.decision);
console.log("Baseline row counts: "+JSON.stringify(before.counts));
if(mode==="audit"){
 console.log("AUDIT ONLY — no D1 modifications");
}else if(!before.writeRequired){
 console.log("No action needed: ledger already reconciled.");
}else{
 // One atomic INSERT; 0017/0018 are not applied or marked.
 // If the guarded SQL inserts zero rows, post-validation fails closed.
 execute(before.sql);
 const after=inspect();
 if(after.writeRequired||after.migrationCountBefore!==before.migrationCountBefore+2||
  JSON.stringify(after.counts)!==JSON.stringify(before.counts))
  throw Error("Post-write ledger or data-count verification failed; stop and review");
 console.log("SUCCESS: only 0016 and 0019 ledger rows recorded.");
 console.log("0017 and 0018 remain unapplied. No data or schema migration executed.");
}
