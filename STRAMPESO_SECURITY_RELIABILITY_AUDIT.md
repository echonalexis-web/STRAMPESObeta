# STRAMPESO Web System - Security & Reliability Audit Report

**Audit date:** 2026-09-30
**Scope:** `server/` (Node.js/Express/MongoDB API), `client/` (React/Vite SPA), deployment config (Vercel, Render)
**Method:** Static source review, dependency audit (`npm audit`), git history inspection. No live penetration testing was performed against a running deployment.

---

## 1. Executive Summary

STRAMPESO is a mature, actively-hardened MERN application. The majority of standard OWASP-relevant controls are already implemented correctly and consistently: bcrypt password hashing, JWT session invalidation via `tokenVersion`, role-based access control on every route file, NoSQL-injection sanitization (`express-mongo-sanitize`), XSS sanitization on request bodies, MIME + magic-byte file upload validation, unique compound indexes preventing race-condition duplicates, and email-enumeration-safe auth endpoints. A prior internal audit (`markdowns/SECURITY_BASELINE_AUDIT.md`) flagged several gaps that have since been **fixed** in the current codebase (rate-limiting no longer silently disables outside `NODE_ENV=production`; the `/uploads` static route now verifies the JWT; `fileController.canAccessRef` now covers the employer-application ownership case).

However, this audit found **one critical, actively-exploitable issue**: a live MongoDB Atlas connection string with plaintext credentials is hardcoded as a fallback value in six committed, pushed source files. This is a full-database-compromise risk independent of any application-layer control and should be remediated (credential rotation) before anything else in this report.

Beyond that, the remaining findings are process-hardening items typical of a pre-production capstone/beta system: missing crash handlers, no security headers on the deployed frontend, a session token stored in `localStorage`, and several dependency CVEs with available patches.

### Summary of Findings by Severity

| Severity | Count | Status |
|---|---|---|
| **Critical** | 1 | Open — hardcoded live database credentials in 6 committed files. **Requires manual action: rotate the Atlas password.** |
| **High** | 3 | ✅ All 3 fixed — process crash handlers added; `nodemailer` upgraded; `/uploads` route now enforces per-file ownership |
| **Medium** | 5 | 3 fixed (security headers, error-message leakage, `qs`/`multer`/`brace-expansion` CVEs); 2 deferred by product decision (JWT in `localStorage`; committed user files in git history) |
| **Low** | 4 | Open — `detectMaliciousPayload` regex-based WAF is bypassable; `sensitiveOperationLimiter` in-memory rate limiter unused/non-distributed; CORS `Access-Control-Allow-Origin` reflected in rate-limit handler; missing `helmet` CSP in development |
| **Informational** | 3 | Open — no automated test coverage for auth/authorization paths beyond one unit test file; large `npm audit` dev-dependency surface; no structured/centralized logging |

*Medium findings are 3.5–3.9 in Section 3 — see each for full status detail.*

---

## 2. System Architecture Overview

**Stack:**
- **Frontend:** React 19 + Vite 8 SPA (`client/`), deployed to Vercel, using `axios` for REST calls and `socket.io-client` for real-time messaging/notifications/presence.
- **Backend:** Node.js + Express 4 (`server/`), deployed to Render, using Mongoose 8 as the MongoDB ODM, `socket.io` for real-time features, and JWT (`jsonwebtoken`) for stateless session auth.
- **Database:** MongoDB Atlas (cloud-hosted cluster `stram-peso.nevsgla.mongodb.net`).
- **File storage:** Configurable driver — local disk (`server/uploads/`, ephemeral on Render) or Cloudinary, via `services/storageService.js`.
- **Email:** Gmail SMTP via `nodemailer`, with a console-log fallback when unconfigured.
- **Auth providers:** Local (bcrypt password) and Google Sign-In (`google-auth-library`, ID token verification).

