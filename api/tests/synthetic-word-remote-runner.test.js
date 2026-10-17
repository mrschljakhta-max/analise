import test from "node:test";
import assert from "node:assert/strict";
import {
 PREREQUISITES,SCHEMA_0016,SCHEMA_0019
} from "../src/synthetic-word-migration-plan.js";
import {runSyntheticWordMigrations} from "../src/synthetic-word-remote-runner.js";

function simulatedRemote({v16=false,v19=false,brokenSchema=false,malformedQuery=false,
 inactiveApply=false}={}){
 const objects=new Map(Object.entries(PREREQUISITES));
 const add=schema=>Object.entries(schema).forEach(([name,type])=>objects.set(name,type));
 if(v16)add(SCHEMA_0016);
 if(v19)add(SCHEMA_0019);
 const files=[],requests=[];
 let hasColumn=v16;
 const execute=args=>{
  requests.push(args);
  if(args[0]==="--file"){
   const file=args[1];files.push(file);
   if(!inactiveApply){
    if(file.includes("0016")){add(SCHEMA_0016);hasColumn=true}
    if(file.includes("0019"))add(SCHEMA_0019);
   }
   // This is the failure mode in GitHub Actions #4: Wrangler exited 0 and
   // printed a human readable report instead of JSON for --file.
   return "🌀 Executing on remote D1...\n✅ Database schema updated\n";
  }
  if(args[0]!=="--json"||args[1]!=="--command")
   throw Error("Unexpected Wrangler invocation");
  if(malformedQuery)return "not-json";
  const sql=args[2];
  if(sql.includes("sqlite_master")){
   let results=[...objects.entries()].map(([name,type])=>({name,type}));
   if(brokenSchema)results=results.filter(x=>x.name!=="demo_revision_check");
   return JSON.stringify([{success:true,results}]);
  }
  if(sql.includes("pragma_table_info")){
   return JSON.stringify([{success:true,results:hasColumn?[{name:"version_id"}]:[]}]);
  }
  if(sql.includes("COUNT(*) AS stored")){
   if(!objects.has("demo_word_rows"))throw Error("No rows table");
   return JSON.stringify([{success:true,results:[{stored:4,ready:2,pending:2}]}]);
  }
  throw Error("Unexpected SQL");
 };
 return {execute,files,requests,objects};
}
test("plain-text Wrangler --file output is accepted only after schema verification",()=>{
 const sim=simulatedRemote();
 const logs=[];
 const result=runSyntheticWordMigrations(sim.execute,s=>logs.push(s));
 assert.deepEqual(result,{stored:4,ready:2,pending:2});
 assert.deepEqual(sim.files,[
  "migrations/0016_synthetic_report_versions.sql",
  "migrations/0019_synthetic_word_records.sql"
 ]);
 assert.ok(logs.some(s=>s.includes("Verified D1 migration 0016")));
 assert.ok(sim.requests.filter(a=>a[0]==="--json").length>=7);
});
test("resume after 0016 already applied (possibly on previous failed workflow)",()=>{
 const sim=simulatedRemote({v16:true});
 assert.deepEqual(runSyntheticWordMigrations(sim.execute),{stored:4,ready:2,pending:2});
 assert.deepEqual(sim.files,["migrations/0019_synthetic_word_records.sql"]);
});
test("rerun after both migrations skips all writes",()=>{
 const sim=simulatedRemote({v16:true,v19:true});
 runSyntheticWordMigrations(sim.execute);
 assert.deepEqual(sim.files,[]);
});
test("a partial 0016 blocks all writes",()=>{
 const sim=simulatedRemote({v16:true,brokenSchema:true});
 assert.throws(()=>runSyntheticWordMigrations(sim.execute),/Incomplete migration 0016/);
 assert.deepEqual(sim.files,[]);
});
test("DDL command exit 0 is not enough to claim schema success",()=>{
 const sim=simulatedRemote({inactiveApply:true});
 assert.throws(()=>runSyntheticWordMigrations(sim.execute),/Prerequisite 0016 verification failed/);
 assert.deepEqual(sim.files,["migrations/0016_synthetic_report_versions.sql"]);
});
test("missing 0019 objects after exit 0 is rejected",()=>{
 const sim=simulatedRemote({v16:true,inactiveApply:true});
 assert.throws(()=>runSyntheticWordMigrations(sim.execute),/Migration verification incomplete/);
 assert.deepEqual(sim.files,["migrations/0019_synthetic_word_records.sql"]);
});
test("malformed query output fails before writing any D1 data",()=>{
 const sim=simulatedRemote({malformedQuery:true});
 assert.throws(()=>runSyntheticWordMigrations(sim.execute),/schema query did not return structured JSON/);
 assert.deepEqual(sim.files,[]);
});
