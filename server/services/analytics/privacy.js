// Privacy helpers for statistics and reports: age brackets (never a date of birth)
// and the small-cell rule (any count under 5 is shown as "under 5", and a hidden
// number can never be worked out by subtracting from a total that is still shown).

const { getManilaToday, getAgeFromDate } = require("../../utils/age");
const { SMALL_CELL_THRESHOLD } = require("./config");

// Brackets by whole years of age, in Manila. Under 15 cannot hold an account.
const AGE_BRACKETS = Object.freeze(["15-17", "18-24", "25-30", "31+"]);
const UNKNOWN_BRACKET = "unknown";

// Bracket of one date of birth, same age rules as utils/age.js (birthday counts, Feb 29 rule).
const ageBracketOf = (dateOfBirth, now = new Date()) => {
  const age = getAgeFromDate(dateOfBirth, now);
  if (age === null || age < 15) return UNKNOWN_BRACKET;
  if (age <= 17) return "15-17";
  if (age <= 24) return "18-24";
  if (age <= 30) return "25-30";
  return "31+";
};

// Date of birth a person turning `years` today would have (the same technique as
// dobRangeForTier in utils/age.js, so no MongoDB $dateDiff is needed and every
// MongoDB version works).
const birthdayMinus = (years, now = new Date()) => {
  const t = getManilaToday(now);
  return new Date(Date.UTC(t.year - years, t.month - 1, t.day));
};

// Date-of-birth range for one bracket: { $gt, $lte } on the stored date of birth.
const dobRangeForBracket = (bracket, now = new Date()) => {
  switch (bracket) {
    case "15-17":
      return { $gt: birthdayMinus(18, now), $lte: birthdayMinus(15, now) };
    case "18-24":
      return { $gt: birthdayMinus(25, now), $lte: birthdayMinus(18, now) };
    case "25-30":
      return { $gt: birthdayMinus(31, now), $lte: birthdayMinus(25, now) };
    case "31+":
      return { $lte: birthdayMinus(31, now) };
    default:
      return null;
  }
};

// Aggregation expression that turns a date-of-birth field into its bracket label,
// without ever returning the date.
const ageBracketExpression = (field, now = new Date()) => ({
  $switch: {
    branches: [
      { case: { $not: [{ $gt: [field, null] }] }, then: UNKNOWN_BRACKET },
      { case: { $gt: [field, birthdayMinus(15, now)] }, then: UNKNOWN_BRACKET },
      { case: { $gt: [field, birthdayMinus(18, now)] }, then: "15-17" },
      { case: { $gt: [field, birthdayMinus(25, now)] }, then: "18-24" },
      { case: { $gt: [field, birthdayMinus(31, now)] }, then: "25-30" },
    ],
    default: "31+",
  },
});

// Small-cell suppression for one breakdown.
//   cells: [{ key, value }]; total: the sum of the cells (or null when no total is shown).
// Rules:
//   1. a cell with 1 to threshold-1 is hidden ("under 5");
//   2. if a total is shown and exactly one cell is hidden, the smallest visible cell is hidden
//      too (complementary suppression), so the hidden value cannot be got by subtraction;
//   3. if still not safe, the total is hidden.
// A zero is not sensitive and stays visible. Returns { cells, total, totalHidden } where a
// hidden cell is { key, value: null, suppressed: true } and its true value never leaves here.
const suppressSmallCells = (cells, { total, threshold = SMALL_CELL_THRESHOLD } = {}) => {
  const list = (cells || []).map((cell) => ({ key: cell.key, value: Number(cell.value) || 0, suppressed: false }));
  for (const cell of list) {
    if (cell.value > 0 && cell.value < threshold) cell.suppressed = true;
  }
  let totalShown = total !== null && total !== undefined;
  const hiddenCount = () => list.filter((cell) => cell.suppressed).length;

  if (totalShown && hiddenCount() === 1) {
    const candidates = list.filter((cell) => !cell.suppressed && cell.value > 0).sort((a, b) => a.value - b.value);
    if (candidates.length > 0) candidates[0].suppressed = true;
  }
  // One hidden cell and nothing else to hide with: hide the total instead.
  if (totalShown && hiddenCount() === 1) totalShown = false;

  return {
    cells: list.map((cell) => (cell.suppressed ? { key: cell.key, value: null, suppressed: true } : { key: cell.key, value: cell.value, suppressed: false })),
    total: totalShown ? total : null,
    totalHidden: !totalShown && total !== null && total !== undefined,
  };
};

// Whether a breakdown by these brackets needs the rule at all (it does for any age cut).
const needsSuppression = (breakdownKey) => ["ageBracket", "minor"].includes(breakdownKey);

module.exports = {
  AGE_BRACKETS,
  UNKNOWN_BRACKET,
  ageBracketOf,
  dobRangeForBracket,
  ageBracketExpression,
  suppressSmallCells,
  needsSuppression,
};
