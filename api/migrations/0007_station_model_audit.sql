-- ANALISE: forward-only, administrative history for model metadata changes.
-- Existing station_types, stations, locations, and other directories are not changed.
-- Earlier modifications cannot be reconstructed; audit begins after applying this migration.
CREATE TABLE IF NOT EXISTS station_model_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL REFERENCES station_types(id),
  model_import_code TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_name TEXT NOT NULL,
  new_name TEXT NOT NULL,
  old_category TEXT NOT NULL,
  new_category TEXT NOT NULL,
  old_note TEXT NOT NULL,
  new_note TEXT NOT NULL,
  old_is_active INTEGER NOT NULL CHECK(old_is_active IN (0, 1)),
  new_is_active INTEGER NOT NULL CHECK(new_is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS station_model_audit_lookup
  ON station_model_audit(model_import_code, id DESC);

-- SQLite triggers execute in the same transaction as UPDATE.
-- Only actual changes to general administrative metadata are recorded.
CREATE TRIGGER IF NOT EXISTS station_model_audit_after_update
AFTER UPDATE OF name, category, note, is_active ON station_types
FOR EACH ROW
WHEN OLD.name IS NOT NEW.name
  OR OLD.category IS NOT NEW.category
  OR OLD.note IS NOT NEW.note
  OR OLD.is_active IS NOT NEW.is_active
BEGIN
  INSERT INTO station_model_audit (
    model_id, model_import_code,
    old_name, new_name,
    old_category, new_category,
    old_note, new_note,
    old_is_active, new_is_active
  ) VALUES (
    OLD.id, OLD.import_code,
    OLD.name, NEW.name,
    OLD.category, NEW.category,
    OLD.note, NEW.note,
    OLD.is_active, NEW.is_active
  );
END;
