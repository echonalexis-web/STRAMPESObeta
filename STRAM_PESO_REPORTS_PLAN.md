# STRAM PESO: Reports and Dashboard Analytics Plan

Status: PLAN ONLY. No source file, config or package was changed, no migration or query was run, nothing was installed. Everything below was read from the code.
Date: 2026-11-20. Branch at planning time: `feat/superadmin-user-management-layout`. Proposed build branch: `feat/reports-and-dashboard-analytics`.

Labels used on every finding: **Proven** (read in the code), **Likely** (follows from the code but not demonstrated), **Suspected** (a risk I could not confirm from files alone). Things I did not check are listed in section 13.

Scope: (j) Best and Most Performative Employer Reports, (k) Dashboard Statistics Filtering, (l) Custom Reports Generator.

---

## 1. Current state

### 1.1 Where the numbers come from

| Screen (route) | Roles | Client file | Endpoint(s) | Server function |
|---|---|---|---|---|
| Admin Dashboard `/admin` | admin, superadmin (`App.jsx:252`) | `pages/admin/AdminDashboard.jsx` | `GET /admin/analytics`, and the embedded provincial block | `getAdminAnalytics` (`adminController.js:144`) |
| Provincial Analytics Overview (inside `/admin`) | admin, superadmin | `pages/admin/ProvincialAnalyticsOverview.jsx` | `GET /admin/analytics/provincial` | `getProvincialAnalytics` (`adminController.js:229`) |
| Reports & Statistics `/admin/reports` | admin, superadmin (`App.jsx:253`) | `pages/admin/Reports.jsx` | `GET /admin/analytics`, `GET /admin/users`, `GET /admin/jobs` | `getAdminAnalytics`, `getAllUsers`, `getAdminVacancies` |
| Job Monitoring `/admin/job-monitoring` | admin, superadmin (`App.jsx:261`) | `pages/admin/JobMonitoring.jsx` | `GET /admin/jobs`, `GET /admin/jobs/stats` | `getAdminVacancies` (:857), `getAdminVacancyStats` |
| Audit Trail `/admin/audit-logs` | superadmin only (`App.jsx:267`) | `pages/admin/AuditTrail.jsx` | `GET /admin/audit-logs` | `getAuditLogs` (:682) |

All `/admin/*` routes sit behind `router.use(protect, isAdmin)` (`routes/adminRoutes.js`); `isAdmin` lets admin and superadmin through (`middleware/auth.js:280`). The router is mounted on both `${basePath}/admin` mounts (`server.js:486`). **Proven.**

Naming trap (Proven): the client route `/admin/reports` is the analytics page. The server `reportRoutes.js` / `models/Report.js` / `reportController.js` are user-content moderation reports (illegal job, scam, harassment, with statuses open, under_review, action_taken, dismissed). The new work must not reuse the word "reports" in API paths for analytics. This plan uses `/admin/analytics/*` and `/admin/report-exports/*`.

### 1.2 Every current statistic

`getAdminAnalytics` (feeds the dashboard KPI cards, the trend chart, the status donut and the whole top of Reports & Statistics):

| Statistic | Source | Query as written | Findings |
|---|---|---|---|
| totalAccounts | User | `countDocuments({role: {$ne: "superadmin"}})` | Includes admins, soft-deleted accounts and anonymized purge stubs (no `deletedAt` filter). **Proven** |
| totalEmployers / totalJobSeekers | User | `countDocuments({role})` | Same: deleted accounts counted. **Proven** |
| totalVacancies | JobVacancy | `countDocuments()` | All statuses incl. draft and archived, and postings of suspended employers. **Proven** |
| totalApplications | JobApplication | `countDocuments()` | Includes withdrawn. **Proven** |
| verifiedEmployers / pendingVerification | User | `countDocuments({role:"employer", verificationStatus})` | `under_review` and `resubmission_required` are in neither number. **Proven** |
| activeJobs / closedJobs | JobVacancy | `countDocuments({status})` | `activeJobs` ignores deadline, `archived`, `isActive` and the unlisted-employer rule (`utils/jobVisibility.js`), so the dashboard says "active" for jobs the public cannot see. **Proven** |
| applicationsThisMonth[12] | JobApplication | `find({createdAt in this year})` then bucketed in JS | Misnamed: it is 12 monthly buckets of the current calendar year. Loads every application of the year into memory. Uses server-local time (`new Date(y,0,1)`), not Asia/Manila. **Proven** |
| registrationsThisMonth[12] | User | same pattern | Counts all roles incl. admins. **Proven** |
| applicationsByStatus | JobApplication | `find().select("status")` (whole collection) then JS loop | Loads the entire collection. `normalizeApplicationStatus` (:135) returns null for `under_review`, `approved` and `withdrawn`, so those are silently dropped; the chart still has a "Reviewed" slice although the model says employers never set `reviewed` (`JobApplication.js` comment). **Proven** |
| auditEventsToday | AuditLog | `countDocuments({createdAt >= local midnight})` | Server-local midnight. **Proven** |

`getProvincialAnalytics` (year + municipality):

| Statistic | Query | Findings |
|---|---|---|
| months[].registered | `User.aggregate` $match year, role in jobseeker/employer, $group by $month | Good (aggregation). `$month` without a timezone argument is UTC, boundaries are server-local: a mismatch near midnight and new-year. **Proven** |
| months[].applied | `JobApplication.aggregate` by `createdAt` month | Same. |
| placementRate | applications in year (lookup vacancy, regex on `location`) hired / total | Rate over applications created in the year, hires counted by current status. **Proven** |
| avgDaysToFill | closed jobs created in year: avg(`closedAt - createdAt`) | Not time to hire: includes jobs closed manually, expired or by inactivity. Differs from the Archived tab definition (first hire - posting, filled jobs only, `services/archivedJobsService.js`). Two different "time to fill" numbers exist. **Proven** |
| active/closed vacancies | `countDocuments` with year + municipality regex | Municipality is a regex over the free text `location`. |
| topSectors | industry `$unwind`, sum of `max(slots,1)` | Clean-up filter is `{$ne: ["$ind", null]}`: `"$ind"` is a field path, not the `$$ind` variable, so the blank-entry filter does nothing. **Proven** (expression), effect on results **Likely** |
| topRoles | group by title | Slot-weighted, not application-weighted. |
| municipalities / applicantMunicipalities | switch+regex on `location`; applicants from `JobseekerProfile` addresses of `JobApplication.distinct("applicant")` | Unbounded `$in` list of distinct applicant ids. **Proven** |
| year | `Number(req.query.year) \|\| 2026` | Default year is hard-coded 2026; the client options are hard-coded `[2024, 2025, 2026]` and default `2026` (`ProvincialAnalyticsOverview.jsx`). **Proven** |

