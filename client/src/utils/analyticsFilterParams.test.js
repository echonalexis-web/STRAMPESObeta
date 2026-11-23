import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultState,
  manilaToday,
  parseFilterState,
  serializeFilterState,
  isCanonicalFilterQuery,
  toApiParams,
  isPeriodReady,
  activeFilterKeys,
  hasActiveFilters,
  clearedState,
  visibleFilters,
  switchSection,
} from "./analyticsFilterParams.js";

const NOW = new Date("2026-11-20T06:00:00Z");
const qs = (text) => new URLSearchParams(text);

test("Manila date, not UTC, decides the default year", () => {
  // 31 Dec 17:00 UTC is already 1 Jan in Manila
  assert.equal(manilaToday(new Date("2026-12-31T17:00:00Z")).year, 2027);
  assert.equal(defaultState(new Date("2026-12-31T17:00:00Z")).year, "2027");
});

test("a clean URL means the defaults and writes back clean", () => {
  const state = parseFilterState(qs(""), NOW);
  assert.equal(state.section, "jobs");
  assert.equal(state.period, "year");
  assert.equal(state.year, "2026");
  assert.equal(serializeFilterState(state, NOW).toString(), "");
  assert.ok(isCanonicalFilterQuery(qs(""), NOW));
});

test("parse and serialize round trip", () => {
  const url = "section=applicants&period=quarter&quarter=2&municipality=Gasan&ageBracket=15-17&applicationStatus=hired";
  const state = parseFilterState(qs(url), NOW);
  assert.equal(state.ageBracket, "15-17");
  assert.equal(state.quarter, "2");
  assert.ok(isCanonicalFilterQuery(qs(serializeFilterState(state, NOW).toString()), NOW));
  assert.deepEqual(Object.fromEntries(serializeFilterState(state, NOW)), {
    section: "applicants", period: "quarter", quarter: "2", municipality: "Gasan", ageBracket: "15-17", applicationStatus: "hired",
  });
});

test("a filter whose control is hidden for the section is ignored and stripped", () => {
  const state = parseFilterState(qs("section=jobs&ageBracket=15-17&verification=verified&jobType=Part-time"), NOW);
  assert.equal(state.ageBracket, "");
  assert.equal(state.verification, "");
  assert.equal(state.jobType, "Part-time");
  assert.equal(isCanonicalFilterQuery(qs("section=jobs&ageBracket=15-17"), NOW), false);
});

test("switching section keeps the shared filters and sheds the rest", () => {
  const jobs = parseFilterState(qs("period=month&month=3&municipality=Gasan&industry=Retail"), NOW);
  const employers = visibleFilters(switchSection(jobs, "employers"));
  assert.equal(employers.municipality, "Gasan");
  assert.equal(employers.industry, "Retail");
  const applicants = visibleFilters(switchSection(jobs, "applicants"));
  assert.equal(applicants.municipality, "Gasan");
  assert.equal(applicants.industry, "");
  assert.equal(applicants.month, "3");
});

test("unknown values are dropped", () => {
  const state = parseFilterState(qs("section=nope&period=decade&year=abc&quarter=9&jobStatus=weird&scope=x&verification=bogus"), NOW);
  assert.equal(state.section, "jobs");
  assert.equal(state.period, "year");
  assert.equal(state.year, "2026");
  assert.equal(state.quarter, "4");
  assert.equal(state.jobStatus, "");
  assert.equal(state.scope, "all");
  assert.equal(state.verification, "");
});

test("verification accepts one status or exactly the pending-review pair", () => {
  assert.equal(parseFilterState(qs("section=employers&verification=pending,under_review"), NOW).verification, "pending,under_review");
  assert.equal(parseFilterState(qs("section=employers&verification=verified"), NOW).verification, "verified");
  assert.equal(parseFilterState(qs("section=employers&verification=verified,rejected"), NOW).verification, "");
});

test("SPES drops the catalog filters; registrations drop the application status", () => {
  const spes = parseFilterState(qs("dataset=spes&industry=Retail&jobType=Part-time&workNature=remote"), NOW);
  assert.deepEqual([spes.industry, spes.jobType, spes.workNature], ["", "", ""]);
  const reg = parseFilterState(qs("section=applicants&dateField=registered&applicationStatus=hired"), NOW);
  assert.equal(reg.applicationStatus, "");
});

test("custom period needs both days in order", () => {
  const ok = parseFilterState(qs("period=custom&from=2026-01-01&to=2026-03-31"), NOW);
  assert.ok(isPeriodReady(ok));
  assert.equal(isPeriodReady(parseFilterState(qs("period=custom&from=2026-01-01"), NOW)), false);
  assert.equal(isPeriodReady(parseFilterState(qs("period=custom&from=2026-05-01&to=2026-03-31"), NOW)), false);
  assert.equal(isPeriodReady(parseFilterState(qs("period=custom&from=bad&to=2026-03-31"), NOW)), false);
});

test("API params carry only the period fields in use and the section's filters", () => {
  const state = parseFilterState(qs("section=employers&period=quarter&year=2025&quarter=3&verification=pending,under_review&industry=Retail"), NOW);
  assert.deepEqual(toApiParams(state, NOW), {
    section: "employers", period: "quarter", year: "2025", quarter: "3", industry: "Retail", verification: "pending,under_review", scope: "all",
  });
  const custom = parseFilterState(qs("period=custom&from=2026-01-01&to=2026-02-01"), NOW);
  const params = toApiParams(custom, NOW);
  assert.equal(params.from, "2026-01-01");
  assert.equal(params.year, undefined);
});

test("Clear filters resets filters but keeps the section and period", () => {
  const state = parseFilterState(qs("section=jobs&period=month&month=2&municipality=Gasan&scope=public"), NOW);
  assert.ok(hasActiveFilters(state, NOW));
  assert.deepEqual(activeFilterKeys(state, NOW), ["municipality", "scope"]);
  const cleared = clearedState(state, NOW);
  assert.equal(hasActiveFilters(cleared, NOW), false);
  assert.equal(cleared.period, "month");
  assert.equal(cleared.month, "2");
});
