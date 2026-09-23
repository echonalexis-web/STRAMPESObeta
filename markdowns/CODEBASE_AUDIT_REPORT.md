# STRAM PESO — Codebase Audit Report

**Scope:** Full static audit of the STRAM PESO employment/SPES platform — Express 4 + Mongoose/MongoDB backend (`server/`, 100 files: 22 routes, 23 controllers, 19 models, 8 services, 4 middleware) and React 19 + Vite frontend (`client/src`, 109 files: 45 pages, 35 components, 5 hooks, 10 utils, i18n, 35 stylesheets).

**Method:** Four parallel deep-read passes (backend core/security, backend routes/controllers/models, frontend pages/routing, frontend components/hooks/styles) covering effectively every file in scope, cross-referenced and deduplicated below. Every finding cites exact file/line and is labeled **Confirmed** (verified directly from code) or **Potential issue** (reasoned from code, exploitability depends on an environment/runtime factor not verifiable statically).

**Headline numbers:** 6 Critical, 13 High, 20 Medium, 15 Low findings.

> Context: this is a capstone project for the PESO Marinduque office (not a company with a dedicated security team), client on Vercel, server on Render. Recommendations are scoped accordingly — prioritize the Critical/High items before the next deploy; Medium/Low can be tracked as a backlog.

---

## Application Map

**Backend** (`server/server.js` entrypoint): Express app with helmet, CORS, rate limiting, `express-mongo-sanitize`, custom XSS/body sanitization, Socket.IO (JWT-authenticated), and versioned (`/api/v1`) + legacy (`/api`) route mounting. Major domains: auth (`authController`/`authRoutes` — JWT + Google Sign-In), users/profiles (jobseeker & employer), jobs (`jobController` **and** a parallel `employerController` job-CRUD path), applications (`JobApplication`), SPES scholarship applications (`spesController`, `SpesApplication` — separate flow with announcements/results), messaging (`messageController`, `Conversation`/`Message`, Socket.IO real-time), follows/likes, news feed, notifications, file storage (`storageService` — local disk by default, Cloudinary optional), admin/superadmin console (user management, verification queue, audit trail, moderation, reports/analytics).

**Frontend** (`client/src`): React Router v7 SPA. Critical user journeys: Register → email verify → onboarding (jobseeker or employer, multi-step with required avatar upload) → Dashboard/Job Board → apply to job / SPES program → Messages ↔ employer → notifications. Employer journey: Register → onboarding → Post Job → Employer Dashboard (ranked applicants, status changes, interview scheduling) → Messages. Admin: User Management, Employer Verification, Job Monitoring, SPES Applications, Audit Trail, Reports/Analytics, Moderation. State: `AuthContext` (JWT + user in localStorage, cross-tab sync), `SocketContext` (Socket.IO client), `services/api.js` (axios instance + 401 interceptor).

---

## Summary Table

