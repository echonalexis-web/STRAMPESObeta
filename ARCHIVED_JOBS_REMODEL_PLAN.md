# ARCHIVED_JOBS_REMODEL_PLAN

> Plan mode only allowed this file location. On approval, copy it to the repo root as `ARCHIVED_JOBS_REMODEL_PLAN.md` (the requested name). No source code was changed.

## Context
The Employer Dashboard "Archived" tab prints a raw database ID for hired people, repeats the same data three times (row, report, bars), buries the few real jobs under rows of zeros, and shows inconsistent close reasons. The remodel gives the employer a clear outcome per posting. Every rule is computed on the server; the client only renders.

Reused work: `COVER_PHOTO_PLAN.md` (profile viewing rules, `profileProjection.js`), the shared `Pagination`, `Avatar`, `StateBlock`, `ProfileLink`, `--ds-*` tokens. No other plan or branch touches the archived tab (checked `markdowns/`, `LOOP.md`).

## 1. Findings (Proven / Likely / Suspected)

| # | Finding | Label | Where |
|---|---|---|---|
| 1 | **"Days" is not the time the job was open.** `daysActive = ceil(archivedAt − createdAt)`, taken at archive time, not close time. Rows with no snapshot show `m.daysActive ?? 0`, hence the 0 days. The "Avg. days active" tile sums `archivedMetrics.daysActive \|\| 0` over **all** archived rows and divides by the row count, so zero rows drag it down (2.8). | Proven | `jobController.js:61` (`buildArchivedJobSnapshot`), `EmployerDashboard.jsx:1343-1349`, `:1990` |
| 2 | **Why 15 of 16 rows are zeros:** the tab lists `job.archived \|\| job.status === "closed"`. Two close paths set `status:"closed"` + `closedAt` with `updateMany` and **never archive**: deadline sweep and inactivity sweep. Those jobs have no `archivedMetrics` and no `archiveReason`, so every number reads 0 and the reason is empty. Only `closeJob` and `archiveJob` call `archiveJobRecord`. | Proven (code); exact split of the 16 rows Suspected (needs data) | `employerController.js:53-181`, `jobController.js:79`, callers `:979` `:1040` |
| 3 | **Close reason is stored only partly.** `archiveReason` enum is `quota_reached / manual_close / deadline_passed`; `quota_reached` and `deadline_passed` are **never written** anywhere. `archiveJob` writes `req.body.reason \|\| "manual_close"` with no whitelist (an unknown value is a Mongoose enum error → 500). Inactivity auto-close has no reason at all. No stored "closed by". | Proven | `JobVacancy.js:166,194`, `jobController.js:1040`, grep for the enum values |
| 4 | **"Manual Close" twice:** the row sub-line shows a chip from `job.archiveReason` and the report shows the same value again as "Reason". Legacy/auto-closed rows show neither. Label is `replace("_"," ")` + title-case, so it is not translatable. | Proven | `EmployerDashboard.jsx:217`, `:1949-1951`, `:373` |
| 5 | **Raw ID:** the report prints `m.hiredCandidateIds.join(", ")`. Server `archiveJobRecord` loads applications **without `.populate("applicant")`**, so `app.applicant` is an ObjectId and the name branch never runs; `hiredCandidateNames` is always empty. Newer snapshots store sequential labels ("1","2") via `toSequentialHiredCandidateIds`; older ones (your screenshot) kept the raw ObjectId string. Neither helps the employer. | Proven | `jobController.js:58-72`, `:95-105`, `EmployerDashboard.jsx:372` |
| 5b | The three "100%" bars are `qualifiedRate / shortlistedRate / hireRate` and are all 100% whenever one applicant was hired. They add no information. | Proven | `EmployerDashboard.jsx:359-386` |
| 6 | **Vacancies:** `slots` (default 1) is the vacancy count. `remainingSlots = slots − hired` exists on the public job payload only. "Filled" is never stored. | Proven | `JobVacancy.js:73`, `jobController.js getJobs`, `utils/jobDisplay.js getHiredCountMap` |
| 7 | **No server pagination.** The tab uses the one unpaginated `GET /employer/jobs`, which also runs both sweeps on every read and does one `countDocuments` per job (N+1). Search, filter and pagination run on the client. | Proven | `employerController.js:293-316`, `EmployerDashboard.jsx:601-625` |
| 8 | The archive pager is a hand-written `emp-pager`, **not** the shared `Pagination` (so no always-visible summary or rows-per-page). | Proven | `EmployerDashboard.jsx:2018+` |
| 9 | **SPES postings do not appear here.** The tab reads `JobVacancy` only; SPES uses its own models. A SPES minor cannot be hired through `JobApplication`; regular job apply is 18+. | Likely | `spesPostingController.js`, `utils/ageAccess.js` |
| 10 | **Profile rules for a hired person:** an employer sees a jobseeker through `projectJobseeker`. A **hidden** profile with an active application shows name only (photo only if `includePhoto`); a withdrawn application ends the relationship; minors are never visible to employers. The existing employer view route is `/employer/applicants/:userId` (`ProfilePage isEmployerView`). Linking name → that route is consistent. Avatar must follow the same `includePhoto` / hidden rule. | Proven | `profileProjection.js jobseekerMode, projectApplicant`, `App.jsx:272` |
| 11 | **Deleted account:** `JobApplication.applicant` would not populate; today nothing handles it (snapshot string stays). Plan shows "Former user". | Likely | `jobController.js:96-103` |
| 12 | **Time-to-fill signal:** `JobApplication.statusUpdatedAt` records the last status change, so the first hire time is derivable. | Proven | `JobApplication.js:48` |
| 13 | **Links:** a filtered applicants view exists only as in-page state (`selectedJobId` on the Applicants tab, not in the URL). No read-only posting route for employers: `/jobs/:id` is open to all roles but is the jobseeker page with apply UI, and `/post-job` is the edit form. | Proven (applicants state), Suspected (JobDetail for an employer, not rendered) | `EmployerDashboard.jsx:414,511`, `App.jsx:249-251` |
| 14 | **Floating buttons cover "View report":** `cb-launcher` and `PesoHelpFloatingToggle` are `position: fixed` bottom-right (`chatbot.css:30`). No shared page-level bottom padding or token was found for dashboard pages. The `ed-page` tab list has no bottom reserve. | Likely (no shared fix found); not rendered | `styles/chatbot.css`, `components/FloatingMessenger.jsx` |
| 15 | **Tab row clipped under the sticky header:** not provable without rendering. `.ed-tabs` has no scroll-margin; the topbar height varies (comment at `employer-dashboard.css:6089` says 69/115px). | Suspected | `employer-dashboard.css:6089` |

