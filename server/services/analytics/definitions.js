// One definition per metric, shared by every analytics endpoint (the Dashboard, Analytics & Reports
// and the "not enough data" check of the report generator). Pure functions: no database here.
//
//   Application status   one bucket per application; the buckets always add up to the application total.
//                        A status the code does not know goes to "other", never silently dropped.
//   Hires                applications whose status is hired (the legacy "accepted" counts too).
//                        So "Hired" in the status breakdown IS the hires figure.
//   Vacancy status       open (active, not archived), closed (closed, not archived), archived.
//                        Closed never includes archived. A draft is not a posted vacancy and is not counted.
//   Role                 titles are compared ignoring capitals and repeated spaces; the spelling shown is
//                        the most common original one. Stored titles are never changed.

const APPLICATION_STATUS_ORDER = Object.freeze(["pending", "under_review", "shortlisted", "approved", "rejected", "hired", "withdrawn", "other"]);
const VACANCY_STATUS_ORDER = Object.freeze(["open", "closed", "archived"]);

const HIRED_VALUES = Object.freeze(["hired", "accepted"]);
const PENDING_VALUES = Object.freeze(["pending", "applied"]);

// Raw stored status -> one of APPLICATION_STATUS_ORDER.
const normalizeApplicationStatus = (raw) => {
  const value = String(raw || "").trim().toLowerCase();
  if (PENDING_VALUES.includes(value) || value === "") return value === "" ? "other" : "pending";
  if (HIRED_VALUES.includes(value)) return "hired";
  // "reviewed" is the old name for an application the employer has looked at.
  if (value === "reviewed" || value === "under_review") return "under_review";
  if (["shortlisted", "approved", "rejected", "withdrawn"].includes(value)) return value;
  return "other";
};

// rows: [{ _id: <raw status>, count }] from a $group on the lower-cased status.
// Returns { counts: {pending,...,other}, total, hires }.
const applicationStatusCounts = (rows) => {
  const counts = Object.fromEntries(APPLICATION_STATUS_ORDER.map((key) => [key, 0]));
  for (const row of rows || []) counts[normalizeApplicationStatus(row._id)] += Number(row.count || 0);
  const total = APPLICATION_STATUS_ORDER.reduce((sum, key) => sum + counts[key], 0);
  return { counts, total, hires: counts.hired };
};

// Raw vacancy bucket ("archived" flag already folded in) -> open | closed | archived | draft.
const normalizeVacancyStatus = (raw) => {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "archived") return "archived";
  if (value === "active") return "open";
  if (["closed", "filled", "completed", "hired"].includes(value)) return "closed";
  return "draft";
};

// rows: [{ _id: "archived" | <status>, count }]. Returns { open, closed, archived, total } (drafts left out).
const vacancyStatusCounts = (rows) => {
  const counts = { open: 0, closed: 0, archived: 0 };
  for (const row of rows || []) {
    const key = normalizeVacancyStatus(row._id);
    if (key !== "draft") counts[key] += Number(row.count || 0);
  }
  return { ...counts, total: counts.open + counts.closed + counts.archived };
};

// Aggregation expression for the raw vacancy bucket: the archive flag wins over the status.
const vacancyBucketExpression = () => ({ $cond: [{ $eq: ["$archived", true] }, "archived", { $toLower: { $ifNull: ["$status", "draft"] } }] });

// "  Service   Crew " and "service crew" are the same role.
const roleKey = (title) => String(title || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const cleanRoleTitle = (title) => String(title || "").replace(/\s+/g, " ").trim();

// rows: [{ title, count }] (title exactly as stored). Returns [{ title (most common spelling), count }],
// biggest first, ties by title. Empty titles are dropped.
const groupRoleTitles = (rows) => {
  const groups = new Map();
  for (const row of rows || []) {
    const key = roleKey(row.title);
    if (!key) continue;
    const count = Number(row.count || 0);
    if (!groups.has(key)) groups.set(key, { count: 0, spellings: new Map() });
    const group = groups.get(key);
    group.count += count;
    const spelling = cleanRoleTitle(row.title);
    group.spellings.set(spelling, (group.spellings.get(spelling) || 0) + count);
  }
  return [...groups.values()]
    .map((group) => {
      const [display] = [...group.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { title: display, count: group.count };
    })
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
};

const percentOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

module.exports = {
  APPLICATION_STATUS_ORDER,
  VACANCY_STATUS_ORDER,
  HIRED_VALUES,
  PENDING_VALUES,
  normalizeApplicationStatus,
  applicationStatusCounts,
  normalizeVacancyStatus,
  vacancyStatusCounts,
  vacancyBucketExpression,
  roleKey,
  groupRoleTitles,
  percentOf,
};
