// Best-effort runner for steps that happen AFTER the primary write committed
// (notifications, system messages, secondary audit lookups).
//
// Once the database write has succeeded, a failure in one of these steps must
// not turn the request into an error: the client would retry a write that
// already happened ("already applied" / duplicate rows), and upload cleanup
// would delete files the saved record still points at. So this runs the step,
// swallows any throw, and logs it with enough context to find it again.
//
// Never logs request bodies or tokens; error text and stack go through the
// same redaction as sendError.
const logger = require("./logger");
const { redact } = require("./sendError");

/**
 * @param {string} step  short name of the step, e.g. "application.notify_employer"
 * @param {{req?: object, resourceId?: string, resourceType?: string}} ctx
 * @param {() => Promise<any>} fn
 * @returns {Promise<boolean>} true when the step completed, false when it failed
 */
const runPostCommit = async (step, ctx, fn) => {
  try {
    await fn();
    return true;
  } catch (error) {
    try {
      const req = (ctx && ctx.req) || null;
      logger.error("Post-commit step failed", {
        step,
        resourceType: (ctx && ctx.resourceType) || undefined,
        resourceId: ctx && ctx.resourceId ? String(ctx.resourceId) : undefined,
        userId: req && req.user && req.user.id ? String(req.user.id) : null,
        role: (req && req.user && req.user.role) || null,
        error: redact(error && error.message),
        stack: redact(error && error.stack),
      });
    } catch {
      // Logging must never fail the request either.
    }
    return false;
  }
};

module.exports = { runPostCommit };
