-- Null-safe unique identity for public settlement gazetteer records.
-- Names alone are not unique; coordinates distinguish homonyms.
DROP INDEX IF EXISTS idx_settlements_identity;
CREATE UNIQUE INDEX idx_settlements_identity ON directory_entries(
 lower(trim(coalesce(json_extract(data_json,'$.name'),''))),
 lower(trim(coalesce(json_extract(data_json,'$.type'),''))),
 lower(trim(coalesce(json_extract(data_json,'$.community'),''))),
 lower(trim(coalesce(json_extract(data_json,'$.district'),''))),
 lower(trim(coalesce(json_extract(data_json,'$.region'),''))),
 upper(trim(coalesce(json_extract(data_json,'$.mgrs'),''))),
 coalesce(trim(CAST(json_extract(data_json,'$.lat') AS TEXT)),''),
 coalesce(trim(CAST(json_extract(data_json,'$.lon') AS TEXT)),'')
) WHERE directory_id='settlements' AND archived_at IS NULL;
