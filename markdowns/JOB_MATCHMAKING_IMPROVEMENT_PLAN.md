# Job Matchmaking Improvement Plan

**Scope:** two surfaces, one engine.

1. **Applicant side** — how well the job board recommends jobs to a jobseeker.
2. **Employer side** — how well the ranked-applicants list orders candidates for a vacancy.

Status: **planning only — no code written yet.**

Companion doc: [`EMPLOYER_RATINGS_AND_MATCH_CONFIG_PLAN.md`](EMPLOYER_RATINGS_AND_MATCH_CONFIG_PLAN.md).
That one covers *configurable weights* and the *employer-reputation signal*. This one covers
**accuracy, consistency, and usefulness** of the match itself. They are complementary and
deliberately do not overlap — where they touch, this doc cross-references instead of repeating.

Every file path, line number, field name and enum below was verified against the working tree.

---

## The one rule that orders this entire document

> **Do not tune weights, add dimensions, or rebalance anything until Part 0 is done.**

The reason is narrow and concrete. The `credentials` dimension currently reads **near-zero for
every applicant on the job board**, because their licences are never fetched (§0.1). If weights
are rebalanced before that is fixed, the natural correction is to move weight *away* from
credentials — which is exactly backwards, and that miscalibration then becomes the
admin-configurable platform default that every employer inherits.

The same applies to measuring improvement: you cannot tell whether a scoring change helped while
three call sites feed the engine **different inputs for the same applicant** (§0.3). Part 0 is
not cleanup to do "while we're in there" — it is the measurement baseline everything else is
judged against.

---

# Priority checklist

Tiers are ordered by dependency, and within a tier by value. Tier 0 blocks Tier 2 onward;
Tier 1 does not depend on Tier 0 and can run in parallel if two people are working.

### ⛔ Tier 0 — Blocking prerequisites (§0)

Nothing in Tier 2+ is valid until these land. No new features; pure accuracy recovery.

- [ ] **§0.3** Extract `server/services/matchProfileService.js` — one authoritative seeker-builder
      *(do this first; it is how 0.1 and 0.2 get fixed, not a separate task)*
- [ ] **§0.1** 🔴 Job board fetches `professionalLicenses`, `eligibilities`, `vocationalTrainings`,
      `course`, `yearGraduated` — fixes credentials scoring ~0 and false "Missing: NC II" on cards
- [ ] **§0.2** 🔴 Job detail fetches `languageProficiency` — fixes every language requirement
      rendering as unmet
- [ ] **§0.4** One shared tier function + stop swapping score scales inside one badge
- [ ] **§0.5** Remove PII from job-board logs (`req.user` dumps, skills, industry preferences)
- [ ] Regression check: same applicant + same job → **identical** credential and education
      results on card, detail page, and employer table

### 🟢 Tier 1 — Quick wins, no engine change (§B.1, §B.5)

Existing functions, existing data. Shippable without touching scoring. **This is the tier with
something to demo.**

- [ ] **§B.1** 🔴 Call `computeChecklistMatch()` on the employer path — employers currently get
      **no must-have information at all**
- [ ] **§B.1** "Meets must-haves: 4/5" column + missing items in the review modal
- [ ] **§B.1** "Only applicants meeting all must-haves" toggle + sort by must-haves met
- [ ] **§B.5** Move employer sorting server-side *(client currently re-sorts one page only)*
- [ ] **§B.5** Split `total` vs `filteredTotal` in the ranked-applicants response

### 🔵 Tier 2 — Engine overhaul (§A.1, §A.2, §B.2, §C.1)

Requires Tier 0. The actual matching improvement.

- [ ] **§C.1** Weights refactor — `DIMENSION_WEIGHTS` → `DEFAULT_DIMENSION_WEIGHTS`,
      `computeUnifiedScore(…, weights)` *(zero behaviour change; prerequisite for the rest of
      this tier)*
- [ ] **§A.1** Port `locationParser` to `server/utils/` + add the **`location`** dimension
- [ ] **§A.1** Add the **`employmentType`** dimension *(watch the four normalisation traps)*
- [ ] **§A.2** Rebalance: `title` 0.17 → ~0.10-0.12, difference to `skills`
- [ ] **§B.2** Employer-path industry scored from **background**, not stated preference
- [ ] **§C.3** Add explicit `null`-case tests for every new dimension

