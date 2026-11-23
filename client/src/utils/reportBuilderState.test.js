import test from "node:test";
import assert from "node:assert/strict";
import {
  DATASET_FILTERS,
  initialBuilder,
  selectDataset,
  canChooseColumns,
  toggleColumn,
  setFilter,
  buildRequest,
  problems,
  periodOptionsFor,
  filenameFromDisposition,
} from "./reportBuilderState.js";

const NOW = new Date("2026-11-20T06:00:00Z");
const col = (key, isDefault = false) => ({ key, label: key, default: isDefault });
const jobs = { id: "jobs", columns: [col("title", true), col("employer", true), col("hires")], groupings: ["none", "month"], needsPurpose: false };
const hires = { id: "hires", columns: [col("hiredAt", true), col("ageBracket", true)], groupings: ["none", "ageBracket"], needsPurpose: true };
const seekers = { id: "jobseekers", columns: [col("group", true), col("count", true)], groupings: ["ageBracket", "municipality"], defaultGrouping: "ageBracket", needsPurpose: true };

test("starts on the current Manila quarter with nothing chosen", () => {
  const state = initialBuilder(NOW);
  assert.equal(state.dataset, "");
  assert.equal(state.period, "quarter");
  assert.equal(state.quarter, "4");
  assert.equal(state.year, "2026");
  assert.equal(state.format, "csv");
  assert.deepEqual(problems(state, null), ["dataset"]);
});

test("choosing a dataset sets its default columns and grouping and clears old filters", () => {
  let state = { ...initialBuilder(NOW), filters: { municipality: "Gasan" } };
  state = selectDataset(state, jobs);
  assert.deepEqual(state.columns, ["title", "employer"]);
  assert.equal(state.grouping, "none");
  assert.deepEqual(state.filters, {});
  state = selectDataset(state, seekers);
  assert.equal(state.grouping, "ageBracket");
});

test("only a row dataset that is not grouped offers a choice of columns", () => {
  const state = selectDataset(initialBuilder(NOW), jobs);
  assert.equal(canChooseColumns(jobs, state), true);
  assert.equal(canChooseColumns(jobs, { ...state, grouping: "month" }), false);
  assert.equal(canChooseColumns(seekers, selectDataset(initialBuilder(NOW), seekers)), false);
});

test("columns keep the catalog order however they are ticked", () => {
  let state = selectDataset(initialBuilder(NOW), jobs);
  state = toggleColumn(state, jobs, "hires");
  state = toggleColumn(state, jobs, "title");
  assert.deepEqual(state.columns, ["employer", "hires"]);
});

test("no columns is a problem; a grouped report needs none", () => {
  let state = selectDataset(initialBuilder(NOW), jobs);
  state = { ...state, columns: [] };
  assert.deepEqual(problems(state, jobs), ["columns"]);
  assert.deepEqual(problems({ ...state, grouping: "month" }, jobs), []);
});

test("the purpose is needed only where the dataset needs it, 10 to 200 characters", () => {
  const state = selectDataset(initialBuilder(NOW), hires);
  assert.deepEqual(problems(state, hires), ["purpose"]);
  assert.deepEqual(problems({ ...state, purpose: "too short" }, hires), ["purpose"]);
  assert.deepEqual(problems({ ...state, purpose: "x".repeat(201) }, hires), ["purpose"]);
  assert.deepEqual(problems({ ...state, purpose: "  Quarterly placement report  " }, hires), []);
  assert.deepEqual(problems(selectDataset(initialBuilder(NOW), jobs), jobs), []);
});

test("a custom period needs both days in order", () => {
  const state = { ...selectDataset(initialBuilder(NOW), jobs), period: "custom" };
  assert.deepEqual(problems(state, jobs), ["period"]);
  assert.deepEqual(problems({ ...state, from: "2026-05-01", to: "2026-03-01" }, jobs), ["period"]);
  assert.deepEqual(problems({ ...state, from: "2026-01-01", to: "2026-03-01" }, jobs), []);
});

test("the ranking offers only year and quarter, and switching to it fixes a custom period", () => {
  assert.deepEqual(periodOptionsFor("employer_ranking"), ["year", "quarter"]);
  const ranking = { id: "employer_ranking", columns: [col("rank", true)], groupings: [], needsPurpose: false };
  const state = selectDataset({ ...initialBuilder(NOW), period: "custom" }, ranking);
  assert.equal(state.period, "quarter");
});

test("the request carries only the period fields in use and the filters the dataset applies", () => {
  let state = selectDataset(initialBuilder(NOW), jobs);
  state = setFilter(state, "municipality", "Gasan");
  state = setFilter(state, "ageBracket", "15-17"); // not a jobs filter: never sent
  assert.deepEqual(buildRequest(state, jobs), {
    dataset: "jobs",
    params: { period: "quarter", year: "2026", quarter: "4", municipality: "Gasan" },
    grouping: "none",
    format: "csv",
    columns: ["title", "employer"],
  });
  const custom = { ...state, period: "custom", from: "2026-01-01", to: "2026-02-01" };
  assert.deepEqual(buildRequest(custom, jobs).params, { period: "custom", from: "2026-01-01", to: "2026-02-01", municipality: "Gasan" });
});

test("a grouped request sends no columns; a purpose is trimmed and sent only when needed", () => {
  let state = selectDataset(initialBuilder(NOW), hires);
  state = { ...state, grouping: "ageBracket", purpose: "  Quarterly placement report " };
  const body = buildRequest(state, hires);
  assert.equal(body.columns, undefined);
  assert.equal(body.purpose, "Quarterly placement report");
  assert.equal(buildRequest(selectDataset(initialBuilder(NOW), jobs), jobs).purpose, undefined);
});

test("clearing a filter removes it", () => {
  let state = setFilter(selectDataset(initialBuilder(NOW), jobs), "industry", "Retail");
  state = setFilter(state, "industry", "");
  assert.deepEqual(state.filters, {});
});

test("every dataset has a filter list, and none offers a filter the server would ignore", () => {
  assert.deepEqual(Object.keys(DATASET_FILTERS).sort(), ["applications", "audit_summary", "employer_ranking", "employers", "hires", "jobs", "jobseekers", "spes", "verification_activity"]);
  assert.ok(!DATASET_FILTERS.hires.includes("jobStatus"));
  assert.ok(!DATASET_FILTERS.applications.includes("jobStatus"));
});

test("the file name comes from Content-Disposition", () => {
  assert.equal(filenameFromDisposition('attachment; filename="RPT-20261120-ABCDEFGH.csv"'), "RPT-20261120-ABCDEFGH.csv");
  assert.equal(filenameFromDisposition("", "fallback.csv"), "fallback.csv");
});

test("the error code is read from a JSON body or from a Blob body", async () => {
  const { errorCodeOf } = await import("./reportBuilderState.js");
  assert.equal(await errorCodeOf({ response: { data: { code: "RATE_LIMITED" } } }), "RATE_LIMITED");
  assert.equal(await errorCodeOf({ response: { data: new Blob([JSON.stringify({ code: "EXPORT_TOO_LARGE" })]) } }), "EXPORT_TOO_LARGE");
  assert.equal(await errorCodeOf({ response: { data: new Blob(["not json"]) } }), null);
  assert.equal(await errorCodeOf(new Error("network")), null);
});
