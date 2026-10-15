-- Reject repeated settlement identities, while allowing same names in different communities.
-- Other directory types can define their own identity rules in later migrations.
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_identity
ON directory_entries (
 lower(trim(json_extract(data_json,'$.name'))),
 lower(trim(json_extract(data_json,'$.type'))),
 lower(trim(json_extract(data_json,'$.community'))),
 lower(trim(json_extract(data_json,'$.district'))),
 lower(trim(json_extract(data_json,'$.region')))
)
WHERE directory_id='settlements' AND archived_at IS NULL;
