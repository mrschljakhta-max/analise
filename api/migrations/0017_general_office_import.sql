-- Additive, general-purpose document-table storage for explicitly confirmed imports.
-- No changes to the existing ANALISE dictionaries, Purgatory or demo reporting modules.
CREATE TABLE IF NOT EXISTS general_imports (
 id TEXT PRIMARY KEY,
 created_by TEXT NOT NULL REFERENCES users(id),
 source_name TEXT NOT NULL CHECK(length(source_name) BETWEEN 1 AND 160),
 file_sha256 TEXT NOT NULL CHECK(length(file_sha256)=64),
 table_ref TEXT NOT NULL CHECK(length(table_ref) BETWEEN 1 AND 32),
 table_title TEXT NOT NULL CHECK(length(table_title) BETWEEN 1 AND 160),
 config_sha256 TEXT NOT NULL CHECK(length(config_sha256)=64),
 columns_json TEXT NOT NULL CHECK(json_valid(columns_json)),
 records_count INTEGER NOT NULL CHECK(records_count BETWEEN 0 AND 400),
 issues_count INTEGER NOT NULL CHECK(issues_count BETWEEN 0 AND 400),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(created_by,file_sha256,table_ref,config_sha256)
);
CREATE INDEX IF NOT EXISTS general_imports_recent ON general_imports(created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS general_import_rows (
 import_id TEXT NOT NULL REFERENCES general_imports(id),
 item_no INTEGER NOT NULL,
 source_row INTEGER NOT NULL,
 values_json TEXT NOT NULL CHECK(json_valid(values_json)),
 validation_json TEXT NOT NULL CHECK(json_valid(validation_json)),
 review_status TEXT NOT NULL CHECK(review_status IN ('valid','needs_review')),
 PRIMARY KEY(import_id,item_no)
);
CREATE INDEX IF NOT EXISTS general_imports_rows_review ON general_import_rows(import_id,review_status);
