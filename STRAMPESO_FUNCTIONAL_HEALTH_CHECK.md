# STRAMPESO - System Integrity & Functional Verification

**Check date:** 2026-09-30
**Scope:** Full repo — `server/` (Node/Express/MongoDB API) and `client/` (React/Vite SPA), with emphasis on verifying the reliability/security fixes applied earlier this session (crash handlers, `sendError`/`logger` migration, `/uploads` ownership check, TF-IDF caching, dependency bumps) did not regress any existing behavior.

---

## 1. Health Check Summary

**Overall status: PASS WITH WARNINGS**

Nothing in the recent code changes broke the build, the test suite, or any traced workflow. All warnings below are either pre-existing (predate this session) or configuration/documentation gaps, not functional breakage.

| Check | Result |
|---|---|
| Server: syntax check, all 90+ `.js` files | ✅ PASS — 0 syntax errors |
| Server: require-resolution smoke test (87 controllers/routes/middleware/models/services/utils/config modules loaded in isolation) | ✅ PASS — 0 broken imports, 0 missing exports |
| Server: `npm audit` | ✅ PASS — 0 vulnerabilities |
| Server: Jest suite (`npx jest`) | ⚠️ WARNING — 10/12 pass; 2 pre-existing failures, confirmed unrelated to any change this session (see §3) |
| Client: `npm run build` (Vite) | ✅ PASS — builds successfully (one non-blocking chunk-size warning) |
| Client: `npm run lint` (ESLint) | ⚠️ WARNING — 56 errors / 16 warnings, **all pre-existing**, none in files touched this session (see §3) |
| Environment variable consistency | ⚠️ WARNING — one new var undocumented, one dead documented var, one naming inconsistency in migration scripts (see §3) |
| **Unexpected working-tree changes** | 🔴 **FLAGGED — see note below, not caused by this session's work** |

**⚠️ Important — not a code-quality finding, a repo-state finding:** `git status` shows several files deleted in the working tree that this session never touched or deleted: `APPENDICES.pdf`, `SECURITY_AUDIT_REPORT.md`, and the entire `redesigned_home-about-footer_and_new_create_account/` directory (11 files). These deletions are **not staged and not committed** — they are recoverable right now with `git checkout -- <path>` or `git restore <path>`, but they will be lost if a commit is made without noticing. This report does not undo them, since they may be an intentional cleanup done outside this conversation. **Flagging this directly so it isn't accidentally committed if unintentional.**

---

## 2. Core Workflow Integrity Analysis

### Authentication & Access Control — ✅ PASS
Traced statically end-to-end in `server/controllers/authController.js`, `server/middleware/auth.js`, `server/models/User.js`:
- **Registration** (`register`, `registerEmployer`, `googleAuth`): duplicate-email race handled (unique index + `error.code === 11000` fallback), age gate enforced, email verification token issued and hashed before storage, no session token issued until verified — all intact.
- **Login** (`login`): timing-safe (bcrypt always runs, even for a nonexistent user via `DUMMY_PASSWORD_HASH`), correctly branches on staff-disabled / self-deactivated (auto-reactivates) / suspended (issues scoped appeal token) / unverified-email before issuing a normal session JWT. Unaffected by this session's changes — only its `catch` block's error response now routes through the new `sendError` helper instead of returning `error.message` directly; verified the `try` body logic is byte-for-byte unchanged.
- **Session destruction ("logout")**: there is **no server-side logout endpoint** — by design, this is a stateless-JWT app, so "logout" is the client discarding the token from `localStorage` (`client/src/context/AuthContext.jsx`). Server-side forced invalidation exists via `tokenVersion` (bumped on password change/reset, checked on every request in `verifyToken`/`optionalAuth`/the Socket.IO handshake) and `forceLogout()` (emits a socket event on suspend/deactivate/delete). This is expected behavior for the architecture, not a missing feature.
- **Role redirection**: role (`jobseeker`/`employer`/`admin`/`superadmin`) is embedded in the JWT and echoed in the login/register response `user.role`; route guards (`isJobseeker`, `isEmployer`, `isAdmin`, `isSuperadmin`, `authorizeRoles`) in `middleware/auth.js` are unchanged and still chain correctly after `verifyToken` on every route file (spot-checked `adminRoutes.js`, `jobRoutes.js`).
- **`/uploads` ownership check** (fixed this session): re-verified — `canAccessRef` is exported from `fileController.js` and correctly invoked from `server.js` with a fresh DB lookup for role/`isActive`/`tokenVersion` before any non-public file is served.

