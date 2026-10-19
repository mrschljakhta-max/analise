-- ANALISE: history of VP/SP positions. MGRS is authoritative; WGS84 derived by app.
-- Does not store unit affiliation, routes, frequencies, or source document text.
-- One open location per object (ended_at IS NULL).

CREATE TABLE IF NOT EXISTS vp_sp_location_history (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES vp_sp_objects(id) ON DELETE CASCADE,
  mgrs TEXT NOT NULL,
  mgrs_precision_m REAL NOT NULL CHECK(mgrs_precision_m > 0),
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK(source_kind IN ('manual','import','report_link')),
  note TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS vp_sp_one_open_location
  ON vp_sp_location_history(object_id) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS vp_sp_location_object_dates
  ON vp_sp_location_history(object_id, started_at DESC);
