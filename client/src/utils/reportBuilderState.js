// State of the report builder and the request it sends. The server validates everything again
// (allow-listed columns, groupings, periods, purpose); this module keeps the form honest so
// the person is never offered a control that would be ignored.

import { manilaToday } from "./analyticsFilterParams.js";

// Filters each dataset really applies (the server ignores the rest, so they are not offered).
export const DATASET_FILTERS = Object.freeze({
  jobs: ["municipality", "industry", "jobType", "workNature", "jobStatus", "scope"],
  employers: ["municipality", "industry", "verification", "accountStatus", "scope"],
  applications: ["municipality", "industry", "jobType", "workNature", "scope"],
  hires: ["municipality", "industry", "jobType", "workNature", "scope"],
  jobseekers: ["municipality", "ageBracket", "accountStatus", "dateField"],
  spes: [],
  employer_ranking: [],
  verification_activity: [],
  audit_summary: [],
});

export const PURPOSE_MIN = 10;
export const PURPOSE_MAX = 200;
const ALL_PERIODS = ["year", "quarter", "month", "custom"];

// The ranking is for a quarter or a year only.
export const periodOptionsFor = (datasetId) => (datasetId === "employer_ranking" ? ["year", "quarter"] : ALL_PERIODS);

export function initialBuilder(now = new Date()) {
  const today = manilaToday(now);
  return {
    dataset: "",
    period: "quarter",
    year: String(today.year),
    quarter: String(Math.floor((today.month - 1) / 3) + 1),
    month: String(today.month),
    from: "",
    to: "",
    filters: {},
    columns: [],
    grouping: "none",
    format: "csv",
    purpose: "",
  };
}

// Choosing a dataset resets what depended on the previous one.
export function selectDataset(state, dataset) {
  if (!dataset) return { ...state, dataset: "", columns: [], grouping: "none", filters: {}, purpose: state.purpose };
  const periods = periodOptionsFor(dataset.id);
  return {
    ...state,
    dataset: dataset.id,
    period: periods.includes(state.period) ? state.period : "quarter",
    filters: {},
    columns: dataset.columns.filter((column) => column.default).map((column) => column.key),
    grouping: dataset.defaultGrouping || "none",
  };
}

// Columns can be chosen only for a row dataset that is not grouped (a grouped report is group and count).
export const canChooseColumns = (dataset, state) => Boolean(dataset) && dataset.groupings.includes("none") && state.grouping === "none";

export function toggleColumn(state, dataset, key) {
  const has = state.columns.includes(key);
  const next = has ? state.columns.filter((column) => column !== key) : [...state.columns, key];
  // Keep the catalog order, whatever order the boxes were ticked in.
  return { ...state, columns: dataset.columns.map((column) => column.key).filter((column) => next.includes(column)) };
}

export const setFilter = (state, name, value) => {
  const filters = { ...state.filters };
  if (value) filters[name] = value;
  else delete filters[name];
  return { ...state, filters };
};

// The rolling presets (7d, 30d, 90d, 12m) are counted back from today by the server.
const ROLLING = ["7d", "30d", "90d", "12m"];
const periodParams = (state) =>
  ROLLING.includes(state.period)
    ? { period: state.period }
    : state.period === "custom"
      ? { period: "custom", from: state.from, to: state.to }
      : { period: state.period, year: state.year, ...(state.period === "quarter" ? { quarter: state.quarter } : {}), ...(state.period === "month" ? { month: state.month } : {}) };

// The body for POST /admin/report-exports and /preview.
export function buildRequest(state, dataset) {
  const allowed = new Set(DATASET_FILTERS[dataset.id] || []);
  const filters = Object.fromEntries(Object.entries(state.filters).filter(([name, value]) => allowed.has(name) && value));
  const body = {
    dataset: dataset.id,
    params: { ...periodParams(state), ...filters },
    grouping: state.grouping,
    format: state.format,
  };
  if (canChooseColumns(dataset, state)) body.columns = state.columns;
  if (dataset.needsPurpose) body.purpose = state.purpose.trim();
  return body;
}

// What is still missing before Generate or Preview can be used: a list of codes the form
// turns into messages ("dataset", "period", "columns", "purpose").
export function problems(state, dataset) {
  const list = [];
  if (!dataset) return ["dataset"];
  if (state.period === "custom" && !(state.from && state.to && state.from <= state.to)) list.push("period");
  if (canChooseColumns(dataset, state) && state.columns.length === 0) list.push("columns");
  if (dataset.needsPurpose) {
    const length = state.purpose.trim().length;
    if (length < PURPOSE_MIN || length > PURPOSE_MAX) list.push("purpose");
  }
  return list;
}

// The file name the server chose, from Content-Disposition (falls back to the report ID).
export function filenameFromDisposition(header, fallback = "report") {
  const match = /filename="?([^";]+)"?/i.exec(header || "");
  return match ? match[1] : fallback;
}

// The machine code of a failed request. A blob request's error body is itself a Blob, so it is read as JSON.
export async function errorCodeOf(error) {
  const data = error && error.response ? error.response.data : null;
  if (data && typeof data.text === "function") {
    try {
      return JSON.parse(await data.text()).code || null;
    } catch {
      return null;
    }
  }
  return (data && data.code) || null;
}
