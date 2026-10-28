# Mock Defense Revision — Implementation Status

Cross-checked against `STRAMPESO_Mock_Defense_Revision_Document.pdf` (15 numbered items + non-functional
requirements) and the current working tree, including uncommitted changes, on 2026-10-25.

**Legend:** ✅ Implemented · 🟡 Partially implemented · ❌ Not implemented

## Summary

| ✅ Done | 🟡 Partial | ❌ Not started |
|---|---|---|
| 5 | 6 | 4 |

---

## 1. Dropdown for job offer type — ✅ Implemented

Shared constant on both sides ([server/data/jobTypes.js](../server/data/jobTypes.js),
[client/src/constants/jobTypes.js](../client/src/constants/jobTypes.js)), imported by
`JobPostingForm.jsx` and `JobSearchFilters.jsx` instead of two drifting copies. Covers Full-time,
Part-time, Contract(ual), Temporary, Internship, Seasonal, On-the-job training. "Remote" kept as a
legacy-only value; "Work-from-home" deliberately folded into the existing `workNature` field
instead of duplicating it as a jobType (avoids self-contradictory postings).

**Recommendation:** None — matches the spec. Confirm with the panel that merging "Work-from-home"
into `workNature` rather than listing it verbatim is an acceptable interpretation.

---

## 2. Applicant choice of Government ID type — ❌ Not implemented

