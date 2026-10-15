/* ASTRA 3.0: client-side session-only report version planning.
 * No storage, authorization, or upload is performed by this module.
 */
(function (root) {
  "use strict";

  function validDay(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return false;
    const [year, month, date] = day.split("-").map(Number);
    if (year < 1900 || year > 9999) return false;
    const parsed = new Date(Date.UTC(year, month - 1, date));
    return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date;
  }

  function plan(entries, input) {
    const reportDay = input.reportDay || "";
    const sourceKind = input.sourceKind;
    const valid = validDay(reportDay) && (sourceKind === "excel" || sourceKind === "word");
    const history = valid ? entries.filter(function (item) {
      return item.structured && item.sourceKind === sourceKind &&
        item.reportDay === reportDay;
    }) : [];
    const previous = history.find(function (item) {
      return item.status === "checked";
    }) || null;
    const duplicate = entries.find(function (item) {
      return item.structured && item.hash && item.hash === input.hash;
    }) || null;
    const version = history.reduce(function (max, item) {
      return Math.max(max, Number(item.version) || 0);
    }, 0) + 1;
    return { valid: valid, duplicate: duplicate, previous: previous, version: version };
  }

  function accept(entries, input) {
    const decision = plan(entries, input);
    if (!decision.valid) throw Error("Оберіть коректну звітну дату.");
    if (decision.duplicate) throw Error("Такий файл уже прийнято в цій сесії.");
    const revised = entries.map(function (item) {
      if (item.structured && item.sourceKind === input.sourceKind &&
          item.reportDay === input.reportDay && item.status === "checked") {
        return Object.assign({}, item, { status: "superseded" });
      }
      return item;
    });
    const current = Object.assign({}, input, {
      structured: true, status: "checked", version: decision.version
    });
    return { entries: [current].concat(revised), current: current, previous: decision.previous };
  }

  const api = { validDay: validDay, plan: plan, accept: accept };
  root.ASTRA_REPORT_VERSIONS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
