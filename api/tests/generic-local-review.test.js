import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext,Script} from "node:vm";
import {GENERIC_LOCAL_REVIEW_JS} from "../src/generic-local-review-assets.js";
import {GENERIC_PREVIEW_JS} from "../src/generic-preview-client.js";
import {GENERIC_PREVIEW_HTML} from "../src/generic-preview-assets.js";
import worker from "../src/index.js";

const ctx={Date};runInNewContext(GENERIC_LOCAL_REVIEW_JS,ctx);
const review=ctx.AnaliseLocalReview;
const catalog=[{id:"alpha-1",name:"Альфа-демо"},{id:"beta-2",name:"Бета-демо"}];
const check=(status,raw,row)=>({
 sheet:"Таблиця 1",table_index:0,source_row:row,field:"value_2",
 original_value:raw,status,...
 (status==="matched"?{entry_id:"alpha-1",canonical_name:"Альфа-демо"}:{})
});
function start(){
 return review.begin({status:"checked",directory_id:"demo_quality_labels",checks:[
  check("matched","Альфа-демо",1),
  check("missing","Невідома вигадана назва",2),
  check("ambiguous","Бета—демо",3),
  check("empty","",4),
  {sheet:"Таблиця 1",source_row:null,field:null,original_value:"",
   status:"ambiguous_mapping"}
 ]},catalog,"2026-10-17T16:00:00Z");
}

test("review requires confirmed synthetic directory and complete catalog",()=>{
 assert.throws(()=>review.begin({status:"unavailable",directory_id:"demo_quality_labels",checks:[]},catalog),/Непідтверджений/);
 assert.throws(()=>review.begin({status:"checked",directory_id:"unknown",checks:[]},catalog),/Непідтверджений/);
 assert.throws(()=>review.begin({status:"checked",directory_id:"demo_quality_labels",checks:[]},[]),/не завантажено/);
});
test("review starts without implicit normalization or automatic decisions",()=>{
 const x=review.snapshot(start());
 assert.equal(x.persisted_in_d1,false);
 assert.equal(x.summary.matched,1);
 assert.equal(x.summary.pending,3);
 assert.equal(x.summary.needs_mapping,1);
 assert.equal(x.history.length,0);
 assert.equal(x.decisions[1].original_value,"Невідома вигадана назва");
});
test("manual resolution records before/after and preserves original value",()=>{
 const x=start(),after=review.decide(x,"2","map","beta-2","Підтверджено за тестовим довідником","2026-10-17T16:01:00Z");
 assert.equal(review.snapshot(after).summary.mapped,1);
 assert.equal(after.entries[1].original_value,"Невідома вигадана назва");
 assert.equal(after.entries[1].target_name,"Бета-демо");
 assert.equal(after.events[0].previous.status,"pending");
 assert.equal(after.events[0].next.status,"mapped");
 assert.equal(x.events.length,0);
 assert.equal(x.entries[1].status,"pending");
});
test("ignore, correction and undo append new events without erasing history",()=>{
 let x=start();
 x=review.decide(x,"2","ignore",null,"Виключено з тесту","2026-10-17T16:02:00Z");
 x=review.decide(x,"2","map","alpha-1","Уточнено після перегляду","2026-10-17T16:03:00Z");
 assert.equal(x.events.length,2);
 assert.equal(x.entries[1].target_id,"alpha-1");
 x=review.undo(x,"Скасувати останнє підтвердження","2026-10-17T16:04:00Z");
 assert.equal(x.events.length,3);
 assert.equal(x.events[2].action,"undo");
 assert.equal(x.events[2].reverts,2);
 assert.equal(x.entries[1].status,"ignored");
 assert.equal(x.entries[1].original_value,"Невідома вигадана назва");
 assert.throws(()=>review.undo(x,"Повторний відкат","2026-10-17T16:05:00Z"),/вже скасовано/);
});
test("unknown target, empty source and insufficient reason are rejected",()=>{
 const x=start();
 assert.throws(()=>review.decide(x,"2","map","unknown","Причина","x"),/відсутній/);
 assert.throws(()=>review.decide(x,"4","map","alpha-1","Причина","x"),/Порожнє/);
 assert.throws(()=>review.decide(x,"2","map","alpha-1","ні","x"),/причину/);
 assert.throws(()=>review.decide(x,"1","map","alpha-1","Причина","x"),/не можна/);
 assert.throws(()=>review.decide(x,"5","map","alpha-1","Причина","x"),/не можна/);
 assert.throws(()=>review.decide(x,"2","ignore","alpha-1","Причина","x"),/не потрібен/);
 assert.equal(x.events.length,0);
});
test("snapshot is JSON serializable, includes entire history and marks no D1 persistence",()=>{
 let x=start();
 x=review.decide(x,"2","ignore",null,"Виключено в тесті","2026-10-17T16:01:00Z");
 const exported=JSON.parse(JSON.stringify(review.snapshot(x)));
 assert.equal(exported.schema_version,"ANALISE_LOCAL_REVIEW_V1");
 assert.equal(exported.persisted_in_d1,false);
 assert.equal(exported.history.length,1);
 assert.equal(exported.decisions[1].original_value,"Невідома вигадана назва");
});
test("new asset is protected and never writes or stores data on device",async()=>{
 assert.doesNotThrow(()=>new Script(GENERIC_LOCAL_REVIEW_JS));
 assert.doesNotThrow(()=>new Script(GENERIC_PREVIEW_JS));
 assert.match(GENERIC_PREVIEW_HTML,/\/api\/generic-local-review\.js/);
 assert.match(GENERIC_PREVIEW_JS,/localReview\.mount/);
 assert.match(GENERIC_PREVIEW_JS,/reference_review/);
 assert.doesNotMatch(GENERIC_LOCAL_REVIEW_JS,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|indexedDB|sessionStorage/);
 const r=await worker.fetch(new Request("https://example.invalid/api/generic-local-review.js"),{});
 assert.equal(r.status,503);
});
