-- ANALISE: administrative equipment directory. No records or coordinates are seeded.
-- Stable import codes are separate from immutable internal IDs.
CREATE TABLE IF NOT EXISTS station_types (
 id TEXT PRIMARY KEY,
 import_code TEXT NOT NULL UNIQUE,
 type_code TEXT UNIQUE,
 name TEXT NOT NULL,
 normalized_name TEXT NOT NULL,
 category TEXT NOT NULL,
 can_detect INTEGER NOT NULL DEFAULT 0 CHECK(can_detect IN (0,1)),
 can_jam INTEGER NOT NULL DEFAULT 0 CHECK(can_jam IN (0,1)),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 note TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS station_type_antennas (
 id TEXT PRIMARY KEY,
 band_code TEXT NOT NULL UNIQUE,
 station_type_id TEXT NOT NULL REFERENCES station_types(id),
 antenna_kind TEXT NOT NULL CHECK(antenna_kind IN ('directional_jam','omni_jam','detection')),
 mode TEXT NOT NULL CHECK(mode IN ('detect','jam')),
 freq_from_mhz REAL NOT NULL CHECK(freq_from_mhz >= 0),
 freq_to_mhz REAL NOT NULL CHECK(freq_to_mhz >= freq_from_mhz),
 radius_km REAL NOT NULL CHECK(radius_km > 0),
 coverage_type TEXT NOT NULL CHECK(coverage_type IN ('omni','sector')),
 width_deg REAL NOT NULL CHECK(width_deg > 0 AND width_deg <= 360),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 UNIQUE(station_type_id, antenna_kind),
 CHECK((coverage_type='omni' AND width_deg=360) OR (coverage_type='sector' AND width_deg<360)),
 CHECK((antenna_kind='detection' AND mode='detect') OR (antenna_kind IN ('directional_jam','omni_jam') AND mode='jam')),
 CHECK((antenna_kind='omni_jam' AND coverage_type='omni') OR antenna_kind <> 'omni_jam'),
 CHECK((antenna_kind='directional_jam' AND coverage_type='sector') OR antenna_kind <> 'directional_jam')
);
CREATE INDEX IF NOT EXISTS station_type_antennas_type ON station_type_antennas(station_type_id);
CREATE TABLE IF NOT EXISTS stations (
 id TEXT PRIMARY KEY,
 station_code TEXT NOT NULL UNIQUE,
 call_sign TEXT NOT NULL,
 station_type_id TEXT NOT NULL REFERENCES station_types(id),
 org_unit_id TEXT REFERENCES org_units(id),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 deployment_status TEXT NOT NULL DEFAULT 'not_deployed'
   CHECK(deployment_status IN ('not_deployed','deployed','moving')),
 operational_status TEXT NOT NULL DEFAULT 'inactive'
   CHECK(operational_status IN ('active','inactive')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS stations_org_unit ON stations(org_unit_id);
CREATE INDEX IF NOT EXISTS stations_type ON stations(station_type_id);
CREATE TABLE IF NOT EXISTS station_antenna_states (
 station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
 type_antenna_id TEXT NOT NULL REFERENCES station_type_antennas(id),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 PRIMARY KEY(station_id, type_antenna_id)
);
-- Historic positions are retained even after a station is taken off deployment.
-- MGRS is the authoritative input; derived WGS84 values must be computed by the application.
CREATE TABLE IF NOT EXISTS station_location_history (
 id TEXT PRIMARY KEY,
 station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
 mgrs TEXT NOT NULL,
 mgrs_precision_m REAL NOT NULL CHECK(mgrs_precision_m > 0),
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 started_at TEXT NOT NULL,
 ended_at TEXT,
 CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS station_one_open_location
 ON station_location_history(station_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS station_location_history_station_dates
 ON station_location_history(station_id, started_at DESC);
