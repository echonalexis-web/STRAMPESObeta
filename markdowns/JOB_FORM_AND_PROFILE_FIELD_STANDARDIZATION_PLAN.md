# Job Offer Type, Applicant Classification & Multi-Industry Plan

**Scope:** three related field-standardization requests from the review, covering the employer
job-posting form and the applicant profile form:

1. Dropdown for job offer type / employment arrangement.
2. Dropdown/checkbox classification fields on the applicant profile (gender, PWD, employment
   status, educational attainment, civil status, preferred work arrangement) with "Prefer not to
   say" where sensitive.
3. Multi-select industries on the employer job-posting form.

Status: **planning only — no code written yet.**

Related doc: [`JOB_MATCHMAKING_IMPROVEMENT_PLAN.md`](JOB_MATCHMAKING_IMPROVEMENT_PLAN.md) — that
plan's **Tier 0** is a blocking prerequisite for part of §3 here (industry scoring lives in the
same `semanticService.js` dimension code that plan is stabilizing first). See
[Sequencing](#sequencing-against-the-in-flight-matchmaking-work) below.

Every file path, field name, and enum below was verified against the working tree on 2026-10-21.

---

## 1. Job offer type dropdown

### Current state

- `client/src/components/JobPostingForm.jsx` (~line 70) already renders a chip-button picker, not
  free text, backed by:
  ```js
  JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Temporary", "Remote"]
  ```
  (displayed as "Contractual" via a label override for `Contract`).
- `server/models/JobVacancy.js`: `jobType` is a `String` enum with the **same six values**,
  default `"Full-time"`.
- `client/src/components/JobSearchFilters.jsx` **duplicates** this array independently for the
  job-board filter UI — it is not imported from one shared source.
- Missing from the requested list: **Seasonal, Work-from-home, On-the-job training**.
  "Work-from-home" partially overlaps an existing *different* field, `workNature`
  (`onsite | remote | hybrid`), which already captures "remote" as a work arrangement separate
  from employment type. This overlap needs a product decision, not just a schema add.

### Proposed change

- Expand the canonical employment-type enum to:
  `Full-time, Part-time, Contractual, Temporary, Internship, Seasonal, Work-from-home,
  On-the-job training`.
- Resolve the Work-from-home / `workNature` overlap **before** adding it as a `jobType` value —
  recommended: keep `workNature` as the "where" (onsite/remote/hybrid) and drop "Work-from-home"
  from the `jobType` list, since otherwise a job can contradict itself (`jobType:
  "Work-from-home"`, `workNature: "onsite"`). If the business genuinely wants both, add it but
  treat `workNature` as authoritative for matching and `jobType`'s copy as display-only.
- Centralize the enum in one shared constants module (e.g. `client/src/constants/jobTypes.js`)
  imported by both `JobPostingForm.jsx` and `JobSearchFilters.jsx`, instead of two copies drifting
  independently (already happened once — adding six new values in two places is how that drift
  compounds).

### Implementation steps

1. Add the shared constant on the client; update `JobPostingForm.jsx` and
   `JobSearchFilters.jsx` to import it instead of declaring their own arrays.
2. Update `server/models/JobVacancy.js` `jobType` enum to match.
3. Data migration: existing vacancies keep valid old values (`Contract`, `Remote`, etc. are a
   subset) — no backfill needed unless "Remote" is being retired in favor of `workNature`, in
   which case write a one-off script to move `jobType: "Remote"` vacancies to
   `workNature: "remote"` + a non-Remote `jobType`.
4. Update any other literal `jobType` enum copies (check `server/controllers/jobController.js`
   validation and `client/src/pages/EmployerDashboard.jsx` display logic for hardcoded lists).

### Matching & recommendation impact

- `server/services/semanticService.js` has an `employmentTypeScore` dimension that compares
  `job.jobType` against the applicant's `preferredJobTypes` / `preferredWorkNature` arrays. New
  enum values are inert in scoring until applicants can actually express a preference for them —
  which is exactly the gap found in §2 below (`preferredJobTypes` has no UI). **These two features
  must ship together**: adding "Seasonal" as a postable job type with no way for an applicant to
  prefer it just makes those jobs score low for everyone on that dimension by default.
- No weight rebalancing is implied — this only widens the domain of an existing dimension, it
  doesn't add a new one.

---

## 2. Applicant profile classification fields

### Current state (already better than the review assumed)

Most of the fields named in the request are **already** dropdowns/pills, not free text:

| Field | Location | Current control | Gap |
|---|---|---|---|
| `gender` | `User.js` enum `[Male, Female, Prefer not to say]`; `EditProfile.jsx` `<select>` | dropdown ✅ | none |
| `educationalAttainment` | `User.js` enum (8 levels); `EditProfile.jsx` `<select>` | dropdown ✅ | no "prefer not to say" |
| `disability` (PWD) | `JobseekerProfile.js` `[String]` enum `[Visual, Hearing, Speech, Physical, Others]`; `EditProfile.jsx` checkboxes | checkboxes ✅ | no explicit "None" vs "Prefer not to say" distinction — an empty array is ambiguous between "not disabled" and "declined to answer" |
| `civilStatus` | `JobseekerProfile.js` enum (6 values); `EditProfile.jsx` `<select>` | dropdown ✅ | no "prefer not to say" |
| `employmentStatus` | `JobseekerProfile.js` enum `[employed, unemployed]`; `EditProfile.jsx` pill buttons | pills ✅ | only 2 values, no "prefer not to say", no `Student` or `OFW-returning`-style states some PH job boards include |
| `preferredJobTypes` / `preferredWorkNature` (preferred work arrangement) | exist on `JobseekerProfile.js` as arrays | **no control in `EditProfile.jsx` at all** — not in `initialFormData`, never rendered, never submitted | real gap |

So this item is **mostly a gaps-and-polish pass**, not a rebuild:

### Proposed change

1. Add `"Prefer not to say"` to the `civilStatus` and `employmentStatus` enums (model +
   `EditProfile.jsx` options) — matches the pattern already used for `gender`.
2. Make the disability/PWD control unambiguous: an explicit **"No disability" / "Prefer not to
   say" / [checkbox list]** three-way, rather than inferring "no disability" from an empty array.
   This matters because downstream (admin reporting, DOLE-style disaggregation) "no data" and "not
   disabled" are different facts.
3. Build the missing **preferred work arrangement** UI in `EditProfile.jsx`: multi-select
   checkboxes for `preferredJobTypes` (reuse the job-type constant from §1) and
   `preferredWorkNature` (onsite/remote/hybrid), wired into `initialFormData` and the submit
   payload. This is the highest-leverage item in this section because it's the one gap that
   actually affects scoring (see below), not just UI consistency.

### Matching & recommendation impact — read this before touching anything here

`semanticService.js` contains an explicit **"Fairness invariant"** comment stating that
`disability, civilStatus, religion, height, weight, is4psBeneficiary, isOfw` are deliberately
never read by the scoring engine, and "none should ever become a dimension here." The
`MATCHMAKING_DEPLOYMENT_CHECKLIST.md` independently states the same requirement: sensitive
personal attributes unrelated to job requirements must stay out of scoring.

**Implication for this plan:** adding "Prefer not to say" options and cleaning up the PWD/civil
status controls is purely a data-quality and UX change — it must **not** be wired into
`semanticService.js` as a new dimension, filter, or tie-breaker, even implicitly (e.g. don't add a
"disability-friendly employer" boost that reads the applicant's `disability` array). That would
violate the existing invariant and is explicitly out of scope here.

The one exception is `preferredJobTypes` / `preferredWorkNature` — these are **already** read by
`employmentTypeScore` and are not demographic data, they're a stated job preference. Building their
UI is additive to an existing, already-approved dimension, not a new one. Once this ships,
`employmentTypeScore` will start getting real signal for applicants who fill it in instead of
reading an always-empty array — expect `employmentTypeScore` to move from "mostly degenerate" to
actually discriminating between candidates, which is a legitimate scoring improvement, not scope
creep.

---

## 3. Multi-industry selection for employers

### Current state

- `server/models/JobVacancy.js`: `industry` is `{ type: String, default: "" }` — single value, no
  enum (free string today, though the form constrains it via a fixed list).
- `client/src/components/JobPostingForm.jsx`: `VALID_INDUSTRIES` is a flat array rendered as a
  single `<select>`; submitted as `industry: formData.industry.trim()` (one string).
- `client/src/components/JobSearchFilters.jsx` / `JobBoard.jsx`: single-select industry filter.
- `server/controllers/recommendationController.js` `hybridSearch`: applies the filter as
  `filter.industry = industry`, an exact Mongo string match.
- `server/services/semanticService.js`: `resolveJobIndustry` and the
  `industryAffinityScore` / `industryBackgroundScore` dimensions all assume `job.industry` is a
  single string compared against the applicant's industry background/preferences.

This is a genuine schema change, not just a UI change — every one of the four call sites above
treats `industry` as a scalar and will break or silently misbehave if the field becomes an array
without updating all of them.

### Proposed change

- `JobVacancy.js`: change `industry` to `[String]` (array), keep the same `VALID_INDUSTRIES`-style
  enum constraint on array elements. Default `[]`.
- `JobPostingForm.jsx`: replace the single `<select>` with a multi-select (checkbox list or a
  multi-select combobox, consistent with how `qualifications[]` is already handled elsewhere in
  the same form) submitting `industry: [...]`.
- **Backward-compat read path:** existing documents have `industry` as a string. Normalize on read
  everywhere `job.industry` is consumed — `Array.isArray(job.industry) ? job.industry :
  [job.industry].filter(Boolean)` — until a migration script converts all existing rows, then that
  shim can be removed.
- Migration script: one-off pass over `JobVacancy` collection converting any non-array `industry`
  string into a one-element array (or `[]` if empty).

### Call sites that must change together (this is the actual scope of §3)

1. **`JobPostingForm.jsx`** — form control + submission payload.
2. **`JobSearchFilters.jsx` / `JobBoard.jsx`** — filter UI becomes multi-select too (or at minimum
   must match against *any* of the job's industries, not expect exact string equality).
3. **`recommendationController.js` `hybridSearch`** — `filter.industry = industry` must become an
   array-aware query, e.g. `filter.industry = { $in: selectedIndustries }` when the user picks one
   or more filter values, since `job.industry` is now itself an array.
4. **`semanticService.js`** — `resolveJobIndustry`, `industryAffinityScore`, and
   `industryBackgroundScore` need to change from "compare two strings" to "best overlap between
   the job's industry array and the applicant's industry background/preference set" (e.g. max or
   average score across the job's industries, not just the first one). This is a scoring-logic
   change, not just a data-shape change — decide early whether a job matching *any* preferred
   industry should score as well as a job matching its *only* industry, or whether spreading
   across many industries should slightly dilute the per-industry score (anti-gaming: an employer
   tagging every industry to maximize reach shouldn't out-score a precisely-tagged competitor).

### Sequencing against the in-flight matchmaking work

`JOB_MATCHMAKING_IMPROVEMENT_PLAN.md` Tier 0 is explicitly about stabilizing
`semanticService.js`'s dimension inputs (credentials fetch gaps, inconsistent inputs across the
three call sites, weight-scale bugs tracked in `MATCHMAKING_DEPLOYMENT_CHECKLIST.md` as P0-01/02).
**Do the industry-array change to `semanticService.js` after or alongside that Tier 0 work, not
before it** — changing `industryAffinityScore`'s comparison logic while the engine's baseline is
still unstable makes it impossible to tell whether a scoring regression came from the industry
change or from a pre-existing Tier-0 bug. If §3 needs to ship faster than Tier 0 completes, land
the model/form/migration parts (schema, UI, filter) first and gate the `semanticService.js`
scoring-logic change behind a follow-up once Tier 0 lands.

---

## Suggested sequencing across all three

1. **§1 shared constant + enum expansion** — low risk, no scoring-logic change, ship first.
2. **§2 "Prefer not to say" additions + PWD control cleanup** — pure UI/schema, zero scoring
   impact, ship any time.
3. **§2 preferred-work-arrangement UI** — ship together with §1 (same new `jobType` values need a
   way to be preferred).
4. **§3 schema + form + filter changes** — ship once ready; keep the `semanticService.js` scoring
   update as a separate, explicitly-flagged follow-up commit so it can be reviewed/rolled back
   independently of the schema/UI change, and sequence it against
   `JOB_MATCHMAKING_IMPROVEMENT_PLAN.md` Tier 0 as described above.

## Explicit non-goals

- No new scoring dimension for any demographic/sensitive field (`disability`, `civilStatus`,
  `gender`, etc.) — the existing fairness invariant in `semanticService.js` stands.
- No change to `MatchWeightsEditor.jsx` / weight-bounds system — this plan doesn't touch weight
  configuration, only the inputs that feed existing dimensions.
