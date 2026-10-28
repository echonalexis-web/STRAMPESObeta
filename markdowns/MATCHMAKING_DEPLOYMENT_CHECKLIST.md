# Matchmaking and Applicant Ranking — Deployment & Turnover Checklist

**Status:** Not yet cleared for live deployment.  
**Scope:** Job-board recommendations, job-detail match explanations, employer applicant ranking, and configurable matching weights.  
**Purpose:** A prioritized engineering and acceptance checklist for the team taking this feature to production.

This document is based on a targeted review of the current working tree and a backend test run. It is not a full security audit, browser acceptance test, or load-test report. Earlier statements that everything was “fully verified” were too broad: implemented features and passing mocked tests do not establish production readiness.

## How to use this checklist

- `[x]` means the stated baseline was observed, not that the entire feature has production approval.
- `[ ]` means implementation, verification, or sign-off remains outstanding.
- **P0:** Correctness and release blockers; resolve before live use.
- **P1:** Performance, reliability, and acceptance gates; complete before turnover or record an explicitly approved limitation supported by measurements.
- **P2:** Optional improvements; defer unless measurements or product policy justify them.
- Close an item only with evidence: a test, reviewed diff, staging result, benchmark, or named approval. Record the commit and evidence in the completion register below.

## 1. Verified baseline — preserve what already exists

- [x] Ten matching dimensions exist, including location and employment type.
- [x] Shared seeker field-selection constants and a seeker-building helper exist.
- [x] Employer applicant ranking supports must-have checks, server-side sorting, filtered counts, and age-disqualified-last ordering.
- [x] Matching-weight settings and backend endpoints exist for employer defaults, vacancy overrides, platform defaults, and superadmin bounds.
- [x] The resolution service implements vacancy override → employer default → platform default → code fallback.
- [x] Nonempty job-board weight resolution uses at most three profile queries, rather than one query per job. This does not mean the whole recommendation request uses only three queries.
- [x] Stemming and applicant-derived values are memoized; job-board match ordering has a freshness adjustment.
- [x] Breakdown panels, close-match grouping, and a skill-gap insight are implemented in client code.
- [x] Latest review test run: `npm --prefix server test -- --runInBand` produced **70 passing tests across four passing suites, with one additional suite failing to load**. The command exited with code 1.
- [ ] Browser behavior, real MongoDB persistence, startup on the deployment runtime, and concurrent-load performance are independently verified.

## 2. P0 — Correctness fixes required before release

### P0-01 — Normalize configured weights before scoring

**Confirmed defect.** The resolver returns integer percentages such as `skills: 27`, whereas `DEFAULT_DIMENSION_WEIGHTS` uses fractions such as `skills: 0.27`. `computeUnifiedScore()` applies a fixed denominator floor of `0.2` and returns the accumulated weight as coverage. Those operations are not invariant to the scale of the supplied weights.

For example, if salary is the only scored dimension and its dimension score is 1, fractional weights produce `0.06 / 0.2 = 0.30`, while integer weights produce `6 / 6 = 1.00`. Coverage also changes from `0.06` to `6`. Even the code fallback returned by the resolver can therefore change sparse-profile behavior despite having the same nominal proportions.

**Files:** [semanticService.js](../server/services/semanticService.js), [matchWeightsService.js](../server/services/matchWeightsService.js), [matchWeights.js](../server/utils/matchWeights.js).

- [ ] Choose and enforce one internal scoring unit, preferably fractions summing to 1, while retaining integer percentages in the API and settings UI.
- [ ] Normalize at a clearly defined boundary used by every scoring entry point; avoid double conversion.
- [ ] Test default invocation against resolver-supplied fallback for full, sparse, and empty profiles. Scores, coverage, and disqualification must agree.
- [ ] Test custom weights containing zero-weight dimensions and define how those dimensions appear in coverage and explanations.
- [ ] Ensure no-data/zero-effective-weight behavior cannot silently re-enable a deliberately excluded criterion through a fallback scorer.

**Acceptance:** Saving the same weights as the default does not change relevance or coverage; coverage remains within its documented scale.

### P0-02 — Make the job board and job detail use the same applicant-side scoring rules

**Confirmed defect.** `getJobById()` calls `computeUnifiedScore(jobObj, seeker)` without resolving saved weights. The board passes resolved weights. Their industry handling also differs: the board supplies an explicit industry score, including `0.5` when there is an industry but no preference, while the default detail scorer skips missing preference data and uses `0.25` for a mismatch rather than the board's flexible-mode `0.2`.

