# Match-Weights Backend Handoff (§C.1)

**Status: the client UI for this feature is built and merged. The server side described
below does not exist yet — this document is the exact contract that UI was built against.**

Context: `markdowns/JOB_MATCHMAKING_IMPROVEMENT_PLAN.md` §C.1 and
`markdowns/EMPLOYER_RATINGS_AND_MATCH_CONFIG_PLAN.md` Part 2 are the original design docs.
This handoff restates only what's needed to implement the backend, with exact shapes the
client already calls, so no UI changes should be needed to integrate — only new server files
and edits to two existing controllers.

---

## 1. What already exists (do not re-build)

- `server/services/semanticService.js` — `computeUnifiedScore(job, applicant, industryScoreOverride, weights, industryMode)` **already accepts a `weights` parameter**, defaulting to the module constant `DEFAULT_DIMENSION_WEIGHTS` (ten keys, see §2). This was done in an earlier phase specifically so this feature wouldn't need to touch the scoring function itself — only *what gets passed into it*.
- The ten dimension keys, their weights' current code-fallback values, and their client-side labels are already defined in `client/src/utils/qualifications.js`:
  - `DIMENSION_ORDER` — the canonical key list and order.
  - `DIMENSION_LABELS` — display labels.
  - `CODE_FALLBACK_WEIGHTS` — integer-percent mirror of `DEFAULT_DIMENSION_WEIGHTS` (sums to 100).
- Client UI, fully built, calling the endpoints in §3 below:
  - `client/src/components/MatchWeightsEditor.jsx` — shared 10-slider editor (employer default + per-vacancy override).
  - `client/src/components/MatchWeightDefaultsSettings.jsx` — admin platform-default panel, rendered in `client/src/pages/admin/AdminDashboard.jsx`.
  - `client/src/components/MatchWeightBoundsSettings.jsx` — superadmin bounds panel, rendered in `client/src/pages/superadmin/SuperadminConsole.jsx`.
  - Per-vacancy override section in `client/src/components/JobPostingForm.jsx` (only shown when editing an existing job).
  - `client/src/services/api.js` — `employerAPI.{getMatchWeights,updateMatchWeights,resetMatchWeights}`, `jobAPI.{getMatchWeights,updateMatchWeights,resetMatchWeights}`, `adminAPI.{getMatchWeightDefaults,updateMatchWeightDefaults}`, `superadminAPI.{getMatchWeightBounds,updateMatchWeightBounds}`.

All of this currently 404s or errors, by design, until the routes below exist. The UI shows an
inline "not available yet" message on 404 rather than crashing.

## 2. The WeightsMap / BoundsMap shapes

```ts
type DimensionKey =
  | "skills" | "title" | "experience" | "education" | "credentials"
  | "industry" | "language" | "salary" | "location" | "employmentType";

type WeightsMap = Record<DimensionKey, number>; // integers 0-100, MUST sum to exactly 100
type BoundsMap  = Record<DimensionKey, { min: number; max: number }>; // integers 0-100, min <= max
```

All ten keys are always required — no partial objects, no unknown keys. Reject anything else
with 400.

`CODE_FALLBACK_WEIGHTS` (the code-fallback link in the resolution chain, integer form):

```json
{ "skills": 27, "title": 11, "experience": 12, "education": 9, "credentials": 6,
  "industry": 10, "language": 4, "salary": 6, "location": 9, "employmentType": 6 }
```

This must match `server/services/semanticService.js`'s `DEFAULT_DIMENSION_WEIGHTS` (same
values, 0..1 scale there, 0..100 here — multiply by 100).

## 3. Endpoints the client already calls

All responses are JSON. All require `Authorization: Bearer <token>` like every other endpoint
in this codebase (`getAuthHeader()` in `api.js`).

| Method | Path | Role | Request body | Response body |
|---|---|---|---|---|
| GET | `/api/employers/match-weights` | employer | — | `{ weights: WeightsMap, isCustom: boolean, bounds: BoundsMap }` |
| PUT | `/api/employers/match-weights` | employer | `{ weights: WeightsMap }` | `{ weights: WeightsMap }` |
| DELETE | `/api/employers/match-weights` | employer | — | `{ weights: WeightsMap }` (now resolving to platform default) |
| GET | `/api/jobs/:id/match-weights` | employer, must own `:id` | — | `{ weights: WeightsMap \| null, isCustom: boolean, bounds: BoundsMap, employerDefault: WeightsMap }` |
| PUT | `/api/jobs/:id/match-weights` | employer, must own `:id` | `{ weights: WeightsMap }` | `{ weights: WeightsMap }` |
| DELETE | `/api/jobs/:id/match-weights` | employer, must own `:id` | — | `{ ok: true }` |
| GET | `/api/admin/match-weight-defaults` | admin or superadmin | — | `{ weights: WeightsMap, bounds: BoundsMap }` |
| PUT | `/api/admin/match-weight-defaults` | admin or superadmin | `{ weights: WeightsMap }` | `{ weights: WeightsMap }` |
| GET | `/api/admin/match-weight-bounds` | **superadmin only** | — | `{ bounds: BoundsMap }` |
| PUT | `/api/admin/match-weight-bounds` | **superadmin only** | `{ bounds: BoundsMap }` | `{ bounds: BoundsMap }` |

