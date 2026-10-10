# Employer Ratings & Configurable Job-Matching — Implementation Plan

Status: **planning only — no code written yet**

Scope:
1. A jobseeker → employer rating/feedback system, and how ratings feed into job-feed recommendations.
2. Replacing the hardcoded job-match weighting in `semanticService.js` with a configurable one
   (employer- and admin-settable), covering **skills, educational attainment, work experience,
   industry, location, employment type, required qualifications, certifications**.

Every file path, field name, and enum value below was verified against the current codebase.
Where a criterion you asked for does **not** exist yet, that is called out explicitly rather
than glossed over — §2.2 is the most important section in this document for that reason.

---

## 0. What exists today (verified baseline)

- **Matching engine**: `server/services/semanticService.js`. One hardcoded constant drives it:

  ```js
  const DIMENSION_WEIGHTS = {
    skills: 0.28, title: 0.17, experience: 0.14, education: 0.10,
    credentials: 0.07, industry: 0.12, language: 0.05, salary: 0.07,
  };   // sums to exactly 1.00
  ```

  `computeUnifiedScore(job, applicant, industryScoreOverride = null)` calls one function per
  dimension; each returns `0..1` **or `null`** ("no data on either side" → skipped). Final
  score = `weightedSum / Math.max(weightSum, 0.2)`, averaged over only the non-null
  dimensions. Age is a **hard gate**, not a weight — out-of-band age short-circuits to
  `{ score: 0, disqualified: 'age' }`.
