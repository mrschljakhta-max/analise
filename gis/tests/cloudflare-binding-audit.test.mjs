import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectCloudBindings,renderWrangler,safeReport} from "../scripts/audit-cloud-bindings.mjs";
import {namesFor} from "../scripts/cloudflare-provision.mjs";
const known=readFileSync(new URL("../../api/wrangler.toml",import.meta.url),"utf8");
const fixtures=()=>{
 const inv={d1:[],r2:[],kv:[],queue:[]};
 for(const env of ["dev","staging"]){
  const n=namesFor(env);
  const num=env==="dev"?"1":"2";
  inv.d1.push({name:n.d1,id:num.repeat(8)+"-"+num.repeat(4)+"-4"+num.repeat(3)+"-8"+num.repeat(3)+"-"+num.repeat(12)});
  inv.r2.push({name:n.r2,id:n.r2});
  inv.kv.push({name:n.kv,id:num.repeat(32)});
  inv.queue.push({name:n.queue,id:"queue-"+env});
 }
 return inv;
};
test("fully inspected Dev and Staging return distinct real IDs",()=>{
 const got=inspectCloudBindings(fixtures(),known);
 assert.notEqual(got.dev.d1.id,got.staging.d1.id);
 assert.notEqual(got.dev.kv.id,got.staging.kv.id);
 const summary=safeReport(got);
 assert.equal(summary.production_modified,false);
 assert.equal(summary.worker_deployed,false);
 assert.ok(!JSON.stringify(summary).includes(got.dev.d1.id));
 assert.ok(!JSON.stringify(summary).includes(got.dev.kv.id));
});
test("creates exact Wrangler config only after complete resource audit",()=>{
 const values=inspectCloudBindings(fixtures(),known);
 for(const env of ["dev","staging"]){
  const source=readFileSync(new URL("../infra/wrangler."+env+".toml.example",import.meta.url),"utf8");
  const rendered=renderWrangler(env,values,source);
  assert.match(rendered,/workers_dev = false/);
  assert.ok(rendered.includes("database_id = \""+values[env].d1.id+"\""));
  assert.ok(rendered.includes("id = \""+values[env].kv.id+"\""));
  assert.doesNotMatch(rendered,/UUID_REQUIRED|_KV_ID_REQUIRED/);
  assert.ok(!rendered.includes("database_name = \"analise-db\""));
 }
});
test("never permits production rendering",()=>{
 const values=inspectCloudBindings(fixtures(),known);
 assert.throws(()=>renderWrangler("production",values,""),/production/);
});
test("denies when a resource belongs to a different environment",()=>{
 const bad=fixtures();bad.kv[0].id=bad.kv[1].id;
 assert.throws(()=>inspectCloudBindings(bad,known),/share kv resource identity/);
});
test("denies duplicate or missing D1 resource before generating any config",()=>{
 const bad=fixtures();bad.d1.pop();
 assert.throws(()=>inspectCloudBindings(bad,known),/Missing d1/);
 const duplicate=fixtures();duplicate.r2.push({...duplicate.r2[0]});
 assert.throws(()=>inspectCloudBindings(duplicate,known),/Duplicate/);
});
test("refuses bindings that point at ANALISE production D1 or R2",()=>{
 const prodDb=/^database_id\s*=\s*"([^"]+)"/m.exec(known)[1];
 const prodR2=/^bucket_name\s*=\s*"([^"]+)"/m.exec(known)[1];
 const first=fixtures();first.d1[0].id=prodDb;
 assert.throws(()=>inspectCloudBindings(first,known),/Production ANALISE D1/);
 const second=fixtures();second.r2[1].name=prodR2;
 assert.throws(()=>inspectCloudBindings(second,known),/Missing r2/);
});
test("fails closed when existing ANALISE config lacks authoritative database identity",()=>{
 assert.throws(()=>inspectCloudBindings(fixtures(),"[vars]"),/Cannot establish/);
});
test("resists template injection of a wrong D1, R2 or public worker endpoint",()=>{
 const x=inspectCloudBindings(fixtures(),known);
 const source=readFileSync(new URL("../infra/wrangler.dev.toml.example",import.meta.url),"utf8");
 assert.throws(()=>renderWrangler("dev",x,source.replace('workers_dev = false','workers_dev = true')),/Incorrect/);
 assert.throws(()=>renderWrangler("dev",x,source.replace('analise-gis-dev-db','analise-db')),/Incorrect/);
 assert.throws(()=>renderWrangler("dev",x,source.replace('analise-gis-dev-geodata','analise-private-documents')),/Incorrect/);
 assert.throws(()=>renderWrangler("dev",x,source.replace('DEV_KV_ID_REQUIRED','STAGING_KV_ID_REQUIRED')),/placeholder/);
});