`EditProfile.jsx`'s "Government IDs" section only has free-text fields for TIN, SSS/GSIS No.,
Pag-IBIG No., PhilHealth No., plus one generic `validIdFile` upload. There is no ID **type**
dropdown (National ID / Driver's License / Passport / UMID / etc.), no ID number field tied to a
chosen type, no per-ID submission date, and no per-ID verification status — just one undifferentiated
file upload.

**Recommendation:** Add a `governmentId: { type, idNumber, fileUrl, submittedAt, verificationStatus }`
structure (array, since an applicant may submit more than one) to `JobseekerProfile.js`, with a type
dropdown + conditional ID-number field in `EditProfile.jsx`. Reuse the verification-status pattern
already built for employer documents (`User.js verificationStatus`, see item 9).

---

## 3. Standardized height/weight units — 🟡 Partially implemented

`EditProfile.jsx` accepts free text for height/weight ("170 or 5'8\"", "65 or 143 lbs") and shows a
live converted hint ("≈ X cm" / "≈ X kg"), so either unit is usable. But the model
(`JobseekerProfile.js:19-20`) stores `height`/`weight` as bare `Number` — there's no persisted
`heightUnit`/`weightUnit` field, and no explicit unit **selector** as the document literally asks
for ("Height unit: Centimeters or Feet/Inches"). The functional outcome (accept both units) exists;
the explicit dropdown structure does not.

**Recommendation:** Low priority — current UX already solves the underlying user problem. If the
panel wants it to the letter, add a unit toggle/dropdown next to each field and persist the
original unit alongside the normalized value.

---

## 4. Standardized applicant profile classifications — ✅ Implemented

`civilStatus` and `employmentStatus` both have "Prefer not to say" added to their enums and UI. The
disability/PWD control has an explicit three-way ("No disability" / "Prefer not to say" / checkbox
list) instead of inferring from an empty array. Preferred work arrangement
(`preferredJobTypes`, `preferredWorkNature`) now has pill-button multi-select UI, wired into form
state and submission — this was previously a real gap and has since been built.

**Recommendation:** None.

---

## 5. Multiple industries for employers — ✅ Implemented

`JobVacancy.industry` is now `[String]`. `JobPostingForm.jsx` submits an array,
`JobSearchFilters.jsx`/`JobBoard` are multi-select with chip UI, `recommendationController.js` uses
`$in` instead of exact string match, and `semanticService.js`'s `industryAffinityScore`/
`industryBackgroundScore` were rewritten to score over the job's industry array. A migration script
(`server/scripts/migrateIndustryToArray.js`) handles legacy string-valued documents, with defensive
array-normalization at read sites for docs not yet migrated.

**Recommendation:** None on functionality. See the separate note below about a hardcoded DB
credential in the migration script — fix before this is committed/pushed.

---

## 6. View resumes within the system — ❌ Not implemented

`EmployerDashboard.jsx:2428-2432` renders only a `SecureFileLink` labeled "Download Resume" — no
inline viewer (`<iframe>`/PDF embed) anywhere in the employer applicant-review flow. The document's
explicit requirement ("View Resume" distinct from "Download Resume, if permitted") is not met;
employers must leave the system or trigger a file download to see a resume.

**Recommendation:** Add an inline PDF preview (e.g. `<iframe>` pointed at the resume URL, or a PDF.js
viewer) in the applicant review modal, with "Download" kept as a secondary action. Gate it by the
same `SecureFileLink` authorization check already in place.

---

## 7. Remaining vacancy slots — ❌ Not implemented

`VacancyCard.jsx:72`, `JobDetail.jsx:291`, and the employer dashboard all display `job.slots`
directly as "N openings" — that's the **total** configured capacity, not slots minus
applications/hires. There is no `remainingSlots` calculation anywhere in the codebase; the document
explicitly asks for total slots, remaining slots, and vacancy status shown together.

**Recommendation:** Compute `remainingSlots = max(0, slots - hiredCount)` (hired, not merely
applied — applying doesn't consume a slot) at the point `applicationCount`/`slots` are already being
read in `recommendationController.js`/`employerRecommendationController.js`, and surface both
numbers plus `status` (active/closed/draft, already on the model) on the card and detail page.

---

## 8. Clear application statuses — ❌ Not implemented (messy/inconsistent)

`JobApplication.js:15-27` has a status enum with **duplicate, inconsistently-cased values**:
`["pending", "reviewed", "shortlisted", "rejected", "hired", "Applied", "Reviewed", "Accepted",
"Rejected"]`. This looks like two generations of status values left in the schema simultaneously.
Missing entirely: **"Under Review"** (distinct from "reviewed"/pending), **"Approved"** as its own
state, and **"Withdrawn"** — an applicant cannot withdraw an application in this schema at all.
"Hired or Filled" is only partially covered by `hired`/`Accepted`.

**Recommendation:** This is a real data-integrity risk (two differently-cased values can both exist
in production data and have to be handled everywhere statuses are read). Pick one canonical set
matching the document's seven states, write a migration to collapse the legacy variants, and add
`withdrawn` as an applicant-triggered transition with its own endpoint/permission check.

---

## 9. Document verification status — 🟡 Partially implemented

`User.js:130-141` has `verificationStatus: ["unverified", "pending", "verified", "rejected"]` for
employer documents, plus `verificationNote`, `verificationSubmittedAt`, `verificationReviewedAt`,
`verificationReviewedBy` — so admins already have a reviewer trail and a place to record a rejection
reason. Missing from the document's list: **"Under Review"** as a state distinct from "pending", and
**"Resubmission Required"** as distinct from "rejected" (the latter matters because it implies a
different applicant-facing call to action than an outright rejection).

**Recommendation:** Add the two missing enum values and branch the UI messaging/CTA on them; the
reviewer-trail infrastructure is already there, so this is a narrow schema + UI change, not a new
subsystem.

---

## 10. Multiple work experiences — ✅ Implemented

`JobseekerProfile.js:176-189` already models `workHistory` as an array of
`{companyName, address, position, dateFrom, dateTo, status}` records, and `EditProfile.jsx:1684`
renders it with `formData.workHistory.map(...)`, with add/remove controls. Free-text entry per field
is already the norm here (not dropdown-only).

**Recommendation:** None. Confirm `industry` and `employmentType` per work-history entry (listed in
the document's proposed field set) are captured — current schema has company/position/dates/status
but not an explicit per-entry `industry`/`employmentType`. Minor gap if the panel checks field-by-field.

---

## 11. System maintenance functions for admins — 🟡 Partially implemented

`QualificationTemplate` has a full model/controller/routes stack
(`server/controllers/qualificationTemplateController.js`), so qualification templates *are*
admin-maintainable. Superadmin also has `system-settings` and NSRP-template management routes, and
the in-progress match-weights work gives superadmin a bounds/defaults UI (`MatchWeightDefaultsSettings.jsx`,
`MatchWeightBoundsSettings.jsx`). But job categories, industry options, government ID types,
employment types, skills, education options, and municipalities are all **hardcoded JS constant
files** (`client/src/constants/industries.js`, `server/data/jobTypes.js`, etc.) — changing any of
them requires a code deploy, not an admin screen. No admin UI for "application statuses" maintenance
either (and per item 8, that enum needs cleanup first regardless).

**Recommendation:** Lowest priority of the open items — these lists change rarely in practice. If the
panel pushes on this specifically, the fastest path is a single generic `SystemOption` collection
(`{category: 'industry'|'jobType'|'govIdType'|..., value, isActive}`) with one admin CRUD screen
reused across categories, rather than building N separate maintenance UIs.

---

## 12. Automated calculations — 🟡 Partially implemented

Done: applicant age is computed from date of birth (`semanticService.js` `getAgeFromDate`/
`ageEligibility`), matching percentage is computed server-side (the whole `semanticService.js`
engine), and application/dashboard counts exist in the admin/employer controllers. Not found:
**jobseeker profile completion percentage** (searched `Dashboard.jsx` and related — no
`completionPercentage`/`profileCompletion` computation for applicants; this exists conceptually only
as an idea referenced in the matchmaking plan's §A.3, not implemented). **Remaining vacancy slots**
is not computed (see item 7 — currently shows raw `slots`, not a derived remaining count).

**Recommendation:** Add a `computeProfileCompleteness(profile)` helper (field-presence ratio over
the NSRP-relevant fields) and surface it on the applicant dashboard — the matchmaking plan already
flags this as the natural place to tie completion % to match accuracy, so it's not purely cosmetic.

---

## 13. Configurable job matching — 🟡 Partially implemented (infrastructure built, not production-correct)

The `MatchWeightProfile`/`MatchWeightBounds` models, resolution chain (vacancy override → employer
default → platform default → code fallback), and admin/employer-facing weight editors
(`MatchWeightsEditor.jsx`, `MatchWeightDefaultsSettings.jsx`, `MatchWeightBoundsSettings.jsx`) all
exist in the uncommitted working tree — this is real, substantial progress on item 13/14 of the
document. However, per the project's own
[MATCHMAKING_DEPLOYMENT_CHECKLIST.md](MATCHMAKING_DEPLOYMENT_CHECKLIST.md), it is **not yet
correct**: the resolver returns integer percentages while the scoring engine expects fractions
(P0-01, confirmed defect — not a style nitpick, it actually changes computed scores and coverage),
the job board and job-detail page score the same applicant differently (P0-02), and bounds
validation doesn't guarantee a feasible weight vector can still sum to 100 (P0-05). All three are
still **Open** in that checklist's tracking table.

**Recommendation:** Do not present this as "done" at defense without caveats — present it as "the
configurable-weights architecture is built; a known, documented set of correctness bugs (P0-01,
P0-02, P0-05) must be fixed before the numbers it produces can be trusted." Fixing P0-01 first is a
small, isolated change (pick one scoring unit and normalize at one boundary) and would let the rest
of the claim stand cleanly.

---

## 14 & 15. Dropdown formats (alphabetical, free-text fallback, multi-select where sensible) — ❌ Not implemented

None of the dropdown lists checked are alphabetized —
[client/src/constants/industries.js](../client/src/constants/industries.js) runs
IT → Healthcare → Finance → Education → Construction → … (insertion order, not A-Z; "Others" is
correctly pinned last by convention, but nothing before it is sorted). Job types, civil status, and
employment status lists are the same. The document also asks for an "Other, please specify" free-text
fallback on dropdowns that don't list every real-world value, and for allowing more than one
selection "where more than one applies" — multi-select already landed for industries (item 5) and
disability checkboxes, but fixed-enum single-selects like `civilStatus` have no "Other" escape hatch.

**Recommendation:** Cheapest fix in the document: sort each constants array alphabetically (keep
"Others"/"Prefer not to say" pinned last) — this is a pure data change, no logic touched, and can be
done for every list in one pass. The "Other: specify" free-text fallback is a slightly larger UI
change (conditional text input tied to selecting "Other") — worth doing for `civilStatus` and any
dropdown sourced from a fixed enum the panel is likely to probe with an edge-case value.

---

## Non-functional requirements

| Requirement | Status | Notes |
|---|---|---|
| Protect applicant personal information | 🟡 | Fairness invariant in `semanticService.js` deliberately excludes sensitive fields from scoring (good); but see §0.5 PII-logging note below and item 2's single undifferentiated ID upload. |
| Restrict resume/document access to authorized users | ✅ | `SecureFileLink` gates resume access; item 6 is about *where* it's viewed, not *who* can view it. |
| PII kept out of job-board logs | ✅ | Checked `recommendationController.js` — logs now use `logger.debug` with ids only (`userId`), not full `req.user`/skills/preference dumps. This matches the fix the matchmaking plan's §0.5 called for. |
| Validate required fields / prevent invalid or duplicate data | — | Not independently re-verified in this pass; existing `validation.js` middleware covers the common paths. |
| Maintain audit logs for admin actions | ✅ | `auditService.js` + `GET /superadmin/audit-logs` exist and are wired into role/user-management actions. |
| Clear, understandable status messages | 🟡 | Undercut by item 8's messy application-status enum — a status value like `"Reviewed"` vs `"reviewed"` existing simultaneously is the opposite of clear. |
| Usable on desktop and mobile | — | Not verified in this pass (would require browser testing per `MATCHMAKING_DEPLOYMENT_CHECKLIST.md` §4, which is itself still open). |
| Keep calculations consistent across applicant/employer/admin views | ❌ | Directly contradicted by the open P0-02 finding in `MATCHMAKING_DEPLOYMENT_CHECKLIST.md`: job board and job-detail page compute different scores for the same applicant/job pair today. |

---

## Separate finding (not in the revision document, but found while checking item 5)

`server/scripts/migrateIndustryToArray.js:21` hardcodes a live MongoDB Atlas connection string with
a real username/password as its fallback default. If this file is committed and pushed, that
credential is exposed in git history regardless of whether it's later removed from the working file.
Recommend removing the fallback and requiring `MONGODB_URI` from the environment before this script
(or the branch containing it) is pushed anywhere.

---

## Priority order for closing the gap before defense

1. **Item 8** (application status cleanup) — data-integrity risk, not just a missing feature; the
   duplicate enum values can already produce inconsistent behavior in production data.
2. **Item 13 P0-01** (weight scale mismatch) — narrow, isolated fix; unblocks presenting item 13/14
   as genuinely correct rather than "built but caveated."
3. **Item 7** (remaining slots) — small, high-visibility, directly named in the document's final
   "shall" list (#7).
4. **Item 6** (in-system resume viewing) — explicitly called out as "instead of being required to
   download," i.e. download-only is the one thing the document says not to do.
5. **Items 14/15** (alphabetize dropdowns) — cheapest item on this entire list; pure data reordering.
6. **Item 2** (Government ID type) — larger schema addition; lowest urgency-to-effort ratio of the
   remaining gaps unless the panel specifically asks about ID verification.
7. **Items 9, 11, 12** — polish/completeness items; address as time allows.
