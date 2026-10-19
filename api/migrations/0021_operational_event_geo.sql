-- ANALISE: derived WGS84 for map layers from operational_report_events.mgrs.
-- Source of truth remains operational_report_events; this table holds only
-- committed-session geometry suitable for admin map layers.
-- No unit names, call signs, frequencies, or raw document text.

CREATE TABLE IF NOT EXISTS operational_event_geo (
  event_id TEXT PRIMARY KEY
    REFERENCES operational_report_events(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('och_excel','pbd_word')),
  event_date TEXT,
  uav_class TEXT NOT NULL
    CHECK(uav_class IN ('fpv','wing','multirotor','other')),
  mgrs TEXT NOT NULL,
  mgrs_precision_m REAL NOT NULL CHECK(mgrs_precision_m > 0),
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  has_station_ref INTEGER NOT NULL DEFAULT 0 CHECK(has_station_ref IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS op_event_geo_date
  ON operational_event_geo(event_date DESC);

CREATE INDEX IF NOT EXISTS op_event_geo_class
  ON operational_event_geo(uav_class, event_date DESC);

CREATE INDEX IF NOT EXISTS op_event_geo_session
  ON operational_event_geo(session_id);
