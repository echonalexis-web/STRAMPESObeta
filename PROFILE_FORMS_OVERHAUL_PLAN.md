# PROFILE FORMS OVERHAUL PLAN

Status: PLAN ONLY. No source, config, package or lockfile was changed. No app was run against a database. The only code that was executed is the pure function `normalizePhone` in `server/utils/phone.js`, called from a one-line `node -e` on sample strings.

Date: 2026-11-18. Branch at planning time: `test/whitebox-audit` (it carries unrelated uncommitted test files; see "Proposed order and commit plan").

Reading guide. Every finding is labeled **Proven** (read in the code, or executed), **Likely** (follows from the code but not executed end to end) or **Suspected** (needs a check when the work starts). Paths are relative to the repo root. Line numbers were read on 2026-11-18 and will drift.

---

## 1. Executive summary

1. The request describes five problems; the code confirms four fully and one partly. Claim 5 (wizard navigation) is half wrong: the sidebar and the mobile pills already jump BACKWARD today. What is missing is jumping forward again, because the only state is the current step number (no "furthest reached" or per-step completion).
2. Phone: both client and server already have a PH-only phone util (`server/utils/phone.js`, `client/src/utils/phone.js`, shared vectors in `server/tests/fixtures/phoneVectors.json`). The onboarding and Edit profile inputs ignore it: they are bare `<input type="tel">` or `type="text"` with no `maxLength`. `PUT /auth/profile`, the route both the jobseeker wizard and Edit profile use, has NO phone validation at all, so `09125826297` is simply stored as typed.
3. Important conflict: the existing util deliberately rejects "run" numbers. The example in the request, `912 345 6789`, is REJECTED today (tail `23456789` is an ascending run; `09123456789` is in the invalid vectors). A decision is needed (section 14).
4. Error styling: there is no red border or glow anywhere. Only 14 of about 90 form files set `aria-invalid`. Three different error idioms are in use (a blocking "Missing Information" modal in the jobseeker wizard, toasts in Edit profile, per-field text in employer onboarding). The server error shape is mostly `{message}` (157 sites), sometimes `{errors[], message}`, and only 9 sites send `field`. Field-level mapping therefore needs a contract decision before any server change.
5. Language table: the same table is hand-copied in `JobSeekerOnboarding.jsx` and `EditProfile.jsx`, all defaults are unticked. The stored shape needs no change for an "All" checkbox.
6. "Not applicable": `User.workExperience` is a strict enum that is validated on save, so "Not applicable" is rejected today. The employment status and reason enums on `JobseekerProfile` are NOT enforced on the `/auth/profile` path (`upsertProfile` has no `runValidators`). Two legacy scripts would wrongly treat the new value as bad data unless updated (section 9). Contract changes in section 7 need your sign-off first.
7. Wizard state is a localStorage draft per account (not a server draft). "Draft saved automatically" is true only on that device and does not include the resume or ID files.
8. Tests: the client suite runs `node --test` on pure `.js` files only (no React test library, no jsdom). The plan therefore puts all logic in pure modules and lists a manual QA matrix for the components. Adding test dependencies is a decision.
9. Order: WP2 shared pieces, then WP1, WP3, WP4, WP5. One branch, one commit per work package.
10. Open decisions are listed at the end under "## My decisions", each with a recommended default.

---

## 2. Findings

### 2.1 Verification of each claim

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Phone is a plain text box, no country code, no length limit | **Proven** (client). Server is worse than described | Onboarding: `client/src/pages/onboarding/JobSeekerOnboarding.jsx:803` `<input type="tel" ...>`, no `maxLength`. Edit profile: `client/src/pages/EditProfile.jsx:1215` is `type="text"`. Employer onboarding: `EmployerOnboarding.jsx:375` `type="tel"`, placeholder `e.g. 09171234567`. Server: `PUT /auth/profile` and `PATCH /auth/me` (`server/routes/authRoutes.js:346`, `:359`) run only `sanitizeRequestBody` and `detectMaliciousPayload`; `validateUserUpdate` is mounted only on `PUT /users/profile` (`server/routes/userRoutes.js:42`) and `PUT /users/onboarding` (`:29`). No code path on `/auth/profile` checks the phone except the onboarding-completion check at `server/controllers/authController.js:2220-2230`, which only runs while `USERNAME_SIGNUP_ENABLED` is on. |
| 2 | Errors do not clearly glow red with a reason, not consistent | **Proven** | No `box-shadow` or red border on any invalid field; `aria-invalid` appears in 14 files only (table in section 4). See idioms below. |
| 3 | Language table makes the user tick four boxes per row | **Proven** | `JobSeekerOnboarding.jsx:1093-1128`, `EditProfile.jsx:1763-1797`. Defaults: all false (`emptyLanguageRow`, `JobSeekerOnboarding.jsx:94`, `:127-131`; `EditProfile.jsx:198-202`). |
| 4 | No "Not applicable" in Work Experience; no student option in employment status or reason | **Proven** | Work Experience options `JobSeekerOnboarding.jsx:1037-1044`, `EditProfile.jsx:1698`; schema enum `server/models/User.js:224-232`. Status pills `JobSeekerOnboarding.jsx:1593-1594` (only Employed, Unemployed); Edit profile adds "Prefer not to say" (`EditProfile.jsx:2425`). Reasons `client/src/constants/unemploymentReasons.js` (7 values). |
| 5 | Sidebar does not let the user jump between steps | **Partly wrong** | `JobSeekerOnboarding.jsx:434-439` `handleStepJump` allows targets up to and including the current step only (`if (targetStep > step) return`). The sidebar (`:733-757`) and the mobile pills (`:768-787`) already call it, so Step 5 to Step 1 works today. Forward is blocked because `step` is the only state, so after jumping back to 1 the user cannot return to 5 without pressing Next four times. The button label is "Back" (`:1660`), not "Previous". The employer onboarding sidebar is not clickable at all (`EmployerOnboarding.jsx:241-251` plain `<span>`s). |

### 2.2 Other findings that shape the plan

**Phone**

- **Proven.** `server/utils/phone.js:14-49` accepts PH mobile (`09XXXXXXXXX`, `+639XXXXXXXXX`, `639XXXXXXXXX`, `9XXXXXXXXX`) and PH landline (`0` + area code 2-8 + 7-9 digits); rejects any `+` number that is not `+63`; rejects "weak" numbers (last 8 digits all the same, or a substring of the ascending/descending digit cycle). It returns the NATIONAL form (`09...`). Client file is a mirror (`client/src/utils/phone.js`), tested against the same vectors.
- **Proven (executed).** Results of `normalizePhone`: `"912 345 6789"` null; `"09123456789"` null; `"+63 912 345 6789"` null; `"09125826297"` `09125826297`; `"0917 123 4567"` `09171234567`; `"+1 415 555 2671"` null. So the example the request gives for a valid number is rejected by the existing weak-pattern rule, and `fixtures/phoneVectors.json` lists `09123456789` under `invalid` on purpose.
- **Proven.** The "valid phone before a regular job apply" rule (`server/middleware/applyGuards.js:13-28`, mounted at `server/routes/jobRoutes.js:106`) and the onboarding-completion phone check run ONLY when `isUsernameSignupEnabled()` is true (`applyGuards.js:11` `appliesTo`). SPES does not use the apply guard: it has its own optional `contactNumber` (`server/controllers/spesController.js:246-262`, loose regex `{7,20}`).
- **Proven.** Existing loose validators: `server/middleware/validation.js:97` (phone `^[0-9+\-\s()]{10,20}$`), `:143` (secondary mobile same), `:140` (landline `{7,15}`), `:331` (register phone). The register form in the client has no phone field (no `phone` match in `Register.jsx` or `EmployeeRegister.jsx`), so `:331` is unused by the UI.
- **Proven.** Profile completion: server `server/utils/profileCompleteness.js:13` counts `Boolean(user.phone)`; client `ProfilePage.jsx:141,166,183` the same. A format change that keeps the field a non-empty string keeps both working.
- **Proven.** `client/src/data/countries.json` is a flat list of country NAMES (used for citizenship and "laid off abroad"); it has no dial codes, so a new constants file is needed.
- **Likely.** `client/src/components/SearchableDropdown.jsx:106-128` already implements `role="combobox"`, `aria-expanded`, `role="listbox"`, `role="option"`; it is a candidate base for the country selector. Its keyboard behavior, focus handling and 320 px layout must be audited when the work starts (Suspected until then).

**Errors**

- **Proven.** Existing red token: `--ds-danger: #b42318`, `--ds-danger-bg: #fdecea` (`client/src/styles/design-system.css:18-19`), used about 174 and 86 times. The onboarding stylesheet has its own copies: `--ob-danger: #dc2626`, `--ob-danger-text: #b42318`, `--ob-danger-bg: #fff1f2`, `--ob-danger-border: #fecdd3` (`client/src/styles/onboarding.css:35-38`). No ring or glow token exists.
- **Likely** (hand-calculated, re-check with a contrast tool before shipping). `#b42318` on `#ffffff` is about 6.6:1; on `#fdecea` about 5.8:1; both pass 4.5:1 for text and 3:1 for the border.
- **Proven.** Three idioms: (a) jobseeker wizard: a single string `error` state shown in a blocking `role="alertdialog"` titled "Missing Information" (`JobSeekerOnboarding.jsx:1672-1692`), with no field marked; (b) Edit profile: `toast.error(message)` plus a page-level `error` string (`EditProfile.jsx:953-956`), no field marked; (c) employer onboarding: per-field `<span className="onboarding-field-error">` (`EmployerOnboarding.jsx:376`), red text only, no border, no `aria-describedby`. Best existing examples to base the shared pattern on: `ApplyPhoneStep.jsx` (`aria-invalid`, `aria-describedby`, `role="alert"`) and `JobPostingForm.jsx` (4 `aria-invalid`, 4 `aria-describedby`).
- **Proven.** There is a client helper `translateErrorCode(code)` and `apiErrorMessage(err)` (`client/src/utils/apiErrors.js`) reading `errors.codes.<CODE>` from the locale files (`en.json:1520`, includes `PHONE_REQUIRED`, `PHONE_INVALID` at `:1609-1610`; Filipino at the same lines of `fil.json`). That is the existing convention for server-coded errors and the plan reuses it.