Job Monitoring:

| Item | Finding |
|---|---|
| `getAdminVacancies` | Page size is capped at 50 (`Math.min(50, ...)`, :859). The Reports page asks for 500 on export, so a Jobs export is silently truncated to 50 rows. **Proven** |
| `buildAdminVacancyFilter` | For `status = pending` (also `review`) it pushes `{status:"draft"}` and `{status:"active"}` into the same `$or` as the search conditions: the search becomes OR-ed with draft/active, and "pending" matches active jobs. **Proven** |
| `getAdminVacancyStats` | Loads all matching jobs with `.find().lean()` and loops in JS. **Proven** |

Reports & Statistics page (`Reports.jsx`):

| Item | Finding |
|---|---|
| Filters | search, user status, verification, municipality, job status; held in component state only, not in the URL; the KPI cards, trend and donut are unfiltered all-time numbers, so they never agree with the filtered table below them. **Proven** |
| Exports | Built in the browser (`utils/exportUtils.js`, `jspdf` + `jspdf-autotable`): fetches up to `EXPORT_LIMIT = 500` rows from the list endpoint, then CSV/PDF. No server involvement, so no audit entry, no preparer, the PDF timestamp is the browser clock. **Proven** |
| CSV safety | `csvCell` only quotes `"`, `,` and newlines; no formula-injection neutralization (compare `server/utils/csv.js`, which neutralizes `= + - @ tab`). **Proven** |
| Privacy | Applicant export columns are name, email and username (`APPLICANT_COLUMNS`); Employers export includes email. No minor filter, no purpose, no log. **Proven** |
| Truncation | No "showing 500 of N" notice. **Proven** |

Audit Trail: `getAuditLogs` parses `fromDate`/`toDate` with `new Date("YYYY-MM-DDT00:00:00")`, i.e. server-local time, not Manila; `limit` max 100. **Proven**. `AuditLog` has no TTL index, so retention is unbounded unless purged by hand (`models/AuditLog.js`). **Proven**

Tests: no committed test covers `getAdminAnalytics`, `getProvincialAnalytics` or the vacancy filter. The only analytics tests are in the untracked `server/tests/adminController.whitebox.test.js` (your WIP). **Proven** (file listing + grep).

### 1.3 Reusable pieces that already exist

| Need | Existing piece | Path |
|---|---|---|
| Funnel, time to fill, fill rate definitions | `buildFunnel`, `timeToFillDays`, `buildStats`, `HIRED_STATUSES` | `server/services/archivedJobsService.js` |
| Per-user employer metrics (postings, hires, avg days to hire, hire share) | `employerSection` | `server/services/userInsightsService.js` |
| Unlisted-employer rule | `getUnlistedEmployerIds`, `unlistedEmployerQuery`, `isEmployerUnlisted` | `server/utils/jobVisibility.js` |
| Asia/Manila civil date, age tiers (15-17, 18-30, 31+) | `getManilaToday`, tiers | `server/utils/age.js` |
| Location parsing (barangay, city, province, region) | `locationParser` | `server/utils/locationParser.js`, mirrored on the client |
| Municipality labels/regex | `MUNICIPALITY_LABELS`, `normalizeMunicipalityLabel`, `getMunicipalityFilterPattern` | `adminController.js:~40-86` |
| CSV with BOM and formula neutralization | `toCsv`, `csvCell` | `server/utils/csv.js` |
| Audit writer, post-commit wrapper | `logAuditEvent`, `runPostCommit` | `server/services/auditService.js`, `utils/postCommit.js` |
| Per-account export rate limit | `buildAccountBudget`, `userExportBudget` | `server/middleware/budgets.js` |
| Role middleware | `isAdmin`, `isSuperadmin` | `server/middleware/auth.js` |
| Catalogs (industry, job type) | `SystemOption` (`category`, `value`, `isActive`) | `server/models/SystemOption.js` |
| URL-persisted filters (parse, serialize, canonical URL, chips, merged sort) | `userDirectoryParams.js` and `UserDirectoryToolbar.jsx` | `client/src/utils`, `client/src/components` |
| Compact filter container pattern | `JobSearchFilters.jsx` + `jobSearchFilters.css`; `.um-toolbar` in `user-management.css` | `client/src` |
| Pagination, modal, avatar, metric card, state block, chart theme | `Pagination`, `AppModal`, `useModalA11y`, `Avatar`, `MetricCard`, `StateBlock`, `chartTheme.js` | `client/src/components`, `client/src/utils` |
| Charts | `recharts` ^3.8.1 | `client/package.json` |
| Component test runner | vitest + Testing Library (`*.ui.test.jsx`) | `client/vitest.config.js` |

### 1.4 Dependencies available for generating files

| Format | Installed today | Notes |
|---|---|---|
| CSV | none needed; `server/utils/csv.js` | Already safe. |
| XLSX | **none** on server or client | Needs a new dependency. |
| PDF | client: `jspdf` ^4.2.1, `jspdf-autotable` ^5.0.8, `html2canvas`; server: `pdf-lib` ^1.17.1 (used for NSRP forms) | No `@pdf-lib/fontkit`. Standard PDF fonts are WinAnsi, which has no peso sign (U+20B1) and limited Filipino letters: **Likely** (font encoding knowledge, not tested). Fontsource packages ship woff/woff2 only, which neither jsPDF nor pdf-lib can embed. |

---

## 2. Data readiness

