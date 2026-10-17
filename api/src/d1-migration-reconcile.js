// Fail-closed review of already-applied synthetic D1 migrations.
// Pure functions only: no Cloudflare connection, writes or document data.
import {AUDITED_MIGRATIONS,auditMigrationDrift} from "./d1-migration-drift.js";
export const FIXED_FILES=Object.freeze([
 "0016_synthetic_report_versions.sql","0019_synthetic_word_records.sql"
]);
export function normalizeDefinition(sql){
 if(typeof sql!=="string"||!sql.trim())throw Error("Missing SQL definition");
 const input=sql.trim().replace(/^CREATE\s+(TABLE|INDEX|TRIGGER|VIEW)\s+IF\s+NOT\s+EXISTS\s+/i,"CREATE $1 ").replace(/;\s*$/,"");
 let output="",quoted=null;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){
   output+=c;
   if(c===quoted){
    if(input[i+1]===quoted)output+=input[++i];
    else quoted=null;
   }
  }else if(c==="'"||c==='"'||c.charCodeAt(0)===96){
   quoted=c;output+=c;
  }else if(/\s/.test(c)){
   // Whitespace is ignored only outside literal strings.
  }else output+=c;
 }
 if(quoted)throw Error("Unclosed SQL quote");
 return output;
}
export function extractExpectedObjects(migrationSql){
 if(typeof migrationSql!=="string")throw Error("Migration file is missing");
 const sql=migrationSql.replace(/^[ \t]*--.*$/gm,"");
 const re=/^(?:CREATE\s+(TABLE|INDEX|TRIGGER|VIEW)\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_]\w*)|ALTER TABLE\b|INSERT OR IGNORE\b)/gmi;
 const markers=[];let match;
 while((match=re.exec(sql)))markers.push({index:match.index,type:match[1],name:match[2]});
 const result=new Map();
 for(let i=0;i<markers.length;i++){
  const m=markers[i];if(!m.name)continue;
  if(result.has(m.name))throw Error("Duplicate DDL object");
  const content=sql.slice(m.index,markers[i+1]?.index??sql.length);
  result.set(m.name,{type:m.type.toLowerCase(),sql:normalizeDefinition(content)});
 }
 return result;
}
export function buildLedgerInsertSql(){
 const [v16,v19]=FIXED_FILES;
 // One atomic SQLite statement. Zero rows inserted causes a post-check error.
 return "INSERT INTO d1_migrations(name) "+
  "SELECT candidate.name FROM (SELECT '"+v16+"' AS name UNION ALL SELECT '"+v19+"') AS candidate "+
  "WHERE (SELECT COUNT(*) FROM d1_migrations)=15 "+
  "AND (SELECT COUNT(*) FROM d1_migrations WHERE name IN ('"+v16+"','"+v19+"'))=0 "+
  "AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE name IN ("+
   "'civil_office_imports','civil_office_items','operational_report_sessions','operational_report_events'))";
}
export function reviewD1Reconciliation({
 objects,history,documentColumns,foreignKeys,foreignKeyViolations,
 quickCheck,expectedMigrationFiles,baseMigrationNames,counts
}){
 if(!Array.isArray(objects)||!Array.isArray(history)||!Array.isArray(baseMigrationNames)||
  !Array.isArray(documentColumns)||!Array.isArray(foreignKeys)||!Array.isArray(foreignKeyViolations))
  throw Error("Incomplete D1 audit inputs");
 if(quickCheck!=="ok"||foreignKeyViolations.length!==0)
  throw Error("D1 integrity check failed or unavailable");
 if(baseMigrationNames.length!==15||new Set(baseMigrationNames).size!==15||
  !baseMigrationNames.every((x,i)=>/^00\d\d_.+\.sql$/.test(x)&&Number(x.slice(0,4))===i+1))
  throw Error("Unexpected baseline migration filenames");
 if(!counts||!["versions","active_versions","word_rows","audit_events"].every(
  k=>Number.isSafeInteger(counts[k])&&counts[k]>=0))
  throw Error("Invalid D1 row-count snapshot");
 if(counts.active_versions>counts.versions||counts.audit_events<counts.word_rows)
  throw Error("Suspicious D1 row-count invariants");
 const audit=auditMigrationDrift({objects,history,documentColumns});
 const statuses=Object.fromEntries(audit.migrations.map(v=>[v.filename,v.status]));
 for(const file of Object.keys(AUDITED_MIGRATIONS)){
  const eligible=FIXED_FILES.includes(file)?"present_but_unrecorded":"not_applied";
  const okay=FIXED_FILES.includes(file)?"recorded_and_structurally_present":"not_applied";
  if(statuses[file]!==eligible&&statuses[file]!==okay)
   throw Error("Unexpected D1 migration state: "+file);
 }
 const has16=statuses[FIXED_FILES[0]]==="recorded_and_structurally_present";
 const has19=statuses[FIXED_FILES[1]]==="recorded_and_structurally_present";
 if(has16!==has19)throw Error("Partially reconciled migration ledger");
 const expectedHistory=has16?[...baseMigrationNames,...FIXED_FILES]:baseMigrationNames;
 if(history.length!==expectedHistory.length||
  !history.every((row,i)=>row?.name===expectedHistory[i]&&row?.id===i+1))
  throw Error("D1 migration ledger is not the expected sequential baseline");
 const fk=foreignKeys.some(row=>row?.from==="version_id"&&
  row?.table==="demo_report_versions"&&row?.to==="id");
 if(!fk)throw Error("demo_import_documents.version_id foreign key mismatch");
 if(!expectedMigrationFiles||typeof expectedMigrationFiles!=="object")
  throw Error("Migration source files required");
 const found=new Map(objects.map(row=>[row.name,row]));
 const seen=new Set();
 for(const file of FIXED_FILES){
  const map=extractExpectedObjects(expectedMigrationFiles[file]);
  const allow=AUDITED_MIGRATIONS[file];
  if(map.size!==Object.keys(allow).length)
   throw Error("Unexpected number of DDL objects in "+file);
  for(const [name,type] of Object.entries(allow)){
   const expected=map.get(name),actual=found.get(name);
   if(!expected||!actual||expected.type!==type||actual.type!==type||
    normalizeDefinition(actual.sql)!==expected.sql)
    throw Error("D1 SQL mismatch for "+name);
   seen.add(name);
  }
 }
 if(seen.size!==18)throw Error("Expected object count mismatch");
 return Object.freeze({
  decision:has16?"already_reconciled":"eligible_for_manual_ledger_only_repair",
  counts:Object.freeze({...counts}),
  migrationCountBefore:history.length,
  verifiedDefinitions:seen.size,writeRequired:!has16,
  sql:has16?null:buildLedgerInsertSql()
 });
}