Important: **a GET for an employer/job with no custom profile saved yet must return 200**, not
404 — `weights: null` (per-vacancy) or the resolved default (employer default, which always
has a value because it falls back through the chain) with `isCustom: false`. The client's
"not available yet" 404 handling is scaffolding for *this feature not existing at all* — once
routes exist, 404 should only mean "job not found" etc., same as every other endpoint.

On ownership mismatch (`/api/jobs/:id/match-weights` for a job the caller doesn't own), return
403, matching the existing pattern in `employerRecommendationController.getRankedApplicants`
(`server/controllers/employerRecommendationController.js` — ownership check via
`String(job.employer?._id || job.employer) !== req.user.id`).

On validation failure (sum ≠ 100, non-integer, missing/unknown key, out of bounds), return 400
with `{ message: "<human-readable reason>" }` — the client reads `err.response.data.message`
and displays it inline.

## 4. Data model

`server/models/MatchWeightProfile.js`:

```js
{
  owner: { type: ObjectId, ref: "User", default: null },       // employer; null = platform default
  vacancy: { type: ObjectId, ref: "JobVacancy", default: null }, // null = employer's own default; set = per-vacancy override
  weights: {
    skills: Number, title: Number, experience: Number, education: Number,
    credentials: Number, industry: Number, language: Number, salary: Number,
    location: Number, employmentType: Number,
  },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: ObjectId, ref: "User" },
}
```

Compound **unique** index on `{ owner, vacancy }`. Three kinds of document live in this one
collection, distinguished by which of `owner`/`vacancy` is null:
- `owner: null, vacancy: null` → the single platform-default document.
- `owner: <employerId>, vacancy: null` → that employer's own default.
- `owner: <employerId>, vacancy: <jobId>` → that one job's override (owner is redundant with
  the job's own `employer` field, but keeping it lets the unique index and ownership checks
  stay simple — don't trust `vacancy` alone for ownership, always re-verify against the job's
  actual `employer` field server-side).

`server/models/MatchWeightBounds.js` — a **singleton** document (only ever one row):

```js
{
  bounds: {
    skills: { min: Number, max: Number }, title: { min: Number, max: Number },
    experience: { min: Number, max: Number }, education: { min: Number, max: Number },
    credentials: { min: Number, max: Number }, industry: { min: Number, max: Number },
    language: { min: Number, max: Number }, salary: { min: Number, max: Number },
    location: { min: Number, max: Number }, employmentType: { min: Number, max: Number },
  },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: ObjectId, ref: "User" },
}
```

If no bounds document exists yet, every dimension's effective bound is `{min: 0, max: 100}`
(i.e. unconstrained) — this is the zero-config starting state, not an error.

## 5. Validation (server-side, never trust the client)

For any submitted `WeightsMap`:
1. Exactly the ten keys in §2, no more, no fewer.
2. Each value is an integer in `[0, 100]`.
3. Values sum to **exactly** 100.
4. Each value falls within that key's current bounds (fetch `MatchWeightBounds`, default
   `{0,100}` per key if the document doesn't exist).

