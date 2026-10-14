-- ANALISE generic administrative records; no operational military schema.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('duty','admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS references_catalog (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 60),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_reference
 ON references_catalog(kind, name) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY NOT NULL,
  source_name TEXT NOT NULL CHECK(length(source_name) BETWEEN 1 AND 160),
  external_code TEXT NOT NULL CHECK(length(external_code) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 120),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 2000),
  event_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  deletion_reason TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_active ON records(deleted_at, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_active_code
 ON records(source_name, external_code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS record_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_record_audit_record ON record_audit(record_id, id DESC);

CREATE TRIGGER IF NOT EXISTS audit_record_created AFTER INSERT ON records
BEGIN
 INSERT INTO record_audit(record_id, action, actor_id, before_json, after_json, at)
 VALUES (NEW.id, 'create', NEW.updated_by, NULL,
 json_object('source_name',NEW.source_name,'external_code',NEW.external_code,
 'category',NEW.category,'note',NEW.note,'event_at',NEW.event_at,'version',NEW.version), NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS audit_record_changed AFTER UPDATE ON records
BEGIN
 INSERT INTO record_audit(record_id, action, actor_id, before_json, after_json, at)
 VALUES (NEW.id, CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'soft_delete' ELSE 'update' END,
 NEW.updated_by,
 json_object('source_name',OLD.source_name,'external_code',OLD.external_code,'category',OLD.category,
 'note',OLD.note,'event_at',OLD.event_at,'version',OLD.version,'deleted_at',OLD.deleted_at),
 json_object('source_name',NEW.source_name,'external_code',NEW.external_code,'category',NEW.category,
 'note',NEW.note,'event_at',NEW.event_at,'version',NEW.version,'deleted_at',NEW.deleted_at),
 NEW.updated_at);
END;

CREATE TABLE IF NOT EXISTS source_files (
  id TEXT PRIMARY KEY NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_by_hash ON source_files(sha256);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY NOT NULL,
  source_file_id TEXT NOT NULL REFERENCES source_files(id),
  status TEXT NOT NULL CHECK(status IN ('received','review','approved','rejected','failed')),
  parser_version TEXT,
  profile_version TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS report_versions (
  id TEXT PRIMARY KEY NOT NULL,
  report_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','confirmed','superseded')),
  snapshot_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(report_name, version)
);