### 🟣 Tier 3 — Transparency & actionability (§A.3, §A.4, §B.3, §B.4)

Needs Tier 2 settled, or it explains the wrong thing.

- [ ] **§A.3 / §B.4** Shared per-dimension breakdown panel, both surfaces
- [ ] **§A.3** Render unscored dimensions as *"Not enough info"* — **never as 0%**
- [ ] **§B.3** Sort disqualified rows last + show the count
- [ ] **§B.3** Promote `ageUnknown` out of the hover tooltip
- [ ] **§A.4** "Close matches — 1 requirement away" grouping
- [ ] **§A.4** Aggregate skill-gap insight *(also a PESO training-demand signal)*

### ⚪ Tier 4 — Configurability, signals, scale (§A.5, §C.1, §C.2)

- [ ] **§C.1** `MatchWeightProfile` / `MatchWeightBounds` + resolution order
      *(companion plan §2.8 phases 3-6)*
- [ ] **§C.1** Ten-key default set, with the revision document's five as a named preset
- [ ] **§A.5** Remaining-slots / application-pressure signal *(blocked on revision doc #7)*
- [ ] **§A.5** Freshness decay inside `sortBy: 'match'`
- [ ] **§C.2** Memoise stemming + precompute applicant token sets *(pull forward if the board
      gets slow)*

---

## 0. Verified baseline

One engine, `server/services/semanticService.js`, produces **two different numbers** for the
same (job, applicant) pair:

| | What it answers | Where computed | Who sees it |
|---|---|---|---|
| **`relevanceScore`** (0..1) | "How good a fit overall?" — 8 weighted fuzzy dimensions | `computeUnifiedScore()` — `semanticService.js:718` | Employers (ranked table); applicants (ordering, and the badge when no checklist exists) |
| **`checklistMatch.percent`** (0-100) | "Of the stated requirements, how many do you literally meet?" — points-based | `computeChecklistMatch()` — `semanticService.js:591` | Applicants only (job cards, job detail) |

Weights are a hardcoded module constant (`semanticService.js:702-711`), summing to exactly 1.00:

```js
skills 0.28 · title 0.17 · experience 0.14 · education 0.10
credentials 0.07 · industry 0.12 · language 0.05 · salary 0.07
```

Every dimension returns `0..1` **or `null`** ("no data on either side" → skipped, weight
renormalised). Age is a **hard gate**, not a weight (`ageEligibility()`, `semanticService.js:452`).
Nothing is persisted — scores are computed at query time, so any change here applies immediately
and retroactively with **no migration or backfill, ever**.

Three entry points:

- `recommendationController.hybridSearch` — applicant job board → `rankJobsBySkills()`
- `employerRecommendationController.getRankedApplicants` — employer table → `rankApplicantsByJob()`
- `jobController.getJobById:315` — single job detail → `computeChecklistMatch()` only

---

# PART 0 — ⛔ Prerequisites: fix before any matching overhaul

**Blocking.** No new features, no UI changes, no new concepts. This part recovers accuracy the
system is already supposed to have, and establishes the baseline that Parts A-C are measured
against. See *"The one rule"* above for why this cannot be deferred.

## 0.1 🔴 The job board can't see an applicant's licences or certifications

`recommendationController.js:98` selects:

```
skills preferredIndustries expectedSalaryMin expectedSalaryMax
preferredOccupations workHistory languageProficiency
```

Missing: **`professionalLicenses`, `eligibilities`, `vocationalTrainings`, `course`,
`yearGraduated`**. The seeker object built at `semanticService.js:981-998` therefore has none of
them, and `rankJobsBySkills()` accepts no parameters to carry them.

Consequences, both user-visible:

- **`credentialScore()`** (`semanticService.js:382`) reads `getApplicantCredentials()`, which pulls
  from `professionalLicenses` / `eligibilities` / `vocationalTrainings` / `skills`. On the job
  board only `skills` survives — so a nurse with a PRC licence and a welder with NC II score
  **near zero on `credentials` for every job on the board**.
- **The checklist marks certification/licence qualifications as unmet**, so the card prints
  *"Missing: NC II Welding"* to someone who holds NC II Welding.

Worse, it is **inconsistent**: the employer path (`employerRecommendationController.js:48-54`) *does*
fetch all of these, and so does `jobController.getJobById:312`. The same applicant therefore gets
a *different* education rank and a *different* credential score depending on which page is asking.
The job detail page says a requirement is met; the card for the same job says it is missing.

**Fix:** add the five fields to the `recommendationController` select, add matching options to
`rankJobsBySkills()`, and pass them into the seeker object — via §0.3's helper, not as a direct
patch. Mechanical, ~20 lines, no behaviour change beyond correctness.

**Why it blocks:** this is the miscalibration trap. Rebalancing weights while `credentials` reads
zero for everyone bakes a compensation for a bug into the platform default.

## 0.2 🔴 The job detail page can't see language proficiency

The mirror-image bug. `jobController.js:312` selects
`skills workHistory professionalLicenses eligibilities vocationalTrainings educationalAttainment
course yearGraduated` — but **not `languageProficiency`**. `computeChecklistMatch()` builds its
language rows from `profile.languageProficiency` (`semanticService.js:680-683`), so every language
requirement renders as **unmet** on the job detail page, while the same job's card (which *does*
fetch it) renders it correctly.

