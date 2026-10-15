-- Universal, non-operational reference directory infrastructure.
CREATE TABLE IF NOT EXISTS directory_types (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  schema_json TEXT NOT NULL CHECK(json_valid(schema_json)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS directory_entries (
  id TEXT PRIMARY KEY NOT NULL,
  directory_id TEXT NOT NULL REFERENCES directory_types(id),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directory_entries_active ON directory_entries(directory_id, archived_at, id);
CREATE TABLE IF NOT EXISTS directory_entry_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  directory_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  old_json TEXT,
  new_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directory_audit_entry ON directory_entry_audit(entry_id, id DESC);
INSERT OR IGNORE INTO directory_types(id,title,schema_json,created_at,updated_at)
VALUES ('settlements','Населені пункти','{"fields":[{"key":"name","required":true},{"key":"type","required":true},{"key":"community","required":true},{"key":"district","required":true},{"key":"region","required":true},{"key":"mgrs","required":false},{"key":"lat","required":false},{"key":"lon","required":false}]}',datetime('now'),datetime('now'));
