-- 0019: Persist allowlisted, fictional Word demo rows in D1.
-- Never accepts operational documents, coordinates, arbitrary free text or other datasets.
-- Historical synthetic snapshots from migration 0015 are backfilled idempotently.

CREATE TABLE IF NOT EXISTS demo_word_rows (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) IN (32,36)),
  version_id TEXT NOT NULL REFERENCES demo_report_versions(id),
  document_id TEXT NOT NULL REFERENCES demo_import_documents(id),
  source_row INTEGER NOT NULL CHECK(source_row BETWEEN 1 AND 100),
  source_ref TEXT NOT NULL CHECK(
    source_ref='synthetic-docx-2026-10-11:row-'||printf('%03d',source_row)||':label'
  ),
  source_label TEXT NOT NULL CHECK(source_label IN
    ('Альфа-демо','Альфа деммo','Бета-демо','Бетта-демо')),
  canonical_label TEXT CHECK(canonical_label IS NULL OR canonical_label IN
    ('Альфа-демо','Бета-демо')),
  resolution_origin TEXT NOT NULL DEFAULT 'none'
    CHECK(resolution_origin IN ('none','original','manual','rule')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(
    (canonical_label IS NULL AND resolution_origin='none') OR
    (canonical_label IS NOT NULL AND resolution_origin<>'none')
  ),
  UNIQUE(version_id,source_row)
);
CREATE INDEX IF NOT EXISTS demo_word_rows_lookup
  ON demo_word_rows(version_id,source_row);
CREATE INDEX IF NOT EXISTS demo_word_rows_pending
  ON demo_word_rows(version_id,canonical_label);

-- The only accepted resolution targets are the two seeded fictional labels.
-- Existing generic Purgatory cannot introduce arbitrary text into demo records.
CREATE VIEW IF NOT EXISTS demo_word_approved_occurrences AS
SELECT o.source_ref,o.raw_value,
  CASE
    WHEN o.target_id='demo_quality_alpha_v1' AND
      json_extract(e.data_json,'$.name')='Альфа-демо' THEN 'Альфа-демо'
    WHEN o.target_id='demo_quality_beta_v1' AND
      json_extract(e.data_json,'$.name')='Бета-демо' THEN 'Бета-демо'
    ELSE NULL
  END AS canonical_label,
  o.resolution_origin
FROM dq_occurrences o
JOIN directory_entries e ON e.id=o.target_id
  AND e.directory_id='demo_quality_labels' AND e.archived_at IS NULL
WHERE o.directory_id='demo_quality_labels'
  AND o.source_id='synthetic-docx-2026-10-11'
  AND o.active=1 AND o.status='resolved'
  AND o.resolution_origin IN ('manual','rule');

CREATE TABLE IF NOT EXISTS demo_word_row_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id TEXT NOT NULL REFERENCES demo_word_rows(id),
  action TEXT NOT NULL CHECK(action IN ('insert','resolution_changed')),
  before_label TEXT,
  after_label TEXT,
  origin TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS demo_word_audit_by_row
  ON demo_word_row_audit(row_id,id DESC);

CREATE TRIGGER IF NOT EXISTS demo_word_row_insert_audit
AFTER INSERT ON demo_word_rows BEGIN
  INSERT INTO demo_word_row_audit(row_id,action,before_label,after_label,origin)
  VALUES (NEW.id,'insert',NULL,NEW.canonical_label,NEW.resolution_origin);
END;

CREATE TRIGGER IF NOT EXISTS demo_word_row_update_audit
AFTER UPDATE OF canonical_label,resolution_origin ON demo_word_rows
WHEN OLD.canonical_label IS NOT NEW.canonical_label
   OR OLD.resolution_origin IS NOT NEW.resolution_origin
BEGIN
  INSERT INTO demo_word_row_audit(row_id,action,before_label,after_label,origin)
  VALUES (NEW.id,'resolution_changed',OLD.canonical_label,NEW.canonical_label,NEW.resolution_origin);
END;

-- Apply a previously approved correction when an older or new fixture is inserted.
CREATE TRIGGER IF NOT EXISTS demo_word_row_initial_resolution
AFTER INSERT ON demo_word_rows
WHEN NEW.source_label IN ('Альфа деммo','Бетта-демо')
BEGIN
  UPDATE demo_word_rows SET
    canonical_label=(
      SELECT canonical_label FROM demo_word_approved_occurrences a
      WHERE a.source_ref=NEW.source_ref AND a.raw_value=NEW.source_label
        AND a.canonical_label IS NOT NULL LIMIT 1
    ),
    resolution_origin=COALESCE((
      SELECT resolution_origin FROM demo_word_approved_occurrences a
      WHERE a.source_ref=NEW.source_ref AND a.raw_value=NEW.source_label
        AND a.canonical_label IS NOT NULL LIMIT 1
    ),'none'),
    updated_at=CURRENT_TIMESTAMP
  WHERE id=NEW.id;