## 2. Design and content spec

**Close reason model (server-computed `status`)**: `filled` · `closed_manually` · `expired` · `auto_closed` · `closed` (legacy/unknown, neutral).
- Multi-vacancy: `filled` only when hired ≥ slots; otherwise the stored reason, with "x of y filled".
- A job closed by the employer with all vacancies already hired is still `filled` (outcome wins over mechanism); `closeReason` still records how it was closed.

**Collapsed row** (≥768): `[icon] Title / Location · Closed Oct 10, 2026 · [status chip with text]` then `Posted Sep 1 → Closed Oct 10 · 43 days` · `1 of 1 filled` · one text funnel line `Applicants 1 · Qualified 1 · Shortlisted 1 · Hired 1` · button **View report** (real `<button aria-expanded aria-controls>`).

**Expanded report** (two columns ≥1024; single column below):
1. Outcome: reason text, closed date, closed by (Employer / System / Administrator).
2. Funnel: four counts with a percentage in text ("1 of 1 · 100%"). A bar only if applicants ≥ 5.
3. Hired candidates: avatar + name linking to `/employer/applicants/:id`; "Former user" without a link when the account is gone; name only (no link, initials avatar) when the profile is hidden and no photo was shared.
4. Timeline: Posted · First applicant · Closed.
5. Links: "View applicants for this job" (reuse Applicants tab + `selectedJobId`, deep-linked as `?tab=applicants&job=<id>`) shown. "View posting as published" **omitted** (no suitable read-only view; see decisions).

