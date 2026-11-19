// A rejected analytics or report request: carries the HTTP status and a stable
// machine code (INVALID_FILTER, INVALID_PERIOD, COLUMN_NOT_ALLOWED, ...).
class AnalyticsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AnalyticsError";
    this.status = status;
    this.code = code;
  }
}

const invalidFilter = (message) => new AnalyticsError(400, "INVALID_FILTER", message);
const invalidPeriod = (message) => new AnalyticsError(400, "INVALID_PERIOD", message);

module.exports = { AnalyticsError, invalidFilter, invalidPeriod };