| # | Severity | Category | Status | File(s) | Recommendation |
|---|---|---|---|---|---|
| CRIT-1 | Critical | IDOR / PII exposure | Confirmed | `server/controllers/userController.js`, `server/routes/userRoutes.js` | Remove/restrict `GET /api/users/:id`; require ownership or admin role |
| CRIT-2 | Critical | Broken access control | Confirmed | `server/server.js` (`/uploads` gate) | Replace header-presence check with real `jwt.verify` + ownership check |
| CRIT-3 | Critical | Broken user journey | Confirmed | `client/src/routes/ProtectedRoute.jsx`, both onboarding pages | Make redirect guard aware of in-progress "just finished" state |
| CRIT-4 | Critical | Broken UI / dead code | Confirmed | `client/src/pages/Home.jsx` | Wire `onClick={() => handleViewJob(job)}` to job cards |
| CRIT-5 | Critical | Crash risk | Confirmed | `client/src/i18n/index.js` | Wrap `localStorage` access in try/catch |
| CRIT-6 | Critical | Real-time data bug | Confirmed | `client/src/hooks/useFollow.js`, `useJobLike.js` | Use named handler refs with `socket.on/off`, not bare event-name `.off()` |
| HIGH-1 | High | Session security | Confirmed | `server/controllers/authController.js`, `middleware/auth.js` | Add `tokenVersion`/`passwordChangedAt`, invalidate JWTs on password change |
| HIGH-2 | High | Sensitive data exposure | Confirmed | `server/controllers/adminController.js` (3 endpoints) | Add `.select("-password ...")` to all 3 queries |
| HIGH-3 | High | Race condition | Confirmed | `server/models/JobApplication.js`, `jobController.js` | Add unique compound index `{applicant, vacancy}`, handle code 11000 |
| HIGH-4 | High | PII exposure | Confirmed | `server/routes/followRoutes.js`, `followController.js` | Require auth on follower list routes, drop `email` from populate |
| HIGH-5 | High | Maintainability/security drift | Confirmed | `jobController.js` vs `employerController.js` | Consolidate duplicate job-CRUD authorization logic |
| HIGH-6 | High | ReDoS / DoS | Potential | `recommendationController.js`, `newsController.js` | Escape regex metacharacters before `$regex` queries |
| HIGH-7 | High | Broken UX / stuck state | Confirmed | `client/src/pages/Register.jsx` | Reset `loading` in a `finally` block |
| HIGH-8 | High | Race condition | Potential | `client/src/pages/JobBoard.jsx` | Add AbortController/ignore-flag + disable search while loading |
| HIGH-9 | High | Race condition / data integrity | Potential | `client/src/hooks/useRankedApplicants.js`, `EmployerDashboard.jsx` | Guard against stale job-id responses |
| HIGH-10 | High | Memory/state leak | Confirmed | `client/src/pages/EmployerDashboard.jsx` (×6) | Clear the 6 unmanaged `setTimeout` calls on unmount |
| HIGH-11 | High | Mobile layout break | Confirmed | `client/src/components/GoogleSignInButton.jsx`, `auth.css` | Compute button width from container, add `max-width:100%` backstop |
| HIGH-12 | High | Accessibility + validation gap | Confirmed | `client/src/components/FileDropzone.jsx` | Add keyboard handler + client-side file validation |
| HIGH-13 | High | Memory leak / perf | Confirmed | `client/src/components/RankedApplicantsTable.jsx` | Fix scroll-listener cleanup; add pagination/virtualization |
| MED-1 | Medium | User enumeration | Confirmed | `server/controllers/authController.js` (`login`) | Use one generic error message + constant-time comparison |
| MED-2 | Medium | Config risk | Potential | `server/server.js` (rate limiter gating) | Gate disabling only on explicit flag, not `NODE_ENV !== "production"` |
| MED-3 | Medium | Auth gap | Confirmed | `server/server.js` (Socket.IO `io.use`) | Check `isActive`/account status in socket auth, not just JWT signature |
| MED-4 | Medium | CORS risk | Potential | `server/server.js` (`ALLOW_VERCEL_PREVIEWS`) | Avoid wildcard subdomain trust combined with `credentials:true` |
| MED-5 | Medium | Upload validation | Confirmed | `server/middleware/upload.js`, `storageService.js` | Validate file content (magic bytes), not just client-declared MIME |
| MED-6 | Medium | Data integrity | Confirmed | `server/middleware/validation.js` (global sanitizer) | Exclude password/token fields from XSS-escaping/trim |
| MED-7 | Medium | Performance | Confirmed | `JobApplication.js`, `Conversation.js`, `Message.js` | Add indexes on `applicant/vacancy`, `participants`, `conversationId` |
| MED-8 | Medium | Regex DoS (internal) | Potential | `adminController.js`, `verificationController.js`, `messageController.js` | Escape regex input on admin/authenticated search endpoints |
| MED-9 | Medium | Unbounded query | Confirmed | `followController.js`, `jobLikeController.js` | Clamp `limit` query param |
| MED-10 | Medium | Business logic | Confirmed | `messageController.js` (`deleteConversation`) | Soft-delete per participant instead of hard delete for both |
| MED-11 | Medium | Data correctness | Confirmed | `jobController.js` vs `employerController.js` field whitelists | Consolidate (same fix as HIGH-5) |
| MED-12 | Medium | Stale UI state | Confirmed | `client/src/components/SearchableDropdown.jsx` | Sync `searchText` when `value` prop changes externally |
| MED-13 | Medium | Accessibility | Confirmed | `EmployerModal.jsx`, `Modal.jsx` | Add Escape-to-close, focus trap, `role="dialog"` |
| MED-14 | Medium | Mobile UX | Potential | `client/src/components/Navbar.jsx`, `navbar.css` | Lock body scroll + `overscroll-behavior: contain` on mobile menu |
| MED-15 | Medium | Touch target size | Confirmed | `client/src/styles/vacancy-card.css` | Increase favorite-button hit area to ≥44px |
| MED-16 | Medium | Upload UX | Confirmed | `client/src/components/SpesPanel.jsx` | Add client-side size/type validation before upload |
| MED-17 | Medium | Dead code | Confirmed | `client/src/pages/Profile.jsx` | Delete unused duplicate of `ProfilePage.jsx` |
| MED-18 | Medium | Redundant network calls | Confirmed | `client/src/pages/Login.jsx`, `AuthContext.jsx` | Await one `login()` call instead of firing 3 profile fetches |
| MED-19 | Medium | Missing debounce | Confirmed | `client/src/pages/NewsFeed.jsx` | Debounce search input ~300ms |
| MED-20 | Medium | Missing pagination | Confirmed | `client/src/pages/admin/UserManagement.jsx` | Add server-side pagination (backend already supports it) |
| LOW-1 to LOW-15 | Low | Various (see detail) | Mixed | Multiple | See detailed section below |

---

## CRITICAL

### CRIT-1 — Unrestricted IDOR on `GET /api/users/:id` exposes any user's full PII
**Files:** `server/controllers/userController.js:278-289` (`getUserById`), `server/routes/userRoutes.js:68`

```js
exports.getUserById = async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");
  let profile = null;
  if (user.role === "resident") profile = await JobseekerProfile.findOne({ userId: user._id });
  else if (user.role === "employer") profile = await EmployerProfile.findOne({ userId: user._id });
  res.json({ user, profile });
};
```
Route is guarded only by `protect` + `validateMongoId` — **no ownership or role check**. Any authenticated user (resident, employer, or admin) can fetch any other user's full record by ID.

**Why it matters:** Returns home address, DOB, TIN, SSS/GSIS, PhilHealth, Pag-IBIG numbers, disability status, 4Ps beneficiary flag, phone number, and stored-file paths (`resumeFile`, `validIdFile`, `businessPermitUrl`, `registrationDocUrl`). This bypasses the deliberately narrow `employerController.getConnectedJobseekerProfile`, which correctly restricts employer access to only their own applicants/followers. IDs are easy to harvest from applicant/follower lists. **Chains directly into CRIT-2** — the leaked file paths can then be fetched from `/uploads` with no real credential.

**Reproduce:** `curl -H "Authorization: Bearer <any-valid-token>" .../api/users/<any-mongo-id>` → 200 with full profile.

**Fix:** Remove the unrestricted route or scope it to self-only (`getProfile`); route any legitimate cross-user lookup through the existing vetted-relationship checks, or gate a superset behind `isAdmin`.

**Test:** As resident with no relation to employer X, `GET /api/users/:employerXId` should 403/404, not 200.

---

### CRIT-2 — `/uploads` static file route has no real authentication
**File:** `server/server.js:222-247`