**Files:** [jobController.js](../server/controllers/jobController.js), [recommendationController.js](../server/controllers/recommendationController.js), [semanticService.js](../server/services/semanticService.js).

- [ ] Resolve effective weights for the single-job detail path.
- [ ] Share the applicant-facing industry policy, including missing data, mismatches, and employer-industry fallback.
- [ ] Reuse the shared seeker builder wherever possible instead of independently reconstructing matching inputs in each path.
- [ ] Test the same seeker/job on board and detail under all four weight-resolution levels.
- [ ] Verify checklist outcomes agree across board, detail, and employer review for identical underlying requirements and profile data.
- [ ] Preserve and document the intentional employer-side industry difference: background fit is not the same signal as seeker preference.

**Acceptance:** Applicant-facing relevance and dimension scores agree for the same data and configuration. Freshness and followed-employer ordering may affect position, not the displayed fit score. Employer relevance need not equal applicant relevance where the approved industry policy differs.

### P0-03 — Do not skip personalization for profiles with other usable signals

**Confirmed gap.** `canPersonalize` checks skills, industry preferences, occupations, work history, education, and desired title, but not several newly supported inputs such as licenses, language, salary preferences, location, and employment type. A profile containing only those signals can enter the non-personalized branch.

**File:** [recommendationController.js](../server/controllers/recommendationController.js).

- [ ] Derive personalization eligibility from the complete supported signal set, or let the scoring engine determine whether usable data exists.
- [ ] Add license-only, location-only, language-only, salary-only, employment-type-only, and completely empty-profile cases.
- [ ] Keep missing data distinct from a scored mismatch, and apply the sparse-data damping policy consistently.

**Acceptance:** A supported signal is not silently ignored merely because skills and preferred industry are empty.

### P0-04 — Make disabling a vacancy override truthful and persistent

**Confirmed defect.** The “Use custom matching weights for this job” checkbox only changes local component state. Unchecking it hides the editor and displays a default-weights message without deleting the stored override. The actual deletion is performed by a separate handler/button.

**File:** [JobPostingForm.jsx](../client/src/components/JobPostingForm.jsx).

- [ ] Make disabling a saved override invoke the removal flow, or clearly represent it as an unsaved change requiring an explicit save.
- [ ] Keep the current saved state visible when removal fails; do not claim the default is active before the server confirms it.
- [ ] Test save → reload → disable/remove → reload, plus request failure and rapid repeated clicks.
- [ ] Verify switching between jobs cannot reuse another job's loaded weights or pending state.

**Acceptance:** The UI's claimed active profile matches what the server actually uses after refresh.

### P0-05 — Prevent impossible bounds and define tightening behavior

**Confirmed validation gap.** Bounds validation checks each min/max pair but does not verify that any ten-key weight vector can still sum to 100. For example, ten minima of 20 pass individual checks but require a total of at least 200. Updating bounds also does not reconcile existing profiles, and scoring does not consult bounds.

**Files:** [matchWeights.js](../server/utils/matchWeights.js), [matchWeightsController.js](../server/controllers/matchWeightsController.js), [MatchWeightBounds.js](../server/models/MatchWeightBounds.js).

- [ ] Require `sum(min) <= 100 <= sum(max)` in addition to individual range checks.
- [ ] Decide whether tightened bounds grandfather existing profiles, reject the bounds change until conflicts are resolved, or trigger an explicit migration. Do not silently clamp values and break the sum.
- [ ] Show the chosen policy and affected-profile information to the administrator.
- [ ] Define behavior for inherited platform defaults, code fallback, presets, and resets when they conflict with the configured bounds.
- [ ] Obtain an approved location-weight cap; current initial bounds allow 0–100 for every dimension.
- [ ] Test infeasible bounds, existing-profile conflicts, and concurrent bounds/profile updates against the chosen policy.

**Acceptance:** Approved bounds allow a valid profile, and the behavior of existing and inherited profiles is explicit and reproducible.

### P0-06 — Establish a genuinely green test and runtime baseline

**Observed blocker.** `tests/server_tests.js` fails to load because `natural` reaches the ESM-only `afinn-165` dependency through its CommonJS import path. The passing matching tests bypass that barrel import with a mock. This is not evidence that production startup fails, but neither does it verify production compatibility.