**Server error response shapes (Proven by grep)**

| Shape | Where | Count (approx.) |
|---|---|---|
| `{ message }` | most controllers | 157 sites |
| `{ errors: [string], message: errors[0] }` | `validateUserUpdate`, `validatePasswordChange`, `validateUserRegistration` | 8 sites |
| `{ code, message, field }` | usernames, apply phone, onboarding phone (`authController.js:300-304,335,393,426,449,2227`; `applyGuards.js:27`) | 9 sites |

Not field-level and not consistent. This is a contract question (decision D9) and the plan STOPS there: the client is designed to work with today's shapes, and the optional `fieldErrors` addition is only proposed.

**Language table**

- **Proven.** Two hand-copied tables: `JobSeekerOnboarding.jsx:1093-1128` (`.onboarding-lang-table`) and `EditProfile.jsx:1763-1797` (`.lang-table`), with two separate `toggleLanguageSkill` functions (`JobSeekerOnboarding.jsx:471`, `EditProfile.jsx:586`). Read-only display: `ProfilePage.jsx:119`, `:654`, `:1325-1330`. Resume text: `client/src/utils/resumeDerivation.js:80`. `BasicRequirements.jsx:35` is a different feature (job-posting language requirements, a toggle per language) and is NOT in scope.
- **Proven.** Stored shape: `server/models/JobseekerProfile.js:182-203` `languageProficiency.{English,Filipino,Others}.{read,write,speak,understand}` booleans plus `languageOthersLabel`. Saved as JSON via `authController.js:2360-2363`. No server change needed for WP3.
- **Proven.** Completion checks look for "at least one flag true" (`server/utils/profileCompleteness.js:39-45`, `server/utils/personalizationEligibility.js:42-46`, `ProfilePage.jsx:119-123`). "All" produces ordinary flags, so these stay correct.

**Work experience, employment status, reason**

- **Proven.** `User.workExperience` enum `["Fresh Graduate","Less than 1 year","1–3 years","3–5 years","5+ years"]` (note the en dash) at `server/models/User.js:224-232`. It IS validated on save: `authController.js:2259` uses `findByIdAndUpdate(..., { runValidators: true, context: "query" })`.
- **Proven.** `JobseekerProfile.employmentStatus` enum `["employed","unemployed","Prefer not to say"]` (`server/models/JobseekerProfile.js:79-83`); `employmentType` `["wage","self"]`; `unemploymentReason` enum of 7 values (`:89-101`). These are written through `upsertProfile` (`authController.js:209-212`) which is `findOneAndUpdate({userId}, {$set: data}, {new:true, upsert:true})` with NO `runValidators`. So on `/auth/profile` those enums are not enforced today (Proven), and the only value check is `validateUserUpdate` on the `/users/*` routes (`validation.js:172-183`), which allows `employed|unemployed` only (it rejects "Prefer not to say" even though the schema allows it).
- **Proven.** Matching: `server/services/semanticService.js:305-319` `EXPERIENCE_BAND_YEARS` and `bandToYears` (read with `grep -a`; the file contains a byte that makes plain grep report "Binary file matches"). An unknown string such as "Not applicable" returns `null`; `getApplicantExperienceYears` (`:354-360`) then falls back to years computed from `workHistory`. `experienceScore` (`:362-390`) returns `null` ("experience not a factor") only when the JOB has no experience requirement; otherwise an applicant with 0 years scores `0/required`. So today "Not applicable" behaves like Fresh Graduate (0 years, a penalty against jobs that need experience), not neutral. Also the raw string is added to the similarity text (`semanticService.js:1072`), which would add the tokens "not applicable" to the embedding text (Likely noise).
- **Proven.** `workExperience` is NOT used by `canPersonalizeRecommendations` (`server/utils/personalizationEligibility.js`).
- **Proven.** NSRP export (`server/services/nsrpFormService.js:137-144,197-205`): employed/unemployed boxes are drawn only for those exact values; the reason box comes from `UNEMPLOYMENT_REASON_BOX[profile.unemploymentReason]` and is skipped when the key is unknown. So an unknown value already leaves the boxes blank. `lost_informal_work` has no box (existing gap, listed under unrelated issues).
- **Proven.** Two legacy scripts would mis-handle the new `workExperience` value: `server/scripts/migrateWorkExperienceLegacyValues.js:32,59` (`CURRENT_ENUM` and a `$nin` filter would treat "Not applicable" as a legacy value to "repair") and `server/scripts/checkEnumDrift.js:35` (reports drift against its own copy of the enum).
- **Proven.** Displays that would show the raw value: `ProfilePage.jsx:714-721` builds the employment label with `charAt(0).toUpperCase()+slice(1)` and `UNEMPLOYMENT_LABELS` (`:95-103`); a new value such as `not_applicable` would show as "Not_applicable". `ProfilePage.jsx:1258` prints ` · years of experience: <value>`. `client/src/utils/coverLetterDerivation.js:13` copies `workExperience` into the `{years}` placeholder, so a student's cover letter would say "Not applicable" years. `client/src/pages/admin/UserProfileView.jsx:294` prints the raw value (acceptable). `server/services/profileProjection.js:94,358` passes `workExperience` to other viewers (acceptable, a label).
- **Proven.** Client completion counts `Boolean(profile?.workExperience)` (`ProfilePage.jsx:151`); "Not applicable" counts as answered. The server `computeProfileCompleteness` does not look at work experience or employment status at all.

**Wizard**

- **Proven.** Jobseeker wizard: 9 steps (`STEP_LABELS` at `JobSeekerOnboarding.jsx:48-58`), success screen `SUCCESS_STEP = 10`. State is `usePersistentState("jobseekerOnboarding_<userId>")` which writes to `localStorage` on every state change (`client/src/hooks/usePersistentState.js`, the persist effect near the end). It stores `form`, `preferredIndustries`, `industryPreferenceLevel`, `skills`, `step`. There is no server draft. The resume and ID `File` objects are React state only (`:394-397`) and are not persisted.
- **Proven.** Step completion rules exist only inside `handleNext` (`:536-582`) and `validateFinalStep` (`:584-594`): step 1 surname, first name, phone (non-empty only), DOB (age), gender, address; step 2 one industry; step 3 one skill; step 4 one occupation and availability; step 5 educational attainment and work experience; step 6 optional; step 7 civil status (+ other), citizenship, place of birth, full present address; step 8 employment status (+ type or reason); step 9 optional. "Finish Setup" (`submitProfile`, `:601`) re-checks ONLY step 8 (`validateFinalStep`), not steps 1-7.
- **Proven.** Sidebar renders `done` for `step > idx`, `current`, `upcoming` (`:736`); a button is enabled when `idx <= step` (`:737`); `aria-current="step"` is set on the current one. Locked steps are `disabled` (not focusable, no reason announced). Mobile: `.onboarding-mobile-step-pills` (`:768-787`, CSS `onboarding.css:305-330`, shown at `max-width: 900px`, `:1516-1526`) are numbered buttons with `aria-label="Jump to <label>"`.
- **Proven.** Wizard errors: `handleNext` sets one string and shows it in the "Missing Information" modal. Wizard strings are hardcoded English; only a few use `t()` (suggestions, civil status, ID upload). `USERNAME_SIGNUP_PLAN.md` line 45 records the same (Register, Login, Onboarding hardcoded English).
- **Proven.** Employer onboarding: 4 steps (`EmployerOnboarding.jsx:20`), validation in `validateStep1/2`, `errors` object per field (the best existing per-field model), submit to `usersAPI.completeOnboarding` = `PUT /users/onboarding` (validated by `validateUserUpdate`).
- **Proven.** Age-locked DOB: field is `readOnly` when `user.dateOfBirth` exists (`JobSeekerOnboarding.jsx:804`); server enforces the lock (`authController.js:2045-2064`). Not touched by this plan.

### 2.3 Existing plans and branches reviewed (reuse, do not duplicate)

- `markdowns/USERNAME_SIGNUP_PLAN.md` defines the phone rule (section 4 and 16.x): format only, no SMS, required before a REGULAR apply, SPES exempt, shared with the employer only after applying or via "Share my contact details" (`server/controllers/contactShareController.js`). WP1 keeps all of it; the rule stays behind `USERNAME_SIGNUP_ENABLED`.
- `markdowns/SPES_RESTRUCTURE_PLAN.md` defines the age lock, `errors.codes.*` i18n and SPES apply. Reused: the `errors.codes` mechanism and the DOB lock (untouched).
- `markdowns/JOB_FORM_AND_PROFILE_FIELD_STANDARDIZATION_PLAN.md`, branches `feat/profile-field-suggestions`, `feat/profile-about-restructure`, `feat/qualification-steps`: wizard/profile typeahead and field work. `feat/profile-field-suggestions` is 2 commits ahead of `main` and touches both onboarding and Edit profile (`dd8b1d01`, `454829f2`); WP1, WP3, WP4 and WP5 touch the same files, so merge order matters (see commit plan). Not read in depth; Suspected overlap in `JobSeekerOnboarding.jsx` and `EditProfile.jsx`.

---

## 3. Inventory: phone numbers (Inspect 1)

**Stored**