**Zero-applicant rows:** compact, muted, **not expandable**: title, location, status chip, dates, "No applicants". No button, no zeros.

**List controls:** chips `All · Filled · Closed manually · Expired · No applicants` (each shows its count, `aria-pressed`, result count announced in the existing `role="status"`), sort `Recently closed` (default) / `Most applicants`, existing search, shared `Pagination` always visible (default 10, 25, 50).

**Top stat cards:** `Archived jobs`, `Total applicants`, `Hired candidates`, `Avg. time to fill`, `Fill rate`.

**Definitions (documented in code and in the UI tooltip text):**
- Duration = `closedAt − createdAt`, whole days, minimum shown as "Less than 1 day". Uses closedAt, never archivedAt.
- Filled job: hired ≥ slots. Time to fill = first-hire time (`min statusUpdatedAt` of hired applications) − `createdAt`; if missing, closedAt.
- Avg. time to fill = mean over **filled jobs only**; "—" when there are none.
- Fill rate = filled jobs ÷ archived jobs **with at least one applicant**, as a percentage; zero-applicant jobs are excluded from the denominator and counted separately in the "No applicants" chip. "—" when the denominator is 0.
- Stat totals are computed over **all** the employer's archived jobs, not the current page or filter.

**Responsive:** 1280 grid row, two-column report; 768 funnel wraps under the title; 390/320 stacked card, 2×2 funnel grid, full-width 44px "View report", single-column report. `.ed-arch` gets bottom padding `calc(var(--ds-space-8) + 96px)` (room for both floating buttons) at all widths; each row action keeps a right gutter of 72px ≥1024. No horizontal scroll (`min-width:0`, `overflow-wrap:anywhere` on names).

**States:** loading (skeleton rows, `aria-busy`), error (announced `role="alert"`, Retry), empty (no archived jobs), empty after filter/search (keeps the filters, "Clear filters"), zero-applicant row, legacy row (neutral "Closed", "—" for unknown fields; never "0 days" as a fact).