| Metric | Exists today? | Where | Trustworthy? | Smallest fix |
|---|---|---|---|---|
| Hires made | Yes | `JobApplication.status === "hired"` (legacy `Accepted`/`accepted` also mean hired, see `HIRED_STATUSES`) | Yes for counts. Legacy statuses still in the enum until `scripts/migrateApplicationStatuses.js` has run everywhere (**Proven** comment in model); unknown whether it ran in production (**Suspected**) | Count both spellings, same as `archivedJobsService` |
| Hire date | Partly | `JobApplication.statusUpdatedAt`, set at every status change (`employerController.js:740, 1066, 1208`; `jobController.js:939`) | It is the date of the LAST status change, not of the hire. Fine only if hired is terminal. Bulk update refuses `hired`/`rejected` rows (`employerController.js:1061`); the single update path was not proven terminal (**Likely**) | Add `JobApplication.hiredAt`, set when status becomes hired, backfill from `statusUpdatedAt` for current hired rows |
| Applicants per employer | Yes | `JobApplication.vacancy` -> `JobVacancy.employer` | Yes | none (needs a join: index `JobVacancy {employer, createdAt}`, missing today: **Proven**, `JobVacancy.js:216-223`) |
| Hire rate | Derivable | hires / non-withdrawn applications | Yes with a stated cohort rule (section 3.2) | none |
| Fill rate (postings with a hire) | Derivable | `archivedJobsService.buildStats` definition | Yes for closed postings; `slots`/`closedAt` exist | none |
| Time to hire | Derivable | first hired `statusUpdatedAt` - `JobVacancy.createdAt` | Good only with `hiredAt` | covered by `hiredAt` |
| Applicant response rate | **No** | would need "first employer action" time | Not derivable: `statusUpdatedAt` is overwritten on every change, so after a later change the first response time is lost. `AuditLog` `employer.application.*` events exist but are best-effort (`runPostCommit`) and have no retention guarantee (**Proven**) | Add `JobApplication.firstResponseAt`, set once on the first transition out of `pending` |
| Median response time | **No** | same | same | same |
| Active postings | Yes | `JobVacancy.status/isActive/archived/applicationDeadline` | Use the single visibility rule (`isJobVisibleToJobseekers` / `buildVisibleJobFilter`), not `status:"active"` alone | reuse |
| Applicants received | Yes | `JobApplication.createdAt` (and `appliedAt`, both default `Date.now`) | Yes | pick `createdAt` consistently (the existing aggregations do) |
| SPES participation per employer | **No** | `SpesPosting` has `createdBy` (an admin), no `employer`; `SpesApplication.posting`/`applicant` only | SPES postings are admin-owned (**Proven**: `models/SpesPosting.js` fields), so there is no employer-to-SPES relation to rank. Drop this metric from the employer ranking; keep SPES as its own dataset (postings, applications by status and age tier) | none; do not invent a field |
| Employer verification date | Yes | `User.verificationReviewedAt`, `verificationSubmittedAt` | Yes | none |
| Employer municipality / industry | Partly | `EmployerProfile.businessAddress` (structured); `User.industry` (string); `JobVacancy.location` (free text built as `barangay, city, province, region` by LocationSelect, parsed by `locationParser`) | Job location parses reliably when built by the form (**Likely**); older rows may not (**Suspected**) | Use the parser plus an "Other / Unparsed" bucket; consider a stored `JobVacancy.municipality` later (out of scope) |
| Applicant municipality | Yes | `JobseekerProfile.presentAddress/permanentAddress` | Present address first, as the provincial code does | none |
| Applicant age bracket | Yes | `User.dateOfBirth` through `utils/age.js` | Computed in Asia/Manila at query time; never output the date | aggregation with `$dateDiff` and `timezone: "Asia/Manila"` |
| Account state at report time | Yes | `User.isActive`, `accountStatus`, `deletedAt`, `purgedAt` | Current state only; there is no state history on the user, only audit events | Reports use current state, labelled "as of" |
| Report preparer | Yes | `req.user` (`_id`, `name`, `role`), `User.staffNote` (free-text "real name + PESO position" the superadmin records per admin, `User.js:144`) | There is no structured office/position field (**Proven**) | Use `name` + `staffNote` when present; never invent an office |

Missing fields (all additive, all nullable): `JobApplication.hiredAt`, `JobApplication.firstResponseAt`. Missing indexes: `JobVacancy {employer:1, createdAt:-1}`, `JobApplication {createdAt:1}`, `JobApplication {vacancy:1, status:1}`, `JobApplication {status:1, hiredAt:1}`. New collection for history: `ReportExport` (section 5.5).

---

## 3. Feature j: best and most performative employer reports

### 3.1 Definition

An employer's performance in a period is measured on **placement outcomes the employer controls**, not on volume of postings. Metrics, with justification:

| Metric | Definition | Why |
|---|---|---|
| Hires made (primary) | Applications with status hired whose `hiredAt` is in the period | The outcome PESO cares about; hard to game; directly "jobs filled" |
| Hire rate | hires / non-withdrawn applications received in the period (cohort) | Quality of the funnel; shown with a confidence-aware value (below) |
| Fill rate | postings with hires >= slots / postings with at least one applicant (closed or filled in the period) | Same definition as the Archived tab, so numbers match |
| Time to hire | median days from posting `createdAt` to first hire, filled postings only | Speed; median, not mean, so one outlier posting does not decide |
| Response rate and median response time | share of applications received at least 7 days ago that moved out of `pending`; median days to first response | Employer responsiveness is the complaint jobseekers raise most; needs `firstResponseAt`, so it is shown only once that field exists and is back-filled where possible |
| Active postings, applicants received | context columns, not ranked | Explain size |
| SPES participation | **excluded** (no employer relation, see section 2) | Would be invented data |

### 3.2 Ranking (explainable)

Recommended for v1: **primary metric with tie-breakers**, no hidden weights:

1. Hires made (more is better)
2. Hire rate, using the lower bound of the 95% Wilson interval (so 1 of 1 does not beat 8 of 20)
3. Fill rate
4. Median time to hire (lower is better)
5. Company name (stable order)

Optional second view, behind decision question Q1: a "Performance score" 0 to 100 = 40% hires (percentile within the eligible group) + 25% Wilson hire rate + 20% fill rate + 15% responsiveness (median response time percentile; weight redistributed to the other three while `firstResponseAt` is unavailable). The score is shown with its four components so anyone can recompute it.

Small-sample rule: an employer needs at least 2 postings active or closed in the period AND at least 5 applicants received to be ranked. Below that the row is listed under "Not enough data" with its raw counts and no rank. Thresholds are constants in one config object, easy for PESO to change.

### 3.3 Period handling

- Selectors: Quarter (Q1 Jan-Mar, Q2 Apr-Jun, Q3 Jul-Sep, Q4 Oct-Dec) and Year, plus an optional custom range used only by the generator.
- All boundaries are Asia/Manila midnight, converted to UTC instants by one shared `periodBounds()` helper. The Philippines has no daylight saving, so the offset is a constant +08:00 (general knowledge, not verified in code; use `Intl` with `timeZone: "Asia/Manila"` as `utils/age.js` already does, never a hard-coded offset in business code).
- Events are attributed by their own date: hires by `hiredAt`, applications by `createdAt`, postings by `createdAt`. The hire rate uses the cohort of applications received in the period and counts those hired as of "now" (stated on screen as "as of <date>"), which is why a partial quarter always looks lower.
- Partial current period: flagged `isPartial: true` with `asOf`; the UI shows "Quarter in progress, as of <date>".
- Comparison: the same type of period immediately before it (Q2 vs Q1; 2026 vs 2025), shown as delta and an arrow with text ("up 3", "down 1"). For a partial current period the comparison is against the previous full period AND the same elapsed span of it (days 1..N), so a half-finished quarter is not unfairly compared to a complete one.

