// Minimal structured logger.
//
// Plain `console.log`/`console.error` calls (previously scattered across the
// codebase, including a one-off duplicate of this exact idea inside
// jobController.js) emit free-form text that a log platform like Render's
// dashboard can only full-text search, not filter or query by field. Every
// call here instead emits one JSON line — {timestamp, level, message, ...} —
// so "show me every 'error' level log for jobId X" becomes a structured
// query instead of a grep. Deliberately dependency-free: this is a thin
// formatting layer over console, not a full logging framework.
//
// Call signature matches plain console methods for drop-in compatibility:
// logger.error("Some error:", errorInstanceOrString) and
// logger.error("Some error:", { jobId, error: err.message }) both work. A
// single plain-object second argument is merged into the log entry's own
// fields (so it shows up queryable, not nested); anything else (a string, an
// Error, multiple args) is captured under `details`.
const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !(value instanceof Error) && !Array.isArray(value);

const format = (level, args) => {
  const [message, ...rest] = args;
  const entry = { timestamp: new Date().toISOString(), level, message };
  if (rest.length === 1 && isPlainObject(rest[0])) {
    Object.assign(entry, rest[0]);
  } else if (rest.length === 1) {
    entry.details = rest[0] instanceof Error ? rest[0].message : rest[0];
  } else if (rest.length > 1) {
    entry.details = rest.map((r) => (r instanceof Error ? r.message : r));
  }
  return JSON.stringify(entry);
};

const write = (level, stream, args) => stream(format(level, args));

module.exports = {
  info: (...args) => write("info", console.log, args),
  warn: (...args) => write("warn", console.warn, args),
  error: (...args) => write("error", console.error, args),
  debug: (...args) => write("debug", console.log, args),
};
