# STRAM-PESO — Security Baseline Audit

**Scope:** 6 Basic Capstone Security Features, verified against actual source (not assumed) — `server/middleware`, `server/controllers/authController.js`, `server/server.js`, `server/config/db.js`, `server/models`.

## 1. Security Baseline Matrix

| Security Feature | Status | Primary File(s) Checked | Brief Evidence / Missing Gap |
|---|---|---|---|
| Password Hashing | **Pass** | `authController.js:83,139,306,399,963` | `bcrypt.hash(password, 10)` on every write path (register, reset, change-password); `bcrypt.compare` on every read path. 10 rounds meets the ≥10 floor exactly. |
| JWT / Session Handling | **Pass** | `authController.js:110-113,161-164,250-253`; `middleware/auth.js:7-63` | Every `jwt.sign` call sets explicit `expiresIn` (`30d` for normal sessions, `7d` for suspension-appeal tokens). Server validates via `Authorization: Bearer <token>` and `jwt.verify` in `verifyToken` — satisfies the "validated Auth headers" option. *Note:* the client stores this token in `localStorage`, not an HttpOnly cookie — standard for a Bearer-token SPA, but worth knowing it's readable by any injected script if an XSS ever slipped past the input sanitization below. |
| Environment Variables | **Pass** | `server/.env.example`; `.gitignore:13-18`; `authController.js` (`process.env.JWT_SECRET`, all `bcrypt`/`jwt` calls) | No hardcoded secrets found anywhere in `server/`. `.gitignore` excludes `.env`/`.env.*` at both root and `**/` scope, only `.env.example` (template, no real values) is tracked. No `\|\| "fallback-secret"` pattern on `JWT_SECRET`. |
| Role-Based Access Control | **Pass** | `middleware/auth.js:97-161`; all `server/routes/*.js` | `isResident`/`isEmployer`/`isVerifiedEmployer`/`isAdmin`/`isSuperadmin` role guards exist and are chained after `verifyToken` on every non-public route across all 20 route files (verified per-file). |
| Data / Record Isolation | **Partial** | `controllers/employerController.js` (ownership checks, e.g. `String(application.vacancy.employer) !== employerId`); `controllers/fileController.js:9-41`; `server.js:221-236` | Most controllers correctly scope queries to the requester's own records. Two exceptions: (1) `fileController.js`'s `canAccessRef` grants a private document only to its owner or an `admin` — it never checks "is this the employer who owns the vacancy," so employers can't open applicant résumés through the signed-URL path despite the UI rendering that link. (2) The `/uploads` static route (below) bypasses ownership checking entirely. |
| Injection Guards | **Pass** | `server.js:119` (`app.use(mongoSanitize())`); `server.js:120` (`hpp()`); all Mongoose models | `express-mongo-sanitize` strips `$`/`.` operator injection from `req.body`/`req.query`/`req.params` globally. All DB access goes through Mongoose ODM methods — no raw/string-concatenated queries found anywhere in `server/controllers`. |
| Payload Validation | **Pass** | `middleware/validation.js` (`validateUserRegistration`, `validateUserLogin`, etc.); `middleware/security.js:29-46` (`detectMaliciousPayload`) | Custom regex-based validators enforce field length, email format, and password complexity (`/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*...])/`) before controllers run. `sanitizeInput` uses the real `xss` npm package, not a homegrown filter. `detectMaliciousPayload` additionally blocks script tags, `javascript:`/`vbscript:` URIs, and `__proto__`/`constructor` prototype-pollution keys. |
| Auth Rate Limiting | **Partial** | `server.js:96-101,158-163` | `authLimiter` (50 req / 15 min, `skipSuccessfulRequests`) is correctly mounted on `/login`, `/register`, `/forgot-password`, `/reset-password`, `/google`, `/email-change`. Implementation is sound — see Operational Check below for why it may not actually run. |
| Global Rate Limiting | **Partial** | `server.js:87-93,153` | `globalLimiter` (500 req / 15 min) is mounted on all of `/api`. Same caveat as above. |
| Operational Check (rate limiting) | **Fail** | `server.js:62` | `disableRateLimits = process.env.DISABLE_RATE_LIMITS === "true" \|\| process.env.NODE_ENV !== "production"` — **every limiter silently becomes a no-op unless the host explicitly sets `NODE_ENV=production`.** Nothing in `server/.env.example` or the repo's deploy config sets it. This is exactly the "unintended runtime condition" this checklist item asks about. |
| Upload Access Control | **Fail** | `server.js:221-236` | The `/uploads` guard checks only that an `Authorization` header is *present* (`if (!isPublicImage && !authHeader)`) — it never calls `jwt.verify` and never checks file ownership. Any non-empty header (expired, malformed, or another user's) passes straight through to `express.static`. |
| File Validation | **Pass** | `middleware/upload.js:18-46` | `MAX_FILE_SIZE` (5MB generic) / `AVATAR_MAX_FILE_SIZE` (2MB) enforced via multer's `limits.fileSize`. `fileFilter` rejects any MIME type not in the `ALLOWED_FILE_TYPES` whitelist before the file is even buffered. |
| Leak Prevention | **Partial** | `server.js:611-628` | Raw stack traces are **never** sent to the client — only `console.error`'d server-side, which is correct regardless of environment. But the error *message* (`err.message`) is only swapped for a generic "Something went wrong" when `NODE_ENV === "production"` — the same unguaranteed condition as the rate-limit gap above, so internal error text can leak to clients in whatever environment the host actually runs. |
| Crash Protection | **Fail** | `server.js` (repo-wide search, no matches) | No `process.on("unhandledRejection", ...)` or `process.on("uncaughtException", ...)` exists anywhere in the codebase. One unawaited rejected promise outside a try/catch can terminate the entire Node process. |

## 2. Actionable Remediation Checklist

**`server.js:62` — Operational Check (rate limiting) — Fail**
Two separate concerns got merged into one flag. Decouple them:
```js
// Before
const disableRateLimits = process.env.DISABLE_RATE_LIMITS === "true" || process.env.NODE_ENV !== "production";

// After — rate limiting is opt-out only, never tied to NODE_ENV
const disableRateLimits = process.env.DISABLE_RATE_LIMITS === "true";
```
Then add `NODE_ENV=production` to the actual Render/host environment variables (not just locally), and set `DISABLE_RATE_LIMITS=true` only in your local `.env` for dev.

**`server.js:221-236` — Upload Access Control — Fail**
```js
// Before
app.use("/uploads", (req, res, next) => {
  const authHeader = req.headers.authorization;
  const isPublicImage = req.path.includes("/profiles/") || req.path.includes("/news/");
  if (!isPublicImage && !authHeader) {
    return res.status(403).json({ message: "Access denied" });
  }
  ...
});

// After — actually verify the token, then check ownership per-file
const jwt = require("jsonwebtoken");
app.use("/uploads", (req, res, next) => {
  const isPublicImage = req.path.includes("/profiles/") || req.path.includes("/news/");
  if (isPublicImage) return next();

  const token = req.headers.authorization?.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(403).json({ message: "Access denied" });
  }
  next(); // still relies on UUID filenames for the ownership gap below — see fileController fix
});
```

**`server/controllers/fileController.js:9-41` — Data / Record Isolation — Partial**
```js
// Add an employer-side branch to canAccessRef's Promise.all:
JobVacancy.exists({
  employer: userId,
  _id: { $in: await JobApplication.find({ $or: [{ resume: ref }, { coverLetterFile: ref }] }).distinct("vacancy") },
}),
```

**`server.js:611-628` — Leak Prevention — Partial**
```js
// Before
message: process.env.NODE_ENV === "production" ? "Something went wrong" : err.message,

// After — default to safe, only show detail when explicitly opted into dev mode
message: process.env.SHOW_ERROR_DETAILS === "true" ? err.message : "Something went wrong",
```
This removes the same `NODE_ENV` single-point-of-failure the rate limiter has — pick one explicit env var and require it to be turned *on* for verbose errors, rather than requiring `NODE_ENV=production` to turn them *off*.

**`server.js` — Crash Protection — Fail**
Add near the top of the file, after `const app = express();`:
```js
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1); // let a process manager (PM2/Render) restart cleanly rather than run in a corrupted state
});
```

## 3. Final Verdict

The codebase implements every core security *mechanism* a capstone defense would look for — bcrypt hashing, RBAC middleware, NoSQL-injection sanitization, regex payload validation, MIME/size-limited uploads — correctly and consistently. The real risk is operational, not architectural: rate limiting and error-message redaction both silently depend on `NODE_ENV=production` being manually set on the host, and one static-file route plus one file-ownership check have gaps that would let an authenticated-but-unauthorized user reach another user's private documents; fixing those five items (all provided above) closes the gap between "secure design" and "secure deployment."