### 3.4 Eligibility

- Included: `role: "employer"`, `verificationStatus: "verified"`, `deletedAt: null`, and currently not suspended, banned or deactivated (the same predicate as `unlistedEmployerQuery`, negated).
- Excluded and counted: employers that had activity in the period but are now suspended, banned, deactivated or deleted are not ranked; the page shows "n employers not shown (account not in good standing)". Their hires still count in province-wide totals under a "Former or restricted employers" line so totals reconcile.
- Deleted users: the account row is anonymized ("Deleted user", `purgedAt` set) after purge, so a deleted employer is never named in a ranking or export; its postings and applications remain only in aggregates.
- Verified at the start of the period is not used (no verification history); decision Q9.

### 3.5 Output

- Top N table (default 10, max 50): rank, employer (avatar + company name), postings, applicants, hires, hire rate (with n), fill rate, median days to hire, (score if enabled).
- Chart: horizontal bar of hires per employer (recharts), each bar labelled, plus a "Show as table" toggle for the same data.
- Per-employer drill-down: a page/drawer with that employer's postings in the period, each with funnel (applicants, qualified, shortlisted, hired), time to fill and close reason (reuse `buildFunnel`, `timeToFillDays`), plus the same metrics vs previous period. No applicant identities, only counts.
- Placement on both dashboards: a "Top employers" card (top 5, current quarter) on `/admin` with a link to the full view, and a new "Employer performance" tab on Reports & Statistics. Admin and Superadmin see the same view (decision Q6).

---

## 4. Feature k: dashboard statistics filtering

### 4.1 Filters per section

One filter object (`AnalyticsFilter`), validated on the server, used by every number on a page.

| Filter | Jobs | Employers | Applicants | Notes |
|---|---|---|---|---|
| Period (month, quarter, year, custom from/to) | posted date | registered date | registered date or applied date (explicit toggle) | Asia/Manila bounds, max span 5 years |
| Municipality | job location (parsed) | business address municipality | present address municipality | Same 6 municipalities + "Other / Outside Province", from `MUNICIPALITY_LABELS` |
| Barangay | optional, only after a municipality is chosen | no | no | Parsed from `location`; "unknown" bucket |
| Industry | yes (catalog) | yes (`User.industry`) | preferred industries (optional) | Values come from `SystemOption` category `industry`, never free text |
| Job type | yes (catalog `jobType`) | no | no | |
| Work nature | yes | no | no | |
| Employer | yes (one employer, picker) | n/a | no | |
| Regular vs SPES | dataset switch (regular `JobVacancy` or `SpesPosting`) | no | SPES applicants as aggregates | SPES has no employer, so Employer filter is disabled for SPES |
| Job status | active, closed, draft, archived | n/a | n/a | One canonical set. Replaces the broken `pending` mapping (section 1.2) |
| Verification status | n/a | six values, plus "Pending review" = pending + under_review | n/a | Same vocabulary as User Management |
| Account status | n/a | active, suspended, banned, deactivated | active, suspended, banned, deactivated | deleted excluded always |
| Age bracket | n/a | n/a | 15-17, 18-24, 25-30, 31+ | Brackets only, computed in the pipeline, never the date. Cells under 5 are shown as "under 5" (decision Q8) |
| Application status | n/a | n/a | pending, under_review, shortlisted, approved, rejected, hired, withdrawn | The donut covers all seven (fixes the dropped statuses) |

### 4.2 Behavior

- Live: selects and chips apply immediately; typed fields (employer picker search) debounce 300 ms (`createDebouncer` in `utils/liveSearch.js`).
- URL state: filters live in the query string with `replace`, using a `parse/serialize/isCanonical` module modeled on `utils/userDirectoryParams.js`; a link restores the same view; a param whose control is hidden for the section is ignored and stripped.
- Requests: one request per section returns cards, series and breakdowns together, so cards, charts and tables always agree; stale responses are ignored (request key check, as on Browse Jobs).
- States: skeleton while loading, error block with "Try again" (`StateBlock kind="error" onRetry`), empty state "No data for these filters" with "Clear filters", a live region announcing "Showing results for <period>".
- Section switch (Jobs / Employers / Applicants) keeps shared filters (period, municipality) and drops the ones that do not apply.
- Every number on screen is computed on the server from the same filter object; the client never sums or derives a statistic.

### 4.3 Server

- `server/services/analytics/`: `period.js` (Manila bounds), `filters.js` (parse + validate + Mongo match builders, whitelists only), `jobsStats.js`, `employersStats.js`, `applicantsStats.js` (each one `$facet` aggregation), `privacy.js` (age bracket expression, small-cell suppression).
- Existing `getAdminAnalytics` and `getProvincialAnalytics` keep their response shape (additive keys only) but run on this service: no more `find().select()` of whole collections, year boundaries in Manila, default year = current Manila year, status buckets complete.
- Indexes: see section 10.
- Caching: none in v1 (section 10 explains why); precompute only if measurements demand it.
- Visibility rule: statistics about jobs that "exist" use an explicit `scope` parameter: `all` (staff view, includes unlisted postings, labelled) or `public` (what jobseekers can see, using `buildVisibleJobFilter` + `getUnlistedEmployerIds`). Default for staff is `all`; the card label says which. Decision Q5.

### 4.4 Layout

Reuse the compact filter container: labelled controls in one wrapping row (44 px, one style), a chip row for toggles (aria-pressed), "Clear filters" text button, a collapsible "Filters" button with a count on phones (the `UserDirectoryToolbar` pattern). Widths: 1280 = one row of controls + chip row; 768 = two or three controls per row; 390/320 = search/period visible, the rest behind the Filters button, charts single column. Charts keep `ResponsiveContainer`; tables become cards on a phone (as User Management does).

---

## 5. Feature l: custom reports generator

### 5.1 Report catalog

