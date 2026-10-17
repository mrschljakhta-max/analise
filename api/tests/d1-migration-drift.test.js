import test from "node:test";
import assert from "node:assert/strict";
import {AUDITED_MIGRATIONS,auditMigrationDrift} from "../src/d1-migration-drift.js";

function fixture({included=["0016","0019"],recorded=[],version=true}={}){
  const objects=Object.entries(AUDITED_MIGRATIONS)
    .filter(([name])=>included.some(n=>name.startsWith(n+"_")))
    .flatMap(([,expected])=>Object.entries(expected).map(([name,type])=>({name,type})));
  return {objects,history:recorded.map(name=>({name})),
    documentColumns:version?[{name:"version_id",type:"TEXT"}]:[]};
}
function entry(result,n){return result.migrations.find(x=>x.filename.startsWith(n+"_"));}

test("observed physical 0016/0019 are unrecorded, 0017/0018 pending",()=>{
  const r=auditMigrationDrift(fixture());
  assert.equal(entry(r,"0016").status,"present_but_unrecorded");
  assert.equal(entry(r,"0017").status,"not_applied");
  assert.equal(entry(r,"0018").status,"not_applied");
  assert.equal(entry(r,"0019").status,"present_but_unrecorded");
  assert.equal(r.noDetectedStructuralDrift,false);
  assert.equal(r.automaticMigrationRunAuthorized,false);
});
test("all structurally present and recorded migrations show no detected structural drift",()=>{
  const names=Object.keys(AUDITED_MIGRATIONS);
  const r=auditMigrationDrift(fixture({included:["0016","0017","0018","0019"],recorded:names}));
  assert(r.migrations.every(x=>x.status==="recorded_and_structurally_present"));
  assert.equal(r.noDetectedStructuralDrift,true);
  assert.equal(r.automaticMigrationRunAuthorized,false);
});
test("version_id missing causes partial migration 0016",()=>{
  const r=auditMigrationDrift(fixture({version:false}));
  assert.equal(entry(r,"0016").status,"partial_or_inconsistent");
  assert(entry(r,"0016").absent.some(x=>x.includes("version_id")));
});
test("wrong SQLite object type causes structural error",()=>{
  const input=fixture();
  input.objects.find(x=>x.name==="demo_word_rows").type="view";
  const r=auditMigrationDrift(input);
  assert.equal(entry(r,"0019").status,"partial_or_inconsistent");
  assert(entry(r,"0019").wrongType.includes("demo_word_rows"));
});
test("recorded missing migration is flagged",()=>{
  const r=auditMigrationDrift(fixture({included:[],recorded:["0018_operational_reports.sql"],version:false}));
  assert.equal(entry(r,"0018").status,"recorded_but_absent");
});
test("duplicate schema object is invalid",()=>{
  const input=fixture();input.objects.push({...input.objects[0]});
  assert.throws(()=>auditMigrationDrift(input),/duplicate/);
});
