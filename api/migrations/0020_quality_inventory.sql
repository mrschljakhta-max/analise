-- Metadata-only quality inventory for approved, non-operational aggregates.
-- Does not insert raw documents, times, positions, station identifiers, frequency,
-- UAV events, or other record-level data. Existing imports and DQ remain intact.
CREATE TABLE IF NOT EXISTS quality_inventory_batches (
  id TEXT PRIMARY KEY,
  batch_key TEXT NOT NULL UNIQUE CHECK(length(batch_key) BETWEEN 3 AND 80),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  nested_archives INTEGER NOT NULL DEFAULT 0 CHECK(nested_archives BETWEEN 0 AND 100),
  total_files INTEGER NOT NULL CHECK(total_files BETWEEN 1 AND 100000),
  unique_files INTEGER NOT NULL CHECK(unique_files BETWEEN 0 AND total_files),
  duplicate_files INTEGER NOT NULL CHECK(duplicate_files = total_files - unique_files),
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quality_inventory_file_types (
  batch_id TEXT NOT NULL REFERENCES quality_inventory_batches(id) ON DELETE CASCADE,
  file_format TEXT NOT NULL CHECK(file_format IN ('xlsx','docx','pdf','csv','txt')),
  file_instances INTEGER NOT NULL CHECK(file_instances BETWEEN 1 AND 100000),
  unique_files INTEGER NOT NULL CHECK(unique_files BETWEEN 0 AND file_instances),
  duplicate_files INTEGER NOT NULL CHECK(duplicate_files = file_instances - unique_files),
  PRIMARY KEY(batch_id,file_format)
);
CREATE INDEX IF NOT EXISTS quality_inventory_recent_idx
  ON quality_inventory_batches(created_at DESC);
-- Read-only summary computed from stored quality metadata, not operational events.
CREATE VIEW IF NOT EXISTS quality_inventory_totals AS
SELECT batch_key,total_files,unique_files,duplicate_files,nested_archives,created_at
FROM quality_inventory_batches;
