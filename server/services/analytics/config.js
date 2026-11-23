// Every tunable number of the reports and dashboard analytics work, in one place,
// so PESO can change a rule without hunting through code.

// Employer performance ranking (Best and Most Performative Employer Reports).
// An employer needs at least this much activity in the period to be ranked;
// below it the employer is listed under "Not enough data" with raw counts only.
const PERFORMANCE = Object.freeze({
  minPostings: 1,
  minApplicants: 3,
  // An employer needs at least one hire to be listed among the top employers.
  minHires: 1,
  defaultTopN: 10,
  maxTopN: 50,
  // An application counts toward the response rate once it is this old.
  responseWindowDays: 7,
  // 95% Wilson interval for the hire rate shown beside the raw rate.
  wilsonZ: 1.96,
});

// Small-cell rule: any count of minors or by age bracket below this is shown as "under 5".
const SMALL_CELL_THRESHOLD = 5;

const LIMITS = Object.freeze({
  // Longest period a filter or a report may cover.
  maxPeriodYears: 5,
  // Server-side query time limits (MongoDB maxTimeMS).
  analyticsMaxTimeMs: 15000,
  exportMaxTimeMs: 20000,
});

// Row caps per export format. Above the cap the request is refused, never truncated.
const EXPORT_ROW_CAPS = Object.freeze({ csv: 50000, xlsx: 50000, pdf: 2000 });

// Report history (metadata only) is kept this long (see scripts/purgeReportHistory.js).
const HISTORY_RETENTION_MONTHS = 24;

module.exports = { PERFORMANCE, SMALL_CELL_THRESHOLD, LIMITS, EXPORT_ROW_CAPS, HISTORY_RETENTION_MONTHS };