| Dataset | Allowed columns (default in bold) | Never allowed | Admin | Superadmin |
|---|---|---|---|---|
| Jobs | **title, employer company, municipality, industry, job type, work nature, slots, status, posted date**, closed date, close reason, applicants, hires | description, salary text with personal data, employer email/phone | yes | yes |
| Employers | **company, verification status, account status, municipality, industry, workforce size class, registered date**, verified date, postings, hires | email, phone, TIN, permit/registration URLs, owner name unless PESO decides | yes | yes |
| Jobseekers (aggregate by default) | counts by age bracket, municipality, month, status | name, email, phone, address, date of birth, any ID, any document; no row-level list in v1 | aggregates only | aggregates only (row-level is Q6) |
| Applications | **application ref, job title, employer company, applied date, status, status date**; aggregate by status/month/municipality | applicant identity, cover letter, resume, notes | yes | yes |
| Hires / placements | **hire date, job title, employer company, municipality, applicant age bracket** | applicant name unless Q7 says yes | aggregate or unnamed list | same |
| SPES postings and applications | postings: title, status, slots, opens, deadline; applications aggregated by status and age tier | any applicant row (15 to 17 year olds), guardian data, documents | yes (aggregates) | yes |
| Employer performance ranking | the section 3.5 table | n/a | yes | yes |
| Verification activity | counts by status and month; review turnaround (submitted to reviewed) | document URLs, notes | yes | yes |
| Audit summary | counts by category, action, severity, month | IP addresses, user agents, metadata bodies, actor names unless superadmin | no | yes (counts only) |

### 5.2 Builder UX

Single page, five labelled steps that are visible at once on desktop and stacked on mobile: (1) dataset, (2) period and filters (the section 4 filter object), (3) columns (checkbox list limited to the allowed set), (4) grouping or summary (allowed groupings per dataset: none, by month, by municipality, by employer where permitted), (5) format and purpose. A "Preview" action calls the server for the record count and the first 20 rows plus the exact "prepared by" block that will print. "Generate" is disabled until a purpose is given where the dataset requires it. Result: file download plus a toast with the report ID; the history list refreshes.

### 5.3 Formats

| Format | Recommendation | Library | Notes |
|---|---|---|---|
| CSV | Yes (default, cheapest, safest for re-use) | none; extend `server/utils/csv.js` | UTF-8 BOM so Excel shows Filipino letters; keep formula neutralization; metadata as leading rows `Report ID, ...` then a blank row then the header (decision Q3b) |
| XLSX | Yes | `exceljs` (new server dependency, MIT, streaming `WorkbookWriter` keeps memory flat for 50k rows) | Sheet 1 "Report" (cover: title, prepared by, role, office/position, timestamp, report ID, dataset, filters, period, record count), Sheet 2 "Data", hidden Sheet 3 `_meta` with canonical JSON. Cell text starting `= + - @` is written as a string with a leading apostrophe. Peso values use number format `"₱"#,##0.00` |
| PDF | Yes for summaries and the ranking; capped at 2,000 rows | server-side `pdf-lib` (installed) + `@pdf-lib/fontkit` (new) + one OFL TrueType font file committed under `server/assets/fonts/` (for example Noto Sans, which has U+20B1 and Filipino letters) | Standard fonts cannot print the peso sign (Likely), so a TTF must be embedded. Title block on page 1 with the prepared-by facts, footer on every page "Report ID, page x of y". Simple table paginator written in-house (pdf-lib has none). Alternative to weigh (Q3): `pdfmake`, which has table layout built in but is a bigger dependency |

The existing client-side `jspdf` export is not used for the new module: a client-generated file cannot be an authoritative "prepared by" record.

### 5.4 Prepared by

Every export, in every format, carries and records:

| Field | Source |
|---|---|
| Report ID | Generated on the server: `RPT-<YYYYMMDD>-<8 random base32 chars>`, unique index on `ReportExport.reportId` |
| Prepared by (full name) | `req.user.name` re-read from the database at request time (never from the body, query or token claims) |
| Role | `req.user.role` |
| Office or position | `User.staffNote` if set (the superadmin-maintained "real name + PESO position" note); otherwise the line is omitted, never filled with a guess |
| Generated at | Server clock converted to Asia/Manila, shown as `2026-11-20 14:05 (Asia/Manila)` |
| Dataset, filters, period | Human summary AND canonical JSON of the parameters |
| Record count | Counted by the server from the same query that produced the rows |
| Purpose | Free text 10 to 200 characters where required (Q4) |
| Schema version | `1`, so future column changes stay traceable |

Where it appears: PDF title block (page 1) and footer (every page); XLSX cover sheet plus hidden `_meta`; CSV leading metadata rows. The same facts go to the audit trail as `report.generated` (severity `info`, `warning` for datasets that carry identity-adjacent rows) via `logAuditEvent`. Because an export is data leaving the system, the audit write is awaited before any byte is sent: if the audit write fails, the request fails with 500 and no file is returned. This is the opposite of the best-effort `runPostCommit` used for status changes, deliberately.

Report history (recommended: yes, metadata only): new collection `ReportExport` storing reportId, preparer snapshot (userId, name, role, staffNote), dataset, format, canonical params, period bounds, record count, purpose, content SHA-256 of the produced bytes, status, duration, createdAt, `regeneratedFrom`. The file itself is not stored (it would duplicate regulated data; regenerating is cheap). Retention: 24 months, then deleted by a documented script (decision Q4), because audit entries already exist for longer.

### 5.5 Large exports and limits

| Format | Synchronous row cap | Behavior above the cap |
|---|---|---|
| CSV | 50,000 | 422 `EXPORT_TOO_LARGE` with "narrow the filters" (same pattern as `GET /admin/users-export`); no silent truncation ever |
| XLSX | 50,000 (streamed) | same |
| PDF | 2,000 | same |

Aggregation and queries run with `maxTimeMS` of 20,000 and map the timeout to 504 `QUERY_TIMEOUT`. A new `reportExportBudget` (per account, 10 per hour, `alwaysOn`, env `REPORT_EXPORT_HOURLY_CAP`) follows `userExportBudget`; one generation per account at a time (in-flight guard returns 429 `REPORT_IN_PROGRESS`). Async generation with a status poll is out of scope for v1 (listed in section 13).

### 5.6 Reproducibility

`POST /admin/report-exports/:reportId/regenerate` reads the stored canonical parameters, produces a NEW report with a new ID and `regeneratedFrom`, and prints "Regenerated from RPT-...; data as of <time>". Event-time metrics (hires in a closed quarter) reproduce exactly; state-time metrics (current account status, current application status) can differ, and the file says so in its notes. The stored content hash lets someone prove a file they hold is the one that was generated.

