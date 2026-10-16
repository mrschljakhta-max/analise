-- ANALISE operational reports: structured events from ОЧ_SE Excel and ПБД Word.
-- Original file bytes are never stored. Only validated structured rows enter D1.
-- Unknown directory values are queued to dq_occurrences (Purgatory) and do not block the rest.

CREATE TABLE IF NOT EXISTS operational_report_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('och_excel','pbd_word')),
  source_label TEXT NOT NULL CHECK(length(source_label) BETWEEN 1 AND 200),
  report_period TEXT CHECK(report_period IS NULL OR length(report_period) BETWEEN 1 AND 40),
  fingerprint TEXT NOT NULL UNIQUE CHECK(length(fingerprint)=64),
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 0 AND 5000),
  unresolved_count INTEGER NOT NULL DEFAULT 0 CHECK(unresolved_count >= 0),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','committed','partial')),
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_op_sessions_recent ON operational_report_sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS operational_report_events (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES operational_report_sessions(id),
  source_type TEXT NOT NULL CHECK(source_type IN ('och_excel','pbd_word')),
  source_row INTEGER NOT NULL CHECK(source_row >= 1),
  request_date TEXT,
  request_time TEXT,
  action_type TEXT,
  from_who TEXT,
  coverage_kind TEXT,
  object_name TEXT,
  unit_name TEXT,
  settlement_name TEXT,
  mgrs TEXT,
  cover_start TEXT,
  cover_end TEXT,
  notified_who TEXT,
  station_name TEXT,
  frequencies TEXT,
  event_datetime TEXT,
  uav_type TEXT,
  detection_settlement TEXT,
  result_text TEXT,
  station_block TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_op_events_session ON operational_report_events(session_id, source_row);
CREATE INDEX IF NOT EXISTS idx_op_events_object ON operational_report_events(object_name);
CREATE INDEX IF NOT EXISTS idx_op_events_station ON operational_report_events(station_name);
