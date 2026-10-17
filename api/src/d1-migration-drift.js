// Read-only schema/history consistency checks. Names and types do not prove SQL equality.
import {SCHEMA_0016,SCHEMA_0019} from "./synthetic-word-migration-plan.js";

export const AUDITED_MIGRATIONS=Object.freeze({
  "0016_synthetic_report_versions.sql":Object.freeze({...SCHEMA_0016}),
  "0017_civil_office_inventory.sql":Object.freeze({
    civil_office_imports:"table",idx_civil_office_imports_recent:"index",
    civil_office_items:"table",idx_civil_office_items_date:"index",
    civil_office_reject_conflict:"trigger",civil_office_audit:"table",
    idx_civil_office_audit_batch:"index",civil_office_import_logged:"trigger",
    civil_office_row_logged:"trigger"
  }),
  "0018_operational_reports.sql":Object.freeze({
    operational_report_sessions:"table",idx_op_sessions_recent:"index",
    operational_report_events:"table",idx_op_events_session:"index",
    idx_op_events_object:"index",idx_op_events_station:"index"
  }),
  "0019_synthetic_word_records.sql":SCHEMA_0019
});

export function auditMigrationDrift({objects,history,documentColumns}){
  if(![objects,history,documentColumns].every(Array.isArray))throw Error("Invalid introspection response");
  const found=new Map();
  for(const obj of objects){
    if(!obj||typeof obj.name!=="string"||typeof obj.type!=="string"||found.has(obj.name))
      throw Error("Invalid or duplicate sqlite_master object");
    found.set(obj.name,obj.type);
  }
  const recorded=new Set();
  for(const item of history){
    if(!item||typeof item.name!=="string"||recorded.has(item.name))
      throw Error("Invalid migration history");
    recorded.add(item.name);
  }
  const hasVersionColumn=documentColumns.some(c=>c?.name==="version_id"&&c?.type?.toUpperCase()==="TEXT");
  const migrations=[];
  let noDetectedStructuralDrift=true;
  for(const [filename,expected] of Object.entries(AUDITED_MIGRATIONS)){
    const absent=[],wrongType=[];
    let presentCount=0;
    for(const [name,type] of Object.entries(expected)){
      const actual=found.get(name);
      if(actual===undefined)absent.push(name);
      else if(actual!==type)wrongType.push(name);
      else presentCount++;
    }
    if(filename.startsWith("0016_")&&!hasVersionColumn)
      absent.push("demo_import_documents.version_id (TEXT)");
    const complete=absent.length===0&&wrongType.length===0;
    const anyPresent=presentCount>0||wrongType.length>0||
      (filename.startsWith("0016_")&&hasVersionColumn);
    const isRecorded=recorded.has(filename);
    let status;
    if(complete&&isRecorded)status="recorded_and_structurally_present";
    else if(complete)status="present_but_unrecorded";
    else if(anyPresent)status="partial_or_inconsistent";
    else if(isRecorded)status="recorded_but_absent";
    else status="not_applied";
    if(!["recorded_and_structurally_present","not_applied"].includes(status))
      noDetectedStructuralDrift=false;
    migrations.push({filename,status,recorded:isRecorded,absent,wrongType});
  }
  return {migrations,noDetectedStructuralDrift,
    automaticMigrationRunAuthorized:false,
    scope:"object names, types, and 0016 version_id column only"};
}
