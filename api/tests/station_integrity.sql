-- ANALISE / read-only integrity checks for station directory.
-- Execute after migration 0006 in a local or isolated test D1 database.
-- Expected result: each violation query returns ZERO rows.
PRAGMA foreign_key_check;
SELECT 'duplicate_station_code' AS issue, station_code AS record_key, COUNT(*) AS count
 FROM stations GROUP BY station_code HAVING COUNT(*) > 1;
SELECT 'duplicate_model_code' AS issue, import_code AS record_key, COUNT(*) AS count
 FROM station_types GROUP BY import_code HAVING COUNT(*) > 1;
SELECT 'multiple_open_locations' AS issue, station_id AS record_key, COUNT(*) AS count
 FROM station_location_history WHERE ended_at IS NULL GROUP BY station_id HAVING COUNT(*) > 1;
SELECT 'antenna_model_mismatch' AS issue, s.station_code AS record_key, a.band_code AS details
 FROM station_antenna_states st
 JOIN stations s ON s.id=st.station_id
 JOIN station_type_antennas a ON a.id=st.type_antenna_id
 WHERE s.station_type_id<>a.station_type_id;
SELECT 'invalid_antenna_capability' AS issue, t.import_code AS record_key, a.band_code AS details
 FROM station_type_antennas a JOIN station_types t ON t.id=a.station_type_id
 WHERE (a.mode='detect' AND t.can_detect<>1) OR (a.mode='jam' AND t.can_jam<>1);
SELECT 'deployed_without_open_location' AS issue, s.station_code AS record_key, s.deployment_status AS details
 FROM stations s
 WHERE s.deployment_status='deployed' AND NOT EXISTS (
 SELECT 1 FROM station_location_history h WHERE h.station_id=s.id AND h.ended_at IS NULL
 );
SELECT 'not_deployed_with_open_location' AS issue, s.station_code AS record_key, s.deployment_status AS details
 FROM stations s
 WHERE s.deployment_status='not_deployed' AND EXISTS (
 SELECT 1 FROM station_location_history h WHERE h.station_id=s.id AND h.ended_at IS NULL
 );
-- Read-only counters (not violations)
SELECT 'station_types' AS entity,COUNT(*) AS count FROM station_types
 UNION ALL SELECT 'station_type_antennas',COUNT(*) FROM station_type_antennas
 UNION ALL SELECT 'stations',COUNT(*) FROM stations
 UNION ALL SELECT 'station_antenna_states',COUNT(*) FROM station_antenna_states
 UNION ALL SELECT 'station_location_history',COUNT(*) FROM station_location_history;
