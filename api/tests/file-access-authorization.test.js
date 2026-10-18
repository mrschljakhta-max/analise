import test from "node:test";
import assert from "node:assert/strict";
import {filesApi} from "../src/index.js";

const authorized={id:"admin-1",role:"admin",active:1};
const unauthorized=[
  null,{id:"duty-1",role:"duty",active:1},
  {id:"admin-2",role:"admin",active:0}
];
test("valid Access identity alone cannot list, download or write objects",async()=>{
  let touched=false;
  const env={DOCUMENTS:{
    async get(){touched=true;throw Error("GET leaked")},
    async put(){touched=true;throw Error("PUT leaked")}
  },DB:{prepare(){touched=true;throw Error("D1 leaked")}}};
  for(const user of unauthorized){
    for(const [method,path,parts] of [
      ["GET","/api/files",["api","files"]],
      ["GET","/api/files/example-id/download",["api","files","example-id","download"]],
      ["POST","/api/files",["api","files"]]
    ]){
      const request=new Request("https://unit.example"+path,{method});
      const response=await filesApi(request,env,user,parts);
      assert.equal(response.status,403);
    }
  }
  assert.equal(touched,false,"Nonadmin should not access D1 or R2");
});
test("admin can list metadata through authorized file route",async()=>{
  const env={DOCUMENTS:{},DB:{prepare(sql){
    assert.match(sql,/SELECT id,original_name,mime_type,byte_size/);
    return {async all(){return {results:[{id:"safe-id",original_name:"synthetic.txt",byte_size:12}]}}};
  }}};
  const res=await filesApi(new Request("https://unit.example/api/files"),env,authorized,["api","files"]);
  assert.equal(res.status,200);
  assert.equal((await res.json()).items[0].id,"safe-id");
});