**Fix:** add `languageProficiency` to that select. One word.

## 0.3 Root cause: three call sites each hand-assemble the seeker

**Start here — 0.1 and 0.2 are symptoms of this, and should be fixed through it.**

The two bugs above are the same bug twice. Each caller independently decides which profile fields
to select and how to shape the object, and each one forgets a different subset. There is nothing
enforcing that the engine's inputs are complete.

**Fix:** extract one helper — `server/services/matchProfileService.js` — exposing:

```js
SEEKER_PROFILE_FIELDS   // the single authoritative .select() string
SEEKER_USER_FIELDS
buildSeekerForMatching(user, profile)   // → { user, profile } in engine shape
```

All three call sites use it. Adding a dimension that needs a new profile field then means editing
**one** constant, not finding three selects — which matters immediately, because §A.1 adds two
dimensions needing `presentAddress`, `preferredWorkLocationLocal`, `preferredJobTypes` and
`preferredWorkNature`. Without this helper, §A.1 reintroduces the same class of bug on day one.

**Why it blocks:** it is the structural reason the overhaul would otherwise ship broken.

## 0.4 Two scores, two tier vocabularies, one badge

`VacancyCard.jsx:70` shows `checklist.percent` when a checklist exists and silently falls back to
`Math.round(relevanceScore * 100)` when it doesn't — **two different scales in one badge**, with no
indication which is being shown. The tier labels disagree too:

| | Thresholds |
|---|---|
| `checklistTier()` — `semanticService.js:579` | Strong ≥85 · Good ≥60 · Partial ≥35 · Low |
| `matchTier()` — `RankedApplicantsTable.jsx:20` | High ≥60 · Medium ≥30 · Low |
| `matchTier()` — `VacancyCard.jsx` fallback path | (third set, for the fallback case) |

So "60%" means *Good* to an applicant and *High* to an employer.

**Fix:** keep both scores — they answer genuinely different questions and both are worth
showing — but:

- Export one shared tier function from `client/src/utils/qualifications.js` and use it on every
  surface.
- Never silently swap scales in one badge. When no checklist exists, label the badge
  **"Estimated fit"** rather than printing a bare percentage that looks like the other metric.
- Settle the vocabulary: **Strong / Good / Partial / Low** everywhere (the checklist's wording —
  it is the one shown to applicants most often).

**Why it blocks:** Tier 3 builds a breakdown panel on both surfaces. Doing it before the
vocabulary is shared means building it twice.

## 0.5 PII in server logs

`recommendationController.js:51-53` logs the **entire `req.user` object**, and lines 105-107 /
132-134 log the applicant's skills and industry preferences on every job-board request. This is a
public-employment-service system handling NSRP data; `markdowns/SECURITY_BASELINE_AUDIT.md` already
flags logging hygiene.

**Fix:** drop to `logger.debug` with ids only, no object dumps.

**Why it's here:** not a matching bug, but it sits in the exact controller Part 0 already edits.
Doing it separately means touching the file twice.

## 0.6 Exit criteria