For any submitted `BoundsMap` (superadmin bounds endpoint only):
1. Exactly the ten keys, no more, no fewer.
2. Each `min`/`max` an integer in `[0, 100]`.
3. `min <= max` for every key.
(No sum constraint — bounds aren't weights.)

Reject with 400 + a message identifying which key(s) failed, on any violation.

## 6. Resolution order — wiring into the scoring engine

```
per-vacancy override  →  employer default profile  →  admin-set platform default  →  CODE_FALLBACK (DEFAULT_DIMENSION_WEIGHTS)
```

`computeUnifiedScore(job, applicant, industryScoreOverride, weights, industryMode)` in
`server/services/semanticService.js` already takes `weights` as its 4th argument — **do not
change that function**. The work is entirely in resolving the right `weights` object and
threading it through the two ranking functions that call it:

### 6a. Employer path — `rankApplicantsByJob` (one job, many applicants)

`server/services/semanticService.js`, `rankApplicantsByJob(job, applicants, options)` — its
call to `computeUnifiedScore` is currently:

```js
computeUnifiedScore(job, item, industryScoreOverride, DEFAULT_DIMENSION_WEIGHTS, 'background')
```

Change this to accept a `weights` option (default `DEFAULT_DIMENSION_WEIGHTS`, so omitting it
is a no-op for any caller that doesn't pass one):

```js
function rankApplicantsByJob(job, applicants, options = {}) {
  const { /* existing options */, weights = DEFAULT_DIMENSION_WEIGHTS } = options;
  ...
  computeUnifiedScore(job, item, industryScoreOverride, weights, 'background')
```

In `server/controllers/employerRecommendationController.js` `getRankedApplicants`, after
loading `job` and before calling `rankApplicantsByJob`, resolve the effective weights for
*this one job* (per-vacancy → employer default → admin default → code fallback) with **at
most 3 extra queries total** (per-vacancy doc, employer-default doc, admin-default doc — all
by exact `{owner, vacancy}` key, no scans), and pass `weights: resolved` into the options
object already being built there.

### 6b. Job-board path — `rankJobsBySkills` (one seeker, many jobs, possibly many employers)

This is the case that needs batch-loading, not a query per job (§2.5 of the companion plan is
explicit about this). `server/services/semanticService.js`, `rankJobsBySkills(jobs, skills,
options)` — its call is currently:

```js
const res = computeUnifiedScore(job, seeker, industryScore);
```

Add a `weightsByJobId` option — a plain object or `Map` keyed by `String(job._id)` — and
resolve per job inside the existing `jobs.map(...)` loop:

```js
function rankJobsBySkills(jobs, skills, options = {}) {
  const { /* existing options */, weightsByJobId = null } = options;
  ...
  const ranked = jobs.map((job) => {
    ...
    const weights = weightsByJobId?.[String(job._id)] || DEFAULT_DIMENSION_WEIGHTS;
    const res = computeUnifiedScore(job, seeker, industryScore, weights);
```

In `server/controllers/recommendationController.js` `hybridSearch`, before calling
`rankJobsBySkills`, build `weightsByJobId` with **three batch queries total** (not one per
job):
1. One `MatchWeightProfile.find({ vacancy: { $in: jobIds } })` for per-vacancy overrides.
2. One `MatchWeightProfile.find({ owner: { $in: employerIds }, vacancy: null })` for every
   distinct employer posting a job in this result set.
3. One `MatchWeightProfile.findOne({ owner: null, vacancy: null })` for the platform default
   (fetch once, reuse for every job that falls through to it).

Then for each job: per-vacancy override (if found) → else that job's employer's default (if
found) → else the platform default (if a document exists) → else `DEFAULT_DIMENSION_WEIGHTS`
(the hardcoded constant, when the settings collection is completely empty — guarantees the
board always scores even on a fresh install with zero configured profiles).

Pass the resulting `weightsByJobId` map into both `rankJobsBySkills` call sites in that
controller (the `canPersonalize` branch) — the `else` branch (minimal-signal seeker) only uses
`computeChecklistMatch`, which doesn't take weights, so it needs no change.

### 6c. `computeChecklistMatch` is unaffected

It doesn't use `DEFAULT_DIMENSION_WEIGHTS` at all (it's a points-based "requirements met"
count, not the fuzzy weighted engine) — nothing to change there.

## 7. Audit logging

Call the existing `logAuditEvent` service (`server/services/auditService.js`) on every
successful PUT/DELETE across all five write endpoints, mirroring how NSRP template uploads are
logged (`server/controllers/...` wherever `superadminAPI.uploadNsrpTemplate`'s route handler
calls it — grep `logAuditEvent` for the exact call shape). Record who changed what (actor id,
which profile — platform/employer-id/job-id, old values, new values).

## 8. Guardrails (carry into review)

- **Age eligibility stays a hard gate, non-configurable.** Nothing in this feature should ever
  let `minAge`/`maxAge` become a weighted dimension — it isn't one of the ten keys and must
  never become one.
- **Weights never filter results — they only reorder them.** A 0% weight on a dimension still
  lets a job/applicant appear; it just stops that dimension contributing to the score. Don't
  let a weight of 0 be conflated with "exclude non-matches on this criterion" anywhere in the
  implementation.
- **No migration risk.** Scores are computed at query time from whatever `MatchWeightProfile`
  documents currently exist — there is nothing to backfill, and a weight change takes effect
  immediately and retroactively for every future request with no data migration.
- **An employer can never read or write another employer's profile**, and never another
  employer's job's override. A regular `admin` can read/write the platform default but **not**
  the bounds endpoint — that's superadmin-only, enforced server-side regardless of what the
  client sends.

## 9. Suggested implementation order

1. The two Mongoose models (§4).
2. A shared internal resolver function, e.g. `resolveEmployerWeights(employerId)` and
   `resolveJobWeights(job)`, used by both the single-job employer endpoints and the
   employer-ranking controller — don't duplicate the fallback chain logic in multiple places.
3. The five GET/PUT/DELETE route groups (§3), with validation (§5) and audit logging (§7).
4. Wire `weights`/`weightsByJobId` into `rankApplicantsByJob` and `rankJobsBySkills` (§6a/§6b)
   and their two calling controllers — this is the step that actually makes a saved profile
   change `relevanceScore`, and should be verified with a hand-inserted `MatchWeightProfile`
   document before considering this done (same verification bar the original design doc set
   for this phase: "verify a hand-inserted profile actually changes relevanceScore").
5. Point the already-built UI at the live routes and confirm end-to-end: change a slider, save,
   see the ranked list reorder.
