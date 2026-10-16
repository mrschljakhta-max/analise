-- Immutable revisions of synthetic demo report results.
-- Report date is extracted from the validated fixture; upload date is independent.
-- No original DOCX/XLSX bytes or operational records are stored.
CREATE TABLE IF NOT EXISTS demo_report_versions (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 kind TEXT NOT NULL CHECK(kind IN ('docx','xlsx')),
 report_date TEXT NOT NULL CHECK(report_date GLOB '????-??-??'),
 revision INTEGER NOT NULL CHECK(revision>=1),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
 source_name TEXT NOT NULL CHECK(length(source_name) BETWEEN 1 AND 160),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json)<=24000),
 session_id TEXT NOT NULL REFERENCES demo_import_sessions(id),
 previous_version_id TEXT REFERENCES demo_report_versions(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(kind,report_date,revision)
);
CREATE INDEX IF NOT EXISTS demo_versions_by_date ON demo_report_versions(report_date,kind,revision DESC);

CREATE TABLE IF NOT EXISTS demo_report_active (
 kind TEXT NOT NULL CHECK(kind IN ('docx','xlsx')),
 report_date TEXT NOT NULL CHECK(report_date GLOB '????-??-??'),
 version_id TEXT NOT NULL REFERENCES demo_report_versions(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(kind,report_date)
);

CREATE TABLE IF NOT EXISTS demo_report_version_events (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES demo_import_sessions(id),
 kind TEXT NOT NULL CHECK(kind IN ('docx','xlsx')),
 report_date TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('published','reused')),
 version_id TEXT NOT NULL REFERENCES demo_report_versions(id),
 expected_previous_id TEXT,
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(session_id,kind,report_date,version_id,event_type)
);

-- This check and pointer update run in the same D1 batch/SQLite transaction.
-- Stale previews cannot silently replace a version published by someone else.
CREATE TRIGGER IF NOT EXISTS demo_revision_check BEFORE INSERT ON demo_report_version_events
BEGIN
 SELECT CASE WHEN
  COALESCE((SELECT version_id FROM demo_report_active
    WHERE kind=NEW.kind AND report_date=NEW.report_date),'')
   != COALESCE(NEW.expected_previous_id,'')
 THEN RAISE(ABORT,'Stale demo report version') END;
 SELECT CASE WHEN NEW.event_type='reused' AND NEW.version_id
  != COALESCE(NEW.expected_previous_id,'')
 THEN RAISE(ABORT,'Wrong reused demo report version') END;
END;
CREATE TRIGGER IF NOT EXISTS demo_revision_publish AFTER INSERT ON demo_report_version_events
WHEN NEW.event_type='published'
BEGIN
 INSERT INTO demo_report_active(kind,report_date,version_id,updated_at)
 VALUES(NEW.kind,NEW.report_date,NEW.version_id,CURRENT_TIMESTAMP)
 ON CONFLICT(kind,report_date) DO UPDATE SET
  version_id=excluded.version_id, updated_at=CURRENT_TIMESTAMP;
END;

-- Existing synthetic history remains readable. Old rows have NULL version_id.
ALTER TABLE demo_import_documents ADD COLUMN version_id TEXT REFERENCES demo_report_versions(id);
CREATE INDEX IF NOT EXISTS demo_history_by_version ON demo_import_documents(version_id);
