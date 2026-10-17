// Read-only remote D1 introspection. No DDL/DML, file reads or user data.
import {execFileSync} from "node:child_process";
import {auditMigrationDrift} from "../src/d1-migration-drift.js";

if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)
  throw Error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the execution environment.");

function query(sql){
  let output;
  try{
    output=execFileSync(process.platform==="win32"?"npx.cmd":"npx",[
      "wrangler","d1","execute","analise-db","--remote","--yes","--json","--command",sql
    ],{cwd:process.cwd(),encoding:"utf8",stdio:["ignore","pipe","pipe"],
      timeout:90000,maxBuffer:5000000});
  }catch{
    // Public CI logs must never contain private output, tokens or SQL error bodies.
    throw Error("Read-only D1 query failed. Review permissions/configuration privately.");
  }
  let value;
  try{value=JSON.parse(output)}catch{throw Error("D1 returned non-JSON output");}
  const operations=Array.isArray(value)?value:[value];
  if(operations.length!==1||operations[0]?.success!==true||
    !Array.isArray(operations[0].results))
    throw Error("D1 returned unsuccessful or malformed response");
  return operations[0].results;
}
const objects=query("SELECT name,type FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%'");
const history=query("SELECT name FROM d1_migrations ORDER BY id");
const documentColumns=query("SELECT name,type FROM pragma_table_info('demo_import_documents')");
const report=auditMigrationDrift({objects,history,documentColumns});
for(const item of report.migrations){
  console.log(item.filename+": "+item.status);
  if(item.absent.length)console.log("  missing_count="+item.absent.length);
  if(item.wrongType.length)console.log("  unexpected_type_count="+item.wrongType.length);
}
console.log("no_detected_structural_drift="+report.noDetectedStructuralDrift);
console.log("authorized_to_run_standard_migrations=false (manual review required)");
console.log("Only object names/types were checked, not exact SQL definitions or data integrity.");
if(!report.noDetectedStructuralDrift)
  console.log("STOP: Do not run generic Wrangler migrations. Verify backups, SQL, and the ledger first.");
