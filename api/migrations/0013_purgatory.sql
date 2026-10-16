-- Generic, non-operational data-quality review queue. No records are seeded.
-- These tables never modify the existing directory data or document originals.
CREATE TABLE IF NOT EXISTS dq_occurrences (
 id TEXT PRIMARY KEY,
 directory_id TEXT NOT NULL REFERENCES directory_types(id),
 source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 120),
 source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 160),
 context_key TEXT NOT NULL DEFAULT '' CHECK(length(context_key)<=100),
 raw_value TEXT NOT NULL CHECK(length(raw_value) BETWEEN 1 AND 200),
 normalized_value TEXT NOT NULL CHECK(length(normalized_value) BETWEEN 1 AND 200),
 target_id TEXT REFERENCES directory_entries(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','ignored')),
 resolution_origin TEXT NOT NULL DEFAULT 'none' CHECK(resolution_origin IN ('none','rule','manual')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(directory_id,context_key,source_ref)
);
CREATE INDEX IF NOT EXISTS dq_queue_idx ON dq_occurrences(active,status,directory_id,context_key,normalized_value);
CREATE INDEX IF NOT EXISTS dq_source_idx ON dq_occurrences(source_id,active);

CREATE TABLE IF NOT EXISTS dq_rules (
 id TEXT PRIMARY KEY,
 directory_id TEXT NOT NULL REFERENCES directory_types(id),
 context_key TEXT NOT NULL DEFAULT '' CHECK(length(context_key)<=100),
 normalized_value TEXT NOT NULL CHECK(length(normalized_value) BETWEEN 1 AND 200),
 raw_example TEXT NOT NULL,
 target_id TEXT NOT NULL REFERENCES directory_entries(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(directory_id,context_key,normalized_value)
);
CREATE INDEX IF NOT EXISTS dq_rules_status_idx ON dq_rules(active,directory_id);

CREATE TABLE IF NOT EXISTS dq_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 entity_type TEXT NOT NULL CHECK(entity_type IN ('occurrence','rule')),
 entity_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('created','updated')),
 actor_id TEXT,
 before_json TEXT,
 after_json TEXT NOT NULL,
 at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS dq_audit_recent_idx ON dq_audit(id DESC);
CREATE INDEX IF NOT EXISTS dq_audit_entity_idx ON dq_audit(entity_type,entity_id,id DESC);

CREATE TRIGGER IF NOT EXISTS dq_occurrence_created AFTER INSERT ON dq_occurrences
BEGIN
 INSERT INTO dq_audit(entity_type,entity_id,action,actor_id,before_json,after_json)
 VALUES ('occurrence',NEW.id,'created',NEW.created_by,NULL,
 json_object('raw',NEW.raw_value,'directory',NEW.directory_id,'context',NEW.context_key,
 'source',NEW.source_ref,'target',NEW.target_id,'status',NEW.status,'active',NEW.active,'origin',NEW.resolution_origin));
END;
CREATE TRIGGER IF NOT EXISTS dq_occurrence_updated AFTER UPDATE ON dq_occurrences
WHEN OLD.raw_value IS NOT NEW.raw_value OR OLD.status IS NOT NEW.status OR
 OLD.target_id IS NOT NEW.target_id OR OLD.active IS NOT NEW.active OR OLD.resolution_origin IS NOT NEW.resolution_origin
BEGIN
 INSERT INTO dq_audit(entity_type,entity_id,action,actor_id,before_json,after_json)
 VALUES ('occurrence',NEW.id,'updated',NEW.updated_by,
 json_object('raw',OLD.raw_value,'directory',OLD.directory_id,'context',OLD.context_key,
 'source',OLD.source_ref,'target',OLD.target_id,'status',OLD.status,'active',OLD.active,'origin',OLD.resolution_origin),
 json_object('raw',NEW.raw_value,'directory',NEW.directory_id,'context',NEW.context_key,
 'source',NEW.source_ref,'target',NEW.target_id,'status',NEW.status,'active',NEW.active,'origin',NEW.resolution_origin));
END;
CREATE TRIGGER IF NOT EXISTS dq_rule_created AFTER INSERT ON dq_rules
BEGIN
 INSERT INTO dq_audit(entity_type,entity_id,action,actor_id,before_json,after_json)
 VALUES ('rule',NEW.id,'created',NEW.created_by,NULL,
 json_object('directory',NEW.directory_id,'context',NEW.context_key,
 'normalized',NEW.normalized_value,'target',NEW.target_id,'active',NEW.active,'version',NEW.version));
END;
CREATE TRIGGER IF NOT EXISTS dq_rule_updated AFTER UPDATE ON dq_rules
WHEN OLD.target_id IS NOT NEW.target_id OR OLD.active IS NOT NEW.active
BEGIN
 INSERT INTO dq_audit(entity_type,entity_id,action,actor_id,before_json,after_json)
 VALUES ('rule',NEW.id,'updated',NEW.updated_by,
 json_object('directory',OLD.directory_id,'context',OLD.context_key,
 'normalized',OLD.normalized_value,'target',OLD.target_id,'active',OLD.active,'version',OLD.version),
 json_object('directory',NEW.directory_id,'context',NEW.context_key,
 'normalized',NEW.normalized_value,'target',NEW.target_id,'active',NEW.active,'version',NEW.version));
END;