**Files:** [package.json](../server/package.json), [server_tests.js](../server/tests/server_tests.js), [matchWeights.test.js](../server/tests/matchWeights.test.js).

- [ ] Resolve dependency/import/test-runner compatibility without merely excluding the failing suite.
- [ ] Run the complete backend suite successfully on the runtime intended for deployment.
- [ ] Smoke-test real server startup and ranking requests without the `natural` mock.
- [ ] Add real-database tests for save/read/reset, ownership, bounds persistence, unique indexes, and concurrent upserts.
- [ ] Correct the resolution-test `CUSTOM` fixture: it currently sets title to `11 - 23 = -12`, which is not a valid saved weight profile.
- [ ] Add an end-to-end backend test that saves a valid profile, fetches rankings, verifies changed relevance, resets it, and verifies restored behavior. The current direct scoring test supplies constants rather than reading a saved profile.
- [ ] Include matching services and validation utilities in coverage collection; current configuration lists controllers, routes, models, and middleware only.

**Acceptance:** Full test command exits 0, production-runtime smoke tests pass, and persistence-to-ranking behavior is verified beyond mocked models.

## 3. P1 — Efficiency and reliability requirements

### P1-01 — Bound work and measure capacity before claiming efficiency

**Observed architecture:** The board loads matching vacancies and scores them before slicing. Employer ranking similarly loads applicants for the vacancy before scoring and slicing. Three batched weight queries eliminate an N+1 pattern, but not CPU work, population cost, or in-memory sorting.

- [ ] Benchmark both endpoints using representative vacancy counts, applicants per vacancy, qualifications per job, and concurrent users.
- [ ] Record cold/warm p50, p95, p99 latency, error rate, CPU, event-loop delay, memory, database time, and candidates evaluated.
- [ ] Include large and sparse profiles, repeated requests, keyword filters, must-have filters, and all sort modes.
- [ ] Agree on a deployment capacity envelope and numeric latency/error budgets before the final acceptance run. Do not label unmeasured capacity “fine at current scale.”
- [ ] Add finite integer validation and documented maximum page sizes to both endpoints. Reject or consistently normalize negative, fractional, nonnumeric, infinite, and excessive inputs.
- [ ] Ensure page-size limits are not mistaken for scoring-work limits: the candidate pool is still processed before pagination.

**Important:** Do not add a database `limit` before personalized scoring and call it equivalent. That can discard the best match before ranking. Any candidate-retrieval optimization must demonstrate acceptable recall against the full-ranking baseline.

### P1-02 — Reduce database work without changing ranking semantics

**Files:** [recommendationController.js](../server/controllers/recommendationController.js), [employerRecommendationController.js](../server/controllers/employerRecommendationController.js), [MatchWeightProfile.js](../server/models/MatchWeightProfile.js).

- [ ] Move deadline-closing maintenance out of the job-board request path; it currently calls `updateMany` on every search. Retain read-side exclusion so expired jobs stay hidden if maintenance is delayed.
- [ ] Push safe eligibility filters into MongoDB: deadlines, already-applied exclusions, and strict industry where appropriate. Preserve missing-value, case-normalization, and employer-industry-fallback semantics.
- [ ] Verify suspended/deleted employers cannot appear on the board; its current employer population does not select `isActive`, unlike checks elsewhere.
- [ ] Defer display-only population and application counts until after ranking/pagination when they are not needed to determine filtering or ordering.
- [ ] Inspect actual query plans with `explain('executionStats')` using production-shaped data.
- [ ] Evaluate a vacancy-leading index for override reads. The model currently defines `{ owner: 1, vacancy: 1 }`, while override lookups query `vacancy` alone; do not assume the compound index provides an efficient targeted lookup for that pattern.
- [ ] Verify application/profile/eligibility lookup indexes and deploy index changes explicitly; avoid relying solely on development auto-index behavior.
- [ ] Test ties and page boundaries with deterministic secondary ordering, such as a stable ID tie-breaker.

**Acceptance:** Query plans and timings meet the agreed budget while ranking membership, counts, and ordering remain correct.

### P1-03 — Bound caches and document invalidation

**Confirmed concern.** `stemCache` is a module-level `Map` with no eviction. Its key is the raw input string; callers include free-text matching inputs, so a small fixed vocabulary cannot be assumed.

**File:** [semanticService.js](../server/services/semanticService.js).

