-- Synthetic-only import history. Never stores original DOCX/XLSX/ZIP bytes.
-- Append-only logical sessions; each user drop creates an opaque session ID.
CREATE TABLE IF NOT EXISTS demo_import_sessions (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 input_count INTEGER NOT NULL DEFAULT 0 CHECK(input_count>=0),
 document_count INTEGER NOT NULL DEFAULT 0 CHECK(document_count>=0),
 row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count>=0),
 pending_count INTEGER NOT NULL DEFAULT 0 CHECK(pending_count>=0),
 auto_resolved_count INTEGER NOT NULL DEFAULT 0 CHECK(auto_resolved_count>=0),
 skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count>=0)
);
CREATE INDEX IF NOT EXISTS demo_import_session_recent ON demo_import_sessions(created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS demo_import_documents (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES demo_import_sessions(id),
 input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
 member_index INTEGER NOT NULL CHECK(member_index BETWEEN 0 AND 11),
 input_name TEXT NOT NULL CHECK(length(input_name) BETWEEN 1 AND 160),
 document_name TEXT NOT NULL CHECK(length(document_name) BETWEEN 1 AND 160),
 kind TEXT NOT NULL CHECK(kind IN ('docx','xlsx','unsupported')),
 status TEXT NOT NULL CHECK(status IN ('accepted','skipped')),
 row_count INTEGER NOT NULL CHECK(row_count BETWEEN 0 AND 100),
 pending_count INTEGER NOT NULL CHECK(pending_count BETWEEN 0 AND 100),
 auto_resolved_count INTEGER NOT NULL CHECK(auto_resolved_count BETWEEN 0 AND 100),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json)<=24000),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(session_id,input_sha256,member_index)
);
CREATE INDEX IF NOT EXISTS demo_import_documents_by_session ON demo_import_documents(session_id,member_index);