Part 0 is done when, for the **same applicant and the same job**:

- The card, the job detail page, and the employer table agree on whether each certification,
  licence, education and language requirement is met.
- An applicant holding a PRC licence or TESDA NC scores **non-zero** on `credentials` from the
  job board.
- No surface prints a bare percentage whose scale is ambiguous.
- Job-board logs contain no profile content.

Until all four hold, treat any measured "improvement" from Parts A-C as unverified.

---

# PART A — Applicant-side matchmaking

Goal: a jobseeker opening the board sees jobs they can **actually get**, understands **why** each
one is ranked where it is, and knows **what to do** about the ones they nearly match.

## A.1 Add the two missing dimensions: location and employment type

A jobseeker in Boac currently sees a Quezon City vacancy ranked identically to the one down the
road — `semanticService.js` contains **zero** references to `location`, `jobType`, `workNature`,
`preferredJobTypes`, or `presentAddress`. For a *municipal* employment service, distance is
arguably the single most practical filter there is, and its absence is the biggest accuracy gap
on this surface.

The data already exists on both sides; the design, the four normalisation traps
(free-text vs structured location, `city` vs `municipality`, `workNature` case mismatch,
`"Remote"` sitting in the wrong enum), and the graded scoring curve are all specified in
**`EMPLOYER_RATINGS_AND_MATCH_CONFIG_PLAN.md` §2.2**. That specification is sound and is adopted
here unchanged — including porting `client/src/utils/locationParser.js` to
`server/utils/locationParser.js`, following the existing `age.js` client/server mirroring
precedent.

