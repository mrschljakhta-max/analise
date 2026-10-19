// Read-only current VP/SP positions for admin GIS map.
// Requires migration 0020_vp_sp_locations. Empty until positions are imported.

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

const VP_SP_GEO_SQL = `
SELECT o.id AS object_id,
       o.code,
       o.kind,
       o.name,
       h.mgrs_precision_m,
       h.latitude,
       h.longitude,
       h.started_at,
       h.source_kind
FROM vp_sp_objects o
JOIN vp_sp_location_history h ON h.object_id = o.id AND h.ended_at IS NULL
WHERE o.is_active = 1
  AND h.latitude BETWEEN -90 AND 90
  AND h.longitude BETWEEN -180 AND 180
ORDER BY o.kind, o.name COLLATE NOCASE
LIMIT ?
`;

export async function gisVpSpGeoApi(req, env, user) {
  if (req.method !== "GET") return respond({ error: "Дозволено лише GET" }, 405);
  if (user?.role !== "admin" || user.active !== 1)
    return respond({ error: "Лише адміністратор" }, 403);
  if (!isGeoLayerEnabled("vp_sp"))
    return respond({ status: "disabled", kind: "vp_sp", items: [] });
  if (new URL(req.url).search)
    return respond({ error: "Непідтримувані параметри" }, 400);
  if (!env?.DB)
    return respond({ status: "database_unavailable", error: "D1 недоступна" }, 503);

  try {
    const result = await env.DB.prepare(VP_SP_GEO_SQL).bind(MAX_POINTS + 1).all();
    const rows = result.results || [];
    const truncated = rows.length > MAX_POINTS;
    const items = [];
    for (const row of rows.slice(0, MAX_POINTS)) {
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      const kind = row.kind === "vp" || row.kind === "sp" ? row.kind : "other";
      items.push({
        id: String(row.object_id),
        code: String(row.code || "").slice(0, 80),
        kind,
        name: String(row.name || "").slice(0, 160),
        mgrs_precision_m: Number(row.mgrs_precision_m) || null,
        lat,
        lon,
        started_at: row.started_at ? String(row.started_at).slice(0, 40) : null,
        source_kind: String(row.source_kind || "manual").slice(0, 20),
      });
    }
    return respond({
      status: "available",
      kind: "vp_sp",
      read_only: true,
      geographic: true,
      source: "vp_sp_location_history (open)",
      truncated,
      count: items.length,
      items,
    });
  } catch (e) {
    if (/no such table/i.test(String(e?.message || e)))
      return respond({ status: "schema_missing", kind: "vp_sp", items: [] });
    return respond({ status: "query_failed", error: "Не вдалося прочитати позиції ВП/СП" }, 503);
  }
}
