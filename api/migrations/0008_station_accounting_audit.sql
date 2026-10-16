-- ANALISE administrative station-accounting audit, forward-only.
-- No changes to existing station rows, organizational directories or location history.
-- The trigger logs only changes to call_sign, org_unit_id and is_active.
-- The author is not recorded; earlier changes cannot be reconstructed.
CREATE TABLE IF NOT EXISTS station_accounting_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL REFERENCES stations(id),
  station_code TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_call_sign TEXT NOT NULL,
  new_call_sign TEXT NOT NULL,
  old_org_unit_id TEXT,
  new_org_unit_id TEXT,
  old_org_unit_label TEXT NOT NULL,
  new_org_unit_label TEXT NOT NULL,
  old_is_active INTEGER NOT NULL CHECK(old_is_active IN (0, 1)),
  new_is_active INTEGER NOT NULL CHECK(new_is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS station_accounting_audit_by_station
 ON station_accounting_audit(station_code, id DESC);

-- Trigger and station UPDATE execute atomically (also for changes made outside the API).
-- Human-readable unit labels are stored as snapshots; their later renaming won't
-- retroactively change old station-accounting history.
CREATE TRIGGER IF NOT EXISTS station_accounting_audit_after_update
AFTER UPDATE OF call_sign, org_unit_id, is_active ON stations
FOR EACH ROW
WHEN OLD.call_sign IS NOT NEW.call_sign
  OR OLD.org_unit_id IS NOT NEW.org_unit_id
  OR OLD.is_active IS NOT NEW.is_active
BEGIN
  INSERT INTO station_accounting_audit (
    station_id, station_code,
    old_call_sign, new_call_sign,
    old_org_unit_id, new_org_unit_id,
    old_org_unit_label, new_org_unit_label,
    old_is_active, new_is_active
  ) VALUES (
    OLD.id, OLD.station_code,
    OLD.call_sign, NEW.call_sign,
    OLD.org_unit_id, NEW.org_unit_id,
    COALESCE((
      SELECT NULLIF(TRIM(unit_code || ' · ' || short_name), '')
      FROM org_units WHERE id=OLD.org_unit_id
    ), '(без підрозділу)'),
    COALESCE((
      SELECT NULLIF(TRIM(unit_code || ' · ' || short_name), '')
      FROM org_units WHERE id=NEW.org_unit_id
    ), '(без підрозділу)'),
    OLD.is_active, NEW.is_active
  );
END;
