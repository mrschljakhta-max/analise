-- ANALISE VP/SP directory: names-only administrative index.
-- Sensitive source coordinates and unit affiliation are NOT ingested or stored.
CREATE TABLE IF NOT EXISTS vp_sp_objects (
 id TEXT PRIMARY KEY,
 code TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('vp','sp')),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 normalized_name TEXT NOT NULL CHECK(length(normalized_name) BETWEEN 1 AND 160),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(kind,normalized_name)
);
CREATE INDEX IF NOT EXISTS vp_sp_objects_by_kind ON vp_sp_objects(kind,is_active);

CREATE TABLE IF NOT EXISTS vp_sp_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 object_id TEXT NOT NULL,
 object_code TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('created','updated')),
 old_json TEXT,
 new_json TEXT,
 changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS vp_sp_audit_object ON vp_sp_audit(object_code,id DESC);

CREATE TRIGGER IF NOT EXISTS vp_sp_objects_audit_insert
AFTER INSERT ON vp_sp_objects
BEGIN
 INSERT INTO vp_sp_audit(object_id,object_code,action,old_json,new_json)
 VALUES (NEW.id,NEW.code,'created',NULL,
   json_object('name',NEW.name,'kind',NEW.kind,'is_active',NEW.is_active));
END;

CREATE TRIGGER IF NOT EXISTS vp_sp_objects_audit_update
AFTER UPDATE OF name,kind,is_active ON vp_sp_objects
FOR EACH ROW WHEN OLD.name IS NOT NEW.name OR OLD.kind IS NOT NEW.kind
  OR OLD.is_active IS NOT NEW.is_active
BEGIN
 INSERT INTO vp_sp_audit(object_id,object_code,action,old_json,new_json)
 VALUES (NEW.id,NEW.code,'updated',
   json_object('name',OLD.name,'kind',OLD.kind,'is_active',OLD.is_active),
   json_object('name',NEW.name,'kind',NEW.kind,'is_active',NEW.is_active));
END;
