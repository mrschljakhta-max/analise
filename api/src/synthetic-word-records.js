// Synthetic-only materialized Word records. No operational/geospatial fields.
const LABELS=new Set(["Альфа-демо","Альфа деммo","Бета-демо","Бетта-демо"]);
const CANONICAL=new Set(["Альфа-демо","Бета-демо"]);

export async function syntheticWordRowsReady(DB){
  const present=await DB.prepare("SELECT name FROM sqlite_master "+
    "WHERE type='table' AND name='demo_word_rows' LIMIT 1").first();
  return Boolean(present);
}

// Statements run inside the *same* D1 transaction as synthetic history and
// immutable report versions. The version_id is resolved from the newly linked
// document row, avoiding duplicate inserts on identical uploads.
export function syntheticWordRowStatements(DB,{sessionId,inputHash,documents}){
  const statements=[];
  if(!Array.isArray(documents)||documents.length<1||documents.length>12)
    throw Error("Invalid synthetic document batch");
  for(let index=0;index<documents.length;index++){
    const doc=documents[index];
    if(doc.type!=="docx")continue;
    if(!Array.isArray(doc.detail)||doc.detail.length!==doc.records||
      doc.records<1||doc.records>100)throw Error("Invalid synthetic Word rows");
    const seen=new Set();
    for(const row of doc.detail){
      if(!Number.isSafeInteger(row.row)||row.row<1||row.row>100||
        seen.has(row.row)||!LABELS.has(row.label)||
        !["known","review","resolved"].includes(row.status)||
        (CANONICAL.has(row.label)!==(row.status==="known")))
        throw Error("Invalid synthetic Word record");
      seen.add(row.row);
      const canonical=CANONICAL.has(row.label)?row.label:null;
      statements.push(DB.prepare(
        "INSERT OR IGNORE INTO demo_word_rows "+
        "(id,version_id,document_id,source_row,source_ref,source_label,canonical_label,resolution_origin) "+
        "SELECT ?,d.version_id,d.id,?,?,?,?,? "+
        "FROM demo_import_documents d "+
        "WHERE d.session_id=? AND d.input_sha256=? AND d.member_index=? "+
        "AND d.kind='docx' AND d.status='accepted' AND d.version_id IS NOT NULL LIMIT 1"
      ).bind(
        crypto.randomUUID(),row.row,
        "synthetic-docx-2026-10-11:row-"+String(row.row).padStart(3,"0")+":label",
        row.label,canonical,canonical?"original":"none",sessionId,inputHash,index
      ));
    }
  }
  return statements;
}