**What this doc adds:** these two dimensions are worth shipping **on fixed default weights,
before any configuration UI exists** (that plan's §2.8 phase 2 reaches the same conclusion). They
improve matching on their own; the config layer is orthogonal.

**Depends on §0.3** — both dimensions need profile fields no current call site selects.

## A.2 Rebalance `title` down, and fix what `industry` means for applicants

Two weight-level problems, visible in the current constant:

**`title` at 0.17 is the second-highest weight** and rests on thin inputs — `desiredJobTitle` (one
free-text field), up to 4 `preferredOccupations`, and the 3 most recent `workHistory` positions
(`getApplicantTitles()`, `semanticService.js:174`). `titleScore()` then does stemmed-token overlap
against the vacancy title, so "Sales Associate" vs "Sales Representative" scores well while
"Store Crew" vs "Sales Associate" scores zero despite being nearly the same job. Title similarity
is a **weak proxy for skills**, weighted almost as heavily as skills themselves.

**`industry` at 0.12 measures different things on the two surfaces.** On the job board,
`hybridSearch` passes an `industryScoreOverride` derived from the seeker's stated preferences
(`recommendationController.js:227-244` → `semanticService.js:1004-1012`) — a reasonable
*preference* signal. On the employer side, `industryAffinityScore()` (`semanticService.js:437`)
scores the same thing — **the applicant's stated industry preference** — which tells an employer
almost nothing about whether the candidate can do the job. See §B.2.

**Proposal:** fold title into skills conceptually rather than deleting it — reduce `title` to
~0.10-0.12 and move the difference to `skills`, once location/employment type are in and the
weights are being rebalanced anyway (the rebalanced default table in the companion plan's §2.4 is
the right place to land this).

## A.3 Make the applicant's match explainable, not just a number

Today a job card shows a percentage, *"You meet N of M must-haves"*, and a flat
`Missing: a, b, c` list (`VacancyCard.jsx:152-162`). The job detail page shows the fuller item
list. The `matchBreakdown` object — the per-dimension scores — is **sent to the client and never
rendered for applicants**; only the employer table surfaces it, and only as a `title=` tooltip
(`RankedApplicantsTable.jsx:38-47`).

**Proposal — a "Why this match?" disclosure on the job detail page:**

- Per-dimension bars from the already-present `matchBreakdown`, using the §0.4 shared labels.
- Dimensions that returned `null` shown as **"Not enough info on your profile"** with a deep link
  to the exact profile section that would fill the gap — not as 0%. This distinction (unscored vs
  scored-zero) is the single most useful thing the breakdown carries and it is currently invisible.
- `coverage` (already returned, `semanticService.js:766`) rendered as a plain-language confidence
  note: *"Based on 6 of 10 criteria — complete your profile for a more accurate match."*

This directly serves the revision document's **#12 (automated calculations)** — profile
completion percentage becomes meaningful when it is tied to match accuracy rather than being a
decorative number.

## A.4 Turn "Missing: …" into something actionable

The strongest applicant-facing feature available from data already computed. `missingRequired`
already lists exactly which must-haves are unmet. Three uses:

1. **Skill-gap grouping on the board** — a *"Close matches — 1 requirement away"* section for jobs
   where `totalMustHaves - metMustHaves === 1`. These are the highest-value jobs to show a
   jobseeker and are currently buried by relevance ordering.
2. **Aggregate gap insight on the dashboard** — the most frequent `missingRequired` value across
   the jobs a seeker nearly matches: *"NC II Welding appears in 7 jobs you nearly qualify for."*
   For a PESO, that aggregate is also a **training-demand signal worth surfacing to admins**.
3. **Honest filter labelling** — `onlyMeetsRequired` already exists
   (`semanticService.js:1022-1028`). Pair it with the count of what it hides, so a filter that
   empties the board explains itself.

> Note: this feature is **only correct after §0.1**. Today it would confidently tell a licensed
> welder that NC II Welding is their skill gap.

## A.5 Signals the board ignores today

- **Remaining slots.** Revision document **#7** asks for remaining-vacancy-slot display. Once that
  count exists, a job with 1 slot and 200 applicants is a materially worse recommendation than an
  identical job with 20 slots and 3 applicants. `applicationCount` is already computed per job
  (`recommendationController.js:182`); `slots` is already on the model. A small
  **application-pressure** adjustment is cheap and genuinely useful. Keep it *small* — it must
  nudge ordering, never hide a listing.
- **Freshness.** `sortBy: 'newest'` exists as a separate mode, but under `sortBy: 'match'` a
  six-month-old vacancy ranks identically to one posted today. A mild recency decay inside match
  ordering is standard and uncontroversial.
- **Deliberately excluded: behavioural signals.** Click/view/save-based personalisation is a much
  larger system (event collection, storage, retention policy) and carries real privacy weight for
  a government service. Out of scope — noted so the omission reads as a decision, not an oversight.

---

# PART B — Employer-side applicant ranking

Goal: the employer opens the ranked list and the top rows are the people worth interviewing, with
visible reasoning and no hidden disqualifications.

## B.1 🔴 Employers get no must-have checklist at all

`computeChecklistMatch()` is **never called on the employer path** —
`employerRecommendationController.js:95` calls only `rankApplicantsByJob()`. The employer sees a
single fuzzy percentage and nothing else.

The practical failure: an applicant **missing every required qualification** can outrank one
meeting all of them, because `relevanceScore` averages over 8 dimensions and `skills` is only
0.28. A candidate with a matching job title, matching industry preference and compatible salary
expectations but **none of the required skills** can land above a fully-qualified candidate whose
desired title happens to be worded differently. The employer has no way to see this — the number
that would reveal it is not computed for them.

**This is the single highest-value employer-side change in the document, and it needs no new
engine code** — just calling the existing function on the existing data:

- Call `computeChecklistMatch(job, applicant)` in `getRankedApplicants` and return it per row.
- Add a **"Meets must-haves: 4/5"** column beside the gauge, and list the missing items in the
  applicant review modal.
- Add a **"Only applicants meeting all must-haves"** toggle — the mirror of the applicant side's
  `onlyMeetsRequired`.
- Add **sort by must-haves met**, alongside the existing match/date/name sorts
  (`EmployerDashboard.jsx:1088-1094`).

**Not blocked by Part 0** — the employer path already fetches the full profile
(`employerRecommendationController.js:48-54`), which is exactly why its results are the *correct*
ones to reconcile the other two surfaces against in §0.6.

## B.2 `industry` is the wrong signal when ranking applicants

As noted in §A.2: on the employer path, the `industry` dimension (weight **0.12**, third-highest)
scores *the applicant's stated industry preference* via `industryAffinityScore()`
(`semanticService.js:437-445`) — returning `1` if the vacancy's industry is in their
`preferredIndustries`, `0.25` otherwise.

For an applicant *choosing* a job, preference is exactly right. For an employer *choosing* an
applicant, it is close to noise — it rewards someone for having ticked a box, not for having
relevant background. And `0.25` for "didn't tick it" quietly penalises anyone who left
`preferredIndustries` empty, which is common on fresh NSRP profiles.

**Proposal:** on the employer path, score industry from the applicant's **actual background** —
`workHistory[].companyName`/`position` and `vocationalTrainings[].course` against the vacancy's
industry — and treat the stated preference as a small secondary bonus rather than the whole
dimension. Return `null` (skip, don't penalise) when there is no background signal either way,
consistent with every other dimension.

## B.3 Make `disqualified` legible, and widen it carefully

Age is a hard gate (`semanticService.js:749-756`) and the table renders an **"Age"** badge for it
(`RankedApplicantsTable.jsx:191-194`, `336-339`). Two improvements:

- **Sort disqualified rows last** rather than interleaving them at `score: 0`, and give the
  employer a count — *"3 applicants outside the age range"* — so a hard gate is never a silent
  deletion from consideration.
- **`ageUnknown` is computed and discarded.** `semanticService.js:757` sets
  `breakdown.ageUnknown = true` when the job constrains age but the applicant has no date of birth
  on file. The employer table's tooltip prints *"Age: not on file"*
  (`RankedApplicantsTable.jsx:45`) — but only inside a hover tooltip. Promote it: *"Age not on
  file — not verified against this job's range"* is materially different from "passes".
- **Resist adding new hard gates.** Education and experience shortfalls are *graded* today
  (`educationScore()` returns a partial ratio; `experienceScore()` likewise) and that is correct —
  `educationOrEquivalentExperience` exists precisely so a capable candidate without the paper
  qualification still surfaces. A "hide everyone below the education bar" toggle would quietly
  undo that. If employers ask for it, make it a **visible filter with a count**, never a
  score-level gate.

## B.4 Replace the tooltip breakdown with a real panel

`matchBreakdown` currently reaches the employer as a `title=` attribute — one pipe-delimited
string, invisible on touch devices, unreadable at a glance
(`RankedApplicantsTable.jsx:38-47`, used at `:199` and `:344`).

**Proposal:** in the applicant review modal, render the same per-dimension bars built for §A.3,
plus the §B.1 must-have list. Same component, both surfaces. Keep the tooltip as the compact
hover affordance on desktop, but it must no longer be the *only* way to see the reasoning.

## B.5 Pagination and sort are inconsistent

- `getRankedApplicants` returns `total: applications.length`
  (`employerRecommendationController.js:122`) — the count *before* ranking slices to
  `limit`/`skip`. Correct for "how many applied", but it will disagree with the filtered count
  once §B.1's must-have filter lands. Decide now: `total` = total applicants, and add a separate
  `filteredTotal`.
- `EmployerDashboard.jsx:1088-1094` **re-sorts client-side** by `relevanceScore` — but the server
  already sorted and sliced (`semanticService.js:940-941`). The client sort therefore only reorders
  *the current page*, which is a no-op for match (already sorted) and misleading for date/name
  (page-local, not global). Move sorting server-side and pass `sortBy` through, matching how
  `hybridSearch` already handles it (`recommendationController.js:25`).

---

# PART C — Shared engine work

## C.1 Configurable weights

Fully specified in **`EMPLOYER_RATINGS_AND_MATCH_CONFIG_PLAN.md` Part 2** — the
`MatchWeightProfile` / `MatchWeightBounds` schemas, the
`per-vacancy → employer default → admin default → code fallback` resolution order, sum-to-100
validation, and admin bounds. Adopted here unchanged; not repeated.

This satisfies revision document **#13** ("the job-matching percentage should not be permanently
hardcoded") and **#14** ("authorised users configure criteria and weights").

**Dependency note:** that plan's §2.8 phase 1 — rename `DIMENSION_WEIGHTS` →
`DEFAULT_DIMENSION_WEIGHTS` and make `computeUnifiedScore()` take a `weights` parameter — is a
**zero-behaviour-change refactor** and a prerequisite for the rebalancing in §A.2 and the new
dimensions in §A.1. It is the first item of Tier 2 for that reason.

**One addition this doc makes:** the revision document's sample weights (Skills 35 · Education 20 ·
Work Experience 20 · Location 15 · Certifications 10) cover **five** criteria. The engine scores
**eight** today and **ten** after §A.1. The admin-facing default must be the complete ten-key set —
a five-key profile would leave title, language, salary, industry and employment type silently
unweighted. Present the document's five as a **named preset** ("PESO recommended") layered on top
of the full set, not as the schema.

## C.2 Performance: the board scores every job on every request

`hybridSearch` loads **all** active vacancies with `.lean()` and no DB-level pagination
(`recommendationController.js:169-173`), then scores every one of them and slices afterwards
(`semanticService.js:1050`). Fine at current scale; linear in total vacancies forever.

The dimension functions are cheap, but each one runs `normalizeText` + `PorterStemmer.stem` over
the same strings repeatedly — `bestPhraseSimilarity()` re-stems both sides on every comparison
(`semanticService.js:110-135`), inside a nested loop over (qualifications × applicant skills) ×
jobs.

Staged response, cheapest first:

1. **Memoise stemming** — a module-level `Map` from raw string → stems. The corpus of skill and
   qualification strings is small and highly repetitive; this is a few lines for a large constant-
   factor win.
2. **Precompute per-applicant token sets once** per request instead of per (job × qualification).
3. **Pre-filter before scoring** — when `industryPreferenceLevel === 'strict'`, the filter already
   runs *after* fetching everything (`recommendationController.js:204-207`); push it into the Mongo
   query.
4. **Cache the ranked list** per (seeker-profile-hash, filter-hash) — the `tfidfCache` at
   `semanticService.js:874-906` is a good precedent, including its text-hash key design (changes to
   a profile or job naturally invalidate, with no `updatedAt` bookkeeping).

Only #1 and #2 are worth doing now; #3 and #4 are listed so the ceiling is known.

## C.3 Guardrails — carry these into code review

- **Scores order; they never hide.** A low score ranks lower. Filtering is always an explicit,
  labelled, counted user action — never a side effect of a weight.
- **Age stays the only hard gate**, non-configurable (§B.3).
- **`null` must never be coerced to `0`.** The whole engine depends on "no data" being skipped
  rather than scored zero; a dimension that returns `0` for a blank profile field silently punishes
  incomplete NSRP profiles. Every new dimension needs an explicit null case, and a test for it.
- **Location weight needs a cap.** Once location is a real dimension, a high weighting ranks
  substantially on where someone lives, which correlates with characteristics unrelated to the job.
  The companion plan's admin bounds (§2.6) are the mechanism; this is the reason.
- **Fairness-sensitive profile fields stay out of scoring.** `JobseekerProfile` carries
  `disability`, `civilStatus`, `religion`, `height`, `weight`, `is4psBeneficiary`, `isOfw`. None is
  referenced by `semanticService.js` today and **none should become a dimension**. Worth stating
  explicitly in the module header so it is a documented invariant rather than an accident.

---

# Decisions needed

1. **Does the applicant keep seeing two numbers** (literal checklist % on cards, fuzzy relevance
   for ordering), or does one become *the* match percentage? §0.4 recommends keeping both with
   clearer labelling — they answer different questions — but a single number is simpler to explain
   at defence.
2. **§B.2** — is scoring an applicant's industry from `workHistory` text acceptable, given company
   names are free text and the inference will be imperfect? The alternative is dropping `industry`
   to a near-zero weight on the employer path.
3. **§A.5 application pressure** — should a heavily-applied-to vacancy rank lower for new seekers?
   It is better matching but it is also the system quietly steering applicants, which is a policy
   call for a PESO, not an engineering one.
4. **Hard gates** — confirm age stays the only one (§B.3). Employers will ask for education and
   experience gates.
5. **The five-criterion preset vs the ten-dimension set** (§C.1) — confirm the document's sample
   weights are presented as a preset rather than replacing the full weight schema.

---

## Note on sequencing vs. demos

Tier 0 produces **no visible new feature** — it is accuracy recovery, and from the outside it
looks like zero progress. Tier 1 (§B.1) is the first tier with something to show, needs no engine
change, and does not depend on Tier 0. If a defence or demo is near, run Tier 1 in parallel rather
than reordering Tier 0 behind it.