---

## 6. Permissions and privacy matrix

| Capability | Admin | Superadmin | Notes |
|---|---|---|---|
| View dashboard statistics with filters (k) | yes | yes | Same endpoints |
| View employer performance (j) | yes | yes | Employer names are business names, not personal data |
| Employer drill-down | yes | yes | Counts only, no applicant identity |
| Generate: Jobs, Employers, Applications, Employer ranking, SPES aggregates, Verification activity | yes | yes | |
| Generate: Hires / placements (unnamed) | yes | yes | Age bracket only |
| Generate: Audit summary | no | yes | Counts only |
| Row-level jobseeker lists / named placements | no | no in v1 | PESO policy question Q7 |
| Report history | own reports | all reports | |
| Regenerate | own reports | any | |

Data minimization (Data Privacy Act): no contact details, no dates of birth, no addresses below municipality, no IDs, tokens, password hashes, document URLs, IPs or user agents in any export or JSON; minors (15 to 17) only as aggregates, with cells under 5 shown as "under 5"; deleted or purged accounts appear only as "Former user" aggregates; forbidden fields are absent from the server projection (allow-list, as in `userInsightsService` and the users CSV), not hidden by the client. Exports needing a stated purpose: jobseeker-adjacent datasets (hires/placements, SPES, applications) and the audit summary; the purpose is stored in history and in the audit entry.

PESO policy decisions to flag: retention of report history; whether named placement lists are ever allowed; the minimum cell size; whether any export of minors' data is allowed even aggregated below municipality level; whether exports are "official reports" needing a signature line (Q10); who may see history of other people's exports.

---

## 7. API contract

All paths exist under both `/api` and `/api/v1` through the existing `${basePath}/admin` mount. All behind `protect, isAdmin` unless noted. Query strings pass `sanitizeQueryParams`; bodies pass `sanitizeRequestBody` and `detectMaliciousPayload`.

### 7.1 New

| Method and path | Role | Purpose | Key params | Response |
|---|---|---|---|---|
| `GET /admin/analytics/filter-options` | admin+ | Catalog values for the filter controls | none | `{municipalities, industries, jobTypes, workNatures, years:[min..current], ageBrackets}` |
| `GET /admin/analytics/summary` | admin+ | All numbers for one section | `section=jobs\|employers\|applicants`, filter fields (section 4.1), `scope=all\|public` | `{filters, period:{type,from,to,isPartial,asOf}, cards:[{key,value,delta?}], series:[...], breakdowns:[...]}` |
| `GET /admin/analytics/performance/employers` | admin+ | Ranking | `period=quarter\|year`, `year`, `quarter`, `limit` (max 50), optional filters | `{period, previous, eligibility:{ranked, notEnoughData, excluded}, rows:[{rank, employerId, name, avatar, postings, applicants, hires, hireRate, hireRateLower, fillRate, medianDaysToHire, responseRate?, score?}], notEnoughData:[...], asOf}` |
| `GET /admin/analytics/performance/employers/:employerId` | admin+ | Drill-down | same period params | `{employer, metrics, previous, postings:[{id,title,funnel,timeToFillDays,closeReason}]}` |
| `GET /admin/report-exports/catalog` | admin+ | Datasets, allowed columns, groupings, caps for this role | none | `{datasets:[{id,columns:[{key,label,default}],groupings,needsPurpose,maxRows}]}` |
| `POST /admin/report-exports/preview` | admin+ | Count and first 20 rows | `{dataset, params, columns, grouping}` | `{recordCount, sample, preparedBy:{name,role,office?}, wouldExceedLimit}` |
| `POST /admin/report-exports` | admin+ (dataset-gated) | Generate file | `{dataset, params, columns, grouping, format, purpose?}` | file stream; headers `Content-Disposition`, `X-Report-Id`, `Cache-Control: no-store` |
| `GET /admin/report-exports` | admin+ | History, paginated | `page`, `limit` (max 50), `dataset`, `from`, `to`; admin sees own, superadmin all | `{items, total, totalPages}` |
| `GET /admin/report-exports/:reportId` | admin+ | One record's metadata | | metadata (no file) |
| `POST /admin/report-exports/:reportId/regenerate` | admin+ (own) / superadmin | Re-run stored params | | file stream, new report ID |

Error codes: 400 `INVALID_FILTER`, `INVALID_PERIOD`, `COLUMN_NOT_ALLOWED`, `PURPOSE_REQUIRED`; 403 `DATASET_FORBIDDEN`; 404 `REPORT_NOT_FOUND`; 422 `EXPORT_TOO_LARGE`; 429 `RATE_LIMITED`, `REPORT_IN_PROGRESS`; 504 `QUERY_TIMEOUT`. The server ignores any `preparedBy`, `reportId` or `generatedAt` sent by the client.

### 7.2 Changed (additive, behavior notes)

| Endpoint | Change |
|---|---|
| `GET /admin/analytics` | Same keys. New additive keys: `applicationsByStatus` gains `under_review`, `approved`, `withdrawn`; `period`, `asOf`; deleted accounts excluded from counts; `year` boundaries in Manila |
| `GET /admin/analytics/provincial` | Same shape. Default `year` becomes the current Manila year (was 2026); client year list comes from `filter-options` |
| `GET /admin/jobs` | Page size cap unchanged (50); the client export path stops depending on it (the generator is server-side); fix the `status=pending` filter bug (own commit, test) |
| `GET /admin/audit-logs` | `fromDate`/`toDate` interpreted as Manila calendar days |

---

## 8. UI plan

| Surface | Admin | Superadmin |
|---|---|---|
| Navigation | existing "Reports & Statistics" (`/admin/reports`) keeps its place | same item (the superadmin navbar already links it) |
| `/admin` dashboard | compact filter bar above the KPI cards and charts; cards, trend, donut and provincial block all read the same filter object; "Top employers" card (top 5, current quarter) | same |
| `/admin/reports` | tabs: Applicants, Jobs, Employers (existing, now filtered by the same object and URL-persisted), new **Employer performance**, and a "Report generator" button | same |
| `/admin/reports/generator` (new page) | builder + history (own) | builder + history (all) |
| `/admin/reports/performance/:employerId` (new page) | drill-down | same |