END;

-- Corrected (or revoked) Purgatory values update the persisted rows automatically;
-- a second DOCX/ZIP upload is not needed.
CREATE TRIGGER IF NOT EXISTS demo_word_dq_updated
AFTER UPDATE OF status,target_id,raw_value,source_id,resolution_origin,active
ON dq_occurrences
WHEN NEW.directory_id='demo_quality_labels'
 AND NEW.source_id='synthetic-docx-2026-10-11'
BEGIN
  UPDATE demo_word_rows SET
    canonical_label=(
      SELECT canonical_label FROM demo_word_approved_occurrences a
      WHERE a.source_ref=NEW.source_ref AND a.raw_value=demo_word_rows.source_label
        AND a.canonical_label IS NOT NULL LIMIT 1
    ),
    resolution_origin=COALESCE((
      SELECT resolution_origin FROM demo_word_approved_occurrences a
      WHERE a.source_ref=NEW.source_ref AND a.raw_value=demo_word_rows.source_label
        AND a.canonical_label IS NOT NULL LIMIT 1
    ),'none'),
    updated_at=CURRENT_TIMESTAMP
  WHERE source_ref=NEW.source_ref
    AND source_label IN ('Альфа деммo','Бетта-демо');
END;

-- The same semantics apply if the queue item appears after the demo document.
CREATE TRIGGER IF NOT EXISTS demo_word_dq_inserted
AFTER INSERT ON dq_occurrences
WHEN NEW.directory_id='demo_quality_labels'
 AND NEW.source_id='synthetic-docx-2026-10-11'
BEGIN
  UPDATE demo_word_rows SET
    canonical_label=(
      SELECT canonical_label FROM demo_word_approved_occurrences a
      WHERE a.source_ref=NEW.source_ref AND a.raw_value=demo_word_rows.source_label
        AND a.canonical_label IS NOT NULL LIMIT 1
    ),
    resolution_origin=COALESCE((
      SELECT resolution_origin FROM demo_word_approved_occurrences a
      WHERE a.source_ref=NEW.source_ref AND a.raw_value=demo_word_rows.source_label
        AND a.canonical_label IS NOT NULL LIMIT 1
    ),'none'),
    updated_at=CURRENT_TIMESTAMP
  WHERE source_ref=NEW.source_ref
    AND source_label IN ('Альфа деммo','Бетта-демо');
END;

-- Materialize previously imported fictional Word rows without re-upload.
-- Records with the same immutable version+row key are inserted only once.
INSERT OR IGNORE INTO demo_word_rows
(id,version_id,document_id,source_row,source_ref,source_label,canonical_label,resolution_origin)
SELECT lower(hex(randomblob(16))),d.version_id,d.id,
  CAST(json_extract(j.value,'$.row') AS INTEGER),
  'synthetic-docx-2026-10-11:row-'||
     printf('%03d',CAST(json_extract(j.value,'$.row') AS INTEGER))||':label',
  json_extract(j.value,'$.label'),
  CASE WHEN json_extract(j.value,'$.label') IN ('Альфа-демо','Бета-демо')
       THEN json_extract(j.value,'$.label') ELSE NULL END,
  CASE WHEN json_extract(j.value,'$.label') IN ('Альфа-демо','Бета-демо')
       THEN 'original' ELSE 'none' END
FROM demo_import_documents d
JOIN json_each(d.snapshot_json,'$.detail') j
WHERE d.kind='docx' AND d.status='accepted'
 AND d.version_id IS NOT NULL
 AND d.document_name GLOB 'ANALISE_ДЕМО_*'
 AND json_type(j.value,'$.row')='integer'
 AND CAST(json_extract(j.value,'$.row') AS INTEGER) BETWEEN 1 AND 100
 AND json_type(j.value,'$.label')='text'
 AND json_extract(j.value,'$.label') IN
   ('Альфа-демо','Альфа деммo','Бета-демо','Бетта-демо')
 AND (
  (json_extract(j.value,'$.label') IN ('Альфа-демо','Бета-демо')
   AND json_extract(j.value,'$.status')='known')
  OR
  (json_extract(j.value,'$.label') IN ('Альфа деммo','Бетта-демо')
   AND json_extract(j.value,'$.status') IN ('review','resolved'))
 );