- [ ] Bound stemming-cache entries or memory with an eviction policy and test sustained distinct inputs.
- [ ] Verify applicant memoization is used with immutable request-local objects and does not retain stale derived data after mutations.
- [ ] Audit TF-IDF cache keys against every input affecting cached results, including candidate membership and relevant text/profile changes.
- [ ] Avoid caching authorization-sensitive response payloads across users or employers.
- [ ] Add ranked-list caching only if benchmarks justify it, with explicit invalidation for jobs, profiles, applications, account eligibility, follows, weights, and time-sensitive ordering.

**Acceptance:** Memory reaches a stable bound under a long-running test, and relevant changes are reflected within the documented freshness window.

### P1-04 — Strengthen configuration integrity and authorization tests

- [ ] Test unauthenticated access and every role against every settings method, including write/delete operations—not just representative GET requests.
- [ ] Test another employer's vacancy, malformed IDs, missing vacancies, and verification-status restrictions.
- [ ] Ensure the schema and supported write paths preserve valid integer weights and sum-to-100 invariants; API-only validation is insufficient for imports and maintenance scripts.
- [ ] Test simultaneous first saves, resets, and singleton creation with the actual unique indexes installed.
- [ ] Define a concurrent-edit policy: explicit last-write-wins or version-based conflict handling, with user-visible behavior.
- [ ] Verify audit records identify actor, target, and before/after state; document what happens if audit storage fails after the settings write succeeds.
- [ ] Define cleanup and ownership behavior for vacancy deletion or any supported employer reassignment.

## 4. P1 — Matching quality and user acceptance

### Quality is more than passing unit tests

- [ ] Build an anonymized or synthetic evaluation set reviewed by PESO/domain staff: strong fits, partial fits, missing credentials, equivalent experience, sparse profiles, remote work, nearby locations, and differently worded occupations.
- [ ] Evaluate applicant recommendations and employer rankings separately; they answer different questions.
- [ ] Record reviewer judgments, top-result relevance, must-have recall, and unacceptable false-negative examples. Set acceptance thresholds before tuning.
- [ ] Compare default and custom profiles against the evaluation set, including profiles that put very high weight on a single criterion.
- [ ] Confirm checklist percentage means requirements met, while relevance means weighted fit—not probability of hiring or proof of qualification.
- [ ] Review whether followed employers should always precede unfollowed employers, even when the latter are much better matches; current match ordering gives follows first priority.
- [ ] Obtain authorized policy/legal review of age-based disqualification and location limits; do not treat an existing hard gate as proof it is appropriate for every vacancy.
- [ ] Preserve human review and exclude sensitive personal attributes unrelated to job requirements from scoring.

### Browser acceptance checklist

- [ ] Complete real-browser flows for jobseeker, employer, admin, and superadmin, on desktop and a mobile viewport.
- [ ] Save employer defaults, save a vacancy override, change platform defaults, remove the override, and reset employer defaults; verify the resolution chain after reload.
- [ ] Verify the new scores and explanations on both board and detail, and refresh employer ranking after changes.
- [ ] Verify must-have filters, counts, global sorting, ties, empty results, and pagination beyond the first page.
- [ ] Test slow networks, failed saves, rejected validation, and failed initial loads; no silent success or misleading default state.
- [ ] Keep job-post saves and weight saves clearly distinguished, including unsaved changes and cancellation.
- [ ] Distinguish missing candidate information from absent job requirements and intentionally zero-weight criteria in the breakdown. The current generic “Not enough info on your profile” can blame the wrong side.
- [ ] Verify keyboard access, focus, labels, contrast, mobile slider/input usability, and screen-reader error announcements.
- [ ] Verify close-match and skill-gap statements describe their actual data scope. If based only on fetched/paginated jobs, do not imply platform-wide totals.

**Acceptance:** Save a completed UAT record with role, scenario, expected outcome, actual outcome, evidence, and reviewer. Code inspection alone does not close these items.

## 5. P1 — Deployment and operational turnover