Layouts: desktop = filter row, chips, then cards and charts in the existing grid; tablet = controls wrap two or three per row; phone = Filters button, single-column charts, tables become cards. Reused: `MetricCard`, `StateBlock`, `Pagination`, `Avatar`, `AppModal` (preview and confirm), `useModalA11y`, `chartTheme`, `.um-toolbar` and chip styles, `AdminHeader` (or a hidden h1 plus the top bar title, as User Management does).

---

## 9. i18n and accessibility

New string groups in `en.json` and `fil.json` (parity checked, Filipino flagged for native review): `admin.analytics.filters.*`, `admin.analytics.periods.*` (Q1 to Q4, year, "in progress, as of"), `admin.performance.*` (metric names, "Not enough data", eligibility note, drill-down), `admin.reportGenerator.*` (datasets, columns, groupings, formats, purpose, history, errors, "prepared by" labels). Keys never contain dots in the leaf name (audit action keys lesson).

Accessibility: every chart has a "Show as table" toggle and a text summary in a `role="img"` label; colors from `chartTheme` plus a second encoding (pattern, shape or direct labels), never color alone; the donut shows values in a legend table; filters are real labelled controls, chips are `aria-pressed` buttons, the builder is a labelled form with step headings, errors are linked with `aria-describedby`; 44 px targets; focus visible; a polite live region announces result counts and "Report ready, ID RPT-...".

---

## 10. Performance and safety

Estimated cost (assumes province scale: tens of thousands of users and applications; to be measured, not guaranteed):

| Query | Today | Planned |
|---|---|---|
| Dashboard KPIs | full collection load of `JobApplication` plus yearly doc loads | 6 `countDocuments` and 3 `$group` aggregations; `{createdAt}` and `{status}` indexes |
| Employer ranking | not available | `JobVacancy` match by `createdAt` -> `$lookup` applications by `vacancy` (indexed) -> `$group` by employer; needs `{employer, createdAt}`; capped by eligibility and `maxTimeMS` |
| Applicant breakdowns | per-applicant profile fetch with unbounded `$in` | `$lookup` to `jobseekerprofiles` on `userId` (indexed) in one pipeline |

Indexes to add (each an additive `schema.index`, listed so they can be created before deploy): `JobVacancy {employer:1, createdAt:-1}`, `JobApplication {createdAt:1}`, `JobApplication {vacancy:1, status:1}`, `JobApplication {status:1, hiredAt:1}`, `ReportExport {reportId:1}` unique, `ReportExport {preparedBy:1, createdAt:-1}`.

Caching: none in v1. Staleness rule: any cached number could show a just-suspended or just-deleted employer as eligible, which the eligibility predicate must never do. If measurements later require it, cache only the expensive pure-event aggregates (no account-state fields) for 60 seconds, keyed by the canonical filter hash, with a `statsVersion` counter bumped by the same code paths that suspend, reactivate, delete, restore or purge users; account-state predicates are always applied fresh.

Protection against expensive combinations: filters are whitelists (enums and catalog values, no free regex); period max 5 years; one employer id at most; `limit` caps; `maxTimeMS` 15 s on analytics and 20 s on exports; per-account budgets; row caps; `lean()` and projection on every export query.

Failure handling: each section loads independently, so one failed card shows "Could not load, try again" without blanking the page; the export fails closed (audit first); partial PDF/XLSX output is never sent (build to a temp buffer or stream with abort on error).

---

## 11. Test plan

Server (jest, mocked models for routes plus real aggregation logic tested through pure functions where possible):

| Area | Cases |
|---|---|
| `periodBounds` | quarter and year boundaries at Asia/Manila midnight; 31 Dec 23:59 Manila vs 1 Jan UTC; partial current period `isPartial`; previous-period computation; invalid inputs rejected |
| Metrics | hires per employer; hire rate Wilson bound (1/1 below 8/20); fill rate with multi-slot jobs; median time to hire with one outlier; zero applicants (no divide by zero, "not enough data"); ties broken by the documented order; legacy `Accepted` counted as hired |
| Eligibility | suspended, banned, deactivated, deleted and unverified employers excluded and counted; anonymized purge stub never named; verified-then-restricted employer's hires still in the province total |
| Filters | every filter builder rejects unknown values and objects; municipality parser on well-formed and odd `location` strings; age bracket from DOB near birthday boundaries in Manila; small-cell suppression |
| Existing bugs | analytics status buckets include `under_review`/`approved`/`withdrawn`; `$filter` variable fix drops blank industries; `status=pending` filter no longer merges with search |
| Permissions | admin vs superadmin per dataset; 403 `DATASET_FORBIDDEN`; no token 401; both `/api` and `/api/v1` mounts |
| Export header contents | preparer name/role/office from the authenticated user even when the body claims otherwise; Manila timestamp; unique report ID; record count equals rows; filters and period summary present; audit entry written first and request fails if the audit write fails; history row written |
| Privacy | JSON and files contain none of: email, phone, dateOfBirth, password, token, document URL, IP; minors only aggregated; deleted users anonymized |
| Limits | 422 over the row cap; 429 over the budget; in-flight guard; 504 on `maxTimeMS` |
| Formats | CSV BOM and formula neutralization; XLSX cover sheet content and string-typed risky cells; PDF text extraction shows peso sign and a name with ñ (font embedded) |

Client (vitest + Testing Library, node:test for pure helpers): filter parse/serialize/canonical URL and hidden-control stripping; live debounce; stale response ignored; Clear filters visible only when active; empty and error states with retry; chips toggle; builder only offers allowed columns for the role; preview shows the prepared-by block; purpose required before Generate; history list; charts have table alternatives; mobile Filters toggle; i18n key existence.

Manual checks at 1280, 768, 390 and 320 on Admin and Superadmin, both dashboards and the generator, using a real-browser harness like the one used for User Management.

Seed data needed (a fixture module, not production data): 8 employers (verified active with many hires; verified with 1 of 1 hire; verified with 0 applicants; verified suspended; verified deactivated; unverified; deleted and anonymized; verified with legacy `Accepted` rows); postings across two quarters including one created 31 Dec 23:30 Manila and one on 1 Jan 00:30 Manila; multi-slot postings; applications in every status including withdrawn; applicants of ages 15, 17, 18, 30, 31 and a birthday on the period boundary; hires with and without `hiredAt` (backfill case); SPES postings with applicants aged 15 to 17.

---

## 12. Build order

One branch `feat/reports-and-dashboard-analytics`. Each commit leaves server tests, client build and lint passing and can be reverted alone.