**Primary data flows:**
1. **Auth:** Client → `/api/v1/auth/*` → `authController.js` → Mongoose `User` model → bcrypt/JWT → signed token returned to client, stored in `localStorage`.
2. **Job matching:** `jobController.js` / `services/semanticService.js` compute structured + TF-IDF relevance scores between `JobVacancy` and `JobseekerProfile`/`User` documents, entirely in-process (no external ML service).
3. **File uploads:** Multipart → `multer` (memory storage) → `middleware/upload.js` (MIME + magic-byte validation) → `services/storageService.js` (local disk or Cloudinary) → reference stored on the owning document → retrieved later via `fileController.getSignedUrl` (ownership-checked) or `/uploads` static middleware (JWT-checked, public for profile/news images).
4. **Real-time:** `socket.io`, authenticated at handshake via the same JWT + `tokenVersion` check as REST, used for messaging, typing indicators, presence, and forced logout on suspension/deactivation.
5. **Admin/Superadmin:** Two-tier staff model — `admin` (day-to-day PESO office operations) and `superadmin` (the only role that can provision/disable/reset admin accounts), enforced via `middleware/auth.js` role guards on every route file.

**Configuration management:** Environment variables via `dotenv` + `.env` (gitignored) with a tracked `.env.example` template. No secrets manager / vault is used — appropriate for the current deployment scale (Render + Vercel with dashboard-configured env vars).

---

## 3. Security Findings

### 3.1 [CRITICAL] Hardcoded live database credentials committed to source control

- **Severity:** Critical
- **Component/File Path:** `server/scripts/seedJollibeeJobs.js:26`, `server/scripts/unseedJollibeeJobs.js:28`, `server/scripts/migrateResidentRoleToJobseeker.js:22`, `server/scripts/migrateJobSalaryNumbers.js:9`, `server/scripts/migrateRequirementsToQualifications.js:13`, `server/scripts/migrateCompanySizeBands.js:22`
- **Description:** All six files fall back to a hardcoded literal when the environment variable is unset:
  ```js
  const mongoURI = process.env.MONGODB_URI || "mongodb+srv://alexis:ecjan05@stram-peso.nevsgla.mongodb.net/?appName=STRAM-PESO";
  ```
  This string contains a live MongoDB Atlas username (`alexis`) and password (`ecjan05`) for the cluster `stram-peso.nevsgla.mongodb.net`. It has been committed to git (introduced in commit `c9a1e17d`) and the repository has two GitHub remotes configured (`origin: echonalexis-web/STRAMPESObeta`, `old-origin: Alki0101/Stram-Peso`).
- **Potential Impact:** Anyone with read access to either GitHub repository (or its full git history — deleting the file does not remove it from history) has direct read/write credentials to the production database: every user's PII (names, addresses, dates of birth, resumes, government ID numbers, TIN/SSS/PhilHealth numbers for jobseekers; business permits for employers), password hashes, and the ability to modify or delete any record, including escalating any account to `superadmin`.
- **Concrete Remediation Steps:**
  1. **Immediately** rotate the Atlas database user's password (Atlas dashboard → Database Access → edit user `alexis` → generate a new password), and update `MONGO_URI`/`MONGODB_URI` in the actual Render environment and local `.env` files.
  2. Remove the hardcoded fallback from all six scripts — require the env var and fail fast instead:
     ```js
     const mongoURI = process.env.MONGODB_URI;
     if (!mongoURI) throw new Error("MONGODB_URI is required to run this script");
     ```
  3. If either GitHub repository is public, treat the credential as fully burned regardless of rotation timing, and consider whether the exposed data (if any writes/reads occurred from an unknown party) requires a breach assessment.
  4. Optionally purge the string from git history (`git filter-repo` or BFG Repo-Cleaner) and force-push — coordinate with anyone else with a local clone, since this rewrites history. Rotation alone is sufficient to close the immediate risk; history-scrubbing is a cleanup step afterward, not a substitute for rotation.

### 3.2 [High — FIXED] No process-level crash handlers

- **Severity:** High
- **Status:** ✅ Fixed — `process.on("unhandledRejection", ...)` and `process.on("uncaughtException", ...)` handlers added near the top of `server/server.js`, right after `const server = http.createServer(app);`.
- **Component/File Path:** `server/server.js` (entire file — no matches for `uncaughtException`/`unhandledRejection`)
- **Description:** Node registers no `process.on("unhandledRejection", ...)` or `process.on("uncaughtException", ...)` handlers. An unawaited rejected promise anywhere in the ~20 controllers, or a synchronous throw outside a try/catch (e.g., inside a `.then()` callback, a socket event handler, or a third-party library callback), terminates the entire Node process by default.
- **Potential Impact:** A single malformed request or edge-case bug can crash the whole API server, dropping every in-flight request and all active Socket.IO connections for every user, until the host (Render) restarts the process. This is a full-service denial-of-service triggerable by an ordinary bug, not just an attacker.
- **Concrete Remediation Steps:**
  ```js
  // near the top of server.js, after `const app = express();`
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    process.exit(1); // let Render's process manager restart cleanly
  });
  ```