- [ ] Record supported Node.js/MongoDB versions, exact lockfiles, environment-variable names, and fresh-install/build/start commands. Keep secrets out of documentation.
- [ ] Test a fresh installation in staging, including the location-data file and all newly added services/models.
- [ ] Back up configuration and relevant data before deploying; rehearse restore in a nonproduction environment.
- [ ] Document approved default weights, bounds, who may change them, and how resets/inheritance work.
- [ ] Document required indexes and any legacy data migrations; verify idempotency and rollback behavior before running them live.
- [ ] Add or verify endpoint rate limits, request timeouts, and database failure behavior for costly ranking requests.
- [ ] Monitor ranking latency, errors, candidate counts, memory, and database load without logging profile text, documents, tokens, or unnecessary personal information.
- [ ] Define alert thresholds and assign a response owner for ranking failures and unexpected score shifts.
- [ ] Document rollback of both application code and matching configuration; code rollback alone may leave newer saved profiles in effect.
- [ ] Update the old improvement plan and handoff document to distinguish implemented features from verified release gates; their historical checklist/status text is not an authoritative readiness record.
- [ ] Provide maintainers an API/role matrix, score semantics, resolution-order examples, test instructions, known limitations, and troubleshooting steps.
- [ ] Provide PESO/admin staff a short operating guide: interpreting scores, changing weights safely, reviewing audit records, and escalating suspicious results.
- [ ] Run a handover exercise in which the receiving maintainer deploys staging, changes and resets weights, diagnoses a ranking issue, and performs a rollback without assistance.

## 6. P2 — Optional work, not automatic release blockers

- [ ] **Application pressure:** obtain policy approval before letting application volume affect recommendation order. Define remaining slots from actual hiring/status semantics, not `slots - applicationCount`.
- [ ] **Additional ranking cache or candidate retrieval:** implement only after profiling identifies a bottleneck; protect personalization, eligibility, and top-result recall.
- [ ] **Improved occupational/credential normalization:** consider curated synonyms and domain mappings if the evaluation set exposes systematic misses. Validate changes rather than tuning only against a few examples.
- [ ] **Platform-wide training-demand insights:** treat as a separate aggregation/privacy feature rather than presenting a single seeker's current page as population-level demand.

A launch can defer these items with a documented decision. It cannot substitute them for P0 correctness fixes or measured operational acceptance.

## 7. Recommended execution order

1. Fix scoring units and applicant board/detail parity; add regression tests first.
2. Fix signal eligibility, override-toggle persistence, and bounds feasibility/policy.
3. Establish a green full suite, production-runtime smoke tests, and real-database integration coverage.
4. Bound pagination inputs and caches; address request-path maintenance and verify indexes.
5. Benchmark representative and peak workloads; optimize only where measurements justify it.
6. Complete domain evaluation, role-based browser UAT, and configuration-policy approval.
7. Rehearse deployment, monitoring, rollback, and maintainer turnover; collect sign-off.

## 8. Release decision checklist

- [ ] All P0 items closed with regression coverage.
- [ ] Full test suite exits 0 and deployment-runtime startup/ranking smoke tests pass.
- [ ] Real-database save → rank → reset tests pass.
- [ ] Board/detail parity and intentional employer-side differences are verified and documented.
- [ ] Browser UAT passes for all four roles.
- [ ] Load and sustained-memory tests meet approved budgets at the agreed deployment scale.
- [ ] Security, ownership, policy, and bounds behavior have named approvals.
- [ ] Monitoring, backup/restore, and rollback are tested.
- [ ] Remaining limitations have explicit owners and acceptance—not a blanket “fully verified” claim.
- [ ] Receiving maintainer completes the turnover exercise.

**Go-live rule:** Do not mark this feature production-ready until all P0 gates are closed and P1 evidence/sign-offs are recorded. If turnover happens earlier, label the delivery as a development handoff with unresolved blockers.

## 9. Completion and evidence register

Duplicate rows as needed. An unchecked item remains open even when related code already exists.

| Item ID / section | Owner | Fix commit / PR | Test or staging evidence | Reviewer / approval | Status |
|---|---|---|---|---|---|
| P0-01 weight scale | Unassigned | — | — | — | Open |
| P0-02 scoring parity | Unassigned | — | — | — | Open |
| P0-03 usable signals | Unassigned | — | — | — | Open |
| P0-04 override control | Unassigned | — | — | — | Open |
| P0-05 bounds policy | Unassigned | — | — | — | Open |
| P0-06 tests/runtime | Unassigned | — | — | — | Open |
| P1 performance and reliability | Unassigned | — | — | — | Open |
| P1 quality and browser UAT | Unassigned | — | — | — | Open |
| P1 deployment and turnover | Unassigned | — | — | — | Open |
