// The report generator: validates a request against the catalog, runs the dataset, adds the
// "prepared by" facts, renders a file, and records it.
//
// Rules this file enforces:
//   - the preparer, report ID and timestamp come from the server, never from the request
//   - only catalog columns, groupings and formats are accepted
//   - above the row cap the request is refused (422), never truncated
//   - the audit entry is written BEFORE any byte is returned, and a failed audit write
//     fails the request: data leaving the system must always leave a trace
//   - one generation per account at a time

const crypto = require("crypto");
const User = require("../../models/User");
const AuditLog = require("../../models/AuditLog");
const ReportExport = require("../../models/ReportExport");
const { AnalyticsError } = require("../analytics/errors");
const { parseAnalyticsFilter, summarizeFilter } = require("../analytics/filters");
const { loadCatalog } = require("../analytics/catalog");
const { formatManilaStamp, formatManilaDate, manilaParts, startOfManilaDay } = require("../analytics/period");
const { suppressSmallCells } = require("../analytics/privacy");
const datasets = require("./datasets");
const { scopeCounts } = require("../analytics/overviewStats");
const { DATASETS, FORMATS, SENSITIVE_DATASETS, PURPOSE_MIN, PURPOSE_MAX, rowCapFor, catalogForRole } = require("./catalog");
const { FORMAT_RENDERERS } = require("./formats");

const SCHEMA_VERSION = 1;
const PREVIEW_ROWS = 20;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const fail = (status, code, message) => new AnalyticsError(status, code, message);

// ------------------------------------------------------------------ ids and small helpers