| Field | Model | Format today | Role |
|---|---|---|---|
| `User.phone` | `server/models/User.js:134` `String, default null` | Whatever was typed (e.g. `09125826297`, `0917 123 4567`, `+63...`). No normalization on write. | Primary phone; jobseeker, employer, admin |
| `JobseekerProfile.mobileSecondary` | `JobseekerProfile.js:41` | As typed | Secondary mobile (jobseeker) |
| `JobseekerProfile.landline` | `authController.js:2299` | As typed | Landline (jobseeker); stays unchanged |
| `EmployerProfile.fax` | `authController.js:2387` | As typed | Fax (employer); not a phone; unchanged |
| `SpesApplication.contactNumber` | `server/models/SpesApplication.js:30` | As typed, `{7,20}` regex | SPES contact; separate |
| `AccountRecoveryRequest.contactPhone` | `AccountRecoveryRequest.js:33` | NATIONAL normalized by `normalizePhone` (`accountRecoveryController.js:58`) | Recovery contact; separate |
| `AccountRecoveryRequest.phone` | `:14` | Free text `maxlength 40` | Recovery claim |
| `ContactShare.fields.phone` | `server/models/ContactShare.js:15` | Boolean only | Consent flag |

**Entered (client)**

| Place | File and line | Control today | Validation today |
|---|---|---|---|
| Jobseeker onboarding Step 1 (primary) | `JobSeekerOnboarding.jsx:803` | `type="tel"`, no limit | Non-empty only (`:541`) |
| Jobseeker onboarding Step 7 (landline, secondary mobile) | `:1391-1392` | `type="tel"` | None |
| Jobseeker Edit profile (primary) | `EditProfile.jsx:1214-1215` (also admin and employer: one shared field, outside the role conditionals) | `type="text"` | None client-side |
| Jobseeker Edit profile NSRP tab (landline, secondary mobile) | `:2250-2255` | `type="tel"` | None |
| Employer onboarding Step 2 | `EmployerOnboarding.jsx:374-376` | `type="tel"`, placeholder `e.g. 09171234567` | Non-empty (`:156`) |
| Employer Edit profile | the same shared field `EditProfile.jsx:1214` | `type="text"` | None |
| Inline apply step | `client/src/components/ApplyPhoneStep.jsx:11-70` | `type="tel"` | `phoneProblem` (PH util) then `PUT /auth/profile` |
| SPES apply | `client/src/components/SpesApplyFlow.jsx:314` | `type="tel"`, prefilled from `user.phone` (`:74`) | Non-empty (`:176`) |
| Recovery contact | `client/src/pages/StaffAccountRecovery.jsx:50` | text | `phoneProblem` |
| Signup (jobseeker, employer) | `Register.jsx`, `EmployeeRegister.jsx` | none | none |

**Server validation per route**

| Route | Validator | Phone check |
|---|---|---|
| `PUT /auth/profile`, `PATCH /auth/me` (both mounts) | none | none (except completion check, flag-gated) |
| `PUT /users/profile`, `PUT /users/onboarding` | `validateUserUpdate` | regex `^[0-9+\-\s()]{10,20}$` |
| `POST /auth/register*` | `validateUserRegistration` | same regex, client sends no phone |
| Regular job apply | `requireApplyPhone` | `phoneProblem` (PH util), flag-gated |
| Recovery request | controller | `normalizePhone`, flag-gated |
| SPES apply | controller | regex `{7,20}`, optional |

**Consumers (read, display, export)**

| Consumer | File and line | Effect of a new stored format |
|---|---|---|
| Contact share (shows `user.phone` to employer) | `contactShareController.js:23,92,111` (`isValidPhone(user.phone)`) | Must keep validating legacy and E.164 |
| Employer sees applicant phone | `employerController.js:21`, `profileProjection.js:176-340`, `employerRecommendationController.js:44,123`, `spesController.js:123` | Value passed through; client formats for display |
| Seeker sees employer phone | `jobController.js:166,232,289`, `jobLikeController.js:124`, `recommendationController.js:227` (signed-out visitors get none, `jobController.js:206,266`) | Same |
| NSRP Form 1 export | `nsrpFormService.js:188` (page 1 mobile), `:325` (telephone, other form) | Must print the national form for PH numbers (box width `nsrpFormFieldMaps.js:100`, `maxWidth: 100`) |
| Profile completion | `profileCompleteness.js:13`, `ProfilePage.jsx:141,166,183` | Non-empty check only; unaffected |
| Apply guard and onboarding completion | `applyGuards.js:25`, `authController.js:2221` | Use the shared parser; accept both formats |
| Profile pages | `ProfilePage.jsx:876,1111,1214`, `PersonProfileView.jsx:31`, `admin/UserProfileView.jsx:257,334`, `Settings.jsx:1011`, `EmployerModal.jsx:102`, `EmployerDashboard.jsx:188,2284`, `ResumeStudio.jsx:242,298`, `ShareContactButton.jsx`, `admin/SpesApplications.jsx:228` | Show via one display helper; `tel:` links use the E.164 form |
| Notifications | no phone content found in `server/services` notifications (Suspected: a final grep when work starts) | none |

Static office phone numbers in the chatbot (`client/src/chatbot/contact.js`, `ui/ContactCard.jsx`) are content, not user data; out of scope.

---

## 4. Inventory: forms and field types (Inspect 3)

About 90 `.jsx` files render a form control. Counts are lines matching in `client/src` (approximate, line-based).

Control types present: `type="text"` 115, `select` 81, `checkbox` 41, `number` 27, `textarea` 27, `Autosuggest` 26, `date` 20, `file` 14, `search` 11, `password` 10, `tel` 9, `email` 9, `SearchableDropdown` 7, `CodeInput` 6, `range` 5, `url` 4, `radio` 4, `datetime-local` 3. Plus 31 `pill-btn` button groups used as radio-like choices (gender, employment status, employment type, job type, etc.); these are `<button>`s, not inputs, and need group-level error handling. `role="alert"` appears in 64 places; `useToast` / `toast.error` in 37 files.

Idioms by area (inputs / `aria-invalid` count / how errors show):

| Area | Files (inputs, `aria-invalid`) | Error idiom today |
|---|---|---|
| Public auth | `Login` (4,0), `Register` (10,0, `describedby` 1), `EmployeeRegister` (6,0), `ForgotPassword` (2,0), `ForgotUsername` (1,0), `ResetPassword` (2,0), `AccountRecovery` (4,0), `StaffAccountRecovery` (4,0), `AccountSuspended` (1,1), `ChangePassword` (1,1), `CodeInput` (2,1) | Mostly a single error string; 3 files have `aria-invalid` |
| Jobseeker wizard and profile | `JobSeekerOnboarding` (51,0), `EditProfile` (78,0, `describedby` 1), `Settings` (14,0), `ApplyModal` (2,0), `ApplyPhoneStep` (1,1), `SpesApplyFlow` (7,0, `describedby` 1), `ResumeStudio` (8,0), `coverLetterBuilder` (5,0), `DobPrompt` (1,1), `EmailPrompt` (2,0, `describedby` 1), `EmailChangeCard` (2,0), `IdOcrReview` (2,0), `ProfileTemplateModal` (4,2), `ProfileTemplatesTab`, `JobSearchFilters` (7,0), `YourApplications`, `SpesPostings`, `ShareContactButton` (2,0), `ReportButton` (2,0), `AvatarPicker`, `AvatarPresetPicker`, `HeightInput`, `WeightInput`, `LocationSelect` (4,0), `QualificationsEditor` (2,0) | Modal (wizard), toast (Edit profile), string under form (others) |
| Employer | `EmployerOnboarding` (16,0, per-field `errors` object), `EmployerDashboard` (14,0), `JobPostingForm` (7,4, `describedby` 4; best current model), `BasicRequirements` (5,0), `InterviewScheduleModal` (4,0), `RankedApplicantsTable` (5,0), `MatchWeightsEditor`, `MatchWeightBoundsSettings` (2,0), `FileUpload` (1,1) | Mixed; `JobPostingForm` is field-level |
| Admin | `admin/SpesApplications` (16,2), `admin/SpesPostingForm` (10,1, `describedby` 2), `admin/CreateAnnouncement` (6,0), `admin/AuditTrail` (6,0), `admin/Reports` (5,0), `admin/AccountRecoveryQueue` (4,0), `admin/JobMonitoring` (4,0), `admin/ModerationQueues` (3,0), `admin/UserManagement` (2,0), `admin/NewsFeedManagement`, `admin/EmployerVerification` (2,0), `admin/ProvincialAnalyticsOverview`, `admin/SpesPostingsAdmin`, `admin/FindAccount`, `SystemOptionsSettings`, `NsrpTemplateSettings`, `ResetPasswordControl` (4,0), `UnlockLoginControl`, `TemporaryPasswordPanel` | Mostly string or toast |
| Superadmin | `superadmin/SuperadminAdminAccounts` (4,0), `superadmin/SuperadminConsole` (1,0, `describedby` 1) | String |
| Shared widgets | `Autosuggest`, `SearchableDropdown`, `LocationAutosuggest`, `FileUpload` (1,1), `FileDropzone` (`describedby` 1), `DocumentDropzone`, `Pagination`, `Composer` (chatbot) | Widget-specific |
| Messaging / news | `Messages` (3,0), `FloatingMessenger`, `NewsFeed` (4,0), `NewsFeedDetail` | Mostly not validation forms |

Files that already set `aria-invalid` (14): `admin/SpesApplications`, `admin/SpesPostingForm`, `JobPostingForm`, `ProfileTemplateModal`, `CodeInput`, `FileUpload`, `ChangePassword`, `AccountSuspended`, `DobPrompt`, `ApplyPhoneStep`, and the others counted above. These are the first migration candidates because they already follow the right semantics.

Server-to-field error mapping: see the shape table in 2.2. Today the client maps server errors to a field only for username (`field: "username"`) and phone on apply, and only by convention.

A per-file audit of every field (label, control, current error handling) is part of the WP2 migration step, produced by a one-off listing script that is NOT committed (it only prints). The count above is the planning baseline.

---

## 5. Design and behavior spec

### 5.1 WP2 first: the shared field error pattern

