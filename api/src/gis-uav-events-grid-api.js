// Coarse spatial aggregate of UAV-related operational events for admin GIS.
// Default mode is grid (cell centers), not individual event points.
// Requires migration 0021_operational_event_geo and a backfill of lat/lon from MGRS.

import { isGeoLayerEnabled, GIS_GEO_LAYERS } from "./gis-geo-layers.js";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'",
};

const respond = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const UAV_GRID_SQL = `WITH eligible AS (
  SELECT latitude AS lat, longitude AS lon
  FROM operational_event_geo
  WHERE latitude BETWEEN -85 AND 85
    AND longitude BETWEEN -180 AND 180
    AND (? IS NULL OR event_date >= ?)
    AND (? IS NULL OR event_date < ?)
), buckets AS (
  SELECT CAST((lat + 90) / ? AS INTEGER) AS y,
         CAST((lon + 180) / ? AS INTEGER) AS x
  FROM eligible
)
SELECT y, x, COUNT(*) AS n FROM buckets
GROUP BY y, x ORDER BY n DESC, y, x LIMIT 501`;

function parseParams(url) {
  const q = new URL(url).searchParams;
  const allowed = new Set(["cell", "from", "to"]);
  for (const key of q.keys()) {
    if (!allowed.has(key)) throw new Error("Непідтримувані параметри");
  }
  let cell = 0.5;
  if (q.has("cell")) {
    const raw = q.get("cell");
    if (!["0.25", "0.5", "1", "2"].includes(raw)) throw new Error("Неприпустима сітка");
    cell = Number(raw);
  }
  const from = q.get("from");
  const to = q.get("to");
  if (from != null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Некоректна дата from");
  if (to != null && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Некоректна дата to");
  return { cell, from: from || null, to: to || null };
}

export async function gisUavEventsGridApi(req, env, user) {
  if (req.method !== "GET") return respond({ error: "Дозволено лише GET" }, 405);
  if (user?.role !== "admin" || user.active !== 1)
    return respond({ error: "Лише адміністратор" }, 403);
  if (!isGeoLayerEnabled("uav_events"))
    return respond({ status: "disabled", kind: "uav_events_grid", items: [] });
  if (GIS_GEO_LAYERS.uav_events.mode !== "grid")
    return respond({
      status: "mode_not_grid",
      kind: "uav_events_grid",
      message: "Точкові події БПЛА вимкнені; увімкнено лише сітку",
      items: [],
    });

  let params;
  try {
    params = parseParams(req.url);
  } catch (e) {
    return respond({ error: e.message || "Некоректні параметри" }, 400);
  }
  if (!env?.DB)
    return respond({ status: "database_unavailable", error: "D1 недоступна" }, 503);

  const { cell, from, to } = params;
  try {
    const result = await env.DB.prepare(UAV_GRID_SQL)
      .bind(from, from, to, to, cell, cell)
      .all();
    const source = result.results || [];
    const truncated = source.length > 500;
    const items = [];
    for (const row of source.slice(0, 500)) {
      const x = Number(row.x);
      const y = Number(row.y);
      const count = Number(row.n);
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(count) || count < 1)
        continue;
      const lat = (y + 0.5) * cell - 90;
      const lon = (x + 0.5) * cell - 180;
      if (lat < -85 || lat > 85 || lon < -180 || lon > 180) continue;
      items.push({ id: x + "-" + y, lat, lon, count });
    }
    return respond({
      status: "available",
      kind: "uav_events_grid",
      read_only: true,
      geographic: true,
      centers_are_cell_centers: true,
      cell_degrees: cell,
      from,
      to,
      source: "operational_event_geo",
      truncated,
      count: items.length,
      items,
    });
  } catch (e) {
    if (/no such table/i.test(String(e?.message || e)))
      return respond({ status: "schema_missing", kind: "uav_events_grid", items: [] });
    return respond({ status: "query_failed", error: "Не вдалося прочитати сітку подій БПЛА" }, 503);
  }
}