- **Callers**: `recommendationController.hybridSearch` (jobseeker job board) and
  `employerRecommendationController.getRankedApplicants` (employer's ranked applicants).
  Both attach `relevanceScore` (0..1) + `matchBreakdown` to each result **at query time**.
  Nothing is persisted on `JobApplication`, so weight changes take effect immediately for all
  future searches — **no migration or backfill is ever needed**.
- **No rating/review system exists anywhere** in client or server, used or unused. (The only
  field named `rating` is `JobseekerProfile.eligibilities[].rating`, a civil-service exam
  score string — unrelated.)
- **`JobApplication.status`** enum: `pending, reviewed, shortlisted, rejected, hired` (plus
  legacy capitalised variants). **`hired` is the last state that exists** — there is no
  "completed" / "employment ended" status anywhere in the app.
- **Notifications** are created in exactly two places —
  `employerController.updateApplicationStatus` and `.bulkUpdateApplicationStatuses` — both via
  `notificationService.createNotificationForUser(...)`, which checks
  `User.notificationPreferences` before creating + emitting.
- **Admin-configurable platform setting precedent**: `NsrpTemplateSettings.jsx` +
  `nsrpTemplateController.js` — per-item settings card, server-side validation, persisted,
  audit-logged via `logAuditEvent`.
- **Client/server shared-util precedent**: `server/utils/age.js` mirrors `client/src/utils/age.js`.
  This matters in §2.3 (a location parser needs the same treatment).

---

# PART 1 — Employer Rating / Feedback System

## 1.1 Goal

Let a jobseeker rate + review an employer they were actually hired by; surface that on the
employer's listings/profile; and use it as one small, bounded signal in job-feed ranking.

## 1.2 When can a jobseeker rate? (your "after leaving a job or something" question)

The app has no "this employment ended" state — `hired` is terminal. Two honest options:

| | Option A — new `completed` status | Option B — time-gate off `hired` |
|---|---|---|
| Change | Add `completed` to the status enum, settable from `hired` | No schema change |
| Accuracy | Precise: rating opens when work actually ended | "N days" is a guess |
| Effort for user | Someone must remember to flip it — many hires never will | Zero user action |
| Notification | Clean event-driven trigger | No event to hang a push on without a scheduler (none exists in this codebase) |

**Recommendation: both, with B as the floor and A as the accelerant.**

```
canRate(application) =
     (status === 'hired' && daysSince(statusUpdatedAt) >= 14)
  || (status === 'completed')
```

`completed` is added as an optional "Mark as no longer working here" action the jobseeker can
take any time after `hired`. It is the only way to rate *before* the 14-day floor, and the one
clean event for a push notification. The 14-day gate itself is evaluated **lazily** on
read (page load / API call), **not** via a cron — this codebase has no scheduled-job
infrastructure, and introducing one solely for this is disproportionate. A banner in "Your
Applications" covers that path.

**One rating per application**, not per employer-jobseeker pair. Someone hired twice by the
same employer in two roles rates each separately; someone merely *rejected* can never rate at
all.

## 1.3 Data model

New collection — `server/models/EmployerRating.js`:

```js
{
  employer:    ObjectId(User),           // rated employer
  jobseeker:   ObjectId(User),           // rater
  application: ObjectId(JobApplication), // UNIQUE INDEX — one rating per application
  vacancy:     ObjectId(JobVacancy),
  rating:      Number,                   // 1-5, required
  categories: {                          // optional sub-ratings, each 1-5
    communication: Number, workEnvironment: Number,
    paymentTimeliness: Number, management: Number,
  },
  reviewText:  String,                   // optional, length-capped (~1000)
  isAnonymous: Boolean,                  // default false — hides rater identity on display
  employerResponse: { text: String, respondedAt: Date },  // optional, one reply
  status: { type: String, enum: ['published','flagged','removed'], default: 'published' },
  createdAt, updatedAt,
}
```

Denormalised aggregate — `averageRating`, `totalRatings`, `ratingBreakdown {1..5}` — stored on
the employer's `User` doc (next to `verificationStatus`, which already lives there) and
recomputed synchronously on every rating create/edit/remove. At this app's scale that is
simplest and correct; if it ever becomes hot, move to a scheduled aggregation — not needed now.

> **Note:** only `status: 'published'` ratings count toward the aggregate, so a
> flagged/removed review stops affecting both the displayed average and §1.8's ranking signal.

## 1.4 API

| Endpoint | Purpose |
|---|---|
| `POST /api/applications/:id/complete` | Flip `hired → completed`; fires the "rate your employer" notification |
| `POST /api/employers/:employerId/ratings` | Create a rating (body carries `applicationId`) |
| `GET /api/employers/:employerId/ratings` | Paginated public list; respects `isAnonymous` |
| `PATCH /api/employers/ratings/:ratingId` | Rater edits own rating within an edit window (suggest 14 days) |
| `DELETE /api/employers/ratings/:ratingId` | Rater deletes own; admin/superadmin may remove any |
| `POST /api/employers/ratings/:ratingId/response` | Employer's one-time public reply |
| `POST /api/employers/ratings/:ratingId/report` | Routes into the **existing** `reportController.js` pipeline with a new `rating` target type — do not build a parallel moderation system |

Eligibility (`canRate`) is **re-validated server-side** on create — ownership of the
application, status/time-gate, and "not already rated". The client's eligibility flag is a UI
hint only, never trusted.

## 1.5 Client UI

- **`YourApplications.jsx`** — on a `hired` row past the gate (or a `completed` row) not yet
  rated, add a **"Rate Employer"** action beside the existing View/Edit/Withdraw buttons (same
  `app-act` button family). Add **"Mark as no longer working here"** on any `hired` row.
- **New `RatingModal.jsx`** — star picker (1-5, required), the four optional category ratings,
  optional review text, anonymous checkbox. Build on the existing `AppModal.jsx` wrapper, not a
  bespoke modal.
- **Employer** (`EmployerDashboard.jsx`) — new "Reviews" tab: aggregate (★ avg + count) plus the
  review list, each with a one-time reply box.
- **Public signal** — `★ 4.3 (28)` on `VacancyCard.jsx` and the employer's public profile, so
  jobseekers see it *before* applying. This is the direct, visible use; §1.8 is the
  algorithmic one.
- **Admin** — moderation queue for flagged ratings, following the existing
  `UserModeration.jsx` / `EmployerVerification.jsx` list-plus-action layout.

## 1.6 Notifications

Two new types via the existing `createNotificationForUser` pattern, each with a matching
`User.notificationPreferences` key (defaulting `true`, like every existing key):

| Type | To | Fires when | Preference key |
|---|---|---|---|
| `employer_rating_prompt` | jobseeker | `completed` transition **only** (event-driven; the time-gate path is a passive banner per §1.2) | `notifyRatingPrompt` |
| `employer_rating_received` | employer | a rating is submitted | `notifyEmployerRating` |

## 1.7 Moderation & abuse prevention

- Reuse the existing report pipeline (§1.4) rather than building a second one.
- Sanitise `reviewText` with `DOMPurify` on submit, matching how chat messages are already
  handled in `Messages.jsx`.
- One-rating-per-application structurally prevents a single applicant from stacking reviews on
  one employer by re-applying. It does **not** prevent multi-account abuse — that is not
  solvable at this layer, and the exposure is the same as any review system's.
- If review-bombing shows up in practice, add a cool-down (no two ratings of the *same*
  employer within N days). Later hardening, not day one.
- Admin removal should be audit-logged via `logAuditEvent`, same as NSRP template changes.

## 1.8 How ratings affect job-feed recommendations

Ratings enter the §2 scoring engine as one **additional dimension**:

```js
employerReputation: 0.06   // illustrative; platform-fixed, NOT employer-configurable
```

- Value = `(averageRating - 1) / 4` → 1★ maps to 0, 5★ maps to 1.
- Returns **`null` when the employer has no published ratings**, so it is simply skipped and
  the weight renormalises away — identical to how every existing dimension already handles
  missing data. No structural change to `computeUnifiedScore` is required.
- Consider requiring a minimum sample (e.g. `totalRatings >= 3`) before the dimension returns
  a value at all, so one disgruntled review can't move a new employer's ranking.

**Two deliberate guardrails:**

1. **This weight is platform-level and excluded from the employer-configurable set in §2.**
   Letting employers tune how much their own reputation counts is a direct conflict of
   interest — anyone with a bad average would set it to zero.
2. **Ratings nudge ordering; they never hide a listing.** Keep the weight small (0.05–0.08
   range) and do not filter low-rated employers out of the feed. A de-facto blacklist is a
   product and legal decision of a completely different magnitude than a ranking nudge, so it
   is flagged here rather than assumed.

**How much can it actually move a result?** The employer's own criteria sum to 1.00 (§2.4), so
adding 0.06 makes the denominator ~1.06 — the reputation dimension can shift a job's final
score by at most **≈5.7%**. That cap is the point: visible, but never decisive over a genuine
skills/experience match.

**Secondary, cheaper lever:** `Dashboard.jsx` already client-side fast-tracks jobs from
*followed* employers ahead of plain relevance order. The same treatment can extend to
highly-rated employers (e.g. `avgRating >= 4.5 && totalRatings >= 5`). This is independent of
`semanticService.js` and shippable while the dimension change is still in review.

## 1.9 Rollout phases

1. Schema + `completed` transition + rating CRUD — server only, verified by API calls.
2. `YourApplications.jsx` rate action + `RatingModal`.
3. Employer "Reviews" tab + public `★` display on vacancy cards.
4. Admin moderation queue + report-pipeline integration.
5. `employerReputation` dimension — **last**, once real ratings exist to validate against.
   Shipping a ranking signal with zero data in the system is untestable.

## 1.10 Decisions needed from you

- **14-day gate** — a starting guess; adjust to taste.
- **`employerResponse`** — day one, or later?
- **`isAnonymous`** — allow it? It raises honesty but removes accountability. Genuine product call.
- **Minimum sample size** before reputation affects ranking (suggested 3) — and before the
  public `★` badge appears at all.

---

# PART 2 — Configurable Job-Matching Percentage

## 2.1 Goal

Replace the hardcoded `DIMENSION_WEIGHTS` with a configurable weight set that **employers and
authorised administrators** can tune per criterion, with platform guardrails.

## 2.2 ⚠️ Criteria gap analysis — read this first

You listed eight criteria. Mapped against what the engine scores today:

| Your criterion | Today's dimension | Status |
|---|---|---|
| Skills | `skills` (0.28) | ✅ exists |
| Educational attainment | `education` (0.10) | ✅ exists |
| Work experience | `experience` (0.14) | ✅ exists |
| Industry | `industry` (0.12) | ✅ exists |
| Required qualifications | `skills` + `credentials` (both read `job.qualifications[]`) | ✅ exists, split across two dimensions |
| Certifications | `credentials` (0.07) | ✅ exists |
| **Location** | — | ❌ **does not exist — must be built** |
| **Employment type** | — | ❌ **does not exist — must be built** |

Verified by direct search: `semanticService.js` contains **zero** references to `location`,
`jobType`, `workNature`, `preferredJobTypes`, or `presentAddress`. Location and employment
type are currently ignored entirely by matching.

Three dimensions exist that you didn't list — `title` (0.17), `language` (0.05), `salary`
(0.07). They work and are useful; this plan **keeps** them rather than silently dropping
working functionality. Final configurable set = **10 dimensions**.

### The good news: the data already exists on both sides

No new profile fields or onboarding changes are required. Everything needed is already stored:

| | Vacancy (`JobVacancy`) | Jobseeker (`JobseekerProfile`) |
|---|---|---|
| Location | `location: String` (required, indexed) | `presentAddress` / `permanentAddress` `{street, barangay, municipality, province, region}`; `preferredWorkLocationLocal: [String]` (max 3) |
| Employment type | `jobType` enum `[Full-time, Part-time, Contract, Internship, Temporary, Remote]`; `workNature` enum `[remote, onsite, hybrid]` (indexed) | `preferredJobTypes` enum `[Full-time, Part-time, Contract, Temporary, Internship]`; `preferredWorkNature` enum `[Remote, Onsite, Hybrid]` |

### ⚠️ Four data mismatches that will cause silent bugs if not handled

These are the real implementation traps. Each needs explicit normalisation:

1. **Location is free text on one side, structured on the other.** `JobVacancy.location` is a
   single `String` — but it is *not* arbitrary: `LocationSelect.jsx` builds it as
   `[barangay, city, province, region].join(", ")` (e.g. `"BOAC, MARINDUQUE, REGION IV-B"`).
   A parser already exists — `parseLocationValue()` in `client/src/utils/locationParser.js` —
   **but it is client-side only**; `server/utils/` has no equivalent. It must be ported to
   `server/utils/locationParser.js`, following the existing `age.js` client/server mirroring
   precedent. Scoring must compare *parsed components*, never raw strings.
2. **`city` vs `municipality`.** `LocationSelect`'s structured output uses `city`;
   `JobseekerProfile.presentAddress` uses `municipality`. Same concept, different key.
3. **`workNature` case mismatch.** Vacancy stores **lowercase** (`remote/onsite/hybrid`);
   jobseeker stores **capitalised** (`Remote/Onsite/Hybrid`). A naive `===` silently never
   matches.
4. **"Remote" is in the wrong enum.** `JobVacancy.jobType` includes `"Remote"`, but
   `preferredJobTypes` does **not** (it has only Full-time/Part-time/Contract/Temporary/
   Internship). A `jobType: "Remote"` vacancy can therefore *never* match a jobseeker's
   job-type preference. Treat `jobType === "Remote"` as a `workNature` signal, not a job-type
   one, and compare it against `preferredWorkNature` instead.

### Proposed scoring for the two new dimensions

- **`location`** — graded, not binary, using parsed components:
  `same municipality/city` → `1.0`; `same province` → `~0.6`; `same region` → `~0.3`;
  otherwise → `~0.1`. Check the jobseeker's `preferredWorkLocationLocal` entries **first**
  (an explicit stated preference outranks where they happen to live), falling back to
  `presentAddress`. Return **`null`** when the vacancy's location can't be parsed or the
  jobseeker has neither preference nor address — consistent with every other dimension.
  **Override:** if the vacancy is `workNature: "remote"` (or `jobType: "Remote"`), return
  `null` — physical distance is irrelevant to a remote role and shouldn't penalise it.
- **`employmentType`** — `1.0` if `job.jobType ∈ preferredJobTypes`, `0` if the jobseeker
  stated preferences and this isn't among them, `null` if they stated none. Blend with a
  `workNature` vs `preferredWorkNature` comparison (both normalised to a common case) so
  on-site/remote/hybrid fit is captured in the same axis.

## 2.3 Scope: employer default + optional per-vacancy override + admin defaults

Per-vacancy-only configuration forces re-tuning on every post; employer-level-only can't
express "this one role really needs the certification." This plan does **both**, plus the
admin layer your request calls for:

```
Resolution order at scoring time:
  per-vacancy override  →  employer default profile  →  admin-set platform default  →  code fallback
```

That last link (`DEFAULT_DIMENSION_WEIGHTS`, the renamed current constant) guarantees the
system always scores even with an empty settings collection.

**"Authorised administrators may configure"** is satisfied at two levels:
- Admins edit the **platform default weight profile** — what every employer gets before
  touching anything, and the reset target.
- Admins set **per-criterion `{min, max}` bounds** constraining what employers may choose (§2.6).

## 2.4 Data model

`server/models/MatchWeightProfile.js`:

```js
{
  owner:   ObjectId(User),        // employer; null = the platform-default profile
  vacancy: ObjectId(JobVacancy),  // null = employer's default; set = per-vacancy override
  weights: {
    skills: Number, title: Number, experience: Number, education: Number,
    credentials: Number, industry: Number, language: Number, salary: Number,
    location: Number, employmentType: Number,          // ← the two new ones
  },
  updatedAt, updatedBy,
}
```

Stored as **integer percentages 0-100** (human-readable, matches the UI), converted to `0..1`
only where `computeUnifiedScore` consumes them. Compound index on `{owner, vacancy}`, unique.

**Validation:** all ten keys present, each an integer within its admin-configured bounds, and
the set **must sum to exactly 100**. A strict sum removes any ambiguity about what a 87% or
150% total would mean; enforced client-side (live running total) *and* re-checked server-side.

**Illustrative rebalanced default** (today's eight renormalised to make room for the two new
dimensions — tunable, and exactly 100):

| skills | title | experience | education | credentials | industry | language | salary | location | employmentType |
|---|---|---|---|---|---|---|---|---|---|
| 24 | 14 | 12 | 9 | 6 | 10 | 4 | 6 | 9 | 6 |

`employerReputation` (§1.8) sits **outside** this 100 as a platform-fixed ~0.06, capping its
influence at ≈5.7% of the final score.

Second collection — `MatchWeightBounds`, a single platform-wide document, same ten keys, each
holding `{min, max}`. Superadmin-editable (§2.6).

## 2.5 Server-side changes

- **`semanticService.js`** — change `computeUnifiedScore(job, applicant, industryScoreOverride = null)`
  to accept a `weights` argument defaulting to `DEFAULT_DIMENSION_WEIGHTS` (the renamed current
  constant), instead of closing over the module-level constant. The scoring maths is untouched;
  this is a pure signature change. Add the two new dimension functions (§2.2) and
  `server/utils/locationParser.js`.
- **Both controllers** (`recommendationController.hybridSearch`,
  `employerRecommendationController.getRankedApplicants`) — resolve the applicable profile per
  §2.3 before scoring and pass the weights through. Batch-load profiles for the result set;
  don't query per job inside the ranking loop.
- **New endpoints:**

  | Endpoint | Who |
  |---|---|
  | `GET/PUT /api/employers/match-weights` | employer — own default profile |
  | `GET/PUT /api/jobs/:id/match-weights` | employer — per-vacancy override (own jobs only) |
  | `GET/PUT /api/admin/match-weight-defaults` | admin — platform default profile |
  | `GET/PUT /api/admin/match-weight-bounds` | superadmin — per-criterion bounds |

- Server re-validates everything the client validated (sum, bounds, key completeness, integer
  type, unknown-key rejection). Never trust the client's arithmetic.
- **Audit-log every weight change** via `logAuditEvent`, mirroring NSRP template uploads — so a
  suspicious weight configuration is traceable after the fact.

## 2.6 Guardrails

- **Admin bounds are the primary defence.** They stop an employer zeroing out a criterion that
  should always matter, or maxing one that acts as an exclusionary proxy. Now that `location`
  is becoming a real dimension this is no longer hypothetical: a 100%-location weighting would
  rank almost purely on where someone lives, which can correlate with characteristics that have
  nothing to do with the job. A sane cap on `location` matters more than on most others.
- **Age eligibility stays a hard gate**, outside the weighted system and non-configurable,
  exactly as today. It is legally sensitive and must not become a tunable slider.
- **Weights never filter — they only order.** A low score ranks a job lower; it must not remove
  it from results. Keep that invariant explicit in code review.
- **No migration risk.** Scores are computed at query time and never persisted, so weight edits
  apply immediately and retroactively with no backfill.

## 2.7 Client UI

- **Employer "Matching Preferences"** (new tab in `EmployerDashboard.jsx`) — ten sliders
  (Skills, Job Title, Experience, Education, Certifications, Industry, Language, Salary Fit,
  **Location**, **Employment Type**), each with a live percentage readout; a running
  `Total: 100% ✓` indicator that blocks Save until exactly 100; slider ranges clamped to the
  admin bounds with a tooltip explaining the limit; and "Reset to platform default".
- **Per-vacancy override** on the Post/Edit Job form — a "Use custom matching weights for this
  job" toggle revealing the same component, pre-filled from the employer's default.
- **Admin panels** (`SuperadminConsole.jsx`, beside the NSRP template settings, reusing that
  card pattern) — one for the platform default profile, one for the ten `{min, max}` bound pairs.
- **Phase 2 (optional)** — extend the existing `matchBreakdown` display on job cards so a
  jobseeker can see *why* a percentage landed where it did, including a note when an employer
  has custom-weighted a listing. Transparency nicety; not a blocker.

## 2.8 Rollout phases

1. **Pure refactor** — rename `DIMENSION_WEIGHTS` → `DEFAULT_DIMENSION_WEIGHTS`; make
   `computeUnifiedScore` take a `weights` param defaulting to it. Zero behaviour change,
   independently shippable, and a prerequisite for everything else.
2. **Port the location parser** to `server/utils/locationParser.js` + add the `location` and
   `employmentType` dimension functions, still on fixed defaults. Ship with the rebalanced
   default table (§2.4) — this alone measurably improves matching, before any config UI exists.
3. **Schemas + CRUD + resolution order**, server-only dark launch — verify a hand-inserted
   profile actually changes `relevanceScore` before building any UI.
4. Employer default-profile UI.
5. Per-vacancy override UI.
6. Admin platform-default + bounds UI and enforcement.
7. *(Optional)* jobseeker-facing transparency UI.

> Phases 1 and 2 are worth doing **regardless** of whether the configurability work proceeds —
> location and employment type being invisible to matching is a correctness gap today.

## 2.9 Decisions needed from you

- **Strict sum-to-100, or free-form totals normalised server-side?** This plan recommends
  strict (no hidden renormalisation surprising anyone), but it is a real trade-off.
- **Default bounds** — is e.g. 10–60% sensible across the board, or should `location` and
  `salary` carry tighter caps for the reasons in §2.6?
- **Should employers be nudged to configure weights at all**, or silently inherit the platform
  default forever (recommended — simplest, and the default is a good one)?
- **Per-vacancy overrides day one, or defer to a later phase?** Phases 4 and 5 are separable.

---

# PART 3 — Cross-cutting notes

- **Suggested build order across both parts:**
  `§2.8 phase 1 (refactor)` → `§2.8 phase 2 (location + employment type)` →
  `Part 1 phases 1-4 (ratings)` → `§2.8 phases 3-6 (configurability)` →
  `§1.9 phase 5 (reputation dimension)`.
  Rationale: the refactor is a safe prerequisite both features depend on; the reputation
  dimension needs real rating data before it can be validated; and the location/employment-type
  fix delivers value without waiting on any configuration UI.
- Both features add audit-logged, admin-moderated surfaces (rating moderation; weight and
  bounds changes), consistent with the `logAuditEvent` precedent already set by the NSRP
  template flow — neither needs to invent a new convention.
- Both touch `semanticService.js` on independent axes and do not conflict: Part 1 adds one
  platform-fixed dimension; Part 2 makes the other ten employer-tunable.
