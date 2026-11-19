// Pure helpers for the Browse Jobs salary range setter. Values travel as the
// same `salaryMin` / `salaryMax` filter params the old slider sent: a digit
// string, or '' for "no bound" (JobBoard drops empty params before the request).

export const SALARY_MAX_DIGITS = 7;

export const SALARY_CHIPS = [
  { id: "any", min: "", max: "" },
  { id: "under15", min: "", max: "15000" },
  { id: "15to30", min: "15000", max: "30000" },
  { id: "30to50", min: "30000", max: "50000" },
  { id: "over50", min: "50000", max: "" },
];

// Keep digits only and cap the length (typing, pasting).
export const cleanSalaryInput = (raw) =>
  String(raw ?? "").replace(/\D/g, "").slice(0, SALARY_MAX_DIGITS);

// Normalises a stored filter value (number, string or undefined) to '' or digits.
export const salaryValue = (value) => {
  if (value === undefined || value === null || value === "") return "";
  return cleanSalaryInput(value);
};

export const isSalaryRangeInvalid = (min, max) => {
  const lo = salaryValue(min);
  const hi = salaryValue(max);
  return lo !== "" && hi !== "" && Number(lo) > Number(hi);
};

export const hasSalaryFilter = (min, max) => salaryValue(min) !== "" || salaryValue(max) !== "";

// The chip whose range equals the current values exactly, or null.
export const activeSalaryChip = (min, max) => {
  const lo = salaryValue(min);
  const hi = salaryValue(max);
  return SALARY_CHIPS.find((chip) => chip.min === lo && chip.max === hi)?.id ?? null;
};

// Which summary to show: { kind: 'any' | 'from' | 'upTo' | 'between', min, max }.
export const salarySummaryParts = (min, max) => {
  const lo = salaryValue(min);
  const hi = salaryValue(max);
  if (lo === "" && hi === "") return { kind: "any" };
  if (hi === "") return { kind: "from", min: Number(lo) };
  if (lo === "") return { kind: "upTo", max: Number(hi) };
  return { kind: "between", min: Number(lo), max: Number(hi) };
};
