-- Generic organization directory storage. No real unit records are seeded.
CREATE TABLE IF NOT EXISTS org_units (
 id TEXT PRIMARY KEY,
 import_key TEXT NOT NULL UNIQUE,
 unit_code TEXT NOT NULL UNIQUE,
 full_name TEXT NOT NULL,
 short_name TEXT NOT NULL,
 unit_type TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS org_relations (
 id TEXT PRIMARY KEY,
 import_key TEXT NOT NULL UNIQUE,
 child_id TEXT NOT NULL REFERENCES org_units(id),
 parent_id TEXT NOT NULL REFERENCES org_units(id),
 relation_type TEXT NOT NULL CHECK(relation_type IN ('organizational','temporary')),
 valid_from TEXT,
 valid_to TEXT,
 basis TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','closed')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(child_id <> parent_id),
 CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_one_parent ON org_relations(child_id)
 WHERE relation_type='organizational' AND state='active';
CREATE INDEX IF NOT EXISTS org_relations_parent ON org_relations(parent_id);
CREATE TABLE IF NOT EXISTS org_import_audit (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL,
 units_count INTEGER NOT NULL,
 relations_count INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);