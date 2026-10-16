-- Synthetic-only reference dictionary for isolated upload/QC testing.
-- Deliberately no operational entity names or locations.
INSERT OR IGNORE INTO directory_types(id,title,schema_json,created_at,updated_at)
VALUES ('demo_quality_labels','ДЕМО · Тестові назви',
'{"fields":[{"key":"name","label":"Назва","type":"text","required":true}]}',
datetime('now'),datetime('now'));