### Applicant & Job Management Flows — ✅ PASS
Traced `server/controllers/jobController.js`, `server/services/semanticService.js`, `server/routes/jobRoutes.js`:
- **Job application submission** (`applyToJob`): still wrapped in a Mongoose session/transaction (`JobApplication.startSession()` → `commitTransaction()` on success, `abortTransaction()`+`endSession()` on every early-return error path) — confirmed all four transaction-lifecycle call sites are intact after this session's edits.
- **Update/delete application** (`updateMyApplication`, `deleteMyApplication`): ownership checks (`application.applicant.toString() !== req.user.id`) intact; the storage-cleanup `.catch(() => {})` calls fixed this session now log context (application id, error) instead of silently swallowing — confirmed via `git diff` that only the `.catch` bodies changed, not the surrounding control flow.
- **Candidate ranking / relevance scoring**: `computeUnifiedScore` (structured scoring) is unchanged. The TF-IDF fallback (only reached when *no* structured qualification data exists for *any* candidate) was refactored into a cached `tfidfRank` wrapper this session — **manually verified with a live script**: identical inputs return identical scores on a cache hit (0ms), and a genuine content change (editing a candidate's profile text) correctly produces a fresh, different score rather than a stale cached one. No behavior change to score values, only to redundant recomputation.
- **Admin management views** (`adminController.js`): `getAllUsers`, `getAdminVacancies`, `getAuditLogs`, etc. use `escapeRegex`-sanitized search filters (no ReDoS exposure); `deleteUser` cascades correctly across `JobApplication`, `JobVacancy`, `Message`, `Conversation` before removing the `User` document — this cascade is **not wrapped in a transaction** (pre-existing, not introduced this session — see §4).

### Database & Data Persistence — ⚠️ PASS WITH WARNINGS
- **Connection resilience** (fixed this session): `config/db.js` now sets `serverSelectionTimeoutMS`, `socketTimeoutMS`, `maxPoolSize`; confirmed the app still connects and the test suite (which imports controllers that reference models) runs without error.
- **Schema/FK integrity**: Mongoose `ref` fields (`JobApplication.applicant → User`, `JobApplication.vacancy → JobVacancy`, etc.) are declared correctly across all inspected models; the unique compound index `{ applicant: 1, vacancy: 1 }` on `JobApplication` (preventing duplicate applications under a race) is untouched.
- **🔴 Unresolved from the prior security audit — re-confirmed still present:** six files under `server/scripts/` (`seedJollibeeJobs.js`, `unseedJollibeeJobs.js`, `migrateResidentRoleToJobseeker.js`, `migrateJobSalaryNumbers.js`, `migrateRequirementsToQualifications.js`, `migrateCompanySizeBands.js`) still contain the hardcoded MongoDB Atlas connection string (`mongodb+srv://alexis:ecjan05@...`) as a fallback. This was flagged Critical in the security audit; the code fix was never applied (only the credential-rotation recommendation was actioned, per your earlier decision to skip the code-level fix for now). Re-surfacing it here because it's squarely a "database interactivity" integrity concern: anyone running one of these scripts without `MONGODB_URI` explicitly set in their shell still silently connects to that hardcoded database.
- **Naming inconsistency found**: these same 6 scripts check `process.env.MONGODB_URI`, while the live app (`config/db.js`) and `.env.example` use `process.env.MONGO_URI`. A developer who only ever sets `MONGO_URI` (the documented variable) will have these scripts silently fall through to the hardcoded fallback above even after rotating the password and updating `.env` — because they're reading the wrong variable name entirely. This compounds the finding above.

---

## 3. Identified Broken Features or Regressions

**None caused by this session's changes.** Every item below is either pre-existing or a documentation/config gap, listed for completeness per the requested report structure.

| # | Item | File(s) | Status |
|---|---|---|---|
| 1 | `MAX_FILE_SIZE` test expects 15MB, actual constant is 5MB | `server/middleware/upload.js:18` vs `server/tests/server_tests.js:65` | **Pre-existing failure**, confirmed via `git stash` to reproduce identically on the pre-session codebase. Either the test or the constant is stale — not something this session touched. |
| 2 | Field-name mismatch: test expects `businessPermit`, code returns `businessPermitUrl` | `server/controllers/authController.js` (`getDocumentFieldRemovals`) vs `server/tests/server_tests.js:69` | **Pre-existing failure**, same `git stash` confirmation. The function itself was not touched this session (only its file's unrelated `catch` blocks were). |
| 3 | 56 ESLint errors / 16 warnings on `client/` | Scattered across `client/src/pages/**`, `client/src/components/**` (see full list in lint output) | **All pre-existing.** Mostly `no-unused-vars` (unused `error`/`err` catch bindings, destructured-but-unused fields) and the newer `eslint-plugin-react-hooks` v7 rules (`react-hooks/refs`, `react-hooks/set-state-in-effect`) flagging patterns that were allowed under the previous plugin version. None are in files this session modified. |
| 4 | `SHOW_ERROR_DETAILS` (new env var, introduced this session in `server/utils/sendError.js`) is not documented in `server/.env.example` | `server/.env.example` | **Gap introduced this session** — functional impact is none (defaults safely to hiding error details), but it should be documented so a future developer knows the flag exists for local debugging. |
| 5 | `BASE_URI` is documented in `.env.example` but never read anywhere in `server/` | `server/.env.example:5` | Pre-existing dead config entry, unrelated to this session. |
| 6 | `MONGODB_URI` vs `MONGO_URI` naming inconsistency in 6 migration/seed scripts | `server/scripts/{seedJollibeeJobs,unseedJollibeeJobs,migrateResidentRoleToJobseeker,migrateJobSalaryNumbers,migrateRequirementsToQualifications,migrateCompanySizeBands}.js` | Pre-existing, re-surfaced above (§2, Database) because it compounds the still-open hardcoded-credential finding. |
| 7 | `adminController.deleteUser` cascading delete across 5 collections is not wrapped in a MongoDB transaction | `server/controllers/adminController.js:1170-1182` | Pre-existing. A crash mid-`Promise.all` could leave orphaned `JobApplication`/`Message`/`Conversation` documents after the `User` itself is deleted (or vice versa, depending on which promise settles first). Not introduced this session. |
| 8 | No routes or documents reference a `logout` endpoint | *(absence, not a bug)* | Confirmed intentional — stateless JWT design; see §2. Documenting here only because Phase 2 of this check explicitly asked to trace "session destruction." |

No broken route references, no missing controller exports, and no unhandled-import failures were found — the full require-resolution smoke test (87 modules: every file under `controllers/`, `routes/`, `middleware/`, `models/`, `services/`, `utils/`, `config/`) loaded successfully with zero errors.

---

## 4. Immediate Action Items to Restore System Stability

1. **Decide on the unexpectedly-deleted files** (`APPENDICES.pdf`, `SECURITY_AUDIT_REPORT.md`, `redesigned_home-about-footer_and_new_create_account/*`) before your next commit. They're currently only working-tree deletions (recoverable via `git restore <path>`) — if this wasn't intentional, restore now; if it was a deliberate cleanup, no action needed, just confirm before it gets committed and becomes harder to reverse.
2. Add `SHOW_ERROR_DETAILS=true` (commented out, like the other optional flags) to `server/.env.example` with a one-line explanation, so the flag introduced this session is discoverable.
3. Fix the `MONGODB_URI`/`MONGO_URI` naming inconsistency in the 6 affected scripts (standardize on `MONGO_URI` to match the live app and `.env.example`), and remove the hardcoded credential fallback in the same pass — this closes both the naming footgun and the still-open Critical finding from the security audit in one edit.
4. Reconcile the 2 pre-existing test failures in `server/tests/server_tests.js` — either update `MAX_FILE_SIZE`'s expected value to match the actual 5MB constant (or vice versa, if 15MB was the intended limit), and update the `businessPermit`/`businessPermitUrl` expected key to match the current field name.
5. Triage the 56 client ESLint errors at a convenient time — mostly mechanical (unused catch-block bindings can drop the unused parameter entirely; the `react-hooks/set-state-in-effect` and `react-hooks/refs` findings in `GoogleSignInButton.jsx`, `InterviewScheduleModal.jsx`, and `JobSearchFilters.jsx` reflect real (if usually benign) React anti-patterns worth a closer look since they can cause extra re-renders).
6. Remove `BASE_URI` from `.env.example` (or wire it up if it was meant to do something) so the documented config surface matches what the app actually reads.
7. Consider wrapping `adminController.deleteUser`'s multi-collection cascade in a Mongo transaction (`session.withTransaction`) the same way `jobController.applyToJob` already does, so a crash mid-delete can't leave orphaned records.
