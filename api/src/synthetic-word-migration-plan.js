// Pure fail-closed plan for *synthetic-only* D1 schema prerequisites.
// Designed for introspection via sqlite_master / PRAGMA table_info.
// No real document data, names, or operational fields are involved.
export const PREREQUISITES=Object.freeze({
  dq_occurrences:"table",
  demo_import_sessions:"table",
  demo_import_documents:"table"
});
export const SCHEMA_0016=Object.freeze({
  demo_report_versions:"table",
  demo_report_active:"table",
  demo_report_version_events:"table",
  demo_revision_check:"trigger",
  demo_revision_publish:"trigger",
  demo_versions_by_date:"index",
  demo_history_by_version:"index"
});
export const SCHEMA_0019=Object.freeze({
  demo_word_rows:"table",
  demo_word_row_audit:"table",
  demo_word_approved_occurrences:"view",
  demo_word_row_insert_audit:"trigger",
  demo_word_row_update_audit:"trigger",
  demo_word_row_initial_resolution:"trigger",
  demo_word_dq_updated:"trigger",
  demo_word_dq_inserted:"trigger",
  demo_word_rows_lookup:"index",
  demo_word_rows_pending:"index",
  demo_word_audit_by_row:"index"
});
const codeToType=Object.freeze({...PREREQUISITES,...SCHEMA_0016,...SCHEMA_0019});

export function planSyntheticWordMigrations(sqliteObjects,historyColumns){
  if(!Array.isArray(sqliteObjects)||!Array.isArray(historyColumns))
    throw Error("Cannot inspect remote D1 schema");
  const found=new Map();
  for(const obj of sqliteObjects){
    if(!obj||typeof obj.name!=="string"||typeof obj.type!=="string"||
       found.has(obj.name))throw Error("Ambiguous remote D1 schema");
    found.set(obj.name,obj.type);
  }
  for(const [name,type] of Object.entries(codeToType)){
    if(found.has(name)&&found.get(name)!==type)
      throw Error("Unexpected D1 schema object type: "+name);
  }
  const missingCore=Object.keys(PREREQUISITES).filter(name=>!found.has(name));
  if(missingCore.length)throw Error(
    "Missing prerequisite migration 0013/0015: "+missingCore.join(", ")+
    ". Stop before any D1 writes."
  );
  const columnExists=historyColumns.some(col=>col?.name==="version_id");
  const v16=Object.keys(SCHEMA_0016).filter(name=>found.has(name));
  const all16=v16.length===Object.keys(SCHEMA_0016).length;
  if((v16.length>0||columnExists)&&(!all16||!columnExists))
    throw Error("Incomplete migration 0016: manual review required; no D1 writes.");
  const v19=Object.keys(SCHEMA_0019).filter(name=>found.has(name));
  const all19=v19.length===Object.keys(SCHEMA_0019).length;
  if(v19.length>0&&!all19)
    throw Error("Incomplete migration 0019: manual review required; no D1 writes.");
  if(all19&&!all16)
    throw Error("Migration 0019 exists without complete 0016; manual review required.");
  return Object.freeze({
    apply0016:!all16,
    apply0019:!all19,
    versionColumnPresent:columnExists
  });
}
