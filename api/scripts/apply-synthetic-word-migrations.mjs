// Explicitly confirmed GitHub Actions D1 migration runner. No unrelated DDL.
// Read remote schema first, apply ONLY missing synthetic 0016 then 0019,
// independently verify every DDL step (Wrangler file output is not JSON).
import {execFileSync} from "node:child_process";
import {runSyntheticWordMigrations} from "../src/synthetic-word-remote-runner.js";

if(process.env.ANALISE_SYNTHETIC_MIGRATIONS_CONFIRMED!=="true")
 throw Error("Operator must explicitly confirm synthetic migrations 0016 and 0019.");
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)
 throw Error("Cloudflare API credentials missing.");

const bin=process.platform==="win32"?"npx.cmd":"npx";
const prefix=["wrangler","d1","execute","analise-db","--remote","--yes"];
function executeCommand(args){
 try{
  // Query output is JSON; file execution may print a plain-text progress report.
  // Never print either result verbatim, as SQL output can contain user data.
  return execFileSync(bin,[...prefix,...args],{
   encoding:"utf8",maxBuffer:4*1024*1024,timeout:120000,
   stdio:["ignore","pipe","pipe"]
  });
 }catch(error){
  const stderr=String(error.stderr||"");
  const sanitized=stderr.replace(/\/accounts\/[^/\s]+/g,"/accounts/[redacted]")
   .replace(/Bearer\s+[^\s]+/gi,"Bearer [redacted]");
  throw Error("Wrangler D1 operation failed: "+sanitized.slice(-900));
 }
}
runSyntheticWordMigrations(executeCommand,message=>console.log(message));
