"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validDay, todayKyiv, plan, accept } = require("../report-versions.js");

function report(sourceKind, reportDay, hash) {
  return { name: "synthetic." + (sourceKind === "excel" ? "xlsx" : "docx"),
    sourceKind, reportDay, hash, kind: sourceKind.toUpperCase() };
}

test("manual report day must be a real calendar date", () => {
  assert.equal(validDay(""), false);
  assert.equal(validDay("2026-02-29"), false);
  assert.equal(validDay("2024-02-29"), true);
  assert.equal(validDay("2026-10-15"), true);
  assert.equal(validDay("2026-13-01"), false);
});

test("first import creates version 1", () => {
  const result = accept([], report("excel", "2026-10-15", "hash-1"));
  assert.equal(result.current.version, 1);
  assert.equal(result.current.status, "checked");
  assert.equal(result.entries.length, 1);
});

test("replacement marks previous revision as superseded", () => {
  const first = accept([], report("excel", "2026-10-15", "hash-1"));
  const second = accept(first.entries, report("excel", "2026-10-15", "hash-2"));
  assert.equal(second.current.version, 2);
  assert.equal(second.entries[1].status, "superseded");
  assert.equal(second.entries.filter(x => x.status === "checked").length, 1);
  assert.equal(first.entries[0].status, "checked", "previous history must not be mutated");
});

test("Excel and Word revisions are independent on the same reporting day", () => {
  let entries = accept([], report("excel", "2026-10-15", "x-1")).entries;
  entries = accept(entries, report("word", "2026-10-15", "w-1")).entries;
  assert.equal(entries.filter(x => x.status === "checked").length, 2);
  assert.equal(plan(entries, report("word", "2026-10-15", "w-2")).version, 2);
  assert.equal(plan(entries, report("excel", "2026-10-16", "x-2")).version, 1);
});

test("the exact same file bytes are not registered again in any reporting day", () => {
  const entries = accept([], report("word", "2026-10-15", "same-sha")).entries;
  assert.throws(() => accept(entries, report("word", "2026-10-16", "same-sha")),
    /уже прийнято/);
});

test("invalid reporting day cannot be confirmed", () => {
  assert.throws(() => accept([], report("excel", "", "a")), /звітну дату/);
});

test("revisions are never guessed from matching row contents", () => {
  const entries = accept([], report("excel", "2026-10-15", "x-1")).entries;
  const result = accept(entries, report("excel", "2026-10-15", "x-2"));
  assert.equal(result.current.version, 2);
  assert.equal(result.entries.length, 2);
});

test("existing ANALISE page includes manual date and version library", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /report-versions\.js/);
  assert.match(html, /id="structured-report-day"/);
  assert.match(html, /state\.staged\.reportDay=t\.value/);
});

test("default date follows Kyiv midnight rather than UTC", () => {
  assert.equal(todayKyiv(new Date("2026-10-14T20:59:59Z")), "2026-10-14");
  assert.equal(todayKyiv(new Date("2026-10-14T21:00:00Z")), "2026-10-15");
  assert.equal(todayKyiv(new Date("2026-12-31T21:59:59Z")), "2026-12-31");
  assert.equal(todayKyiv(new Date("2026-12-31T22:00:00Z")), "2027-01-01");
});

test("import and export suggest current date without locking manual choices", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /reportDay:window\.ASTRA_REPORT_VERSIONS\.todayKyiv\(\)/);
  assert.match(html, /day:window\.ASTRA_REPORT_VERSIONS\.todayKyiv\(\),reportDateEdited:false/);
  assert.match(html, /state\.staged\.reportDay=t\.value/);
  assert.match(html, /state\.day=t\.value;state\.reportDateEdited=true/);
  assert.match(html, /to==="reports"&&!state\.reportDateEdited/);
});