### 3.3 [High — FIXED] `nodemailer` dependency has a known high-severity DoS CVE

- **Severity:** High
- **Status:** ✅ Fixed — upgraded to `nodemailer@10.0.13` (`package.json` now pins `^10.0.13`). `npm audit` no longer reports any nodemailer advisory.
- **Component/File Path:** `server/package.json` (`"nodemailer": "^10.0.0"`), used throughout `server/services/mailService.js`
- **Description:** `npm audit` reports the installed `nodemailer` range (`<=10.0.8`) is vulnerable to [GHSA-v53p-9fqp-m79j](https://github.com/advisories/GHSA-v53p-9fqp-m79j) — quadratic backtracking in the address-parser's free-text fallback, allowing remote denial of service (CVSS 7.5) — and a moderate RFC 5322 comment-parsing issue ([GHSA-g57g-f23g-4646](https://github.com/advisories/GHSA-g57g-f23g-4646)).
- **Potential Impact:** Since `sendPasswordResetEmail`, `sendEmailVerification`, etc. all pass a user-influenced `to`/`name` value into `nodemailer.sendMail`, a crafted email address or name at registration/password-reset time could trigger catastrophic backtracking and pin a CPU core, degrading or crashing the process (compounding finding 3.2, since email sends are `.catch(() => {})`'d in most call sites but not universally).
- **Concrete Remediation Steps:** Run `npm install nodemailer@latest` (or at minimum `>=10.0.9`) in `server/`, then re-run `npm audit` to confirm the advisory clears. No code changes are required — this is a drop-in patched version per `npm audit`'s `fixAvailable: true`.

### 3.4 [High — FIXED] Legacy `/uploads` filename-only access control has no per-file ownership check

- **Severity:** High
- **Status:** ✅ Fixed — `fileController.canAccessRef` is now exported and reused directly in the `/uploads` gate in `server/server.js`. The route now re-fetches the user (role, `isActive`, `tokenVersion`) and calls `canAccessRef` with the exact stored-value ref (`/uploads` + the requested path) before serving any non-public file — the same ownership check the signed-URL path already enforced.
- **Component/File Path:** `server/server.js:232-255`
- **Description:** The `/uploads` static-file gate (distinct from the properly-scoped `fileController.getSignedUrl` signed-URL path used elsewhere) verifies only that the caller presents *any* currently-valid JWT (`jwt.verify(token, process.env.JWT_SECRET)`) for non-public paths (`resumes`, `temp`, and any future non-profile/non-news subfolder). It does not check whether the requesting user owns, or is otherwise authorized to view, the specific file being requested — any authenticated user (jobseeker, employer, or otherwise) can fetch any other user's résumé or private document by guessing/enumerating its filename under `/uploads/resumes/...`.
- **Potential Impact:** Filenames are UUID-based (see `generateSecureFilename` in `middleware/upload.js`) so blind enumeration is impractical, but the filename is not a secret in every code path — e.g., it may appear in API responses to other authorized viewers, browser history, referrer headers, or server logs — at which point this route grants full access with no ownership check at all, unlike the signed-URL path (`fileController.canAccessRef`) that correctly checks ownership before issuing access.
- **Concrete Remediation Steps:** Either (a) deprecate this legacy static route entirely in favor of the already-correct `fileController.getSignedUrl` + `storageService` signed-URL flow for all private documents, or (b) if it must stay for local-storage-driver deployments, route it through the same `canAccessRef` ownership check instead of a bare `jwt.verify`:
  ```js
  app.use("/uploads", async (req, res, next) => {
    const isPublicImage = req.path.includes("/profiles/") || req.path.includes("/news/");
    if (isPublicImage) return next();
    const token = req.headers.authorization?.split(" ")[1];
    let user;
    try { user = jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(403).json({ message: "Access denied" }); }
    const ref = req.path.replace(/^\//, "");
    const allowed = await canAccessRef(ref, { id: user.id, role: user.role });
    if (!allowed) return res.status(403).json({ message: "Access denied" });
    next();
  });
  ```

### 3.5 [Medium — DEFERRED] JWT session token stored in `localStorage`, not an HttpOnly cookie

- **Severity:** Medium
- **Status:** Deferred by product decision. A full migration to HttpOnly cookies requires CSRF protection, cross-origin cookie configuration (`SameSite=None; Secure`, since the Vercel frontend and Render backend are different domains), and reworking the Socket.IO auth handshake — a real architecture change with session/UX implications, not a drop-in patch. Reviewed with the project owner; explicitly deferred rather than rushed. The existing layered XSS defenses (`xss` package sanitization, `detectMaliciousPayload`, React's default output escaping) remain the primary mitigating control in the meantime.
- **Component/File Path:** `client/src/context/AuthContext.jsx:110`, `client/src/services/api.js:58`, and ~15 other call sites
- **Description:** The 30-day-lived session JWT is stored in `localStorage` and attached manually as an `Authorization: Bearer` header. Any script that executes in the page's origin — via a successful XSS, a compromised third-party script, or a malicious browser extension — can read `localStorage` directly and exfiltrate the token, granting full account takeover for up to 30 days with no further authentication needed.
- **Potential Impact:** This is a defense-in-depth gap, not an immediately exploitable vulnerability on its own — the application's input sanitization (`xss` package, `detectMaliciousPayload`, React's default JSX escaping) makes a stored/reflected XSS unlikely but not proven absent. Given the long (30-day) token lifetime and the sensitivity of data behind it (résumés, government IDs, admin actions), the blast radius of any future XSS is significantly larger than it would be with HttpOnly cookies.
- **Concrete Remediation Steps:** Migrating a Bearer-token SPA to HttpOnly cookies is a non-trivial architecture change (requires CSRF protection to compensate, and reworking the Socket.IO handshake which currently reads the token from `socket.handshake.auth.token`). Given the project's stage, the pragmatic options are: (a) shorten the token TTL and add a refresh-token flow, or (b) accept the risk explicitly and prioritize XSS-prevention hardening (see 3.7) as the primary mitigating control instead.

### 3.6 [Medium — FIXED] No security headers on the deployed frontend (Vercel)

- **Severity:** Medium
- **Status:** ✅ Fixed — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Strict-Transport-Security` added to both `vercel.json` (root, active deployment config) and `client/vercel.json`. A `Content-Security-Policy` is intentionally not included yet — it needs the exact set of API/socket origins finalized first, since a misconfigured `connect-src` would silently break login and real-time features; tracked as a follow-up.
- **Component/File Path:** `client/vercel.json`
- **Description:** The Vercel config sets only `Cache-Control` headers. It does not set `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, or `Strict-Transport-Security` on the served SPA. `helmet`'s CSP in `server.js` only protects API JSON responses, which browsers don't render as HTML anyway — it provides no protection for the actual page the user's browser executes.
- **Potential Impact:** No CSP means a successful script-injection anywhere in the SPA (a compromised dependency, a DOM XSS via an unsanitized third-party value rendered into the DOM) runs with no browser-level containment — no restriction on `connect-src`/`script-src` to block exfiltration to an attacker domain. No `X-Frame-Options` means the site can be embedded in an attacker's iframe for clickjacking.
- **Concrete Remediation Steps:** Add a `headers` block to `client/vercel.json`:
  ```json
  {
    "source": "/(.*)",
    "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" }
    ]
  }
  ```
  A `Content-Security-Policy` should be added once the exact set of API/socket origins is finalized (it must allow `connect-src` to the Render API and WSS endpoints).

### 3.7 [Medium — FIXED] Error message detail gated on `NODE_ENV`, not an explicit flag

- **Severity:** Medium
- **Status:** ✅ Fixed — added `server/utils/sendError.js`, a shared helper gated on an explicit `SHOW_ERROR_DETAILS` env var (never `NODE_ENV`). Migrated all 87 matching `res.status(500).json({ message: error.message [|| "fallback"] })` call sites across all 16 affected controllers to use it. Set `SHOW_ERROR_DETAILS=true` in a local `.env` if verbose error messages are wanted for development; it must stay unset (or `false`) everywhere else.
- **Component/File Path:** `server/server.js:685-689`, and dozens of controller `catch` blocks that do `res.status(500).json({ message: error.message })` directly (e.g., `authController.js:205,272,381,444,490,545,617,689,876,963,976,996`)
- **Description:** The global error handler correctly redacts `err.message` when `NODE_ENV === "production"`, but the same env var also controls rate limiting and dev-only response fields (`devResetUrl`, `devVerifyUrl`) elsewhere in the codebase. Many individual controller `catch` blocks bypass the global handler entirely and return `error.message` straight to the client unconditionally, regardless of environment — e.g. every `catch` in `authController.js` shown above.
- **Potential Impact:** A raw Mongoose/MongoDB driver error message (which can include schema/field internals, or in rarer cases connection details) is returned directly to any client whenever one of these `catch` blocks fires, independent of whether `NODE_ENV` is set correctly on the host.
- **Concrete Remediation Steps:** Introduce a shared helper (`utils/sendError.js`) that all controllers call instead of ad hoc `res.status(500).json({ message: error.message })`, gated on one explicit env var rather than `NODE_ENV`:
  ```js
  const sendError = (res, error, fallback = "Something went wrong") =>
    res.status(error.status || 500).json({
      message: process.env.SHOW_ERROR_DETAILS === "true" ? error.message : fallback,
    });
  ```
  This also fixes the operational fragility noted in the prior baseline audit, where forgetting to set `NODE_ENV=production` on the host silently leaks internals.

### 3.8 [Medium — FIXED] `qs` dependency moderate CVEs (transitive, via `express`)

- **Severity:** Medium
- **Status:** ✅ Fixed — ran `npm audit fix` in `server/`, which bumped `express` → `4.22.3` (pulling in `qs@6.16.0`) and `multer` → `2.4.0` (also clearing a separate moderate multer DoS advisory found during remediation, and a high-severity `brace-expansion` advisory in the dev-only `nodemon` chain). `npm audit` now reports **0 vulnerabilities**. All changes stayed within existing semver ranges (no `--force`, no major version bumps); server boot, syntax, and the existing Jest suite were re-verified with no new failures.
- **Component/File Path:** `server/node_modules/qs` (transitive dependency of `express`)
- **Description:** `npm audit` flags the resolved `qs` version range (2.2.5–6.15.3) for two moderate advisories: array-limit bypass via bracket-key comma parsing ([GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)) and a DoS via attacker-controlled `isBuffer` ([GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)).
- **Potential Impact:** `qs` parses query strings for Express; a crafted query string could bypass array-length limits or trigger increased CPU/memory use. `express-mongo-sanitize` mitigates the injection angle, but not the DoS angle.
- **Concrete Remediation Steps:** Run `npm audit fix` in `server/` (marked `fixAvailable: true`); if the fix requires an `express` major-version bump, pin `qs` directly via `overrides` in `package.json` instead to avoid an unplanned Express upgrade.

### 3.9 [Medium — DEFERRED] Real user-uploaded files committed to the git repository

- **Severity:** Medium
- **Status:** Deferred by product decision. Fixing this properly requires a git history rewrite + force-push (`git filter-repo`/BFG), which is destructive to anyone else's existing clone and shouldn't be run without confirming first whether these 41 files are real users' documents (requiring their knowledge before a history purge) or the developer's own test uploads (lower urgency, can be handled more casually). Reviewed with the project owner and explicitly deferred rather than rushed through unattended.
- **Component/File Path:** `server/uploads/*` (41 files tracked per `git ls-files`, despite `.gitignore` excluding `server/uploads/*` going forward)
- **Description:** The root `.gitignore` correctly excludes `server/uploads/*` (keeping only `.gitkeep`), but 41 files were already committed before that rule was added (or added directly, bypassing it), including what appear to be real applicant photos, a resume PDF (`office_admin_resume.pdf`, committed three times under different names), and `.docx` files. These are real user PII, not seed/test fixtures.
- **Potential Impact:** Anyone with repository access (see 3.1's exposure concern about public vs. private repo status) can view these files directly, and — because git history is permanent — deleting them from the working tree today does not remove them from anyone's existing clone or from the GitHub history unless it's explicitly rewritten.
- **Concrete Remediation Steps:** Confirm with any real users whose documents these are whether they consented to storage in a developer's git history; if not, remove the files (`git rm --cached`) and scrub history the same way described in 3.1's remediation (coordinated force-push), then verify the `.gitignore` rule is actually preventing new ones (it currently is, per the rule already in place).

### 3.10 [Low] Regex-based "malicious payload" detector is a defense-in-depth measure only, not a substitute for output encoding

- **Severity:** Low
- **Component/File Path:** `server/middleware/security.js:29-68` (`detectMaliciousPayload`)
- **Description:** This middleware blocks requests whose body/query matches patterns like `/<\s*script/i`, `/javascript:/i`, `/__proto__/`, etc. Regex blocklists are inherently bypassable (e.g., `<scr<script>ipt>`, HTML entity encoding, or a payload that doesn't need a `<script>` tag at all, like `<img src=x onerror=...>` — which the list does happen to catch via `onerror\s*=`, but the general class of bypass risk remains for any blocklist approach).
- **Potential Impact:** Low in practice here because it is layered on top of (not a replacement for) the `xss` package sanitization in `middleware/validation.js`/`utils/sanitize.js` and React's default output escaping — so a bypass of this specific filter does not, by itself, produce a stored-XSS vector. It is best understood as noise reduction / early rejection, not a security boundary.
- **Concrete Remediation Steps:** No urgent action required given the layered sanitization already in place; if it's ever relied upon as the primary XSS control for a new field, replace it with the same `xss()`/allow-list sanitization used elsewhere rather than trusting the blocklist alone.

### 3.11 [Low] `sensitiveOperationLimiter` is in-memory and per-process, and appears unused

- **Severity:** Low
- **Component/File Path:** `server/middleware/security.js:71-92`
- **Description:** This factory builds a `Map`-based rate limiter local to the Node process. It was not found wired into any route in this audit's review of the route files (the actual rate limiting in production goes through `express-rate-limit` limiters defined in `server.js`, which are also in-memory but at least consistently applied). An in-memory limiter also resets on every deploy/restart and does not share state across multiple server instances if the app is ever horizontally scaled.
- **Potential Impact:** None currently (dead code), but a future developer wiring it in for a "sensitive operation" would get weaker protection than they might expect under horizontal scaling.
- **Concrete Remediation Steps:** Either remove the unused export, or if kept for future use, document that it (and the `express-rate-limit` limiters in `server.js`) are per-instance and should move to a shared store (e.g., `rate-limit-redis`) before the app is deployed across more than one Render instance.

### 3.12 [Informational] Limited automated test coverage for authorization paths

- **Severity:** Informational
- **Component/File Path:** `server/tests/` (two files: `nsrpFormService.test.js`, `server_tests.js`)
- **Description:** The existing Jest suite covers PDF form-field mapping and a couple of regex/utility functions (`normalizeMunicipalityLabel`, `escapeRegExp`). There is no automated coverage asserting that role guards (`isAdmin`, `isSuperadmin`, `isVerifiedEmployer`, etc.) actually reject cross-role/cross-tenant access, or that `fileController.canAccessRef` correctly denies an unauthorized user.
- **Potential Impact:** Regressions in access-control logic (exactly the kind of subtle ownership-check gap already found and fixed once in `fileController.js`, per the prior baseline audit) can reappear silently with no test to catch them.
- **Concrete Remediation Steps:** Add integration tests (using the existing `supertest` devDependency) asserting 403s for cross-role and cross-owner access attempts on at least the file-access, admin, and superadmin routes.

---

## 4. Reliability & Performance Bottlenecks

### 4.1 [FIXED] No MongoDB connection resilience options configured
- **Impact Level:** High
- **Component/File Path:** `server/config/db.js`
- **Status:** ✅ Fixed — `mongoose.connect()` now passes `serverSelectionTimeoutMS: 10000`, `socketTimeoutMS: 45000`, and `maxPoolSize: 20`, and both the success and failure paths log through the new shared `utils/logger.js` instead of a bare `console.log`. The hard `process.exit(1)` on initial-connect failure is kept (Render restarts the process on exit, which remains the simplest correct behavior for a *first* connection failure); a bounded in-process retry loop was considered but not added, to avoid the added complexity of a retry policy for what is, on Render + Atlas, an infrequent failure mode.
- **Cause (original):** `mongoose.connect(process.env.MONGO_URI)` was called with no options object — no `serverSelectionTimeoutMS`, `socketTimeoutMS`, or `maxPoolSize` configured.

### 4.2 [FIXED] No process-level crash handlers (duplicate of Security Finding 3.2)
- **Impact Level:** High
- **Component/File Path:** `server/server.js`
- **Cause:** See 3.2 — this is simultaneously a security (DoS-by-accident) and reliability concern, since it means the *availability* of the entire platform (jobseekers, employers, and PESO admin staff all depend on the same process) rests on every async code path in every controller never throwing unhandled.
- **Suggested Fix:** Same as 3.2. **Status: fixed alongside 3.2.**

### 4.3 [FIXED] In-process TF-IDF fallback recomputed on every request with no caching
- **Impact Level:** Medium
- **Component/File Path:** `server/services/semanticService.js`
- **Status:** ✅ Fixed — split the old `tfidfRank` into a pure `computeTfidfRanking(job, items)` (the expensive part: one `addDocument`/`listTerms` pass per job/candidate plus the O(n) cosine-similarity loop) and a caching wrapper. The cache key is a SHA-1 hash of the actual `buildJobText`/`buildApplicantText` output for the job and every candidate, not an id+timestamp pair — so correctness doesn't depend on some other code path remembering to bump an `updatedAt`: if a job description or a candidate's profile genuinely changes, the hashed text changes, the key changes, and the next request recomputes automatically. A 30-second TTL and a 200-entry cap (oldest-first eviction) bound memory use; they're a hygiene backstop, not the correctness mechanism. Verified with a manual script: a repeated call for the same job+candidates returns identical scores from cache (0ms), and mutating a candidate's profile text produces a fresh, different (correct) score on the next call.
- **Cause (original):** The code rebuilt a brand-new `TfIdf` index from scratch on every single request that hit this fallback path, regardless of whether the job/candidate data had changed since the last request.

### 4.4 [FIXED] Fire-and-forget error swallowing hides real failures from operators
- **Impact Level:** Medium
- **Component/File Path:** `authController.js` (5 sites), `jobController.js` (4 sites), `newsController.js` (1 site), `jobseekerDocumentController.js` (1 site) — all 12 matching `.catch(() => {})` sites in the codebase
- **Status:** ✅ Fixed — every one now logs via the new shared `utils/logger.js` with a specific, contextual message and relevant identifiers (user/job/application/document id) instead of discarding the error silently. The fire-and-forget behavior itself is unchanged by design (a login still shouldn't fail because `lastLoginAt` didn't save) — only the "zero signal on failure" problem is fixed.
- **Cause (original):** Every one of these discarded the error with an empty `.catch(() => {})`, meaning a systemic failure (e.g., SMTP misconfigured, or a storage-delete consistently failing) produced zero server-side log signal to notice it.

### 4.5 [PARTIALLY FIXED] No centralized/structured logging or monitoring hook
- **Impact Level:** Medium
- **Component/File Path:** `server/utils/logger.js` (new); wired into `server.js`, `config/db.js`, `middleware/security.js`, and the fixed sites from 4.4
- **Status:** ✅ Partially fixed — added a small dependency-free `utils/logger.js` that emits one JSON line per call (`{timestamp, level, message, ...fields}`) instead of free-form text, so a log platform (Render's viewer, or any downstream aggregator) can filter/query by level or field instead of full-text grep only. It replaces every `console.warn`/`console.error` on the reliability-relevant runtime path: the crash handlers (3.2), the global error handler, CORS-blocked warnings, Socket.IO auth warnings/errors, all 20 "failed to mount route" messages, the `securityLogger` middleware's `[SECURITY]`-prefixed logs, DB connect/fail, and the 12 previously-silent catches from 4.4. It also replaces a duplicate ad hoc `console.log`-wrapping "Simple logger" that had been defined locally inside `jobController.js` alone (now just imports the shared one, so every controller's log output is consistent). **Not changed:** the informational, high-volume boot-sequence messages in `server.js` (route-mounted confirmations, the socket-connected message) are left as plain `console.log` — they're benign human-readable startup chatter, not something an operator would alert on, and converting them added no monitoring value. Also not changed: the ~150 remaining `console.*` calls inside one-off developer CLI scripts under `server/scripts/` (migrations, seeders) — those are interactive tools a person runs and reads directly, not part of the always-on request-serving surface this finding is about.
- **Cause (original):** All logging went to stdout via `console.*` with no log levels or structured fields, and wasn't consistently applied (jobController.js had its own separate, non-shared "logger" object).
- **Remaining follow-up:** adopting a real logging library (pino/winston) with a log sink and alerting (e.g., on 5xx rate or the crash-handler paths firing) is still worth planning before a wider PESO-office rollout, but is a bigger infrastructure decision than this pass's scope.

### 4.6 [FIXED] Upload directories created synchronously at every server boot
- **Impact Level:** Low
- **Component/File Path:** `server/server.js`
- **Status:** ✅ Fixed — the blocking `fs.existsSync`/`fs.mkdirSync` loop was replaced with `fs.promises.mkdir(..., { recursive: true })` fired concurrently via `Promise.all` (each with its own `.catch` logging a failure through `utils/logger.js` instead of throwing unhandled). This no longer blocks the event loop during startup; the directories still only need to exist by the time the first upload request arrives, long after this resolves in practice. The broader legacy-`multer.diskStorage` migration noted below is unchanged and remains a separate, larger cleanup.
- **Cause (original):** `fs.existsSync`/`fs.mkdirSync` (synchronous) ran for 5 directories on every process start, blocking the event loop briefly before any request could be served. This was a symptom of the same legacy `multer.diskStorage` path in `server.js` that duplicates the newer, already-correct memory-storage + `storageService` pattern used everywhere else (`middleware/upload.js`).
- **Remaining follow-up:** consider completing the migration to the `storageService`-based upload pipeline and removing the legacy `multer.diskStorage` block and its three unused route stubs once confirmed nothing still depends on them — out of scope for this reliability pass.

---

## 5. Prioritized Remediation Roadmap

1. **[Do this now, independent of everything else]** Rotate the MongoDB Atlas password for user `alexis` on cluster `stram-peso.nevsgla.mongodb.net`, and update `MONGO_URI` in Render's environment and all local `.env` files. *(Finding 3.1)*
2. Remove the hardcoded connection-string fallback from all 6 affected scripts in `server/scripts/`, replacing with a fail-fast check on the env var. *(Finding 3.1)*
3. ✅ **Done.** Added `process.on("uncaughtException", ...)` and `process.on("unhandledRejection", ...)` handlers to `server.js`. *(Findings 3.2 / 4.2)*
4. ✅ **Done.** Upgraded `nodemailer` to `10.0.13` and confirmed via `npm audit` that the advisory clears. *(Finding 3.3)*
5. ✅ **Done.** The `/uploads` route now calls the same `canAccessRef` ownership check used by the signed-URL flow before serving any non-public file. *(Finding 3.4)*
6. ✅ **Done.** Added baseline security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`) to both `vercel.json` and `client/vercel.json`. A `Content-Security-Policy` is still pending — finalize the API/socket origin list first. *(Finding 3.6)*
7. ✅ **Done.** Added `server/utils/sendError.js` and migrated all 87 ad hoc `res.status(500).json({ message: error.message })` call sites across 16 controllers to use it, gated on an explicit `SHOW_ERROR_DETAILS` flag rather than `NODE_ENV`. *(Finding 3.7)*
8. ✅ **Done.** Ran `npm audit fix` — `express`/`qs`/`multer`/`brace-expansion` all updated within existing semver ranges. `npm audit` now reports 0 vulnerabilities. *(Finding 3.8)*
9. **Deferred by decision** — confirm whether the 41 already-committed files under `server/uploads/` contain real user data; if so, coordinate removal + history scrub with affected users' knowledge before doing a destructive git history rewrite + force-push. *(Finding 3.9)*
10. ✅ **Done.** Added `serverSelectionTimeoutMS`/`socketTimeoutMS`/`maxPoolSize` options to the `mongoose.connect()` call in `config/db.js`. *(Finding 4.1)*
11. ✅ **Done.** Added content-hash-keyed caching for the TF-IDF fallback path in `semanticService.js`, verified to hit cache correctly and invalidate on genuine content changes. *(Finding 4.3)*
12. ✅ **Done.** Replaced all 12 silent `.catch(() => {})` sites with contextual, logged error handling. *(Finding 4.4)*
13. ✅ **Done.** Added a shared structured JSON logger (`utils/logger.js`) and wired it into the full runtime error/warning/security-event surface (crash handlers, global error handler, CORS/socket-auth warnings, route-mount failures, `securityLogger`, DB connect). Adopting a full logging library + external alerting remains a follow-up for before a wider rollout. *(Finding 4.5)*
14. ✅ **Done.** Replaced the blocking startup `fs.mkdirSync` loop with non-blocking `fs.promises.mkdir`. *(Finding 4.6)*
15. **Deferred by decision** — migrating session storage off `localStorage` to HttpOnly cookies (Finding 3.5) requires a coordinated architecture change (CSRF protection, cross-origin cookie config, Socket.IO handshake rework); revisit when there's room for that work and its testing.
16. Longer-term / lower urgency: add access-control regression tests (Finding 3.12), and adopt a full logging library + alerting (Finding 4.5's remaining follow-up) before scaling the deployment beyond a single PESO office pilot.
