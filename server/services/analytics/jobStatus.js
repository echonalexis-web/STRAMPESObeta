// How the admin screens group a posting's raw status into pending, active, closed or
// rejected, in one place for the list, the stats and the dashboards. Moved out of
// adminController; the rules are unchanged.

// Raw status values folded into "closed" and "rejected" (the database enum only has
// active, closed and draft; the rest are tolerated legacy spellings).
const CLOSED_STATUS_VALUES = ["closed", "filled", "hired", "completed"];
const REJECTED_STATUS_VALUES = ["rejected", "declined", "denied"];

const normalizeAdminJobStatus = (value = "") => {
  const status = String(value || "").trim().toLowerCase();

  if (status === "draft" || status === "pending" || status === "review") return "pending";
  if (status === "active") return "active";
  if (CLOSED_STATUS_VALUES.includes(status)) return "closed";
  if (REJECTED_STATUS_VALUES.includes(status)) return "rejected";

  return "pending";
};

// The same grouping as an aggregation expression over a status field.
const statusGroupExpression = (field) => {
  const value = { $toLower: { $trim: { input: { $ifNull: [field, ""] } } } };
  return {
    $switch: {
      branches: [
        { case: { $eq: [value, "active"] }, then: "active" },
        { case: { $in: [value, CLOSED_STATUS_VALUES] }, then: "closed" },
        { case: { $in: [value, REJECTED_STATUS_VALUES] }, then: "rejected" },
        { case: { $in: [value, ["draft", "pending", "review"]] }, then: "pending" },
      ],
      default: "pending",
    },
  };
};

module.exports = { CLOSED_STATUS_VALUES, REJECTED_STATUS_VALUES, normalizeAdminJobStatus, statusGroupExpression };
