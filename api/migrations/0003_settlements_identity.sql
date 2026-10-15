-- Preserve homonymous settlements: the coordinates distinguish records.
-- This protects repeated uploads without treating a shared name as a duplicate.
DROP INDEX IF EXISTS idx_settlements_identity;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_identity
ON directory_entries (
 lower(trim(json_extract(data_json,'$.name'))),
 lower(trim(json_extract(data_json,'$.type'))),
 lower(trim(json_extract(data_json,'$.community'))),
 lower(trim(json_extract(data_json,'$.district'))),
 lower(trim(json_extract(data_json,'$.region'))),
 upper(trim(json_extract(data_json,'$.mgrs'))),
 CAST(json_extract(data_json,'$.lat') AS REAL),
 CAST(json_extract(data_json,'$.lon') AS REAL)
)
WHERE directory_id='settlements' AND archived_at IS NULL;
