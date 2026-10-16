// Operational report parser for ANALISE.
// Excel ОЧ_SE (columns A-O) and Word ПБД (station activity tables).
// Does not persist anything itself.

const MAX_ROWS = 2000;

function normalizeName(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function stripVpPrefix(name) {
  let n = String(name || "").trim();
  if (/^ВП[\s.\-]+/i.test(n)) n = n.replace(/^ВП[\s.\-]+/i, "").trim();
  if (n.toLowerCase() === "матє") n = "Мате";
  return n;
}

function parseTime(v) {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2,"0")}:${m[2]}` : s.slice(0,8);
}

function parseDate(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  return s.slice(0,20);
}

export function parseOchExcel(tables) {
  const events = [];
  for (const table of tables || []) {
    const rows = table.rows || [];
    if (!rows.length) continue;
    let headerIdx = -1;
    const headers = [];
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const cells = (rows[i].cells || []).map(c => String(c.value || "").trim());
      const joined = cells.join(" ").toLowerCase();
      if (joined.includes("об'єкт прикриття") || joined.includes("обєкт прикриття") || joined.includes("тип дії")) {
        headerIdx = i;
        headers.push(...cells);
        break;
      }
    }
    if (headerIdx < 0) continue;
    const col = {};
    headers.forEach((h, idx) => {
      const n = h.toLowerCase();
      if (n.includes("дата запиту") || (n === "дата" && idx < 5)) col.date = idx;
      else if (n.includes("час запиту")) col.time = idx;
      else if (n.includes("тип дії")) col.action = idx;
      else if (n.includes("від кого")) col.from = idx;
      else if (n.includes("вид прикриття")) col.kind = idx;
      else if (n.includes("об'єкт") || n.includes("обєкт")) col.object = idx;
      else if (n.includes("підрозділ")) col.unit = idx;
      else if (n.includes("назва н.п") || n.includes("населений")) col.settlement = idx;
      else if (n.includes("координати") && n.includes("mgrs")) col.mgrs = idx;
      else if (n.includes("час початку")) col.start = idx;
      else if (n.includes("час завершення")) col.end = idx;
      else if (n.includes("кого повідомили")) col.notified = idx;
      else if (n.includes("станція")) col.station = idx;
      else if (n.includes("частоти")) col.freq = idx;
    });
    for (let r = headerIdx + 1; r < rows.length && events.length < MAX_ROWS; r++) {
      const cells = rows[r].cells || [];
      const get = (k) => (col[k] != null && cells[col[k]] ? String(cells[col[k]].value || "").trim() : "");
      const objectRaw = get("object");
      if (!objectRaw || /прикриття|інше/i.test(objectRaw)) continue;
      const objectName = stripVpPrefix(objectRaw);
      if (!objectName) continue;
      events.push({
        source_type: "och_excel",
        source_row: r + 1,
        request_date: parseDate(get("date")),
        request_time: parseTime(get("time")),
        action_type: get("action"),
        from_who: get("from"),
        coverage_kind: get("kind"),
        object_name: objectName,
        unit_name: get("unit"),
        settlement_name: get("settlement").replace(/\s*1\s*$/, "").trim(),
        mgrs: get("mgrs"),
        cover_start: parseTime(get("start")),
        cover_end: parseTime(get("end")),
        notified_who: get("notified"),
        station_name: get("station"),
        frequencies: get("freq"),
        raw: { object_raw: objectRaw }
      });
    }
  }
  return { events, source_type: "och_excel" };
}

export function parsePbdWord(tables) {
  const events = [];
  let currentStation = "";
  for (const table of tables || []) {
    const rows = table.rows || [];
    for (let r = 0; r < rows.length && events.length < MAX_ROWS; r++) {
      const cells = (rows[r].cells || []).map(c => String(c.value || "").trim());
      if (!cells.length) continue;
      const first = cells[0] || "";
      if (cells.length <= 2 && first && !/\d{1,2}[:.]\d{2}/.test(first) && first.length < 40 &&
          /малевич|бендер|халк|моцарт|медель|харібо|фієста|форель|титан|клаус|каракурт|кельт|клім|тор|анжен|фугас|сталкер|тінь/i.test(first)) {
        currentStation = first.replace(/[:：]/g, "").trim();
        continue;
      }
      if (/\d{1,2}:\d{2}/.test(first) || /\d{1,2}\.\d{1,2}\.\d{4}/.test(first)) {
        events.push({
          source_type: "pbd_word",
          source_row: r + 1,
          event_datetime: first,
          uav_type: cells[1] || "",
          detection_settlement: (cells[2] || "").replace(/^\d+\s*/, "").trim(),
          result_text: cells[3] || cells.slice(3).join(" ").trim(),
          station_block: currentStation,
          raw: { row: cells }
        });
      }
    }
  }
  return { events, source_type: "pbd_word" };
}

export function parseOperationalReport(tables, filename = "") {
  const name = String(filename).toLowerCase();
  if (name.includes("пбд") || name.includes("pbd") || name.endsWith(".docx")) {
    return parsePbdWord(tables);
  }
  return parseOchExcel(tables);
}
