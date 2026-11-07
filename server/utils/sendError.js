// Central error-response helper for controller catch blocks.
//
// Many controllers used to do `res.status(500).json({ message: error.message })`
// directly, which returns raw Mongoose/MongoDB driver error text straight to
// the client — regardless of environment, since nothing here was gated on
// NODE_ENV the way the global handler in server.js is. `error.message` is
// only ever exposed when SHOW_ERROR_DETAILS=true is explicitly set (e.g. in
// a local .env for development) — deliberately not tied to NODE_ENV, so
// forgetting to set NODE_ENV=production on the host can no longer leak
// internals to real users the way it could before.
//
// It also logs every failure it reports. Before, a controller that caught an
// error and called this left no server-side trace at all, so a 500 could not
// be diagnosed from the logs. The log line carries the operation (method +
// route pattern), the authenticated user's id and role, the status sent, and
// the error with its stack. It never includes the request body, headers or
// query string, and token-shaped text is redacted from the error text first
// (some libraries, e.g. google-auth-library, echo the rejected credential in
// their error message).
const logger = require("./logger");

const REDACTIONS = [
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
  [/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]"],
  [/(segments in token:\s*)[^\n]*/gi, "$1[redacted]"],
  [/((?:token|credential|password|secret|authorization)["']?\s*[:=]\s*["']?)[^\s"',&;]+/gi, "$1[redacted]"],
];

const redact = (text) => {
  if (typeof text !== "string") return text;
  return REDACTIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
};

// Route pattern (e.g. "/api/v1/jobs/:id/apply"), never the concrete URL, so
// ids and query strings (which can carry tokens) stay out of the log.
const describeOperation = (req) => {
  if (!req) return undefined;
  const routePath = req.route && typeof req.route.path === "string" ? req.route.path : null;
  const path = routePath ? `${req.baseUrl || ""}${routePath}` : String(req.originalUrl || req.url || "").split("?")[0];
  return `${req.method || "?"} ${path}`;
};

const logFailure = (res, error, status, fallback) => {
  try {
    const req = res && res.req;
    const entry = {
      operation: describeOperation(req),
      userId: req && req.user && req.user.id ? String(req.user.id) : null,
      role: (req && req.user && req.user.role) || null,
      status,
      error: redact((error && error.message) || (typeof error === "string" ? error : fallback)),
    };
    if (status >= 500) {
      entry.stack = redact(error && error.stack);
      logger.error("Request failed", entry);
    } else {
      logger.warn("Request rejected", entry);
    }
  } catch {
    // Logging must never turn a handled error into a second failure.
  }
};

const sendError = (res, error, fallback = "Something went wrong", status = 500) => {
  logFailure(res, error, status, fallback);
  return res.status(status).json({
    message: process.env.SHOW_ERROR_DETAILS === "true" ? (error && error.message) || fallback : fallback,
  });
};

module.exports = { sendError, redact, describeOperation };
