// Filter and sort for the superadmin / admin user directory and its CSV export.
// One builder shared by both, so a filtered list and its export can never
// disagree. Pure: takes the query string object, returns a Mongo filter + sort.
const { escapeRegex } = require("./sanitize");

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_DAYS = 90;
const SEARCH_MAX = 100;

const VERIFICATION_STATUSES = ["unverified", "pending", "under_review", "verified", "resubmission_required", "rejected"];
const STATUS_FILTERS = ["active", "suspended", "banned", "deactivated", "deleted"];
const SORT_FIELDS = { joined: "createdAt", lastActive: "lastActiveAt", name: "name" };

const flag = (value) => String(value || "").trim().toLowerCase() === "true";
const text = (value) => String(Array.isArray(value) ? value[0] : value || "").trim();

// Active / inactive-by-reason, as the directory shows them.
const statusClause = (status) => {
  switch (status) {
    case "active":
      return { isActive: { $ne: false }, deletedAt: null };
    case "suspended":
      return { isActive: false, deletedAt: null, accountStatus: { $nin: ["banned", "deactivated"] } };
    case "banned":
      return { isActive: false, deletedAt: null, accountStatus: "banned" };
    case "deactivated":
      return { isActive: false, deletedAt: null, accountStatus: "deactivated" };
    case "deleted":
      return { deletedAt: { $ne: null } };
    default:
      return null;
  }
};

const buildDirectoryQuery = (query = {}, { isSuperadmin = false, now = Date.now() } = {}) => {
  // Superadmin accounts are invisible to the directory.
  const filter = { role: { $ne: "superadmin" } };
  const and = [];

  const role = text(query.role);
  if (["employer", "jobseeker", "admin"].includes(role)) filter.role = role;

  const verification = text(query.verificationStatus);
  if (VERIFICATION_STATUSES.includes(verification)) filter.verificationStatus = verification;

  const isActiveRaw = text(query.isActive);
  if (["true", "false"].includes(isActiveRaw)) filter.isActive = isActiveRaw === "true";

  // Deleted accounts: hidden unless a superadmin asks (status=deleted, or the
  // older deleted=include|only switch). Admins always get the default.
  const status = text(query.status);
  const deletedMode = text(query.deleted);
  let deletedHandled = false;
  if (isSuperadmin && status === "deleted") {
    and.push(statusClause("deleted"));
    deletedHandled = true;
  } else if (isSuperadmin && deletedMode === "only") {
    filter.deletedAt = { $ne: null };
    deletedHandled = true;
  } else if (isSuperadmin && deletedMode === "include" && !STATUS_FILTERS.includes(status)) {
    deletedHandled = true;
  }
  if (STATUS_FILTERS.includes(status) && status !== "deleted") {
    and.push(statusClause(status));
    deletedHandled = true;
  }
  if (!deletedHandled) filter.deletedAt = null;

  if (flag(query.noEmail)) {
    and.push({ $or: [{ email: { $exists: false } }, { email: null }, { email: "" }] });
  }

  if (flag(query.lockedNow)) {
    filter["loginLock.lockedUntil"] = { $gt: new Date(now) };
  }

  if (flag(query.idle90)) {
    const cutoff = new Date(now - IDLE_DAYS * DAY_MS);
    and.push({ $or: [{ lastActiveAt: null }, { lastActiveAt: { $lt: cutoff } }] });
    and.push({ $or: [{ lastLoginAt: null }, { lastLoginAt: { $lt: cutoff } }] });
    and.push({ createdAt: { $lt: cutoff } });
  }

  const search = text(query.search || query.q).slice(0, SEARCH_MAX);
  if (search) {
    const pattern = { $regex: escapeRegex(search), $options: "i" };
    // Username-only accounts have no email: staff find them by username.
    and.push({ $or: [{ name: pattern }, { email: pattern }, { username: pattern }] });
  }

  if (and.length) filter.$and = and;

  const sortKey = SORT_FIELDS[text(query.sort)] ? text(query.sort) : "joined";
  const order = text(query.order) === "asc" ? 1 : text(query.order) === "desc" ? -1 : sortKey === "name" ? 1 : -1;
  const sort = { [SORT_FIELDS[sortKey]]: order, _id: order };

  return { filter, sort, sortKey, caseInsensitiveSort: sortKey === "name" };
};

module.exports = { buildDirectoryQuery, VERIFICATION_STATUSES, STATUS_FILTERS, IDLE_DAYS };