Built first because WP1, WP3, WP4, WP5 all use it.

**Pieces**

1. **CSS** `client/src/styles/form-field.css` (new, imported once from the design-system entry). Tokens added to `design-system.css` `:root` (no new colors beyond the glow): `--ds-danger-ring: rgba(180, 35, 24, 0.18)` and reuse `--ds-danger` and `--ds-danger-bg`. Rules:
   - `.ds-field` wrapper: label, control, helper text, error row.
   - Invalid control: `border-color: var(--ds-danger)` and `box-shadow: 0 0 0 3px var(--ds-danger-ring)`. No animation, no transition on the glow (reduced motion safe).
   - Baseline attribute rules: `input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"], [role="combobox"][aria-invalid="true"]` get the same look, so any legacy markup that only sets `aria-invalid` is styled without a rewrite. Group error: `[role="group"][aria-invalid="true"], [role="radiogroup"][aria-invalid="true"]` get a red outline box.
   - `:focus-visible` on an invalid control keeps a visible focus ring that differs from the glow (2px solid `--ds-focus` offset 2px, plus the red border), so focus and error are both readable.
   - Windows forced-colors: `@media (forced-colors: active)` uses `outline: 2px solid CanvasText` plus the icon and text; the glow is not relied on.
   - Error row: `.ds-field__error { display:flex; gap: 6px; color: var(--ds-danger); font-size: var(--ds-text-sm); }` with an inline SVG icon (`aria-hidden="true"`). Text is never color only: icon, border and message always appear together.
2. **Component** `client/src/components/FormField.jsx` (new): props `id`, `label`, `required`, `hint`, `error` (string), `children` as a render function or a cloned control. It generates `${id}-error` and `${id}-hint`, sets `aria-invalid` and `aria-describedby` (error id first, then hint id) on the control, and renders the error row with `role="alert"` ONLY when the error text changes after submit or blur (to avoid double announcements; see the rule below). Also exports `FieldGroup` for checkbox, radio and pill-button groups (renders `role="group"` or `role="radiogroup"` with `aria-labelledby`, `aria-invalid`, `aria-describedby`).
3. **Pure logic** `client/src/utils/formErrors.js` (new, testable with `node --test`):
   - `makeErrors()`: shape `{ [fieldName]: { code, params } }`.
   - `firstInvalidField(order, errors)` returns the first field name in DOM/visual order.
   - `mapServerError(err, fieldMap)`: reads `err.response.data` and returns `{ field, code, params }` or `{ field: null, ... }` (form-level). Handles the three current shapes: (a) `{code, field}` direct; (b) `{code}` with `fieldMap[code]`; (c) `{message}`/`{errors[]}` with no code returns a form-level error (no guessing from English text; that would be fragile).
   - `messageFor(code, params, t)` returns the translated string from `formErrors.*` or `errors.codes.*`, falling back to the server message.
4. **Hook** `client/src/hooks/useFieldErrors.js` (new): holds `errors`, `setFieldError`, `clearFieldError(name)` (called on change and blur), `validateAll(validators, order)`, and `focusFirstInvalid(formRef)` which calls `scrollIntoView({block:"center"})` (instant when `prefers-reduced-motion`) and `.focus()` on the first `[aria-invalid="true"]`, finding by `order`, not DOM guess. On a submit with any error it also sets a visually-hidden polite live region text "N fields need attention" (the per-field `role="alert"` is skipped on submit to avoid a flood; the first field receives focus and its message is read via `aria-describedby`).
5. **Announcement rule.** On blur or change validation the error text is inside an `aria-live="polite"` container; on submit failure the live region summarizes the count and focus goes to the first invalid field. This replaces the 64 ad-hoc `role="alert"` uses where they sit on field errors (page-level failure banners keep `role="alert"`).
6. **Wizard modal.** The "Missing Information" `alertdialog` in the jobseeker wizard is replaced for validation problems by inline field errors plus focus on the first invalid field. It stays for non-field failures (network error on final submit), reworded.

**Specific messages (i18n keys, both `en.json` and `fil.json`, namespace `formErrors`)**

Generic: `required` ("Enter {{field}}." / for selects "Select {{field}}."), `requiredGroup` ("Choose at least one."), `tooShort` ("Use at least {{min}} characters."), `tooLong` ("Use {{max}} characters or fewer."), `wrongFormat`, `outOfRange` ("Enter a value from {{min}} to {{max}}."), `notAllowed` ("That value is not allowed."), `alreadyTaken` ("That {{field}} is already taken."), `mustMatch` ("The two entries must match."), `invalidEmail`, `invalidUrl` ("Enter a full web address, for example https://example.com."), `invalidDate`, `dateInFuture`, `dateTooEarly`, `ageTooYoung` ("You must be at least {{min}} years old."), `fileTooLarge` ("Choose a file under {{max}}."), `fileWrongType` ("Choose a {{types}} file."), `weakPassword`, `numbersOnly`.

Phone (namespace `phoneInput.errors`, also the server codes below): `required` ("Enter your mobile number."), `phFormat` ("Enter a 10-digit mobile number that starts with 9."), `tooShort` ("That number is too short. Enter at least {{min}} digits."), `tooLong` ("That number is too long. Use {{max}} digits or fewer."), `badChars` ("Use numbers only."), `weak` ("That number does not look real. Check it and try again."), `countryUnknown` ("Choose a country code from the list."), `landlineNotAllowed` ("Enter a mobile number, not a landline.").

Filipino strings are flagged for native review.

**Migration order (WP2, after shared pieces are merged)**

1. Adopt the already-semantic forms (they only need the new CSS and `FormField`): `ApplyPhoneStep`, `DobPrompt`, `ChangePassword`, `AccountSuspended`, `CodeInput`, `FileUpload`, `ProfileTemplateModal`, `JobPostingForm`, `SpesPostingForm`, `SpesApplications` (the 14).
2. Auth and signup: `Login`, `Register`, `EmployeeRegister`, `ForgotPassword`, `ForgotUsername`, `ResetPassword`, `AccountRecovery`, `StaffAccountRecovery`.
3. Jobseeker onboarding wizard: per-step validators extracted from `handleNext` into a pure `getStepErrors(stepIndex, state)` (used also by WP5 reachability); replace modal with inline errors. Employer onboarding: convert its existing `errors` object to the shared pattern.
4. Edit profile (all tabs, all roles): validators for name, phone, DOB (locked), address blocks, numbers, dates, files; replace toast-only validation with field errors (toast stays for save success and network failure).
5. Employer tools: `JobPostingForm` rest, `EmployerDashboard` forms, `InterviewScheduleModal`, `BasicRequirements`, `QualificationsEditor`.
6. SPES: `SpesApplyFlow`, `SpesPostings`, admin `SpesApplications` filters.
7. Admin and superadmin: `CreateAnnouncement`, `NewsFeedManagement`, `SuperadminAdminAccounts`, `ResetPasswordControl`, `UnlockLoginControl`, `TemporaryPasswordPanel`, `SystemOptionsSettings`, `NsrpTemplateSettings`, moderation and verification forms.
8. Settings and modals: `Settings` (password, email change `EmailChangeCard`, ID OCR), `EmailPrompt`, `ShareContactButton`, `ReportButton`, `ApplyModal`, `ResumeStudio`, `coverLetterBuilder`, `ImageEditorModal`.

Intentionally skipped (not validation forms): search boxes (`type="search"`, `JobSearchFilters` keyword), pagination page-size selects, chat composers (`Messages`, `FloatingMessenger`, chatbot `Composer`), `range` sliders in match-weights (they clamp, they do not error), admin filter toolbars (`AuditTrail`, `Reports`, `ApplicationsToolbar`). They keep their current behavior.

Each migrated form gets a checklist item: label bound with `htmlFor`, `aria-invalid`, `aria-describedby`, message text from `formErrors.*`, first-invalid focus, no toast for validation.

### 5.2 WP1 Phone

**Shared component** `client/src/components/PhoneInput.jsx` (new) with the pure logic in `client/src/utils/phoneIntl.js` and the data in `client/src/constants/phoneCountries.js`.

- Layout: label above; below it a flex row: country selector (left, fixed width about 7.5rem showing `PH +63`) and number input (right, flex 1, `min-width: 0`). At 320 px both still fit; if the selector needs more room, the row wraps (selector on its own line) via `flex-wrap: wrap`. Both controls 44 px high.
- Country selector: a combobox based on the existing `SearchableDropdown` pattern (to be audited), listbox of "Philippines +63". Filter matches country name (case-insensitive, diacritics ignored), ISO code or dial code with or without `+`. Type "63", "+63", "phil" or "ph" and Philippines shows. Keyboard: Down/Up/Enter/Escape/Home/End, type-ahead; the selected item announced; the popup closes on Tab. Visible text is `ISO +dial` (no flag emoji, which render as letters on Windows). The accessible name is "Country calling code" (translated) and the number input has its own visible label (the field label, e.g. "Mobile number").
- Default country: always `PH` (+63). It is never inferred from citizenship (asked later) or from `navigator.language`.
- Number input: `type="tel"`, `inputMode="tel"`, `autoComplete="tel-national"`, `maxLength` equal to the formatted length (PH: 12 including two spaces). Behavior (all pure functions, unit tested):
  - Typed characters other than digits are dropped; spaces, dashes and parentheses are ignored. A `+` is accepted only as the first character of a paste.
  - **PH mode:** national number is exactly 10 digits and must start with 9. A leading `0` on an empty field is ignored while typing. A pasted `09123456789` (11 digits starting `09`) drops the `0`. A pasted `639123456789`, `+639123456789`, or `+63 912 345 6789` drops the `63`. Display groups as `912 345 6789`.
  - **Other countries:** a pasted `+<dial> ...` whose dial code matches the list (longest-prefix match) sets the selector and keeps the national digits. Generic rule below.
  - Pasted text that contains letters is rejected: the input keeps only the digits and shows the `badChars` hint text.