const newReportId = (now = new Date()) => {
  const p = manilaParts(now);
  const day = `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
  const bytes = crypto.randomBytes(8);
  let suffix = "";
  for (let i = 0; i < 8; i += 1) suffix += BASE32[bytes[i] % 32];
  return `RPT-${day}-${suffix}`;
};

// One generation per account at a time.
const inFlight = new Set();

// Purpose: free text, 10 to 200 characters, control characters removed.
const cleanPurpose = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw fail(400, "PURPOSE_REQUIRED", "The purpose must be text.");
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
};

const stringList = (value, name) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw fail(400, "INVALID_FILTER", `${name} must be a list of text values.`);
  return value;
};

// The stored canonical filter turned back into the query shape parseAnalyticsFilter reads
// (used to regenerate a report from its stored parameters).
const filterToQuery = (filter) => {
  const { period, section, ...rest } = filter;
  const query = { ...rest };
  if (period) {
    query.period = period.type;
    for (const key of ["year", "quarter", "month", "from", "to"]) if (period[key] !== undefined) query[key] = String(period[key]);
  }
  void section;
  return query;
};

// ------------------------------------------------------------------ validation

// body: { dataset, params, columns, grouping, format, purpose }
const validateRequest = async (user, body, now) => {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const dataset = typeof input.dataset === "string" ? DATASETS[input.dataset] : null;
  if (!dataset) throw fail(400, "INVALID_FILTER", "Unknown dataset.");
  if (!dataset.roles.includes(user.role)) throw fail(403, "DATASET_FORBIDDEN", "You are not allowed to generate this report.");

  const format = input.format === undefined ? "csv" : input.format;
  if (typeof format !== "string" || !FORMATS.includes(format) || !FORMAT_RENDERERS[format]) throw fail(400, "INVALID_FILTER", "That file format is not available.");

  const allowedKeys = dataset.columns.map((column) => column.key);
  const requested = stringList(input.columns, "columns");
  for (const key of requested) if (!allowedKeys.includes(key)) throw fail(400, "COLUMN_NOT_ALLOWED", `Column ${key} is not available for this report.`);
  const chosen = requested.length ? allowedKeys.filter((key) => requested.includes(key)) : dataset.columns.filter((column) => column.default).map((column) => column.key);

  const defaultGrouping = dataset.defaultGrouping || (dataset.groupings.includes("none") ? "none" : "none");
  const grouping = input.grouping === undefined || input.grouping === "" ? defaultGrouping : input.grouping;
  if (grouping !== "none" && !dataset.groupings.includes(grouping)) throw fail(400, "INVALID_FILTER", "That grouping is not available for this report.");

  const purpose = cleanPurpose(input.purpose);
  if (dataset.needsPurpose && (purpose.length < PURPOSE_MIN || purpose.length > PURPOSE_MAX)) {
    throw fail(400, "PURPOSE_REQUIRED", `State the purpose of this report in ${PURPOSE_MIN} to ${PURPOSE_MAX} characters.`);
  }

  const query = input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : {};
  const catalog = await loadCatalog();
  const parsed = parseAnalyticsFilter(query, { section: dataset.section, now, catalog });
  // A dataset that does not read the municipality never prints one in its header.
  if (!dataset.municipality) delete parsed.filter.municipality;

  return { dataset, format, columns: chosen, grouping, purpose, parsed };
};

// A report over a scope with fewer than 1 vacancy or 3 applications is refused before anything is
// exported or logged as a success.
const ensureEnoughData = async (spec) => {
  if (!spec.dataset.needsData) return;
  const counts = await scopeCounts(spec.parsed.period, spec.parsed.filter.municipality || null);
  if (!counts.enough) throw fail(422, "NOT_ENOUGH_DATA", "There is not enough data for this period and municipality to make a report.");
};

// ------------------------------------------------------------------ data

const bracketKey = { ageBracket: "_bracket" };

// Groups row-level data into { group, count } rows. Counts about age go through the
// small-cell rule (a count of 1 to 4 becomes "under 5").
const groupRows = (dataset, rows, grouping) => {
  const counts = new Map();
  const dateField = dataset.groupDate;
  const keyOf = (row) => {
    if (grouping === "month") return String(row[dateField] || "").slice(0, 7) || "unknown";
    return String(row[bracketKey[grouping] || grouping] ?? "unknown") || "unknown";
  };
  for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1);
  let entries = [...counts.entries()].map(([key, value]) => ({ key, value }));
  entries = grouping === "month" ? entries.sort((a, b) => a.key.localeCompare(b.key)) : entries.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  if (grouping === "ageBracket") {
    const safe = suppressSmallCells(entries, { total: rows.length });
    return safe.cells.map((cell) => ({ group: cell.key, count: cell.suppressed ? datasets.UNDER_FIVE : cell.value }));
  }
  return entries.map((entry) => ({ group: entry.key, count: entry.value }));
};

const FETCHERS = {
  jobs: (spec, ctx) => datasets.jobsRows(spec.parsed.filter, spec.parsed.period, ctx),
  employers: (spec, ctx) => datasets.employersRows(spec.parsed.filter, spec.parsed.period, ctx),
  applications: (spec, ctx) => datasets.applicationsRows(spec.parsed.filter, spec.parsed.period, ctx),
  hires: (spec, ctx) => datasets.hiresRows(spec.parsed.filter, spec.parsed.period, ctx),
};

// Runs the dataset. limit: how many rows to return (the preview takes a few; a report takes up to the cap).
// Returns { rows, columns, recordCount, notes }.
const fetchData = async (spec, { now, limit }) => {
  const { dataset, format, grouping } = spec;
  const cap = rowCapFor(format);
  const notes = [];

  if (dataset.kind === "rows") {
    const grouped = grouping !== "none";
    // A grouped report reads every matching row (still capped) and returns one row per group.
    const { rows, total } = await FETCHERS[dataset.id](spec, { now, limit: grouped ? cap + 1 : Math.min(limit, cap + 1), cap });
    if (total > cap) throw fail(422, "EXPORT_TOO_LARGE", `This report has more than ${cap} rows. Narrow the filters.`);
    if (grouped) {
      const out = groupRows(dataset, rows, grouping);
      if (grouping === "ageBracket") notes.push("Counts of 1 to 4 are shown as 'under 5' to protect privacy.");
      return { rows: out.slice(0, limit), columns: [{ key: "group", label: groupLabel(grouping) }, { key: "count", label: "Count" }], recordCount: out.length, notes };
    }
    notes.push("Account and application status are as of the time this report was generated.");
    // Only the chosen columns leave this function: helper fields used for grouping are dropped.
    const picked = rows.slice(0, limit).map((row) => Object.fromEntries(spec.columns.map((key) => [key, row[key]])));
    return { rows: picked, columns: dataset.columns.filter((column) => spec.columns.includes(column.key)).map(({ key, label }) => ({ key, label })), recordCount: total, notes };
  }

  let rows;
  if (dataset.id === "jobseekers") {
    rows = await datasets.jobseekersRows(spec.parsed, { grouping });
    notes.push("Counts of 1 to 4 are shown as 'under 5' to protect privacy.");
  } else if (dataset.id === "spes") {
    const query = (section) => parseAnalyticsFilter({ ...filterToQuery(spec.parsed.filter), dataset: "spes" }, { section, now });
    rows = await datasets.spesRows(query);
    notes.push("SPES applicants include minors: counts of 1 to 4 are shown as 'under 5'.");
  } else if (dataset.id === "employer_ranking") {
    rows = await datasets.rankingRows(filterToQuery(spec.parsed.filter), now);
    notes.push("Ranked by hires, then hire rate (lower bound of the 95% Wilson interval), fill rate, median days to hire, then name.");
  } else if (dataset.id === "verification_activity") {
    rows = await datasets.verificationRows(spec.parsed.period);
  } else {
    rows = await datasets.auditRows(spec.parsed.period);
    notes.push("Counts only. No actor, address or message is included.");
  }
  if (rows.length > cap) throw fail(422, "EXPORT_TOO_LARGE", `This report has more than ${cap} rows. Narrow the filters.`);
  return { rows: rows.slice(0, limit), columns: dataset.columns.filter((column) => spec.columns.includes(column.key)).map(({ key, label }) => ({ key, label })), recordCount: rows.length, notes };
};

const GROUP_LABELS = { month: "Month", municipality: "Municipality", employer: "Employer", status: "Status", ageBracket: "Age bracket", verificationStatus: "Verification status" };
const groupLabel = (grouping) => GROUP_LABELS[grouping] || "Group";

// ------------------------------------------------------------------ prepared by

const loadPreparer = async (user) => {
  // Re-read from the database: the name, role and office on a report are never taken from the request or token.
  const record = await User.findById(user._id).select("name role staffNote").lean();
  if (!record) throw fail(401, "UNAUTHORIZED", "Account not found.");
  const note = typeof record.staffNote === "string" ? record.staffNote.trim() : "";
  return { userId: record._id, name: record.name || "", role: record.role, staffNote: note || null };
};

const buildMeta = ({ spec, reportId, preparer, generatedAt, recordCount, notes, regeneratedFrom }) => {
  const { dataset, parsed } = spec;
  const lines = [
    ["Report ID", reportId],
    ["Prepared by", preparer.name],
    ["Role", preparer.role],
  ];
  // Never guessed: the office or position is printed only when the superadmin recorded one.
  if (preparer.staffNote) lines.push(["Office or position", preparer.staffNote]);
  lines.push(["Generated at", formatManilaStamp(generatedAt)], ["Dataset", dataset.label], ["Period", parsed.period.label]);
  for (const row of summarizeFilter(parsed.filter).filter((item) => item.label !== "Period")) lines.push([row.label === "Dataset" ? "Source" : row.label, row.value]);
  if (spec.grouping !== "none") lines.push(["Grouped by", groupLabel(spec.grouping)]);
  lines.push(["Record count", String(recordCount)]);
  if (spec.purpose) lines.push(["Purpose", spec.purpose]);
  lines.push(["Schema version", String(SCHEMA_VERSION)]);
  if (parsed.period.isPartial) lines.push(["Note", `Period in progress, as of ${formatManilaDate(parsed.period.asOf)}.`]);
  if (regeneratedFrom) lines.push(["Note", `Regenerated from ${regeneratedFrom}; data as of ${formatManilaStamp(generatedAt)}.`]);
  for (const note of notes) lines.push(["Note", note]);
  return { title: `${dataset.label}: ${parsed.period.label}`, lines };
};

// ------------------------------------------------------------------ public operations

// POST /admin/report-exports/preview
const previewReport = async (user, body, now = new Date()) => {
  const spec = await validateRequest(user, body, now);
  const preparer = await loadPreparer(user);
  const cap = rowCapFor(spec.format);
  try {
    await ensureEnoughData(spec);
    const data = await fetchData(spec, { now, limit: PREVIEW_ROWS });
    return { dataset: spec.dataset.id, recordCount: data.recordCount, wouldExceedLimit: false, columns: data.columns, sample: data.rows, preparedBy: { name: preparer.name, role: preparer.role, ...(preparer.staffNote ? { office: preparer.staffNote } : {}) }, maxRows: cap, period: spec.parsed.period.label };
  } catch (error) {
    if (error instanceof AnalyticsError && error.code === "NOT_ENOUGH_DATA") {
      return { dataset: spec.dataset.id, recordCount: null, wouldExceedLimit: false, notEnoughData: true, columns: [], sample: [], preparedBy: { name: preparer.name, role: preparer.role }, maxRows: cap, period: spec.parsed.period.label };
    }
    if (error instanceof AnalyticsError && error.code === "EXPORT_TOO_LARGE") {
      return { dataset: spec.dataset.id, recordCount: null, wouldExceedLimit: true, columns: [], sample: [], preparedBy: { name: preparer.name, role: preparer.role }, maxRows: cap, period: spec.parsed.period.label };
    }
    throw error;
  }
};

const record = (spec) => ({ dataset: spec.dataset.id, format: spec.format, params: spec.parsed.filter, columns: spec.columns, grouping: spec.grouping, purpose: spec.purpose });

// Strict audit write: unlike logAuditEvent it does not swallow an error, because a report must not leave without a trace.
const writeAudit = ({ req, user, reportId, spec, recordCount, regeneratedFrom }) => {
  const ip = req ? (typeof req.headers?.["x-forwarded-for"] === "string" && req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0].trim() : req.ip || "") : "";
  return AuditLog.create({
    actorId: user._id,
    actorRole: user.role,
    action: "report.generated",
    targetType: "report",
    targetId: reportId,
    severity: SENSITIVE_DATASETS.includes(spec.dataset.id) ? "warning" : "info",
    ipAddress: ip,
    userAgent: req?.headers?.["user-agent"] || "",
    metadata: {
      reportId,
      dataset: spec.dataset.id,
      format: spec.format,
      recordCount,
      grouping: spec.grouping,
      period: spec.parsed.period.label,
      filters: summarizeFilter(spec.parsed.filter).map((row) => `${row.label}: ${row.value}`),
      purpose: spec.purpose || undefined,
      regeneratedFrom: regeneratedFrom || undefined,
    },
  });
};

// Best effort: the request is refused either way, so a failed history write must not hide the real reason.
const recordBlocked = async ({ spec, preparer, reason, now, regeneratedFrom }) => {
  try {
    await ReportExport.create({
      reportId: newReportId(now),
      preparedBy: preparer,
      ...record(spec),
      periodFrom: spec.parsed.period.from,
      periodTo: spec.parsed.period.to,
      recordCount: 0,
      contentSha256: "",
      status: "blocked",
      blockedReason: reason,
      regeneratedFrom,
      schemaVersion: SCHEMA_VERSION,
    });
  } catch (error) {
    void error;
  }
};

// POST /admin/report-exports  (and regenerate)
// Returns { bytes, filename, contentType, reportId, recordCount }.
const generateReport = async (user, body, { req = null, now = new Date(), regeneratedFrom = null } = {}) => {
  const key = String(user._id);
  if (inFlight.has(key)) throw fail(429, "REPORT_IN_PROGRESS", "A report is already being generated for your account. Wait for it to finish.");
  inFlight.add(key);
  const started = Date.now();
  try {
    const spec = await validateRequest(user, body, now);
    const preparer = await loadPreparer(user);
    try {
      await ensureEnoughData(spec);
    } catch (error) {
      // A refused report is kept in the history as "blocked" with its reason; no file, no audit of an export.
      if (error instanceof AnalyticsError && error.code === "NOT_ENOUGH_DATA") await recordBlocked({ spec, preparer, reason: "NOT_ENOUGH_DATA", now, regeneratedFrom });
      throw error;
    }
    const data = await fetchData(spec, { now, limit: rowCapFor(spec.format) + 1 });
    const reportId = newReportId(now);
    const meta = buildMeta({ spec, reportId, preparer, generatedAt: now, recordCount: data.recordCount, notes: data.notes, regeneratedFrom });
    const renderer = FORMAT_RENDERERS[spec.format];
    const bytes = await renderer.render({ meta, columns: data.columns, rows: data.rows, spec: { dataset: spec.dataset.id, format: spec.format } });
    const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    // Audit first, history second, bytes last: if either write fails nothing is returned.
    await writeAudit({ req, user, reportId, spec, recordCount: data.recordCount, regeneratedFrom });
    await ReportExport.create({
      reportId,
      preparedBy: preparer,
      ...record(spec),
      periodFrom: spec.parsed.period.from,
      periodTo: spec.parsed.period.to,
      recordCount: data.recordCount,
      contentSha256,
      durationMs: Date.now() - started,
      regeneratedFrom,
      schemaVersion: SCHEMA_VERSION,
    });
    return { bytes, filename: `${reportId}.${renderer.extension}`, contentType: renderer.contentType, reportId, recordCount: data.recordCount };
  } finally {
    inFlight.delete(key);
  }
};

const canSee = (user, item) => user.role === "superadmin" || String(item.preparedBy.userId) === String(user._id);

// GET /admin/report-exports
// Every history filter is a whitelist; anything else is a 400, never ignored.
const HISTORY_SORTS = Object.freeze({ newest: { createdAt: -1, _id: -1 }, oldest: { createdAt: 1, _id: 1 } });

const historyText = (value, name) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw fail(400, "INVALID_FILTER", `${name} is not valid.`);
  return value.trim();
};

const historyInt = (value, name, { min, max, fallback }) => {
  const text = historyText(value, name);
  if (text === "") return fallback;
  if (!/^\d{1,6}$/.test(text)) throw fail(400, "INVALID_FILTER", `${name} is not valid.`);
  const n = Number(text);
  if (n < min || n > max) throw fail(400, "INVALID_FILTER", `${name} is out of range.`);
  return n;
};

const historyDay = (value, name) => {
  const text = historyText(value, name);
  if (text === "") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw fail(400, "INVALID_FILTER", `${name} must be a date like 2026-03-31.`);
  const [, y, m, d] = match.map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw fail(400, "INVALID_FILTER", `${name} is not a real date.`);
  return { y, m, d };
};

// GET /admin/report-exports
const listReports = async (user, query = {}) => {
  const page = historyInt(query.page, "page", { min: 1, max: 100000, fallback: 1 });
  const limit = historyInt(query.limit, "limit", { min: 1, max: 50, fallback: 20 });
  const dataset = historyText(query.dataset, "dataset");
  if (dataset && !Object.prototype.hasOwnProperty.call(DATASETS, dataset)) throw fail(400, "INVALID_FILTER", "dataset is not an allowed value.");
  const format = historyText(query.format, "format");
  if (format && !FORMATS.includes(format)) throw fail(400, "INVALID_FILTER", "format is not an allowed value.");
  const sortKey = historyText(query.sort, "sort") || "newest";
  if (!Object.prototype.hasOwnProperty.call(HISTORY_SORTS, sortKey)) throw fail(400, "INVALID_FILTER", "sort is not an allowed value.");
  const from = historyDay(query.from, "from");
  const to = historyDay(query.to, "to");
  if (from && to && Date.UTC(from.y, from.m - 1, from.d) > Date.UTC(to.y, to.m - 1, to.d)) throw fail(400, "INVALID_FILTER", "from is after to.");

  const filter = {};
  // Who may read what is decided here, not by the client: a PESO admin sees only their own reports.
  if (user.role !== "superadmin") filter["preparedBy.userId"] = user._id;
  if (dataset) filter.dataset = dataset;
  if (format) filter.format = format;
  const range = {};
  // Whole Manila days: from the start of the first day to the start of the day after the last.
  if (from) range.$gte = startOfManilaDay(from.y, from.m, from.d);
  if (to) range.$lt = startOfManilaDay(to.y, to.m, to.d + 1);
  if (Object.keys(range).length) filter.createdAt = range;

  const [items, total] = await Promise.all([
    ReportExport.find(filter).sort(HISTORY_SORTS[sortKey]).skip((page - 1) * limit).limit(limit).lean(),
    ReportExport.countDocuments(filter),
  ]);
  return { items: items.map(publicRecord), total, page, totalPages: Math.max(Math.ceil(total / limit), 1) };
};

const publicRecord = (item) => ({
  reportId: item.reportId,
  dataset: item.dataset,
  format: item.format,
  grouping: item.grouping,
  columns: item.columns,
  params: item.params,
  recordCount: item.recordCount,
  purpose: item.purpose || "",
  preparedBy: { name: item.preparedBy?.name || "", role: item.preparedBy?.role || "" },
  contentSha256: item.contentSha256,
  regeneratedFrom: item.regeneratedFrom || null,
  createdAt: item.createdAt,
  // History columns: how the period was chosen, the municipality, and whether a file was made.
  period: {
    type: (item.params && item.params.period && item.params.period.type) || null,
    from: item.periodFrom ? formatManilaDate(item.periodFrom) : null,
    to: item.periodTo ? formatManilaDate(new Date(new Date(item.periodTo).getTime() - 1)) : null,
  },
  municipality: (item.params && item.params.municipality) || null,
  result: item.status === "blocked" ? "blocked" : "made",
  blockedReason: item.status === "blocked" ? item.blockedReason || null : null,
});

// GET /admin/report-exports/:reportId
const getReport = async (user, reportId) => {
  const item = typeof reportId === "string" ? await ReportExport.findOne({ reportId }).lean() : null;
  // Someone else's report is reported as not found, so its existence is not leaked.
  if (!item || !canSee(user, item)) throw fail(404, "REPORT_NOT_FOUND", "Report not found.");
  return publicRecord(item);
};

// POST /admin/report-exports/:reportId/regenerate
const regenerateReport = async (user, reportId, { req = null, now = new Date() } = {}) => {
  const item = typeof reportId === "string" ? await ReportExport.findOne({ reportId }).lean() : null;
  if (!item || !canSee(user, item)) throw fail(404, "REPORT_NOT_FOUND", "Report not found.");
  return generateReport(
    user,
    { dataset: item.dataset, params: filterToQuery(item.params || {}), columns: item.columns, grouping: item.grouping, format: item.format, purpose: item.purpose },
    { req, now, regeneratedFrom: item.reportId }
  );
};

module.exports = {
  newReportId,
  cleanPurpose,
  filterToQuery,
  groupRows,
  validateRequest,
  previewReport,
  generateReport,
  listReports,
  getReport,
  regenerateReport,
  catalogForRole,
  _inFlight: inFlight,
};
