# Reports and dashboard analytics: build status

Branch: `feat/reports-and-dashboard-analytics` (cut from `feat/superadmin-user-management-layout`, 75e51121).
Plan: `STRAM_PESO_REPORTS_PLAN.md`. Approved decisions and commit order are in the build request; the plan is not rewritten, deviations are listed here.
Rule: never run a backfill, migration, index creation or deletion script against any database. Scripts are written, not run.

## Baseline (before any change)

| Check | Result |
|---|---|
| Server tests | 109 suites, 3254 tests pass (last clean run of the same code; the baseline run on this branch overlapped my first edits, so it is not used) |
| Client `node --test` | 604 of 604 |
| Client vitest | 29 of 29 |
| Lint | 46 problems |
| Client build | OK |

## What the plan said it did not check

| Item | Finding | Changes the plan? |
|---|---|---|
| `Reports.jsx` after line 330 | The rest is the PDF handler, KPI cards, trend chart (has a "view as table" `<details>` already), donut, records table with its own pagination footer. Nothing new. | No |
| `JobMonitoring.jsx` internals | It has its OWN client-side CSV and PDF export (`exportCsv`, `exportPdfTable`, `JOB_EXPORT_COLUMNS`, limit 500 against a server cap of 50). Its columns carry no contact details, but it shares the unsafe `csvCell` in `utils/exportUtils.js`. | Yes: the client-export hotfix (commit 3) covers both pages by fixing `csvCell` once, plus removing email and username columns on Reports. Full retirement (commit 14) covers both pages. |
| `AuditTrail.jsx` export | There is no export at all (no CSV or PDF code). Date filters are plain `type="date"` values sent as `YYYY-MM-DD`, which the server reads in server-local time. | Minor: the audit summary dataset is new; the date handling fix is in the bug-fix commit. |
| Mobile behavior of the dashboards | Not testable without the real app; will be checked in the final browser pass with a harness. | No |
| MongoDB `$dateDiff` support | Server MongoDB version is not stated anywhere in the repo; mongoose 8.24.4, driver 6.21.0; `$dateDiff` is used nowhere. | Yes: age brackets are computed with date cutoffs built in JavaScript (`dobRangeForBracket`, `ageBracketExpression`), the same technique as `dobRangeForTier` in `utils/age.js`. Works on every MongoDB version. `$month` with `timezone` (MongoDB 3.6+) is used for monthly buckets. |

## Commit log

| # | Commit | Status |
|---|---|---|
| 1 | Foundations: config, Manila periods, privacy helpers, filter object, shared municipality module | done: server 110 suites 3284 tests pass, client 604 + 29 pass, lint 46 (= baseline), build OK |
| 2 | Job Monitoring fixes | done: server 111 suites 3299 tests pass, client 604 + 29 pass, lint 46 (= baseline), build OK, en/fil parity 0/0 |
| 3 | Hotfix for client exports | done: server 111 suites 3299 pass (unchanged), client 610 + 29 pass, lint 46, build OK |
| 4 | Data additions (shared helper, backfill script, index script) | done: server 114 suites 3325 pass; client untouched (610 + 29, lint 46, build OK from commit 3) |
| 5 | Analytics refactor with identical numbers | done: server 115 suites 3332 pass; client untouched |
| 6 | Analytics bug fixes | next |
| 7 | Dashboard filtering (server then client) | |
| 8 | Employer performance server | |
| 9 | Employer performance client | |
| 10 | Generator core (CSV, history, audit-first, budgets) | |
| 11 | XLSX | |
| 12 | PDF | |
| 13 | Generator client | |
| 14 | Retire old client exports | |

## Notes for resuming

- Commit 1 files: `server/services/analytics/{config,errors,municipality,period,privacy,filters}.js`, `server/tests/analyticsFoundations.test.js`, municipality helpers moved out of `adminController.js` unchanged.
- Commit 2: `status=pending` filter fixed (was OR-merged with search and matched active jobs; now its own condition, not active/closed/rejected). Stats rewritten as one aggregation + an id lookup for the application sum; expressions moved to `services/analytics/{municipality,jobStatus}.js` and proven equal to the JS rules by an evaluator test. Truncation notice on both client exports (toast + i18n key `admin.reports.exportTruncated`). Untracked whitebox tests WB-ADM-43/44/50/51 updated to the new behavior.
- A vitest run once failed to start (no tests, 1 error) while the full server suite was running at the same time; re-running alone passed 29/29. Do not run them in parallel.
- Commit 3: `utils/csvText.js` (formula-injection neutralization, BOM) now backs `exportUtils.csvCell/toCsv`, so Reports AND Job Monitoring CSVs are protected; Reports exports no longer carry the email and username columns (the on-screen table is unchanged).
- Found while preparing commit 4: hired is NOT terminal in the single-update path (`employerController.updateApplicationStatus` allows any status, even back to pending), so `statusUpdatedAt` can move after a hire. Five runtime paths write JobApplication.status, not four: employer single update, employer no-show reject, employer bulk update, applicant withdraw (`jobController.deleteMyApplication`), and applicant re-apply reactivation (`jobController.applyToJob`, resets a withdrawn row to pending).
- Mongoose autoIndex is not disabled anywhere (User.js comment implies it is on), so the new indexes are NOT declared with `schema.index`; they live in `server/config/reportIndexes.js` and are created only by `scripts/createReportIndexes.js` (written, not run).
- Commit 4: `services/applicationStatusService.js` (`setApplicationStatus`, `reactivationFields`) wired into all five status-change paths; `JobApplication` gains `hiredAt`, `hiredAtApproximate`, `firstResponseAt` (no new schema indexes). Tests: helper unit tests, the real handlers for the four employer/applicant paths, and a source scan that fails if anything assigns `application.status` or bulk-writes JobApplication directly.
- Scripts written, NOT run: `server/scripts/backfillApplicationDates.js` (dry run default; sets `hiredAt` from `statusUpdatedAt`, marks it approximate; does not backfill `firstResponseAt` on purpose), `server/scripts/createReportIndexes.js` (dry run default). Expected indexes are listed in `server/config/reportIndexes.js`: jobapplications {createdAt}, {vacancy,status}, {status,hiredAt}; jobvacancies {employer,createdAt}; reportexports {reportId} unique, {preparedBy,createdAt}, {createdAt}.
- Un-hiring is possible in the single-update path, so the helper clears `hiredAt` when a hire is undone.
- Commit 5: `services/analytics/dashboardStats.js` now computes the dashboard and provincial numbers (controllers are thin). Monthly buckets, status buckets and applicant municipalities run in the database; `LOCAL_TIME_ZONE` keeps the old server-local month and year edges so no number moves. Golden test (`dashboardStatsGolden.test.js`) runs the old code as a reference against the new pipelines through a small evaluator (`server/testSupport/pipelineEval.js`) and passes under TZ Asia/Manila, America/New_York, Pacific/Auckland and UTC. No dashboard number changes in this commit.
- Commit 6 will change these numbers (before to after, each listed in its commit message and the final report): account and employer and jobseeker totals and the registration series exclude soft-deleted accounts; activeJobs uses the visibility rule (a new additive activeJobsAll keeps the old count); the status chart gains under_review, approved and withdrawn; topSectors stops counting blank industries ($$ind fix); default year is the current Manila year; year and month edges and "audit events today" use Asia/Manila; audit-log date filters use Manila days. Left as is on purpose: avgDaysToFill (closed minus created, differs from the Archived tab definition), because it is not on the approved fix list.