- Example hint under the field (always visible, `aria-describedby`): PH `Example: 917 123 4567` (a number that passes the weak-pattern rule, since the request's `912 345 6789` does not; decision D5). Other countries: no example (the format varies).
- Props: `id`, `name`, `label`, `value` (E.164 or legacy string), `onChange(e164String | "")`, `error`, `required`, `disabled`, `allowLandline` (PH landline mode, default false), `autoFocus`. Controlled; internally keeps `{iso, national}`. Emits `""` when the field is empty and `e164` when the parse is valid; emits the raw typed national text through an optional `onRawChange` so the parent can validate on blur.
- Used by: jobseeker onboarding Step 1 (primary) and Step 7 (secondary mobile); jobseeker Edit profile (primary and secondary mobile); employer onboarding; employer Edit profile; admin and superadmin Edit profile (same shared field); `ApplyPhoneStep`. The landline stays a plain tel input (decision D3). SPES `contactNumber` and recovery contact keep their controls for now (decision D3b; the server will accept both formats).

**Validation rules (client and server identical; server is the source of truth)**

Shared logic lives in `server/utils/phone.js` (extended, backward compatible) and its client mirror `client/src/utils/phone.js` (extended) plus `phoneIntl.js`. Both use the same country data and the same test vectors file.

| Country | Rule on the NATIONAL digits (after dropping one leading `0`/the dial code) | Stored |
|---|---|---|
| Philippines (+63) | exactly 10 digits, first digit 9; not a weak pattern (kept) | `+639XXXXXXXXX` |
| PH landline (only when `allowLandline`) | existing landline rule: area code 2-8, 8-10 digits including area code | `+63` + digits without the leading 0 |
| Any other country with a known dial code | 6 to 13 digits (national), total digits including the dial code at most 15 (E.164). One leading `0` is dropped (trunk prefix). Not all one repeated digit. | `+<dial><national>` |
| Unknown or missing dial code | rejected, `PHONE_COUNTRY_UNKNOWN` | none |

Valid examples: `+639171234567`, `917 123 4567`, `0917 123 4567` (PH, leading 0 dropped), `+1 415 555 2671`, `+44 7911 123456`, `+971 50 123 4567`. Invalid examples: `912 345 6789` and `0912 345 6789` (weak run, D5), `812 345 6789` (does not start with 9), `91712345` (short), `+63 9171234567890` (long), `0917-ABC-4567` (letters), `+999 123456` (no such code), `+1 111 111 1111` (all the same digit), `""` when required.

Server error codes (all via the existing `{ code, message, field: "phone" }` shape, which is already used at `applyGuards.js:27` and `authController.js:2227`, so NO new shape): keep `PHONE_REQUIRED`, `PHONE_INVALID`; add `PHONE_PH_FORMAT`, `PHONE_TOO_SHORT`, `PHONE_TOO_LONG`, `PHONE_BAD_CHARS`, `PHONE_WEAK`, `PHONE_COUNTRY_UNKNOWN`, `PHONE_LANDLINE_NOT_ALLOWED`. Each gets `errors.codes.*` in both locale files; the client maps them to `phoneInput.errors.*`.

**Where the server enforces it (new, additive)**

- `PUT /auth/profile` and `PATCH /auth/me` (`authController.updateProfile`): when `req.body.phone !== undefined` and non-empty, parse with the shared parser; on failure respond 400 `{ code, message, field: "phone" }`; on success store the E.164 string. Empty string keeps today's behavior (`commonUpdates.phone = ""` then the model; see D8 about whether an empty clears an existing phone: today a full-form save sends `""` when empty).
- `validateUserUpdate`, `validateUserRegistration` (`validation.js:97,331`): replace the loose regexes with the shared parser so the `/users/*` routes agree with `/auth/*`.
- `mobileSecondary` (`validation.js:143`, `authController.js:2300`): same parser, optional.
- `phoneProblem` / `isValidPhone` / `normalizePhone` keep their exported names and their current inputs; they gain legacy plus E.164 support. `normalizePhone` keeps returning the national `09...` form (the recovery controller stores that); a new `toE164(value)` and `parsePhone(value, { defaultIso })` are added.
- The flag-gated rules (required before regular apply, required to finish onboarding when `USERNAME_SIGNUP_ENABLED`) are unchanged. SPES stays exempt.

**Storage, display and old values**

- Canonical stored format for NEW saves: E.164 (`+639125826297`). `User.phone` stays a `String`; no schema change.
- Read both: `parsePhone` accepts `09125826297`, `9125826297`, `639125826297`, `+639125826297` (PH) and `+<dial>...`. A legacy PH landline `0422123456` parses as a landline and stays valid for the apply rule and contact share (existing behavior).
- Display helper `formatPhoneDisplay(stored)` (client) used by every consumer in section 3: PH mobile `+63 912 582 6297`; other countries `+<dial> <digits grouped in 3-4>`; unparseable legacy values shown exactly as stored (never hidden). `tel:` links use the E.164 string when parsable, else the stored text. The NSRP export prints the national `0912 582 6297` for +63 mobiles and the E.164 for other countries (D2).
- Existing accounts are not touched until their owner saves. Optional bulk migration: see section 8.

**Existing rules that stay:** valid by format only (no code), required before regular job apply (flag), SPES exempt, shared only after applying or via "Share my contact details".

### 5.3 WP3 Language table "All"

- New shared component `client/src/components/LanguageProficiencyTable.jsx` (new) replacing both copies. Props: `value` (the existing `languageProficiency` object), `othersLabel`, `onChange(nextValue)`, `onOthersLabelChange`, `disabled`, `idPrefix`. The two pages keep `form.languageProficiency` exactly as is; only the markup is shared.
- Pure helper `client/src/utils/languageProficiency.js`: `rowState(row)` returns `"all" | "some" | "none"`; `setRow(value, lang, checked)` sets all four flags; `toggle(value, lang, key)`.
- Layout: columns Language, All, Read, Write, Speak, Understand. The "All" checkbox sets `ref.indeterminate = true` when `rowState === "some"`; `aria-checked="mixed"` is native for `indeterminate` checkboxes; accessible name `All for English` / `All for Filipino` / `All for <Others label>` (when the Others label is empty: `All for other language`). Individual box names stay `English — Read` etc. Ticking "All" ticks the four; unticking clears the four; a click on an indeterminate "All" selects all.
- The "Others, specify" row: its All is enabled even before a label is typed, but the profile still stores flags without a label exactly as today (no new rule).
- Defaults unchanged: all rows unticked (`emptyLanguageRow`). No default ticks are added.
- 44 px targets (the checkbox itself plus its cell as the label area); at `max-width: 480px` each language becomes a stacked card (language name, then "All", then a 2x2 grid of Read/Write/Speak/Understand) instead of a horizontally scrolling table, because 6 columns do not fit 320 px (the current wrap `.onboarding-lang-table-wrap` scrolls horizontally inside its box).
- Separate class names (`.onboarding-lang-table`, `.lang-table`) are merged into one `lang-proficiency.css`; the old rules are removed in the same commit.
- Used in: jobseeker onboarding Step 5 and Edit profile (Career tab). Not used in `BasicRequirements`, `ProfilePage` (read-only list unchanged).

### 5.4 WP4 "Not applicable"

**Options (value and label; proposed wording, D7)**

| Field | New value | Label (en) | Filipino (review) |
|---|---|---|---|
| `workExperience` | `Not applicable` | Not applicable | Hindi naaangkop |
| `employmentStatus` | `not_applicable` | Not applicable (still studying / not yet graduated) | Hindi naaangkop (nag-aaral pa / hindi pa nakapagtapos) |
| `unemploymentReason` | `not_applicable` | Not applicable (not yet graduated) | Hindi naaangkop (hindi pa nakapagtapos) |

Placement: Work Experience: appended after "5+ years" (keeps the order of increasing experience; "Not applicable" last, with a hint line "For students and people who have not graduated yet."). Employment status: a third pill beside Employed and Unemployed in onboarding (Edit profile has "Prefer not to say" already; add Not applicable before it). Selecting status `not_applicable` hides Employment Type and Reason and clears them (and `laidoffCountry`). Reason: last item in the reason dropdown (for a student who still chooses "Unemployed"). `UNEMPLOYMENT_REASON_OPTIONS` in `client/src/constants/unemploymentReasons.js` gets the new item and a new constants file `client/src/constants/profileOptions.js` holds the work-experience list and the status list so onboarding and Edit profile stop duplicating them. Labels are looked up through i18n keys `profileOptions.*`.

**Required rules in the wizard:** Step 5 passes with `Not applicable` (counts as answered); Step 8 passes with status `not_applicable` and no type or reason. SPES applicants can finish the wizard.

**Matching (D6, behavior change, needs your confirmation)**

- Default: `Not applicable` is neutral. In `semanticService.experienceScore`, an applicant whose `workExperience` is `Not applicable` AND who has no work history returns `null` (experience dimension skipped, the same mechanism used when a job lists no experience requirement, `:370`), so the applicant is neither penalized nor treated as missing data. If the applicant has work history, years are computed from it as today. `bandToYears("Not applicable")` already returns `null` (Proven), so this is a small explicit branch, not a rewrite.
- The raw value is excluded from the similarity text (`semanticService.js:1072`) so "not applicable" tokens do not enter the embedding text.
- `canPersonalizeRecommendations` does not read `workExperience` (Proven); no change.
- Server profile completion (`profileCompleteness.js`) does not read these fields; client completion counts the value as answered (no change needed).

**NSRP Form 1 export (default D8): leave blank.** The official form has no "not applicable" box. For `employmentStatus: "not_applicable"` neither Employed nor Unemployed box is drawn (the code already draws only for exact `employed`/`unemployed`), the type boxes are not drawn, and the reason is not drawn (`UNEMPLOYMENT_REASON_BOX` has no key for `not_applicable`; the existing lookup already skips unknown keys). Work experience is not on the form. Never invent a value. A test pins this.

**Display:** a single label helper (`client/src/utils/profileLabels.js`, new) maps stored values to translated labels. `ProfilePage.jsx:714-721` and `:1258` use it; `UNEMPLOYMENT_LABELS` gains the new key. For `workExperience: "Not applicable"` the line ` · years of experience: ...` is hidden. `coverLetterDerivation.js:13` skips the `{years}` replacement when the value is `Not applicable`. `admin/UserProfileView.jsx:294` shows it as a normal value.

### 5.5 WP5 Wizard navigation

**Rule (pure function in `client/src/utils/wizardSteps.js`, new):**

`isStepComplete(i, state)` reuses the step checks that today live inside `handleNext` (extracted into `getStepErrors(i, state)` which returns field-keyed errors; the same function feeds WP2). Optional steps (6 and 9) are always complete. `reachability(state)` returns, for each step i: `reachable` when every REQUIRED step before i is complete; completed steps are always reachable; the current step is not a link. The user on Step 5 can click Step 1 (always reachable) and then Step 5 again (reachable because steps 1-4 are complete), or any step up to the first incomplete required step plus one.

**Behavior**

- Sidebar and mobile pills call one `goToStep(target)`: if reachable, save is implicit (the draft already persists on every change, Proven), clear any transient error, set `step`. No validation errors are shown when leaving.
- Locked steps use `aria-disabled="true"` (not `disabled`) so they stay in the tab order and can announce why: `aria-describedby` points at a sr-only reason ("Complete Personal Details first."), and pressing a locked step shows a polite status message under the step list (same text), not a modal.
- The current step keeps `aria-current="step"` and is not interactive (rendered as a button with `aria-disabled` or a non-link element; no self-navigation).
- Targets 44 px minimum (the desktop rail and the pills). The visible states: done (check), current, available (no check, enabled), locked (lock icon plus muted text). Contrast 4.5:1 for text.
- Previous and Next keep behaving exactly as today: "Back" and "Next" (`:1660-1665`). Next still validates the current step; with WP2 it shows inline errors and focuses the first invalid field.
- If an earlier step becomes incomplete after an edit (for example the user clears the phone on Step 1), later steps lock again immediately (the rule is recomputed on every render) and a polite status line under the step list says "Step 1 needs attention; later steps are locked until it is complete." If the user is currently on a later step when this is detected (draft restored from an older build), a banner at the top of the step says which earlier step needs attention with a button to go there.
- "Finish Setup" re-validates every required step with `getStepErrors` (today only step 8) and, if one fails, navigates to the first incomplete step and focuses the first invalid field. The server's own checks stay the authority.
- Mobile: keep the pills (they already exist at `max-width: 900px`), upgrade them to 44 px targets with locked and done states, `aria-label="Step N of 9: <label>, <completed|current|locked: complete X first>"`, and add a compact "Step 5 of 9: Work Background" header with a native `<select>` jump menu as an alternative for narrow screens (the pill row scrolls horizontally on a phone and hides most pills; a `<select>` is the most predictable pattern on 320 px). Decision D10 asks whether to ship the select or only the upgraded pills.
- Employer wizard (4 steps): default to include it (D11). Same `wizardSteps.js` helper with its own step rules; the rail items become buttons with the same states; its rail is not clickable today, so this is new behavior.
- The age-locked DOB and the SPES rules are not touched.

**Draft limits to tell the user (UI copy):** the draft is saved on this device only, and files chosen for the resume or ID must be re-selected after a reload. The rail text "Draft saved automatically" becomes "Draft saved on this device". No server-draft work is in scope (extra ideas).

---

## 6. Exact API and data changes (contract list)

All additive or tightening. Both mounts (`/api` and `/api/v1`) are served by the same router via `mountApiRoutes` (`server.js:441,630-631`), so every change below applies to both with no separate edits. Every item needs your sign-off before it is built (rule: stop and ask before any API contract change).

| # | Change | Request | Response | Backward compatible? |
|---|---|---|---|---|
| C1 | Server validates `phone` on `PUT /auth/profile`, `PATCH /auth/me` | `phone` string (legacy or E.164) | On bad value: 400 `{ code, message, field: "phone" }` with the new codes. On success `user.phone` stored as E.164 | Tightening: input that is accepted today and is not a plausible phone (for example `abc`) now returns 400. Valid legacy input is accepted and stored as E.164. |
| C2 | `validateUserUpdate` and `validateUserRegistration` call the shared parser | same | existing `{ errors, message }` shape, message text becomes the specific phone message | Tightening for `/users/*` |
| C3 | `mobileSecondary` validated with the shared parser | string | 400 `{code, message, field:"mobileSecondary"}` | Tightening; empty still allowed |
| C4 | New enum values: `User.workExperience` `"Not applicable"`; `JobseekerProfile.employmentStatus` `"not_applicable"`; `JobseekerProfile.unemploymentReason` `"not_applicable"` | those strings | stored and returned verbatim | Additive. Old values unchanged. |
| C5 | Allow-list validation for `employmentStatus`, `employmentType`, `unemploymentReason` on `/auth/profile` (today unenforced because `upsertProfile` skips validators) | the three fields | 400 `{ code: "ENUM_INVALID", message, field }` for a value outside the list | Tightening. Optional (D9b). Needed so the new values are not the only thing guarded. The allowed list includes every value already in the schema, including `"Prefer not to say"`. |
| C6 | `validateUserUpdate` employment and reason lists gain the new values (and `"Prefer not to say"`, which the schema already allows) | same | same | Additive |
| C7 | New error codes in `errors.codes.*` (en and fil) | n/a | n/a | Additive |
| C8 | OPTIONAL, NOT BUILT UNTIL YOU DECIDE (D9): additive `fieldErrors: { <field>: { code, params? } }` alongside the existing `message`/`errors` in validation responses | n/a | extra key | Additive; no existing client reads it |
| C9 | Matching: `experienceScore` returns `null` for `Not applicable` with no work history (D6) | n/a | different recommendation scores for that group of users | Behavior change, not a schema or status change |

Not changed: auth, role gating, status codes of existing success paths, any projection (`profileProjection.js`) or the fields shown to other viewers. Forbidden fields stay ABSENT from JSON. No new field carries phone text in any response.

Client localStorage draft keys: unchanged (`jobseekerOnboarding_<userId>`); the draft shape gains nothing (reachability is computed, not stored).

---

## 7. Migration plan

**Phones.** Not required for correctness: every consumer reads both formats (section 3), and each account's phone is rewritten to E.164 the next time its owner saves a valid number. A bulk script is provided as optional.

`server/scripts/migratePhonesToE164.js` (WRITTEN, NOT RUN; to be written during implementation, never run against a real database by the agent):

- Default is DRY RUN: it reads and prints a report (counts: already E.164, convertible, unparseable, empty) and writes a JSON report to `server/scripts/out/phone-migration-<timestamp>.json` (git-ignored). No writes happen without `--apply`.
- `--apply` first writes a BACKUP file `server/scripts/out/phone-backup-<timestamp>.json` containing `{ _id, phone, mobileSecondary }` for every document it will change, and refuses to continue if the backup cannot be written.
- Scope: `User.phone` and `JobseekerProfile.mobileSecondary`. Landlines, `fax`, SPES `contactNumber` and recovery fields are NOT touched. Unparseable values are left exactly as they are and listed in the report.
- Idempotent (re-running changes nothing already in E.164), supports `--limit N`, uses `updateOne` per document, reads `MONGODB_URI` from the environment (never printed).
- `--restore <backup-file>` writes the saved values back.
- Instructions for the human: (1) take a normal database backup, (2) run on a COPY or staging database first with no flag and read the report, (3) only then `--apply` on the target, (4) keep the backup file.

**Enums.** No data migration: new values are additive, old values remain valid. Two existing scripts must be updated so they do not mistake the new value for bad data: `server/scripts/migrateWorkExperienceLegacyValues.js:32` (`CURRENT_ENUM`) and `server/scripts/checkEnumDrift.js:35` (`workExperience`, and add `employmentStatus` and `unemploymentReason` if it is meant to cover them). They are edited, not run.

**Seeds and tests data.** `server/services/nsrpSampleData.js` and `server/scripts/testNsrpExport.js` keep their values; no new sample data is needed beyond a test fixture.

---

## 8. File-by-file change list

**New (client)**

| File | Purpose |
|---|---|
| `client/src/styles/form-field.css` | shared field, error, group, forced-colors styles (WP2) |
| `client/src/components/FormField.jsx` | wrapper and `FieldGroup` (WP2) |
| `client/src/utils/formErrors.js` | pure error model and server-error mapping (WP2) |
| `client/src/hooks/useFieldErrors.js` | error state, focus first invalid (WP2) |
| `client/src/constants/phoneCountries.js` | country name, ISO, dial code (WP1) |
| `client/src/utils/phoneIntl.js` | parse, normalize, format, paste handling (WP1) |
| `client/src/components/PhoneInput.jsx` + `client/src/styles/phone-input.css` | the control (WP1) |
| `client/src/components/LanguageProficiencyTable.jsx` + `client/src/utils/languageProficiency.js` + `client/src/styles/lang-proficiency.css` | WP3 |
| `client/src/constants/profileOptions.js` | work experience and status lists (WP4) |
| `client/src/utils/profileLabels.js` | label lookup (WP4) |
| `client/src/utils/wizardSteps.js` | step rules and reachability (WP5, shares rules with WP2) |
| `client/src/components/WizardStepNav.jsx` (optional, D10) | shared rail/pills/select for both wizards (WP5) |

**New (server)**

| File | Purpose |
|---|---|
| `server/data/phoneCountries.json` | mirror of the client list (parity test) |
| `server/utils/enumValues.js` | one list for status and reason values (C5, C6) |
| `server/scripts/migratePhonesToE164.js` | optional migration, written not run |

**Edited (server)**

| File | Change |
|---|---|
| `server/utils/phone.js` | add `parsePhone`, `toE164`, error-code detail; keep existing exports and behavior for legacy input |
| `server/middleware/validation.js` (`:97,:143,:172-183,:331`) | use the shared parser; add the new enum values |
| `server/controllers/authController.js` (`:2038-2044`, `:2220-2230`, `:2300`, `:2324-2326`) | validate and store E.164; enum allow-list (C5); `mobileSecondary` |
| `server/controllers/userController.js` (`:76`, `:88`, `:172-184`) | same parser and enums for `PUT /users/onboarding` and `/users/profile` |
| `server/controllers/contactShareController.js` (`:23`) | `isValidPhone` stays; confirm it accepts E.164 (it will via the shared parser) |
| `server/middleware/applyGuards.js`, `server/controllers/accountRecoveryController.js` | no behavior change; import path unchanged |
| `server/models/User.js` (`:224-232`) | enum gains `"Not applicable"` |
| `server/models/JobseekerProfile.js` (`:79-101`) | enums gain `"not_applicable"` |
| `server/services/semanticService.js` (`:305-319`, `:362-390`, `:1072`) | neutral handling (D6); open with `grep -a` / the editor, the file has a byte that trips plain grep |
| `server/services/nsrpFormService.js` (`:188`) | print the national PH form for E.164 `+63` mobiles; no new boxes |
| `server/scripts/migrateWorkExperienceLegacyValues.js`, `server/scripts/checkEnumDrift.js` | enum lists updated |

**Edited (client)**

| File | Change |
|---|---|
| `client/src/styles/design-system.css` | add `--ds-danger-ring` |
| `client/src/pages/onboarding/JobSeekerOnboarding.jsx` | PhoneInput (Step 1, Step 7 secondary), `LanguageProficiencyTable`, new options, WP2 inline errors replacing the modal for validation, `getStepErrors`, `WizardStepNav`/reachability, final-step validation of all steps, copy "Draft saved on this device" |
| `client/src/pages/onboarding/EmployerOnboarding.jsx` | PhoneInput, shared error pattern, step nav (D11) |
| `client/src/pages/EditProfile.jsx` | PhoneInput (primary shared field and secondary mobile), `LanguageProficiencyTable`, new options, WP2 validation |
| `client/src/components/ApplyPhoneStep.jsx` | PhoneInput and shared error pattern |
| `client/src/pages/ProfilePage.jsx` (`:95-103,:714-721,:1258`) | label helper, hide "years of experience" for Not applicable, formatted phone |
| `client/src/utils/coverLetterDerivation.js` (`:13`) | skip `{years}` for Not applicable |
| display places in section 3 | use `formatPhoneDisplay` |
| `client/src/constants/unemploymentReasons.js` | add `not_applicable` |
| `client/src/i18n/locales/en.json`, `fil.json` | namespaces `phoneInput`, `formErrors`, `langTable`, `profileOptions`, `wizardNav`, plus `errors.codes.PHONE_*` and `ENUM_INVALID` |
| every file in the WP2 migration list | shared field pattern |

**Edited (tests):** `server/tests/fixtures/phoneVectors.json` gains international and E.164 vectors (existing entries unchanged); the client phone test reads the same file.

---

## 9. Tests

**Server (jest, `server/tests/`, files named like the existing ones)**

- `phoneIntl.test.js`: PH 10-digit rule; 11-digit `09...` normalization; `63...` and `+63...` paste; rejected: letters, wrong start digit (`8`), too short, too long, weak runs; other countries (valid `+1`, `+44`, `+971`; invalid unknown dial code, too short, over 15 digits in total, all-same digit); one leading `0` dropped for non-PH; E.164 output; legacy PH landline still valid; legacy `09125826297` accepted and converted.
- Parity: `server/data/phoneCountries.json` equals the client list (a node test in the client suite imports both files, as `usernameSignupI18nParity.test.js` does for locales); both phone utils pass the SAME vectors file.
- Routes with `supertest`: `PUT /auth/profile` rejects `abc` with `{code, field:"phone"}` and stores E.164 for a valid number; `PUT /users/profile` and `PUT /users/onboarding` agree; both `/api` and `/api/v1` prefixes return identical results; `PATCH /auth/me` too; empty phone behavior pinned; the flag-gated apply guard and completion check still behave the same with E.164 stored and with legacy stored; SPES `contactNumber` unchanged.
- `profileEnumNotApplicable.test.js`: new values accepted and stored; every old value still accepted; unknown value rejected (C5) with `ENUM_INVALID`; `"Prefer not to say"` still accepted.
- Matching: extend `semanticService.dimensions.test.js` (existing file that already loads `semanticService`) with Not applicable plus no history returns `null` for `experienceScore`; with history uses history; Fresh Graduate unchanged; the similarity text excludes the value.
- NSRP export: with `employmentStatus: "not_applicable"` and reason `not_applicable`, none of the employed/unemployed/reason boxes are drawn (assert on the draw calls via the existing export test harness); with an E.164 `+63` phone the printed text is the national form; other-country number printed as E.164.
- Contact share and profile projection: phone passes through unchanged and is still ABSENT when not shared (regression).
- Heads up (from memory notes): `server/tests/server_tests.js` fails to load because of `natural` -> `afinn-165` (ESM) under Jest; that is a pre-existing problem and unrelated. The tests above avoid that file. The existing `semanticService.dimensions.test.js` loads `semanticService` successfully, so the matching test belongs there.

**Client (`node --test`, pure logic only, `client/src/utils/*.test.js`)**

- `phoneIntl.test.js`: typing and paste cases (the cases in 5.2), selector auto-set from a pasted `+<dial>`, longest-prefix dial match, example hint data, formatting groups, invalid combinations.
- `formErrors.test.js`: server-error mapping for the three shapes, first-invalid ordering, message fallback order (`formErrors.*` then `errors.codes.*` then server message).
- `languageProficiency.test.js`: `rowState` all/some/none, `setRow`, `toggle`.
- `wizardSteps.test.js`: reachability (Step 5 to 1 to 5 allowed when 1-4 complete; locked when an earlier required step is incomplete; optional steps 6 and 9 never block; editing step 1 to incomplete locks later steps); `getStepErrors` per step.
- `profileLabels.test.js`: labels for every stored value including the new ones and legacy `Prefer not to say`; `coverLetterDerivation` skips `{years}`.
- `formFieldsI18nParity.test.js`: every new key in `phoneInput`, `formErrors`, `langTable`, `profileOptions`, `wizardNav` and `errors.codes.PHONE_*` exists in both `en.json` and `fil.json` (pattern of `usernameSignupI18nParity.test.js`).

**Component behavior (not unit-testable today)**

The client has no React testing library or jsdom. The plan does NOT add one (D13 asks). Components are therefore covered by (a) pure-logic tests above (b) a written manual QA matrix, run at 1280, 768, 390 and 320 px: PhoneInput (keyboard, paste, selector search by name and code), shared error pattern (glow, icon, message, `aria-invalid`/`aria-describedby`, focus on first invalid field, reduced motion, forced-colors, screen-reader read-out), language All (all/some/none states, keyboard, 44 px), Not applicable flows for a SPES applicant end to end, wizard navigation (jump back and forth, locked reasons announced, mobile pills and select, Previous/Next unchanged). An automated browser pass with Playwright is possible only if you approve adding it (D13).

Run commands to use when building (listed, not run now): `cd server && npx jest tests/phoneIntl.test.js tests/profileEnumNotApplicable.test.js tests/semanticService.dimensions.test.js` and `cd client && npm test`, `npm run lint`, `npm run build`.

---

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The weak-pattern rule rejects the request's own example number and some real numbers (`09123456789`, `09876543210`) | Real users blocked; "valid" examples fail | D5: keep the rule, use a safe example, or relax only the ascending-run check. Decide before build. |
| Tightening `/auth/profile` (C1, C3, C5) rejects input that was accepted before | A save that used to succeed now returns 400 | Only for values that cannot be a phone or an enum member; messages are specific; old stored values are never re-validated on unrelated saves. The Edit profile full-form save sends the ORIGINAL phone back: a legacy value such as `0917 123 4567` re-parses fine; a legacy value that does not parse would block every Edit profile save (Suspected). Mitigation: skip phone validation when the submitted phone equals the stored phone (unchanged), the same pattern the DOB lock uses (`authController.js:2050`). |
| PH landline users (employers) cannot enter a landline as their primary phone | Employer onboarding blocked for a landline-only business | D3a: `allowLandline` for the employer control; mobile-only for jobseekers. |
| Generic international rule drops a leading `0` that belongs to the number (for example some Italian landlines) | Wrong number stored for rare cases | Documented; mobile numbers are the target; D4 asks whether to reject instead of drop. |
| Dial-code collisions (+1 US/CA, +7 RU/KZ, +44 UK/GG/JE/IM) | The pasted number picks the first country in the list | Match the longest dial prefix and prefer the first listed; the stored E.164 is identical either way. |
| Two copies of the country list (client and server) drift | Selector accepts what the server rejects | Parity test; one source file generated by hand-copy; no build step added. |
| WP2 touches about 90 files | Large diff, merge conflicts with `feat/profile-field-suggestions` and other branches | One commit per area; shared pieces first; rebase onto the merged suggestion branch before WP3-WP5 (see commit plan). |
| Removing the wizard modal changes a known flow | A user who relied on the modal sees inline errors instead | The modal stays for non-field failures; inline errors plus focus are clearer. |
| Draft is localStorage only | A user on another device or after clearing the browser loses the draft and the chosen files | Say so in the UI copy; no server draft in scope. |
| Matching change (D6) shifts scores for students | Different ranking for a group of users | Behavior is neutral by design; covered by tests; D6 asks for confirmation. |
| `semanticService.js` contains a byte that makes plain grep say "Binary file matches" | Edits made with a tool that treats it as binary can fail or miss lines | Use `grep -a` and the editor; do not reformat the file. |
| Tailwind appears in `client/package.json` devDependencies (see unrelated issues) | Rule says no Tailwind | New CSS is hand-written in `client/src/styles`; nothing in this plan uses it. |
| Filipino strings are drafts | Wrong or awkward wording | Flagged for native review; keys exist in both locales so nothing renders blank. |

---

## 11. Extra ideas (kept separate; not in scope)

1. Use `PhoneInput` for SPES `contactNumber` and the recovery contact phone, and re-normalize those on read.
2. A server-side wizard draft (autosave per step to the profile) so a draft survives device changes and files; this would be a contract and schema change.
3. Translate the remaining hardcoded English in the jobseeker and employer wizards (only a few strings use `t()` today).
4. A real SMS or OTP phone verification (explicitly excluded by the existing rule).
5. A `FormField`-based lint rule that flags a bare `<input>` without a label or `aria-describedby`.
6. A single shared `PillGroup` (radio-like buttons) with `role="radiogroup"` and arrow-key behavior instead of 31 hand-rolled pill rows.
7. Save-and-continue-later link in the wizard footer that jumps to the first incomplete step.
8. Show profile-completion hints that link to the exact incomplete field.
9. Add a Playwright smoke test for the wizard (needs approval for the dependency).

---

## 12. Unrelated issues noticed (not fixed)

1. `client/package.json` lists `tailwindcss` and `@tailwindcss/vite` in devDependencies and `client/package-lock.json` is modified in the working tree, while the project rule is no Tailwind (`vite.config.js` does not reference it, so it appears unused). Worth checking what changed in the lockfile.
2. `validateUserUpdate` rejects `employmentStatus: "Prefer not to say"` although `JobseekerProfile` allows it and Edit profile offers it (`validation.js:172` vs `JobseekerProfile.js:79`). It only affects `/users/*` routes, which the profile UI does not use.
3. `validateUserUpdate` name rule `^[a-zA-Z\s\-']+$` (`validation.js:86`) would reject names with `ñ`, periods or accents (common in Filipino names). It runs only on `/users/profile` and `/users/onboarding` (employer onboarding), where the employer name goes through it.
4. `JobseekerProfile` enums are not enforced on `/auth/profile` because `upsertProfile` (`authController.js:209`) has no `runValidators`; any string can be stored for `employmentStatus`, `unemploymentReason`, `civilStatus`-like fields. C5 only covers three fields.
5. NSRP export has no box for `lost_informal_work` (`nsrpFormService.js:137-144`), so that reason prints nothing.
6. The phone-required rules run only while `USERNAME_SIGNUP_ENABLED` is on; with it off, nothing on the server requires a phone at all (by design in `USERNAME_SIGNUP_PLAN.md`, but the onboarding UI requires it either way).
7. The request calls the wizard button "Previous"; in the code it is "Back".
8. `employmentStatus` display in `ProfilePage.jsx:714` capitalizes the raw stored string; `"Prefer not to say"` works only by accident.
9. `server/tests/server_tests.js` fails to load (pre-existing; recorded in memory).
10. The repo root has stray files (`ok.jsx`, `New Text Document.txt`, `debug.log`, `client/ksjdks.jsx`); not touched.

---

## 13. Proposed order and commit plan

Branch: do NOT build on `test/whitebox-audit` (it holds unrelated uncommitted test and black-box files). Create one new branch from `main`, for example `feat/profile-forms-overhaul`. If you want `feat/profile-field-suggestions` merged first (it touches the same two page files), merge it into `main` before starting, then rebase this branch before WP3.

One branch, one commit per work package, each commit building and passing its tests on its own:

1. **WP2 shared pieces** (`form-field.css`, `FormField`, `formErrors.js`, `useFieldErrors`, tokens, i18n `formErrors`) plus migration step 1 (the 14 forms that already use `aria-invalid`). Commit: `feat(forms): shared field error pattern`.
2. **WP2 migration** in logical commits by area (auth/signup, wizards, Edit profile, employer tools, SPES, admin/superadmin, settings/modals). Commit prefix `refactor(forms): migrate <area> to shared field errors`. These are optional to squash.
3. **WP1 phone**: server util and validators (C1-C3), country data both sides, `PhoneInput`, consumers and display helper, NSRP print, fixtures, tests, optional migration script. Commit: `feat(phone): country code selector with per-country validation`.
4. **WP3 language**: shared table, merged CSS, tests. Commit: `feat(profile): "All" select in the language proficiency table`.
5. **WP4 not applicable**: enums, validators (C4-C6), constants and labels, matching (C9, only after D6), NSRP checks, display fixes, scripts' enum lists, tests. Commit: `feat(profile): "Not applicable" options for students and non-graduates`.
6. **WP5 wizard navigation**: `wizardSteps.js`, nav component, jobseeker and employer wizards, final-step revalidation, mobile pattern. Commit: `feat(onboarding): free movement between completed wizard steps`.

Stop points (ask before continuing): before C1-C9 are built (contract sign-off), before D6 (matching), before any server error-shape change (D9), and before adding any dependency or test tooling (D13).

---

## My decisions

**Approved 2026-11-18: every default below is accepted as written.** Specifically: D5 keep the weak-pattern rule and use `917 123 4567` as the example hint; contract changes C1-C9 approved; D6 neutral matching; D3a employer landline allowed; D13 no new test dependencies; D14 new branch `feat/profile-forms-overhaul` from `main`, one commit per work package. Implementation has NOT started; it waits for an explicit go-ahead.

Each item has a recommended default. Reply with changes only; anything not changed uses the default.

- **D1. Canonical phone storage and old values.** Default: E.164 (`+639125826297`) for new saves; read both formats everywhere; existing values rewritten only when their owner saves; optional dry-run migration script, written but not run.
- **D2. Phone display format.** Default: PH mobile `+63 912 345 6789`; other countries `+<dial> <grouped digits>`; unparseable legacy values shown as stored; `tel:` links use E.164; the NSRP form prints the national `0912 345 6789` for +63 mobiles.
- **D3. Which fields use the new control.** Default: primary phone everywhere (jobseeker onboarding Step 1, Edit profile for all roles, employer onboarding, `ApplyPhoneStep`) AND the secondary mobile; the landline stays a plain input unchanged.
- **D3a. Employer landline.** Default: the employer control also accepts a PH landline (`allowLandline`); jobseekers are mobile-only. Alternative: mobile-only for everyone, which can block a landline-only business.
- **D3b. SPES `contactNumber` and recovery contact phone.** Default: keep their current controls in this change; the server accepts both formats; moving them is listed in extra ideas.
- **D4. Rule for non-Philippine numbers; phone library.** Default: no library; digits only, national part 6-13 digits (one leading `0` dropped), total at most 15 digits including the dial code, reject unknown dial codes and all-same-digit numbers. Alternative: reject a leading `0` instead of dropping it.
- **D5. The weak-pattern rule versus your example `912 345 6789`.** Today it is rejected (`23456789` is an ascending run; `09123456789` is an intentional invalid vector). Default: keep the rule (it blocks obvious fake numbers), and use `917 123 4567` as the example hint. Alternative: relax it so only all-same-digit tails are blocked (drop the ascending/descending-run check), which would accept your example; this changes the shared fixtures (`09123456789` moves from invalid to valid) and the apply guard behavior.
- **D6. Matching behavior for "Not applicable".** Default: neutral (experience dimension skipped when there is no work history; history still counts when present; the raw value is kept out of the similarity text). Alternative: treat like Fresh Graduate (0 years, which penalizes against jobs that require experience).
- **D7. Exact wording of the new options.** Default: Work Experience "Not applicable"; employment status "Not applicable (still studying / not yet graduated)"; reason "Not applicable (not yet graduated)"; stored values `Not applicable`, `not_applicable`, `not_applicable`. Filipino strings are drafts for native review.
- **D8. NSRP export for the new values.** Default: leave the boxes blank, never invent a value. Also: an empty submitted phone behaves as today (clears or keeps; I will confirm the current behavior in code first and keep it).
- **D9. Server error shape.** Default: do not change it. The client works with `{code, field}`, `{code}` plus a per-form field map, and form-level `{message}`/`{errors[]}`. Alternative (C8): add an optional `fieldErrors` object to validation responses. STOP and ask before any change.
- **D9b. Enum allow-list on `/auth/profile` (C5).** Default: add it for `employmentStatus`, `employmentType`, `unemploymentReason` only, with all existing values allowed. Alternative: skip it, leaving those fields unvalidated as today.
- **D10. Mobile step navigation.** Default: upgrade the existing numbered pills (44 px, locked and done states, full aria labels) and add a "Step N of 9" native `<select>` jump menu. Alternative: pills only.
- **D11. Employer wizard.** Default: include it (rail items become buttons with the same states). Alternative: jobseeker wizard only.
- **D12. Error message wording.** Default: the list in section 5.1 and the phone messages in 5.2 (specific, sentence case, no jargon). Edit the wording there if you prefer other text.
- **D13. Test tooling.** Default: no new dependencies; pure-logic tests with `node --test` plus the manual QA matrix. Alternative: approve React Testing Library with jsdom (and optionally Playwright) so components get automated tests.
- **D14. Branching.** Default: one new branch from `main` (`feat/profile-forms-overhaul`), one commit per work package (WP2 may use several commits for its migration). Alternative: one branch per package.
- **D15. Order of work.** Default: WP2 shared pieces first, then WP1, WP3, WP4, WP5.
- **D16. Draft wording.** Default: change "Draft saved automatically" to "Draft saved on this device" because the draft is local only.
- **D17. Skipped forms in WP2.** Default: the skip list in section 5.1 (search boxes, chat composers, range sliders, filter toolbars).