| # | Commit | Contents | Size | Risk |
|---|---|---|---|---|
| 1 | Shared foundations | `period.js` (Manila bounds), `privacy.js` (age bracket, small-cell rule), `filters.js` (parse/validate, whitelists), config constants; pure, no endpoint | S | Low |
| 2 | Data additions | `JobApplication.hiredAt` and `firstResponseAt` set at the four status-change sites, backfill script (written, not run), indexes; no read changes | M | **High**: touches the status code paths in `employerController.js` and `jobController.js`; wrong placement could skip a write |
| 3 | Analytics service, existing endpoints | Move `getAdminAnalytics` and `getProvincialAnalytics` onto aggregations with the same shapes, fix the four bugs (dropped statuses, `$ind`, hard-coded year, local-time boundaries), add `filter-options` | L | Medium: shape compatibility; mitigated by golden tests |
| 4 | Dashboard filtering (k) | `GET /admin/analytics/summary`, client filter module, filter bar, URL state, cards/charts/tables from one response, Reports page filters moved to the URL | L | Medium |
| 5 | Job Monitoring fixes | `status=pending` filter bug, stats via aggregation, export-truncation notice | S | Low |
| 6 | Employer performance server (j) | service, ranking, drill-down, endpoints, tests | M | Medium: metric definitions and small-sample rules |
| 7 | Employer performance client (j) | tab, dashboard card, drill-down page, chart plus table | M | Low |
| 8 | Generator core (l) | catalog, `ReportExport` model, report ID, prepared-by, audit-first, history endpoints, CSV generation, budgets, tests | L | **High** (privacy allow-lists, audit-first behavior) |
| 9 | XLSX (l) | `exceljs` dependency, cover sheet, streaming | M | Medium (new dependency) |
| 10 | PDF (l) | `@pdf-lib/fontkit` + font file, title block, table paginator | M | **High** (layout and fonts) |
| 11 | Generator client (l) | builder, preview, history, regenerate | L | Medium |
| 12 | Retire client-side exports | Reports page uses the generator, remove `EXPORT_LIMIT` path and the unsafe `csvCell` copy | S | Low |

Dependencies: 1 before everything; 2 before 6 and the response-time parts; 3 before 4; 6 before 7; 8 before 9, 10, 11; 12 last. j and k are independent after commit 3; l needs commit 1 and the filter module from commit 4 for its filters step.

---

## 13. Risks, out of scope, and decisions

### Risks and unknowns

- Metric definitions are a policy choice; a poorly explained ranking can embarrass the office (mitigated by transparent tie-breakers and "Not enough data").
- `hiredAt` and `firstResponseAt` start empty; back-filled `hiredAt` is only as good as `statusUpdatedAt` (Likely fine). Response metrics will be thin until new data accumulates.
- Whether `migrateApplicationStatuses.js` ran in production is unknown (**Suspected**); legacy status spellings are handled either way.
- Municipality derived from free-text `location` may misclassify old rows (**Suspected**); an "Other / Unparsed" bucket keeps totals honest.
- Real data volumes and current Atlas indexes were not checked (no database access): cost figures are estimates.
- PDF layout and fonts are the most error-prone part; the peso-sign claim is **Likely** and must be proven with a rendered sample before commit 10 is accepted.
- Two new dependencies (`exceljs`, `@pdf-lib/fontkit`) and one font file need approval.
- Not checked: production environment settings, whether admins currently use the client-side exports in a way that must keep working, the `Reports.jsx` code after line 330 (PDF handler, render), `JobMonitoring.jsx` internals, `AuditTrail.jsx` export behavior, mobile behavior of existing dashboards.

### Ideas considered and kept out of scope (not folded in)

- Asynchronous report generation with a status poll and a download link.
- Scheduled or emailed reports; saved report templates; shareable report links.
- Pre-computed daily statistics collections or a data warehouse.
- Storing generated files; digital signatures or QR verification of a report.
- Employer-facing "how do I compare" scorecards; public leaderboards.
- Geographic maps; forecasting; sector benchmarks.
- A stored `JobVacancy.municipality` field to replace location parsing.
- SPES-to-employer linkage (would need new data and a policy decision).
- Translating the existing hard-coded English labels on the legacy dashboard (separate task).

### Decision questions (recommended answer first)

1. **Definition and weights of "performative".** Recommend: rank by hires with the tie-breakers in 3.2 in v1; add the optional 40/25/20/15 score only after PESO reviews it. Why: no hidden weights to defend, easy to explain, and response time data does not exist yet.
2. **Minimum sample.** Recommend at least 2 postings and 5 applicants in the period to be ranked. Why: stops a 1-of-1 employer topping the list; PESO can change two constants.
3. **Formats.** Recommend CSV, XLSX and PDF, all server-side. Why: one authoritative "prepared by" path. (3b) CSV metadata as leading rows, blank line, then the header: readable in Excel; a companion file is awkward to keep together. Alternative for PDF: `pdfmake` instead of `pdf-lib` + font if you want less layout code.
4. **Report history.** Recommend yes, metadata only (no files), kept 24 months, purpose text stored. Why: accountability without storing regulated data twice. Which datasets need a purpose: hires/placements, SPES, applications, audit summary.
5. **Do statistics include postings of suspended employers?** Recommend staff views default to all (labelled "includes postings hidden from the public"), with a Public-only switch. Why: staff need the full picture, but the label prevents confusion with the job board.
6. **Same datasets for Admin and Superadmin?** Recommend the same operational datasets; superadmin additionally gets the audit summary and all-user history. Why: PESO admins prepare the reports; per-person data stays out for both.
7. **Named placement lists.** Recommend not in v1 (age bracket only). Why: Data Privacy Act minimization; revisit with a written PESO policy.
8. **Small-cell rule.** Recommend show "under 5" for any age-bracket or minor cell below 5. Why: tiny cells can identify a minor in a small province.
9. **Eligibility timing.** Recommend current account state (verified and in good standing now), disclosing the excluded count. Why: there is no verification history; consistent with the unlisted-jobs rule.
10. **Signature or approval line.** Recommend a printed "Prepared by" block only, with an empty "Reviewed by" line on PDF. Why: matches paper practice without adding an approval workflow; a real approval workflow is a separate feature.
11. **Retention of the new history and exports metadata.** Recommend 24 months with a deletion script, audit entries follow the audit policy. Why: bounded growth.
12. **Dependencies.** Recommend approving `exceljs` and `@pdf-lib/fontkit` plus one OFL font. Why: no XLSX capability and no peso-capable PDF font exist today.
