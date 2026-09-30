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
const sendError = (res, error, fallback = "Something went wrong", status = 500) =>
  res.status(status).json({
    message: process.env.SHOW_ERROR_DETAILS === "true" ? (error && error.message) || fallback : fallback,
  });

module.exports = { sendError };
