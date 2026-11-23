// Indexes the dashboard analytics and the report generator expect. They are deliberately
// NOT declared with schema.index(): Mongoose builds those automatically on start-up, and
// building an index on a production collection must be a decision, not a side effect.
// scripts/createReportIndexes.js creates them (dry run by default; never run by the app).
//
// Why each one:
//   jobapplications {createdAt}            period filters, monthly buckets, cohort hire rate
//   jobapplications {vacancy, status}      funnel per posting and per employer (hires, applicants)
//   jobapplications {status, hiredAt}      hires made in a period
//   jobvacancies {employer, createdAt}     one employer's postings in a period (ranking, drill-down)
//   reportexports {reportId} (unique)      look a report up by its ID
//   reportexports {preparedBy.userId, createdAt}  "my reports" history, newest first
//   reportexports {createdAt}              retention: delete history older than 24 months
const REPORT_INDEXES = Object.freeze([
  { collection: "jobapplications", key: { createdAt: 1 }, options: { name: "report_createdAt" } },
  { collection: "jobapplications", key: { vacancy: 1, status: 1 }, options: { name: "report_vacancy_status" } },
  { collection: "jobapplications", key: { status: 1, hiredAt: 1 }, options: { name: "report_status_hiredAt" } },
  { collection: "jobvacancies", key: { employer: 1, createdAt: -1 }, options: { name: "report_employer_createdAt" } },
  { collection: "reportexports", key: { reportId: 1 }, options: { name: "report_reportId_unique", unique: true } },
  { collection: "reportexports", key: { "preparedBy.userId": 1, createdAt: -1 }, options: { name: "report_preparedBy_createdAt" } },
  { collection: "reportexports", key: { createdAt: 1 }, options: { name: "report_createdAt_retention" } },
]);

module.exports = { REPORT_INDEXES };
