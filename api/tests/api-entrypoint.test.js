import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

// Regression: a previous direct edit replaced the entire Worker entrypoint
// with the syntactically valid single identifier "PLACEHOLDER".
// node --check alone does not catch such a corruption.
const source=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");

test("the API entrypoint exports a real Cloudflare fetch handler",()=>{
  assert.ok(source.length>10000,"Entrypoint is unexpectedly short");
  assert.doesNotMatch(source,/\bPLACEHOLDER\b/);
  assert.equal(typeof worker,"object");
  assert.equal(typeof worker.fetch,"function");
  assert.match(source,/\bexport default\s*\{/);
  assert.match(source,/async fetch\(req, env\)/);
});

test("Cloudflare Access is verified before serving private data",()=>{
  assert.match(source,/Cf-Access-Jwt-Assertion/);
  assert.match(source,/createRemoteJWKSet/);
  assert.match(source,/jwtVerify\(/);
  assert.match(source,/ACCESS_AUD/);
  assert.match(source,/SELECT id,email,role,active FROM users/);
});

test("restored entrypoint preserves existing protected application routes",()=>{
  for(const path of [
    "/api/dashboard",
    "/api/database-viewer",
    "/api/generic-preview",
    "/api/synthetic-upload",
    "/api/purgatory"
  ])assert.ok(source.includes(path),"Missing established route: "+path);
  assert.ok(!source.includes("/api/operational-reports"),
    "Unreviewed report write endpoints must not be enabled in a recovery-only PR");
});

test("private routes fail closed with missing Access/D1 configuration",async()=>{
  const request=new Request("https://example.invalid/api/dashboard",{
    method:"GET",headers:{"accept":"text/html"}
  });
  const result=await worker.fetch(request,{});
  assert.equal(result.status,503);
  assert.match(await result.text(),/Сервер не налаштований/);
});

test("homepage is just a redirect, never an unauthenticated HTML dashboard",async()=>{
  const result=await worker.fetch(new Request("https://example.invalid/"),{});
  assert.equal(result.status,302);
  assert.equal(result.headers.get("location"),"https://example.invalid/api/dashboard");
  assert.equal(result.headers.get("cache-control"),"no-store");
});
