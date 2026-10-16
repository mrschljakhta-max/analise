// Operational report import API.
// prepare: check directories, queue unknowns to purgatory.
// commit: persist validated events to D1 after explicit confirmation.
// Original file bytes are never accepted or stored.

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'"
};
const respond = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: HEADERS });
const fail = (s, e, extra = {}) => respond({ error: e, ...extra }, s);

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function normalize(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function lookupDirectory(db, table, column, value) {
  if (!value) return null;
  const n = normalize(value);
  try {
    const row = await db.prepare(
      `SELECT id FROM ${table} WHERE lower(trim(${column})) = ? LIMIT 1`
    ).bind(n).first();
    return row ? row.id : null;
  } catch {
    return null;
  }
}

async function queuePurgatory(db, userId, directoryHint, rawValue, sourceRef) {
  if (!rawValue || rawValue.length < 1) return;
  const id = crypto.randomUUID();
  const normalized = normalize(rawValue).slice(0, 200);
  try {
    await db.prepare(`
      INSERT INTO dq_occurrences (
        id, directory_id, source_id, source_ref, context_key,
        raw_value, normalized_value, status, resolution_origin,
        active, version, created_by, updated_by
      ) VALUES (?, ?, ?, ?, '', ?, ?, 'pending', 'none', 1, 1, ?, ?)
      ON CONFLICT DO NOTHING
    `).bind(
      id,
      directoryHint || "unknown",
      "operational_report",
      sourceRef.slice(0, 160),
      rawValue.slice(0, 200),
      normalized,
      userId,
      userId
    ).run();
  } catch {
    // Purgatory tables may not exist yet; ignore
  }
}

export async function operationalReportApi(req, env, user, segments) {
  if (!user || user.role !== "admin" || user.active !== 1) return fail(403, "Лише адміністратор");
  if (req.method !== "POST") return fail(405, "Дозволено лише POST");
  if (!env.DB) return fail(503, "D1 недоступна");

  const action = segments[2];
  if (!["prepare", "commit"].includes(action)) return fail(404, "Маршрут не знайдено");

  let body;
  try {
    const text = await req.text();
    if (text.length > 2_000_000) return fail(413, "Запит завеликий");
    body = JSON.parse(text);
  } catch {
    return fail(400, "Некоректний JSON");
  }

  const events = Array.isArray(body.events) ? body.events.slice(0, 2000) : [];
  const sourceType = body.source_type === "pbd_word" ? "pbd_word" : "och_excel";
  const sourceLabel = String(body.source_label || "звіт").slice(0, 200);
  const reportPeriod = String(body.report_period || "").slice(0, 40);

  if (!events.length) return fail(400, "Немає подій для обробки");

  const fingerprint = await sha256(JSON.stringify({
    sourceType, sourceLabel,
    events: events.map(e => e.source_row + "|" + (e.object_name || e.station_block || "") + "|" + (e.request_date || e.event_datetime || ""))
  }));

  if (action === "prepare") {
    const unresolved = [];
    for (const ev of events) {
      if (ev.object_name) {
        const hit = await lookupDirectory(env.DB, "vp_sp_objects", "name", ev.object_name);
        if (!hit) unresolved.push({ field: "object_name", value: ev.object_name, directory: "vp_sp" });
      }
      const settlement = ev.settlement_name || ev.detection_settlement;
      if (settlement) {
        const hit = await lookupDirectory(env.DB, "settlements", "name", settlement);
        if (!hit) unresolved.push({ field: "settlement", value: settlement, directory: "settlements" });
      }
      const station = ev.station_name || ev.station_block;
      if (station) {
        const hit = await lookupDirectory(env.DB, "stations", "name", station);
        if (!hit) unresolved.push({ field: "station", value: station, directory: "stations" });
      }
      if (ev.unit_name) {
        const hit = await lookupDirectory(env.DB, "org_units", "name", ev.unit_name);
        if (!hit) unresolved.push({ field: "unit", value: ev.unit_name, directory: "org" });
      }
    }

    const seen = new Set();
    for (const issue of unresolved) {
      const key = issue.directory + "|" + normalize(issue.value);
      if (seen.has(key)) continue;
      seen.add(key);
      await queuePurgatory(env.DB, user.id, issue.directory, issue.value, sourceLabel + ":" + issue.field);
    }

    return respond({
      fingerprint,
      source_type: sourceType,
      total: events.length,
      unresolved_count: unresolved.length,
      unique_unresolved: seen.size,
      ready_to_commit: true,
      sample_issues: unresolved.slice(0, 30)
    });
  }

  if (body.confirmed !== true || body.expected_fingerprint !== fingerprint) {
    return fail(409, "Потрібне повторне підтвердження незміненого набору");
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM operational_report_sessions WHERE fingerprint = ? LIMIT 1"
  ).bind(fingerprint).first();
  if (existing) return respond({ id: existing.id, reused: true, fingerprint });

  const sessionId = crypto.randomUUID();
  const unresolvedCount = unresolvedFromBody(events);

  try {
    await env.DB.prepare(`
      INSERT INTO operational_report_sessions
        (id, source_type, source_label, report_period, fingerprint, row_count, unresolved_count, status, actor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'committed', ?)
    `).bind(sessionId, sourceType, sourceLabel, reportPeriod || null, fingerprint, events.length, unresolvedCount, user.id).run();

    for (const ev of events) {
      await env.DB.prepare(`
        INSERT INTO operational_report_events (
          id, session_id, source_type, source_row,
          request_date, request_time, action_type, from_who, coverage_kind,
          object_name, unit_name, settlement_name, mgrs, cover_start, cover_end,
          notified_who, station_name, frequencies,
          event_datetime, uav_type, detection_settlement, result_text, station_block,
          raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), sessionId, sourceType, ev.source_row || 1,
        ev.request_date || null, ev.request_time || null, ev.action_type || null,
        ev.from_who || null, ev.coverage_kind || null, ev.object_name || null,
        ev.unit_name || null, ev.settlement_name || null, ev.mgrs || null,
        ev.cover_start || null, ev.cover_end || null, ev.notified_who || null,
        ev.station_name || null, ev.frequencies || null,
        ev.event_datetime || null, ev.uav_type || null, ev.detection_settlement || null,
        ev.result_text || null, ev.station_block || null,
        JSON.stringify(ev.raw || {})
      ).run();
    }
  } catch (e) {
    return fail(503, "Не вдалося записати в D1");
  }

  return respond({
    id: sessionId,
    fingerprint,
    stored: events.length,
    status: "committed"
  });
}

function unresolvedFromBody(events) {
  let n = 0;
  for (const e of events) if (e.issues && e.issues.length) n += e.issues.length;
  return n;
}
