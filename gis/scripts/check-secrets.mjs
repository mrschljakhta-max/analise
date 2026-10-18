import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/ghp_[A-Za-z0-9]{35,}/,/sk_live_[A-Za-z0-9]{16,}/];
let checked=0;
function inspect(dir){
 for(const f of readdirSync(dir,{withFileTypes:true})){
  if(["node_modules",".git","dist",".wrangler"].includes(f.name))continue;
  const path=join(dir,f.name);
  if(f.isDirectory()){inspect(path);continue;}
  if(!/\.(?:ts|tsx|js|mjs|toml|md|json|yml|yaml|sql)$/.test(f.name))continue;
  const text=readFileSync(path,"utf8");
  for(const rx of patterns)if(rx.test(text))throw Error("Potential secret in "+path);
  checked++;
 }
}
inspect("gis");console.log("PASS GIS basic secret guard ("+checked+" files); external scanning still required.");
