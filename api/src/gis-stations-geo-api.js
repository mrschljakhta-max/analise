// Read-only current station positions for admin GIS map.
// Uses station_location_history where ended_at IS NULL.
// Does not return org_unit, frequencies, antenna parameters, or call-sign by default.

import { isGeoLayerEnabled } from "./gis-geo-layers.js";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'",
};

const respond = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const MAX_POINTS = 2000;

const STATIONS_GEO_SQL = `
SELECT s.id AS station_id,
       s.station_code,
       s.deployment_status,
       s.operational_status,
       st.name AS type_name,
       st.category AS type_category,
       h.mgrs,
       h.mgrs_precision_m,
       h.latitude,
       h.longitude,
       h.started_at
FROM stations s
JOIN station_location_history h ON h.station_id = s.id AND h.ended_at IS NULL
JOIN station_types st ON st.id = s.station_type_id
WHERE s.is_active = 1
  AND h.latitude BETWEEN -90 AND 90
  AND h.longitude BETWEEN -180 AND 180
ORDER BY s.station_code COLLATE NOCASE
LIMIT ?
`;

export async function gisStationsGeoApi(req, env, user) {
  if (req.method !== "GET") return respond({ error: "Дозволено лише GET" }, 405);
  if (user?.role !== "admin" || user.active !== 1)
    return respond({ error: "Лише адміністратор" }, 403);
  if (!isGeoLayerEnabled("stations"))
    return respond({ status: "disabled", kind: "stations", items: [] });
  if (new URL(req.url).search)
    return respond({ error: "Непідтримувані параметри" }, 400);
  if (!env?.DB)
    return respond({ status: "database_unavailable", error: "D1 недоступна" }, 503);

  try {
    const result = await env.DB.prepare(STATIONS_GEO_SQL).bind(MAX_POINTS + 1).all();
    const rows = result.results || [];
    const truncated = rows.length > MAX_POINTS;
    const items = [];
    for (const row of rows.slice(0, MAX_POINTS)) {
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      items.push({
        id: String(row.station_id),
        code: String(row.station_code || "").slice(0, 100),
        type_name: String(row.type_name || "").slice(0, 160),
        type_category: String(row.type_category || "").slice(0, 80),
        deployment_status: String(row.deployment_status || ""),
        operational_status: String(row.operational_status || ""),
        mgrs_precision_m: Number(row.mgrs_precision_m) || null,
        lat,
        lon,
        started_at: row.started_at ? String(row.started_at).slice(0, 40) : null,
      });
    }
    return respond({
      status: "available",
      kind: "stations",
      read_only: true,
      geographic: true,
      source: "station_location_history (open)",
      truncated,
      count: items.length,
      items,
    });
  } catch (e) {
    if (/no such table/i.test(String(e?.message || e)))
      return respond({ status: "schema_missing", kind: "stations", items: [] });
    return respond({ status: "query_failed", error: "Не вдалося прочитати позиції станцій" }, 503);
  }
}