```js
app.use("/uploads", (req, res, next) => {
  const authHeader = req.headers.authorization;
  const isPublicImage = req.path.includes("/profiles/") || req.path.includes("/news/");
  if (!isPublicImage && !authHeader) {
    return res.status(403).json({ message: "Access denied" });
  }
  ...
  next();
});
app.use("/uploads", express.static(path.join(__dirname, "uploads"), { ... }));
```
The gate only checks that **some** `Authorization` header string is present — it never calls `jwt.verify()` (unlike `middleware/auth.js`) and performs **no ownership check** against the requested file. `Authorization: Bearer x` (garbage) satisfies it.

**Why it matters:** This is the default storage driver (`STORAGE_DRIVER=local`) for resumes, valid IDs, business permits, registration docs, and SPES documents — served with effectively zero access control, unlike the careful ownership logic in `fileController.canAccessRef` (used only for the Cloudinary signed-URL path). Combined with CRIT-1 (which leaks the file path strings for any user), an attacker can: (1) `GET /api/users/:id` to obtain another user's document path, then (2) fetch it directly from `/uploads/<path>` with a bogus header — a complete PII/document exfiltration chain. Filenames are random UUIDs, so blind enumeration isn't feasible, but a leaked/shared URL (browser history, screenshot, referrer, or the CRIT-1 chain) is fully exploitable.

**Fix:** Route local-storage reads through the same real `jwt.verify` + ownership check `fileController.canAccessRef` already implements for Cloudinary, instead of a bare header-presence check.

**Test:** `GET /uploads/resumes/<known-file>` with `Authorization: Bearer garbage` should be rejected; only the verified owner/admin should succeed.

---

### CRIT-3 — Onboarding success/required-step screen never renders — `ProtectedRoute` races the onboarding page's own guard
**Files:** `client/src/routes/ProtectedRoute.jsx:52-54`, `client/src/pages/onboarding/JobSeekerOnboarding.jsx:671-677,1532-1542`, `client/src/pages/onboarding/EmployerOnboarding.jsx:182-188,380-409`

```jsx
// ProtectedRoute.jsx
if (location.pathname === "/onboarding" && hasCompletedOnboarding === true) {
  return <Navigate to={getDefaultRouteByRole(userRole)} replace />;
}
```
Both onboarding pages track a local `finished` flag specifically to stop their *own* redirect effect from firing before the success/avatar-upload screen renders. But `ProtectedRoute` — the parent wrapper — has an independent copy of the same check with no `finished` awareness. The instant `submitProfile()` calls `login()` (updating `AuthContext.user.hasCompletedOnboarding` to `true`), `ProtectedRoute` re-renders as a context consumer and replaces the whole subtree with `<Navigate>`, unmounting the onboarding component before `SUCCESS_STEP` (jobseeker) or the required avatar-upload step (employer) ever paints.

**Why it matters:** Every employer is silently skipped past the "Attach profile picture — Required, appears on your job posts" step; every jobseeker never sees the completion confirmation. Data is saved, so it's not data loss, but it's a confirmed regression in the first-run flow for both account types.

**Fix:** Make the `ProtectedRoute` redirect aware of an in-progress "just finished, showing final step" state (lift a ref/flag into `AuthContext`, or only redirect away from `/onboarding` on a *fresh mount* where `hasCompletedOnboarding` was already `true`, not on the render immediately following `login()`).

**Test:** Complete jobseeker/employer onboarding end-to-end; assert the success/avatar-upload step is actually visible before any navigation occurs.

---

### CRIT-4 — Homepage job cards are completely unclickable (dead handler)
**File:** `client/src/pages/Home.jsx:178-182,309-337`

```jsx
const handleViewJob = (job) => {
  const jobId = job?._id || job?.id;
  if (!jobId) return;
  navigate(`/jobs/${jobId}`);
};
...
<article key={jobId} className="jobs-design-card">
  ...
  <button type="button" className="jobs-design-details">Details <FaArrowRight /></button>
</article>
```
`handleViewJob` is defined but never wired to anything — no `onClick` on the card or the "Details" button — despite the section header reading *"Select a card to view the full posting."*

**Why it matters:** The homepage — first thing every visitor sees — advertises clickable job cards that do nothing.

**Fix:** Add `onClick={() => handleViewJob(job)}` to the card/button.

**Test:** Click a featured job card on `/`, assert navigation to `/jobs/:id`.

---

### CRIT-5 — Unguarded `localStorage` read at i18n module load can blank the entire app
**File:** `client/src/i18n/index.js:8,23`

