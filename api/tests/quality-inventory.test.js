import test from "node:test";
import assert from "node:assert/strict";
import {validateQualityInventory,qualityInventoryApi} from "../src/quality-inventory-api.js";
const base={batch_key:"archive_20261017_a",nested_archives:1,files:[
 {format:"xlsx",total:12,unique:11},{format:"docx",total:5,unique:5},{format:"pdf",total:2,unique:1}
]};
test("metadata inventory validates counts and duplicate arithmetic",()=>{
 const data=validateQualityInventory(base);
 assert.equal(data.total,19);assert.equal(data.unique,17);assert.equal(data.duplicates,2);
 assert.equal(data.files.length,3);
});
test("rejects raw document properties, row details, and coordinates",()=>{
 for(const extra of [{file_name:"report.xlsx"},{mgrs:"XYZ"},{station:"test"},{frequencies:"x"},{rows:[{}]}]){
  assert.throws(()=>validateQualityInventory({...base,...extra}));
 }
 assert.throws(()=>validateQualityInventory({...base,files:[{...base.files[0],content:"secret"}]}));
 assert.throws(()=>validateQualityInventory({...base,files:[{format:"xlsx",total:1,unique:2}]}));
 assert.throws(()=>validateQualityInventory({...base,files:[base.files[0],base.files[0]]}));
});
test("only admins can access the inventory API",async()=>{
 const r=await qualityInventoryApi(new Request("https://test.invalid/api/quality-inventory"),{}, {role:"duty",active:1});
 assert.equal(r.status,403);
});
test("non-json or extra properties cannot write",async()=>{
 for(const body of [JSON.stringify({...base,coords:"47.0,35.0"}), "not json"]){
  const r=await qualityInventoryApi(new Request("https://test.invalid/api/quality-inventory",
    {method:"POST",headers:{"content-type":"application/json"},body}),{}, {id:"a",role:"admin",active:1});
  assert.equal(r.status,400);
 }
});