**Fix classification**
- Raw ID: **Root-cause fix** (populate at archive + server `hiredCandidates`, with a live lookup for old snapshots).
- Zero rows: **Root-cause fix** (compute from live `JobApplication` counts for any closed job, archived or not) plus a non-expandable presentation.
- Inconsistent reason: **Root-cause fix** (stored `closeReason`/`closedBy` at all four close sites + a derived legacy fallback).
- Wrong "Avg days": **Root-cause fix** (new definition, filled-only).
- Floating buttons / clipped tabs: **Silences or mitigates only** (padding and scroll-margin; no page-level avoidance layout exists).
- Duplicated "Manual Close": **Root-cause fix** (shown once, in the chip; the report's Outcome lists reason as a sentence, not a repeated chip).

## 3. API changes (exact)

All on `/api` and `/api/v1` (the employer router is mounted once per base path in `server.js`).

1. **New** `GET /employer/jobs/archived` (employer-only, scoped to `req.user` — same router guard as `GET /employer/jobs`). Query: `page`, `limit` (default 10, max 50), `filter` (`all|filled|closed_manually|expired|no_applicants`), `sort` (`recent|applicants`), `q`. It does **not** run the sweeps (read-only; the sweeps still run via `GET /employer/jobs`).
   Response:
   ```
   { items: [{
       _id, title, location, slots, postedAt, closedAt,
       status, closeReason, closedBy,
       durationDays, filled, vacancies,
       funnel: { applicants, qualified, shortlisted, hired },
       firstApplicantAt,
       hiredCandidates: [{ id, name, avatar? }]   // id, name, avatar only
     }],
     total, page, limit,
     stats: { archivedJobs, totalApplicants, hiredCandidates, avgTimeToFillDays|null, fillRate|null, noApplicantJobs } }
   ```
   Forbidden fields (email, phone, DOB, address, skills, resume, NSRP, ID data) are **absent**, not null. `avatar` is present only when the profile is not hidden or the applicant ticked `includePhoto`; `name` is `"Former user"` marker via `name` omitted + `former: true`.
2. **Additive schema** on `JobVacancy`: `closeReason` (`filled|manual|expired|inactivity|admin|null`) and `closedBy` (`employer|system|admin|null`). Existing `archiveReason` / `archivedMetrics` stay untouched and keep being written.
3. **Behavior additions (no status/auth change):** `closeJob`, `archiveJob`, `autoCloseOverdueJobsForEmployer`, `applyInactivityAutoCloseForEmployer` set `closeReason`/`closedBy`. `archiveJobRecord` populates the applicant name (also fixes the empty `hiredCandidateNames`).
4. **Not changed:** `GET /employer/jobs` (still returned for the other tabs). The Archived tab stops consuming it for archived rows.

**Stop and ask before** (not part of this plan): whitelisting `archiveJob`'s `req.body.reason` (today an unknown value is a 500, a status-code change to 400), any role gating, or changing existing schema fields.

**Legacy fallback (server, no write):** `closeReason` null → map `archiveReason` (`manual_close→manual`, `deadline_passed→expired`, `quota_reached→filled`); else if `applicationDeadline` ≤ `closedAt` → `expired`; else `status: "closed"` (neutral). Backfill script `server/scripts/backfillCloseReason.js` is **dry-run by default** (`--apply` to write), derives `closeReason`/`closedBy: "system"|"employer"` only where certain, **written, not run**.

## 4. File-by-file change list

Server
- `server/models/JobVacancy.js` — add `closeReason`, `closedBy`.
- `server/controllers/jobController.js` — `archiveJobRecord`: populate applicants, store names, set `closeReason/closedBy`; `closeJob`/`archiveJob` set them (admin → `admin`).
- `server/controllers/employerController.js` — set reasons in the two sweeps; new `getArchivedJobs` (aggregation by employer, counts via one `JobApplication.aggregate` instead of per-job counts).
- `server/services/archivedJobsService.js` (new) — pure functions: `deriveStatus`, `deriveCloseReason`, `durationDays`, `timeToFill`, `buildStats`, `projectHiredCandidate` (reuses `projectApplicant`'s hidden/`includePhoto` rule).
- `server/routes/employerRoutes.js` — `router.get("/jobs/archived", sanitizeQueryParams, getArchivedJobs)` placed before any `/jobs/:id` route.
- `server/scripts/backfillCloseReason.js` (new, dry-run default).

Client
- `client/src/pages/EmployerDashboard.jsx` — Archived tab fetches the new endpoint (state: `filter`, `sort`, `page`, `pageSize`, `q`), replaces inline row/card/report markup, stat cards, custom pager. (Only the archived section and its state; other tabs untouched.)
- `client/src/components/ArchivedJobRow.jsx` (new), `ArchivedJobReport.jsx` (new), `ArchivedFilters.jsx` (new). Reuse `Avatar`, `ProfileLink`/`Link`, `Pagination`, `StateBlock`.
- `client/src/utils/archivedJobs.js` (new, pure view helpers: chip variant for `status`, duration/"x of y filled" text, funnel text; no business rules).
- `client/src/services/api.js` — `employerAPI.getArchivedJobs(params, signal)`.
- `client/src/styles/employer-dashboard.css` (archived block, replace `ed-arch__*` rules) or new `styles/archived-jobs.css`; bottom padding and tab `scroll-margin-top`.
- `client/src/i18n/locales/en.json`, `fil.json` — new keys below.

## 5. Strings (en + fil; Filipino flagged for native review)
`employerDashboard.archived.*`: `status.{filled,closedManually,expired,autoClosed,closed}`, `closedBy.{employer,system,admin}`, `filters.{all,filled,closedManually,expired,noApplicants}`, `sort.{label,recent,applicants}`, `postedToClosed`, `daysOpen`, `lessThanDay`, `filledOf` ("{{filled}} of {{vacancies}} filled"), `funnel.{applicants,qualified,shortlisted,hired}`, `funnelPct`, `noApplicants`, `viewReport`, `hideReport`, `outcome`, `closeReason`, `closedOn`, `closedByLabel`, `hiredCandidates`, `noneHired`, `formerUser`, `timeline.{posted,firstApplicant,closed}`, `viewApplicants`, `statAvgTimeToFill`, `statFillRate`, `statNoData`, `resultsCount`, `clearFilters`, `loadError`, `retry`. Existing `sumAvgDays` retired.

## 6. Tests (all mocked; no real DB or Cloudinary)
Server (`server/tests/archivedJobs.test.js`): response shape; **scoping** (employer B's jobs and applicants never returned for employer A); filter and sort; pagination and limit cap; close-reason fallback table (stored, `archiveReason` map, deadline, neutral); status `filled` vs multi-vacancy; zero-applicant job; `hiredCandidates` fields exactly `id, name, avatar` and forbidden keys **absent**; hidden profile without `includePhoto` → no avatar; deleted account → `former`; stats (filled-only average, fill-rate denominator, "—" cases); both mounts (`mountApiRoutes("/api")` and `("/api/v1")`); sweeps set `closeReason/closedBy`; `archiveJobRecord` stores names; backfill script dry-run changes nothing.
Client (`node --test`, pure): `archivedJobs.js` helpers per status, zero-applicant row (not expandable), filter/sort param building, empty states, en/fil key parity, "no bars under 5 applicants".

## 7. Risks
- Closed-but-never-archived jobs currently listed will now show real funnel numbers (computed live). Good, but counts can differ from old snapshots; the server prefers live data and stores nothing new for them.
- Stats over all archived jobs need an aggregation; N+1 removal makes this cheaper than today.
- Legacy rows stay neutral "Closed" until the backfill is approved and run.
- Linking to profiles depends on the employer–applicant relationship; withdrawn applications drop the link (shown as name only).

## 8. Extra ideas (kept separate, not in scope)
Reopen from the report; export archived report as CSV; show median instead of mean; per-source applicant breakdown; link to the match weights used at close.

## 9. Unrelated issues noticed (not fixed)
- `GET /employer/jobs` runs two write sweeps on every read and one `countDocuments` per job.
- `archiveJob` accepts an unvalidated `reason`.
- `quota_reached` / `deadline_passed` enum values are dead.
- `SPES_PAGINATION_AUDIT.md` shows as deleted in the working tree (pre-existing).

## 10. Verification (when built)
`npm test` (server, client), `npm run build`, `npm run lint` not above baseline (47), `en.json`/`fil.json` key parity; manual at 1280/768/390/320: filled, closed manually, expired, auto-closed, zero-applicant, legacy, multi-vacancy, deleted hired user, hidden-profile hired user, floating buttons not covering "View report", both languages, network tab shows no forbidden fields.

## My decisions
- **Stat cards:** replace "Avg. days active" with "Avg. time to fill" and add "Fill rate" — default **yes**.
- **Hired candidates:** add `hiredCandidates` (id, name, avatar) to the archive response, additive — default **yes**.
- **Close reason:** use the stored field going forward (`closeReason`, new — the old `archiveReason` is partly dead) and show a neutral "Closed" for legacy jobs — default **as stated**; backfill written, not run.
- **Zero-applicant rows non-expandable** — default **yes**.
- **Filter and sort on the server with pagination** — default **yes**.
- **Links:** applicants link reuses the Applicants tab (add `?tab=applicants&job=` deep link); "View posting as published" **omitted** because no read-only employer view exists — default **omit**.
- **Deleted account** shown as "Former user" — default **yes**.
- **Multi-vacancy:** "Filled" only when all vacancies are filled, otherwise "Closed"-type status with "x of y filled" — default **yes**.
- **Fill rate denominator:** archived jobs with at least one applicant — default **yes** (alternative: all archived jobs).
- **Whitelist `archiveJob`'s `reason`** (400 instead of a 500 on a bad value) — default **ask first**, not in this plan.