```js
const storedLanguage = localStorage.getItem(STORAGE_KEY);
```
This runs synchronously at import time, before React mounts. In Safari private browsing, storage-blocked in-app browsers, or locked-down public terminals (plausible for a PESO office's public-access kiosks), `localStorage` access throws a `SecurityError`, aborting the module graph before the router or `AuthContext` ever render.

**Why it matters:** A user on a storage-restricted device gets a blank white screen with no error UI — the whole app is unusable, not just language selection. Notably, `usePersistentState.js` elsewhere in this same codebase already guards this exact API, making this an inconsistency rather than an unknown risk.

**Fix:**
```js
let storedLanguage;
try { storedLanguage = localStorage.getItem(STORAGE_KEY); } catch { storedLanguage = null; }
```
Apply the same guard to the `setItem` call in the `languageChanged` handler at line 23.

**Test:** Mock `localStorage.getItem` to throw; assert `i18n/index.js` still exports a working instance defaulting to `"en"`.

---

### CRIT-6 — Socket listener cleanup in `useFollow`/`useJobLike` deregisters *every* mounted instance's listeners
**Files:** `client/src/hooks/useFollow.js:59-62`, `client/src/hooks/useJobLike.js:52-55`

```js
return () => {
  socket.off("job:liked");
  socket.off("job:unliked");
};
```
`socket.off(eventName)` with no handler reference removes **every** listener registered for that event on the shared socket, not just this instance's. `useJobLike` runs once per `<JobFavoriteButton>`, and job cards are rendered in lists (Job Board, Dashboard) — many instances share one socket at once.

**Why it matters:** On the Job Board with, say, 20 visible cards, if any single card unmounts (pagination, filter change, navigating away and back) its cleanup silently deregisters the real-time like/follow listeners for **every other still-mounted card**. Their counts stop updating live until a full remount — a silent, hard-to-diagnose regression under completely normal browsing. `useNotifications.js` in this same codebase already demonstrates the correct pattern (named handler refs).

**Fix:**
```js
const onLiked = useCallback((data) => { ... }, [jobId]);
useEffect(() => {
  socket.on("job:liked", onLiked);
  return () => socket.off("job:liked", onLiked);
}, [socket, onLiked]);
```

**Test:** Mount two `useJobLike` instances against a mocked socket, unmount the first, emit `job:liked` for the second's job, assert its state still updates.

---

## HIGH

### HIGH-1 — Password change/reset does not invalidate previously-issued JWTs
**Files:** `server/controllers/authController.js:342-388,437-484`, `server/middleware/auth.js:7-63`

Login issues a 30-day JWT containing only `{id, role}`. Nothing rotates a session-invalidating value (no `tokenVersion`/`passwordChangedAt`), and `verifyToken` never checks one — only `isActive`/`accountStatus`. An attacker holding a stolen token keeps full access for up to 30 days after the legitimate user "resets" their password, defeating the entire point of that recovery flow. Same gap applies to admin-forced password resets.

**Fix:** Add `tokenVersion` to `User`, embed it at sign time, bump on every password change/reset, reject mismatched tokens in `verifyToken`/`optionalAuth`/the socket `io.use` handler.

**Test:** Log in, capture token, reset password, replay old token against a protected route — expect 401 (currently 200). **Status:** Confirmed.

### HIGH-2 — Password hash returned to client on 3 admin endpoints
**File:** `server/controllers/adminController.js:961-1126` (`updateUserRole`, `deactivateUser`, `reactivateUser`)

```js
const user = await User.findById(id);   // no .select("-password")
...
return res.json({ message: "...", user });   // full doc incl. bcrypt hash
```
None of these three queries exclude `password`, and `User.js` has no `select:false` on it either — unlike `getUserProfileDetails` (same file) and `superadminController.js`'s `toAdminView()`, which both correctly whitelist. The bcrypt hash (plus hashed reset/verification tokens) reaches the admin's browser, devtools, and any logging middleware, on every role change/suspend/reactivate.

**Fix:** Add `.select("-password -passwordResetToken -emailVerificationToken -emailChangeToken")` to all three; add `select:false` to the schema as defense-in-depth.

**Test:** Call each endpoint as admin, assert no `password` key in the response. **Status:** Confirmed.

### HIGH-3 — No unique index on `JobApplication` → duplicate-apply race condition
**Files:** `server/models/JobApplication.js` (no index), `server/controllers/jobController.js:505-607`

The apply flow does find-then-create inside a transaction with no unique compound index backing it (contrast `SpesApplication`, which correctly has `.index({applicant, announcement}, {unique:true})` and handles code 11000). Two rapid "Apply" clicks (double-submit on a slow connection, or a script) can create two `JobApplication` rows for the same user/job, corrupting applicant counts and duplicating employer notifications.

**Fix:** `jobApplicationSchema.index({applicant:1, vacancy:1}, {unique:true})`; handle `error.code === 11000`.

**Test:** Fire two concurrent applies for the same user/job, assert only one document exists. **Status:** Confirmed.

### HIGH-4 — Public, unauthenticated follower/following lists leak emails
**Files:** `server/routes/followRoutes.js:17-20`, `server/controllers/followController.js:115-202`

`GET /:userId/followers` / `/following` / `/counts` have no `protect` middleware, and the controller populates `select: "name email role profileImage"`.

**Why it matters:** Any unauthenticated visitor can scrape the name + email of every resident following any employer — a straightforward PII harvesting vector for spam/phishing.

**Fix:** Require `protect`; drop `email` from the populated fields.

**Test:** `GET /api/follows/:id/followers` with no auth header should be rejected, or at minimum contain no `email`. **Status:** Confirmed.

### HIGH-5 — Duplicate job-CRUD authorization code paths (security-drift risk)
**Files:** `server/controllers/jobController.js` vs `server/controllers/employerController.js`

Two independently-written implementations of employer job management (`createJob`/`updateJob`/`deleteJob`/`getEmployerJobs`) exist, called by different frontend surfaces, each with its own hand-rolled ownership check and field whitelist. Both are currently correct, but any future authorization fix applied to one silently won't apply to the other — exactly the pattern that produces IDOR bugs like CRIT-1 over time. Already produces a real correctness divergence — see MED-11.

**Fix:** Consolidate to one controller/route for job CRUD, or extract shared ownership-check/whitelist logic into one helper used by both. **Status:** Confirmed (duplication verified; no active divergent-auth bug found today, but the pattern is fragile).

### HIGH-6 — Public unescaped `$regex` search endpoints (ReDoS / algorithmic-complexity risk)
**Files:** `server/controllers/recommendationController.js:54,66-69` (public `hybridSearch`), `server/controllers/newsController.js:130-133` (public `listNews`)

User-supplied `location`/`q`/`search` flow straight into `$regex` filters unescaped (contrast: `adminController.js` defines `escapeRegex`/`escapeRegExp` but doesn't use them here). Global `sanitizeQueryParams` strips `[](){}$` from query strings, which blocks grouping-based catastrophic backtracking but not all pathological patterns (e.g. long `.*` chains), so risk is reduced but not eliminated.

**Fix:** Escape user input before building `$regex` filters (reuse the existing helper); cap input length; consider text indexes instead of `$regex` for free-text search.

**Test:** Send a long pathological search string to both public endpoints, measure latency vs. baseline. **Status:** Potential (vector confirmed; exploitability depends on untested engine limits).

### HIGH-7 — Register form's submit-blocking state never resets on success
**File:** `client/src/pages/Register.jsx:210-248,479-481`

```js
setSuccess(...); setFormData({...blank}); setTimeout(() => navigate("/login"), 4000);
// no setLoading(false) on the success path — only in the catch block
```
The "Log in" link is guarded with `onClick={(e) => { if (loading) e.preventDefault(); }}`, so it stays dead until the 4-second auto-redirect fires, since `loading` never resets on success.

**Fix:** `setLoading(false)` in a `finally`, or right after `setSuccess(...)`.

**Test:** Register successfully, click "Log in" before 4s elapse — should navigate. **Status:** Confirmed.

### HIGH-8 — `JobBoard.jsx` has no request cancellation on search/pagination
**File:** `client/src/pages/JobBoard.jsx:29-97,116-135`

No `AbortController`/ignore-flag (unlike the well-built pattern in `JobDetail.jsx`), and `JobSearchFilters` isn't passed a `loading` prop, so its Search button isn't disabled mid-request. A user refining filters and re-searching (or a slow Render cold-start response) can let an older response overwrite newer results with no request-id check anywhere in `setJobs`/`setTotalJobs`.

**Fix:** Track a request token or `AbortController`; ignore stale responses; disable search input while loading.

**Test:** Mock two overlapping search calls where the first resolves after the second; assert UI reflects the second. **Status:** Potential (no cancellation exists; latency variance is plausible given this app's own documented Render cold-start workarounds).

### HIGH-9 — `useRankedApplicants` has no cancellation — quick job-switching can show the wrong applicant list
**Files:** `client/src/hooks/useRankedApplicants.js:10-27`, `client/src/pages/EmployerDashboard.jsx:380,456-460`

No ignore-flag/abort on `fetchRankedApplicants`; `EmployerDashboard` also independently re-triggers it on `[selectedJobId, activeTab]`, doubling overlap risk. Clicking through several jobs quickly in the applicants rail (a normal triage workflow) can let an older job's slower response land after a newer job's faster one, populating the table with the wrong job's applicants while the header still shows the newly-selected job's title.

**Why it matters:** An employer could take a shortlist/reject/message action against the wrong applicant — a data-integrity risk, not just staleness.

**Fix:** Compare resolved `jobId` to current `jobId` before committing state, or key an `AbortController` to `jobId`.

**Test:** Select job A (slow), then job B (fast) before A resolves; assert only B's applicants show. **Status:** Potential, high-confidence (race window is a normal workflow, not an edge case).

### HIGH-10 — Six unmanaged `setTimeout(loadDashboardData, 3000)` calls in EmployerDashboard
**File:** `client/src/pages/EmployerDashboard.jsx:856,924,968,997,1051,1070`

Every status-change/bulk-action/interview-scheduling handler schedules a bare 3-second timeout with no `clearTimeout` on unmount. Navigating away within that window (Messages, Notifications, logout) still fires the timer, calling six state setters (`setLoading`, `setStats`, `setJobs`, `setJobApplicants`, `setRecentApplicants`, `setSelectedJobId`) on an unmounted component — six occurrences of this pattern.

**Fix:** Store timer IDs in a ref array and clear them in a cleanup effect (the component already does this correctly for its `successToast` timer).

**Test:** Trigger a status change, navigate away before 3s, assert no post-unmount state-update warning and no stray network call. **Status:** Confirmed.

### HIGH-11 — Google Sign-In button overflows small mobile viewports
**Files:** `client/src/components/GoogleSignInButton.jsx:61` (hardcoded `width:320`), `client/src/styles/auth.css:481-485,609+`

Google's GIS button renders at a fixed 320px regardless of container. On the mobile breakpoint, `.auth-container`/`.auth-card` padding leaves only ~295px of content width on a 375px phone and ~240px on a 320px device — narrower than the button itself, with no `overflow`/`max-width` backstop on `.google-signin__btn`.

**Fix:** Compute width from `targetRef.current.offsetWidth` (or use a safe fallback like 280) instead of a fixed 320; add `.google-signin__btn { max-width:100%; overflow:hidden; }` as backstop.

**Test:** Render the auth page at 320px/375px widths, assert no horizontal scroll (`document.body.scrollWidth <= window.innerWidth`). **Status:** Confirmed by CSS measurement.

### HIGH-12 — `FileDropzone` is keyboard-inert and performs no drag-drop file validation
**File:** `client/src/components/FileDropzone.jsx:36-43,66-81`

`role="button" tabIndex={0}` with no `onKeyDown` — Enter/Space does nothing (sibling `DocumentDropzone.jsx` implements this correctly). Additionally, `handleDrop` passes the dropped file straight to `onFileSelect` with no type/size check — the `accept` attribute only filters the native picker dialog, not drag-and-drop (again, `DocumentDropzone.jsx`'s `validate()` does this correctly).

**Why it matters:** Keyboard/screen-reader users cannot open the file picker at all for employer-verification uploads (business permit/registration doc); any dragged file type/size reaches the server with zero client-side feedback.

**Fix:** Add the same `onKeyDown` handler and `validate()` step already present in `DocumentDropzone.jsx`.

**Test:** Focus the dropzone, fire `keyDown "Enter"`, assert the file input was triggered; drop a disallowed MIME type, assert `onFileSelect` isn't called. **Status:** Confirmed.

### HIGH-13 — `RankedApplicantsTable`'s row menu leaks a `window` scroll listener; table has no pagination
**File:** `client/src/components/RankedApplicantsTable.jsx:54-62,158-462`

```js
useEffect(() => {
  if (!open) return undefined;
  const close = (e) => { ... };
  document.addEventListener("mousedown", close);
  window.addEventListener("scroll", () => setOpen(false), true);   // anonymous, never removed
  return () => document.removeEventListener("mousedown", close);   // scroll listener leaks
}, [open]);
```
Every time an employer opens a row's kebab menu, an orphaned `window` scroll listener accumulates and outlives both the row and the table. Separately, both the mobile-card and desktop-table markup render the **entire** `applicants.map()` twice (CSS just hides one via media query), with no pagination/virtualization — real jank on vacancies with hundreds of applicants, worse on low-end Android devices.

**Fix:** Store the scroll handler in a variable, remove it in cleanup; add pagination or `react-window` virtualization.

**Test:** Open/close the row menu N times; assert `window`'s scroll-listener count returns to 0. Render with 500 mock applicants; assert render time/DOM count stays under budget. **Status:** Confirmed.

---

## MEDIUM

### MED-1 — User enumeration on login (message + timing side channel)
**File:** `server/controllers/authController.js:260-264`

`"User not found"` vs `"Invalid password"` are distinguishable both in message text and timing (bcrypt only runs when the account exists) — inconsistent with `forgotPassword` in the same file, which correctly returns one generic message. Enables enumerating registered emails for a government job board. **Fix:** one generic message; dummy `bcrypt.compare` on the not-found path. **Status:** Confirmed.

### MED-2 — Rate limiting silently disabled whenever `NODE_ENV !== "production"`
**File:** `server/server.js:61-84`

```js
const disableRateLimits = process.env.DISABLE_RATE_LIMITS === "true" || process.env.NODE_ENV !== "production";
```
If Render's `NODE_ENV` is ever unset/misconfigured, every limiter (login, register, forgot-password, admin, upload) silently becomes a no-op in what the operator believes is production. **Fix:** gate only on an explicit `DISABLE_RATE_LIMITS` flag. **Status:** Potential (code-confirmed; live Render env var not verifiable statically — recommend the team check it directly).

### MED-3 — Socket.IO auth doesn't check account status
**File:** `server/server.js:511-530`

`io.use` verifies the JWT signature/expiry only — unlike `verifyToken`, it never checks `isActive`/`accountStatus` in the DB. Combined with HIGH-1 (no token invalidation) and a 30-day TTL, a suspended/banned user can still connect over Socket.IO and receive live notifications/presence for up to 30 days. **Fix:** mirror `verifyToken`'s DB lookup in `io.use`. **Status:** Confirmed.

### MED-4 — `ALLOW_VERCEL_PREVIEWS` + `credentials:true` trusts a shared public domain
**File:** `server/server.js:30-38,132-147`

If ever enabled, `*.vercel.app` wildcard trust combined with `credentials:true` lets any attacker-controlled Vercel deployment make credentialed cross-origin requests against the API. Defaults to `false` per `.env.example`. **Fix:** avoid wildcarding a shared hosting domain; scope to specific project preview patterns if needed. **Status:** Potential (off by default; live value unverifiable).

### MED-5 — Upload MIME-type validation trusts client-declared `Content-Type`
**Files:** `server/middleware/upload.js:24-31`, `server/services/storageService.js:20-31,90-91`

No magic-byte sniffing — `file.mimetype` is attacker-controlled. Partially mitigated by `X-Content-Type-Options: nosniff` on `/uploads`, but doesn't stop malware disguised as a resume being distributed to other users who download it. **Fix:** validate actual file content (e.g. `file-type` package) against the declared category. **Status:** Confirmed gap; impact partially mitigated.

### MED-6 — Global XSS sanitizer runs on password fields, altering what's actually hashed
**File:** `server/middleware/validation.js:5-43`, wired at `server/server.js:126`

`sanitizeRequestBody` runs on every request including `/login`/`/change-password`, HTML-entity-escaping and trimming `password`/`currentPassword`/`newPassword`. Login doesn't break today because the same transform applies consistently, but it silently weakens a user's chosen password entropy (special characters, leading/trailing whitespace) without their knowledge, and is fragile against any future route that bypasses this middleware ordering. **Fix:** exclude credential fields from generic sanitization. **Status:** Confirmed.

### MED-7 — Missing indexes on high-traffic fields: `JobApplication`, `Conversation`, `Message`
**Files:** `server/models/JobApplication.js`, `Conversation.js`, `Message.js`

No index on `applicant`/`vacancy` (JobApplication), `participants` (Conversation), or `conversationId`/`sender` (Message) — every "my applications"/"applicants for job"/"my conversations"/"load thread" query will degrade to a full collection scan as these grow. **Fix:** add the indexes listed in the detail sections above. **Status:** Confirmed.

### MED-8 — Unescaped `$regex` on admin/authenticated search endpoints
**Files:** `server/controllers/adminController.js:515-520,698-714`, `verificationController.js:323-329`, `messageController.js:192-199`

Same root cause as HIGH-6 but reachable only by authenticated roles, so smaller blast radius. **Status:** Potential.

### MED-9 — Unbounded `limit` query param on follow/job-like list endpoints
**Files:** `server/controllers/followController.js:118-119,163-164`, `jobLikeController.js:110-111`

`parseInt(req.query.limit) || 10` with no upper cap (unlike `notificationController.js`/`newsController.js`, which both clamp to a max). Combined with HIGH-4 (unauthenticated), `?limit=999999999` is a low-effort DoS lever. **Fix:** clamp with `Math.min(limit, 100)`. **Status:** Confirmed.

### MED-10 — `deleteConversation` hard-deletes shared history for both participants
**File:** `server/controllers/messageController.js:487-522`

Authorization is correct (only a participant can delete), but the effect destroys the entire conversation + messages for both parties with no consent to the other side — e.g. erasing interview-scheduling records either party may need. **Fix:** soft-delete per participant (`hiddenFor: [userId]`), or block deletion once a formal application/interview references the thread. **Status:** Confirmed (business-logic judgment call).

### MED-11 — Field whitelists diverge between the two duplicate job-update endpoints
**File:** `server/controllers/jobController.js:384-459` vs `server/controllers/employerController.js:282-405`

Direct consequence of HIGH-5: `PUT /api/jobs/:id` silently drops `industry`/`workNature`/`salaryMin/Max`/`minAge` that `PUT /api/employer/jobs/:id` preserves — a job edited via one path can lose fields the other path would have kept, affecting search/ranking correctness downstream. **Fix:** same as HIGH-5. **Status:** Confirmed.

### MED-12 — `SearchableDropdown` never re-syncs display text when `value` prop changes externally
**File:** `client/src/components/SearchableDropdown.jsx:15`

`searchText` seeds from `value` only on mount, with no effect watching `value` afterward — the sibling `JobSearchFilters.jsx` already solves this correctly in the same directory. Any screen resetting/reloading a value into this dropdown shows stale text. **Fix:** `useEffect(() => setSearchText(value || ""), [value])`. **Status:** Confirmed logic gap.

### MED-13 — `EmployerModal`/`Modal` lack Escape-to-close, focus trap, and dialog ARIA roles
**Files:** `client/src/components/EmployerModal.jsx:40-41`, `Modal.jsx:58-59`

Both close only via backdrop-click/explicit button; `EmployerModal` has no `role="dialog"`/`aria-modal` at all — inconsistent with `AppModal.jsx`/`TermsGate.jsx`, which both implement this correctly. **Fix:** reuse `AppModal.jsx`'s pattern or route through it. **Status:** Confirmed.

### MED-14 — Mobile nav menu doesn't lock body scroll; can scroll-chain into the page behind it
**Files:** `client/src/components/Navbar.jsx:506-589`, `client/src/styles/navbar.css:710-737`

Unlike `ImageEditorModal.jsx`/`FeedbackProvider.jsx`, which both lock `document.body.style.overflow`, the mobile menu doesn't — and `.mobile-menu-panel` has no `overscroll-behavior: contain`. Scrolling to the panel's edge can chain into scrolling the page underneath (most visible on iOS Safari). **Fix:** add the same body-scroll-lock effect + `overscroll-behavior: contain`. **Status:** Potential (browser-dependent).

### MED-15 — Favorite-button touch target is 30×30px (below 44px minimum)
**File:** `client/src/styles/vacancy-card.css:120-124`

Fixed 30px square on the primary mobile job-browsing surface, below WCAG 2.5.5/platform guidance (44×44 iOS / 48×48dp Android); the card itself is also clickable, so mis-taps risk accidental navigation instead of favoriting. **Fix:** expand hit area via padding/pseudo-element without changing visual size. **Status:** Confirmed by measurement.

### MED-16 — SPES document upload has no client-side size/type validation
**File:** `client/src/components/SpesPanel.jsx:331-338`

Raw `<input type="file" multiple accept="...">` with no `validate()` step, unlike `AvatarPicker.jsx`/`DocumentDropzone.jsx` elsewhere in the same codebase. Up to 4 arbitrarily large/mismatched files can be selected with no feedback until the server round-trip fails — costly on limited mobile data for the target userbase. **Fix:** reuse the existing `validate(file)` pattern from `DocumentDropzone.jsx`. **Status:** Confirmed.

### MED-17 — Dead duplicate page: `client/src/pages/Profile.jsx`
Not imported anywhere (`App.jsx` routes `/profile` to `ProfilePage.jsx`); confirmed via full-project grep. Stale code that will silently drift out of sync with the real profile page. **Fix:** delete, or wire it up if it was meant to replace `ProfilePage.jsx`. **Status:** Confirmed.

### MED-18 — `Login.jsx` fires three concurrent `/auth/profile` requests per login
**Files:** `client/src/pages/Login.jsx:169,173,186`, `client/src/context/AuthContext.jsx:104-118`

`login()` is called without `await` (which internally fetches the profile), then an explicit `authAPI.getProfile()` call, then `login()` again with the merged user (a third internal fetch). Not a correctness bug — final routing uses the explicit fetch's merged result — but it's wasted load on every login, compounding the latency this codebase has already worked around for Render cold starts (see recent commit history). **Fix:** await one `login()` call; don't have it re-hydrate when the caller immediately re-fetches and merges anyway. **Status:** Confirmed.

### MED-19 — `NewsFeed.jsx` search fires a request on every keystroke, no debounce
**File:** `client/src/pages/NewsFeed.jsx:56-78,205-212`

The effect correctly uses an ignore-flag (no data-corruption bug), but typing an 18-character query fires ~18 separate requests — `Messages.jsx` in the same codebase already debounces user search correctly. **Fix:** debounce ~300ms before it enters the effect's dependency array. **Status:** Confirmed.

### MED-20 — Admin User Management silently caps the roster at 250 users, no pagination/notice
**File:** `client/src/pages/admin/UserManagement.jsx:178`

`adminAPI.getUsers({page:1, limit:250})` with no pager and no truncation indicator, unlike `Reports.jsx`/`AuditTrail.jsx`, which both paginate server-side correctly. Once the platform passes 250 total users, admins silently lose visibility into the rest. **Fix:** add real pagination (backend already supports `page`/`limit`) or surface a truncation warning. **Status:** Confirmed.

---

## LOW

| # | Finding | File(s) | Status |
|---|---|---|---|
| LOW-1 | `password`/token fields lack `select:false` at schema level (root cause behind HIGH-2 — call sites must remember to exclude manually, and 3 already forgot) | `server/models/User.js:19-24,156-181` | Confirmed |
| LOW-2 | Government ID numbers (TIN, SSS/GSIS, PhilHealth, Pag-IBIG, passport) stored as plain unprotected strings — hardening recommendation, no confirmed leak path beyond CRIT-1 | `server/models/JobseekerProfile.js:22-25,55` | Potential |
| LOW-3 | No boot-time validation that `JWT_SECRET`/`MONGO_URI` are set — late, confusing failure instead of fail-fast | `server/config/db.js:3-11` | Confirmed (missing check); secret strength itself unverifiable |
| LOW-4 | Dead legacy `multer.diskStorage` config, unused `uploadDirs` creation, unused `app.locals.upload` — creates unused directories on every boot, misleading to maintainers | `server/server.js:166-247,478` | Confirmed |
| LOW-5 | Dead CSRF middleware (`csrfProtection`) and a whole unused second sanitization utility file, never imported anywhere — false sense of coverage; CSRF itself low-risk since auth is bearer-token, not cookie-based | `server/middleware/security.js:1-26`, `server/utils/sanitize.js` | Confirmed |
| LOW-6 | `authLimiter` double-mounted on `/api/v1/auth/*` (stricter, not weaker, but confusing) while legacy `/api/auth/*` only gets it once | `server/server.js:158-164,321-327` | Confirmed |
| LOW-7 | `detectMaliciousPayload`'s `"constructor"` substring match is overly broad — will false-positive on legitimate content (e.g. "construction site constructor") for a platform with construction-industry job listings | `server/middleware/security.js:29-46` | Confirmed |
| LOW-8 | Rate-limit handler manually reflects the `Origin` header into CORS response headers on 429s, unconditionally — currently harmless only because `cors()` runs first, but fragile against future reordering | `server/server.js:64-73` | Informational |
| LOW-9 | `canAccessRef` runs up to 6 DB existence checks via `Promise.all` without short-circuiting on cheaper checks first — perf-only | `server/controllers/fileController.js:11-68` | Confirmed (perf, not security) |
| LOW-10 | Inconsistent prod/dev error-message redaction — most controllers return raw `error.message` unconditionally, only some guard behind `NODE_ENV==="production"` (~15+ controllers affected) | Many controllers, e.g. `userController.js`, `followController.js`, `notificationController.js` | Confirmed |
| LOW-11 | SPES applicant-only routes (`getMySpesApplication`) have no role restriction beyond `protect` — not exploitable since query is scoped by caller's own id, but semantically any role can call an "applicant self-service" endpoint | `server/routes/spesRoutes.js:45-46` | Potential |
| LOW-12 | `CoverLetterBuilder`'s effect ordering can transiently overwrite a parent's initial `value` with `""` on mount — currently dead code (not imported anywhere in `client/src`), so latent rather than live | `client/src/components/coverLetterBuilder.jsx:25-33,48-53` | Potential/latent |
| LOW-13 | Inconsistent `PropTypes` coverage — several components with no prop validation at all (`Navbar`, `AvatarPicker`, `ImageEditorModal`, `VacancyCard`, `RankedApplicantsTable`, `Modal`, `EmployerModal`), removing an early-warning safety net for shape-mismatch bugs like MED-12 | Various `client/src/components/*.jsx` | Confirmed inconsistency |
| LOW-14 | `Dashboard.jsx`/`JobBoard.jsx` fetch effects run with `[]` deps while reading `user`/`login` from closure — stale-closure trap if a cross-tab account switch ever happens while mounted; currently safe because `ProtectedRoute` guarantees `user` is populated before mount | `client/src/pages/Dashboard.jsx:26-28`, `JobBoard.jsx:95-97` | Potential, low practical impact today |
| LOW-15 | Hard `window.location.href` redirect (not SPA `navigate()`) on 401, discarding in-progress form state; `tokenExpiry` localStorage key not cleared alongside `token`/`user` | `client/src/services/api.js:120-132` | Confirmed design tradeoff |

Also noted, lower priority: duplicated "spotlight mouse tracking" effect block copy-pasted across `Login.jsx`, `Register.jsx`, `EmployeeRegister.jsx` — correct but should be a shared hook.

---

## Notable Solid Patterns (for contrast — not issues)

These exist elsewhere in the same codebase and should be the reference implementations copied into the findings above:

- **Backend:** `middleware/auth.js` role gates (`isAdmin`, `isSuperadmin`, `isVerifiedEmployer`) are consistently applied across admin/superadmin/appeal/report/verification routes. `employerController.getConnectedJobseekerProfile`, per-resource ownership checks in job/message/document controllers, and `fileController.canAccessRef` are correctly-scoped IDOR defenses. `authController.updateProfile`/`userController.completeOnboarding` use explicit field whitelists (no mass assignment found anywhere in `server/controllers`). `SpesApplication` correctly uses a unique index + code-11000 handling (the fix HIGH-3 needs). `middleware/upload.js` sanitizes filenames via `uuidv4()`, preventing path traversal. Global `express-mongo-sanitize` + custom sanitization middleware provide real defense-in-depth.
- **Frontend:** `usePersistentState.js`, `AvatarPicker.jsx`, `ImageEditorModal.jsx`, `DocumentDropzone.jsx` all correctly guard `localStorage`/object-URL lifecycle. `useNotifications.js` uses named handler refs for socket `on`/`off` (the fix CRIT-6 needs). i18n `en.json`/`fil.json` are in exact key parity. `JobDetail.jsx`, `Messages.jsx`, `AdminDashboard.jsx`, `Reports.jsx` all correctly implement fetch-cancellation/ignore-flag patterns (the fix HIGH-8/9 and MED items need). All audited `<img>` tags carry proper `alt` attributes.

---

## Recommended Remediation Order

1. **Before next deploy:** CRIT-1 through CRIT-6 — these are either live PII/document exposure (CRIT-1/2) or break primary user journeys outright (CRIT-3/4/5/6).
2. **This sprint:** HIGH-1 (session invalidation), HIGH-2 (password hash leak), HIGH-3/HIGH-9 (race conditions with data-integrity impact), HIGH-4 (email scraping), HIGH-10/13 (leaks that degrade over a session).
3. **Backlog, prioritized by user-facing impact:** remaining High items (mobile layout, accessibility, duplicate job-CRUD consolidation), then Medium.
4. **Housekeeping pass:** Low-severity dead-code removal (LOW-4, LOW-5, MED-17) and consistency fixes (LOW-10, LOW-13) — cheap to fix, reduce future-bug surface.
